const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { SONG_LIST_COLUMNS } = require('../lib/songColumns');
const { requireAuth, ensureLocalUser } = require('../middleware/auth');
const { asyncRoute } = require('../lib/asyncRoute');

// A friend's heartbeat (see POST /now-playing) older than this is treated as
// "stopped" even if nothing explicitly told us so — covers a closed tab, a
// crashed client, or a lost connection. The frontend heartbeats well inside
// this window, so a friend who's actually still playing never flickers to
// offline between heartbeats.
const NOW_PLAYING_STALE_SECONDS = 30;

router.use(requireAuth);

// Finds an accepted friendship row between the two ids, either direction.
function friendshipRow(db, a, b) {
  return db.prepare(`
    SELECT * FROM friend_requests
    WHERE status = 'accepted'
      AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
  `).get(a, b, b, a);
}

// ── Search & requests ───────────────────────────────────────────────────────

// Real usernames live in quarc-auth, not this app's local mirror (someone
// who's only ever used a sibling Quarc app wouldn't be in it) — same reason
// the admin user list proxies there. Decorates each hit with the caller's
// current relationship to that user so the frontend can show the right
// button (Add / Pending / Friends) without a second round-trip.
router.get('/search', asyncRoute(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);

  const authRes = await fetch(`http://quarc-auth:3002/api/auth/users/search?q=${encodeURIComponent(q)}`, {
    headers: { Cookie: `token=${req.cookies.token}` },
  });
  const users = await authRes.json().catch(() => []);
  if (!authRes.ok) return res.status(authRes.status).json({ error: 'Could not reach quarc-auth' });

  const db = getDb();
  const results = users.map((u) => {
    const row = db.prepare(`
      SELECT * FROM friend_requests
      WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
    `).get(req.user.id, u.id, u.id, req.user.id);
    let status = 'none';
    if (row) {
      if (row.status === 'accepted') status = 'friends';
      else status = row.from_user_id === req.user.id ? 'pending_outgoing' : 'pending_incoming';
    }
    return { id: u.id, username: u.username, status };
  });
  res.json(results);
}));

router.get('/requests', (req, res) => {
  const db = getDb();
  const incoming = db.prepare(`
    SELECT fr.id, fr.from_user_id as userId, u.username, fr.created_at
    FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id
    WHERE fr.to_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user.id);
  const outgoing = db.prepare(`
    SELECT fr.id, fr.to_user_id as userId, u.username, fr.created_at
    FROM friend_requests fr JOIN users u ON u.id = fr.to_user_id
    WHERE fr.from_user_id = ? AND fr.status = 'pending'
    ORDER BY fr.created_at DESC
  `).all(req.user.id);
  res.json({ incoming, outgoing });
});

router.post('/requests', (req, res) => {
  const { toUserId, toUsername } = req.body;
  if (!toUserId || !toUsername) return res.status(400).json({ error: 'toUserId and toUsername required' });
  if (toUserId === req.user.id) return res.status(400).json({ error: "You can't friend yourself" });

  const db = getDb();
  // The target may never have made a request against this app before (they
  // only exist in quarc-auth so far) — provision the same placeholder local
  // row ensureLocalUser() would create on their own first login, so the FK
  // on friend_requests has something to point at.
  ensureLocalUser({ id: toUserId, username: toUsername, role: 'user' });

  const existing = db.prepare(`
    SELECT * FROM friend_requests
    WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
  `).get(req.user.id, toUserId, toUserId, req.user.id);

  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
    if (existing.from_user_id === req.user.id) return res.status(409).json({ error: 'Request already sent' });
    // They'd already asked us — treat this as accepting theirs rather than
    // creating a confusing second, reversed row.
    db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(existing.id);
    return res.json({ ok: true, status: 'accepted' });
  }

  db.prepare(
    'INSERT INTO friend_requests (id, from_user_id, to_user_id, status) VALUES (?, ?, ?, ?)'
  ).run(uuidv4(), req.user.id, toUserId, 'pending');
  res.json({ ok: true, status: 'pending' });
});

router.post('/requests/:id/accept', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
  if (!row || row.to_user_id !== req.user.id) return res.status(404).json({ error: 'Request not found' });
  if (row.status !== 'pending') return res.status(400).json({ error: 'Request is not pending' });
  db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// Covers both declining an incoming request and cancelling one you sent —
// either party may delete a pending row.
router.delete('/requests/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(req.params.id);
  if (!row || (row.from_user_id !== req.user.id && row.to_user_id !== req.user.id)) {
    return res.status(404).json({ error: 'Request not found' });
  }
  db.prepare('DELETE FROM friend_requests WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ── Friends list ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const friends = getDb().prepare(`
    SELECT u.id, u.username
    FROM friend_requests fr
    JOIN users u ON u.id = (CASE WHEN fr.from_user_id = ? THEN fr.to_user_id ELSE fr.from_user_id END)
    WHERE (fr.from_user_id = ? OR fr.to_user_id = ?) AND fr.status = 'accepted'
    ORDER BY u.username
  `).all(req.user.id, req.user.id, req.user.id);
  res.json(friends);
});

router.delete('/:friendId', (req, res) => {
  const db = getDb();
  const row = friendshipRow(db, req.user.id, req.params.friendId);
  if (!row) return res.status(404).json({ error: 'Not friends' });
  db.prepare('DELETE FROM friend_requests WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ── Now playing / activity feed ─────────────────────────────────────────

// Heartbeat while a song is actively playing (frontend calls this every
// ~15-20s — see playerStore.js). Upserting rather than inserting means a
// friend only ever has one current "now playing" row, never a backlog.
router.post('/now-playing', (req, res) => {
  const { songId } = req.body;
  if (!songId) return res.status(400).json({ error: 'songId required' });
  getDb().prepare(`
    INSERT INTO now_playing (user_id, song_id, heartbeat_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET song_id = excluded.song_id, heartbeat_at = excluded.heartbeat_at
  `).run(req.user.id, songId);
  res.json({ ok: true });
});

// Explicit stop (pause/song-end/tab-close best-effort) — snappier than
// waiting for the heartbeat to just go stale.
router.delete('/now-playing', (req, res) => {
  getDb().prepare('DELETE FROM now_playing WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.get('/activity', (req, res) => {
  const db = getDb();
  const friends = db.prepare(`
    SELECT u.id, u.username
    FROM friend_requests fr
    JOIN users u ON u.id = (CASE WHEN fr.from_user_id = ? THEN fr.to_user_id ELSE fr.from_user_id END)
    WHERE (fr.from_user_id = ? OR fr.to_user_id = ?) AND fr.status = 'accepted'
  `).all(req.user.id, req.user.id, req.user.id);

  const nowPlayingStmt = db.prepare(`
    SELECT ${SONG_LIST_COLUMNS}, np.heartbeat_at FROM now_playing np
    JOIN songs s ON s.id = np.song_id
    WHERE np.user_id = ? AND np.heartbeat_at > datetime('now', '-${NOW_PLAYING_STALE_SECONDS} seconds')
  `);
  const recentStmt = db.prepare(`
    SELECT ${SONG_LIST_COLUMNS}, lh.played_at FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    WHERE lh.user_id = ?
    ORDER BY lh.played_at DESC LIMIT 1
  `);

  const activity = friends.map((f) => ({
    userId: f.id,
    username: f.username,
    nowPlaying: nowPlayingStmt.get(f.id) || null,
    recentlyPlayed: recentStmt.get(f.id) || null,
  }));
  res.json(activity);
});

module.exports = router;
