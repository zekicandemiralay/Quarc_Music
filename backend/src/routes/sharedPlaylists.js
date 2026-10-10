const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { SONG_LIST_COLUMNS } = require('../lib/songColumns');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

function isMember(db, playlistId, userId) {
  return !!db.prepare(
    'SELECT 1 FROM shared_playlist_members WHERE playlist_id = ? AND user_id = ?'
  ).get(playlistId, userId);
}

function areFriends(db, a, b) {
  return !!db.prepare(`
    SELECT 1 FROM friend_requests
    WHERE status = 'accepted'
      AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
  `).get(a, b, b, a);
}

router.get('/', (req, res) => {
  const playlists = getDb().prepare(`
    SELECT sp.id, sp.name, sp.created_by, sp.updated_at,
      (SELECT COUNT(*) FROM shared_playlist_songs WHERE playlist_id = sp.id) as song_count,
      (SELECT COUNT(*) FROM shared_playlist_members WHERE playlist_id = sp.id) as member_count
    FROM shared_playlists sp
    JOIN shared_playlist_members spm ON spm.playlist_id = sp.id
    WHERE spm.user_id = ?
    ORDER BY sp.updated_at DESC
  `).all(req.user.id);
  res.json(playlists);
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO shared_playlists (id, name, created_by) VALUES (?, ?, ?)').run(id, name.trim(), req.user.id);
  db.prepare('INSERT INTO shared_playlist_members (playlist_id, user_id) VALUES (?, ?)').run(id, req.user.id);
  res.json({ id, name: name.trim(), created_by: req.user.id, song_count: 0, member_count: 1 });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const playlist = db.prepare('SELECT * FROM shared_playlists WHERE id = ?').get(req.params.id);
  if (!playlist || !isMember(db, playlist.id, req.user.id)) return res.status(404).json({ error: 'Not found' });

  const members = db.prepare(`
    SELECT u.id, u.username FROM shared_playlist_members spm
    JOIN users u ON u.id = spm.user_id WHERE spm.playlist_id = ?
  `).all(playlist.id);
  const songs = db.prepare(`
    SELECT ${SONG_LIST_COLUMNS} FROM songs s
    JOIN shared_playlist_songs sps ON sps.song_id = s.id
    WHERE sps.playlist_id = ? ORDER BY sps.position
  `).all(playlist.id);

  res.json({ ...playlist, members, songs });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const playlist = db.prepare('SELECT * FROM shared_playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Not found' });
  if (playlist.created_by !== req.user.id) return res.status(403).json({ error: 'Only the creator can delete this playlist' });
  db.prepare('DELETE FROM shared_playlists WHERE id = ?').run(playlist.id);
  res.json({ ok: true });
});

router.post('/:id/songs', (req, res) => {
  const { songId } = req.body;
  if (!songId) return res.status(400).json({ error: 'songId required' });
  const db = getDb();
  if (!isMember(db, req.params.id, req.user.id)) return res.status(404).json({ error: 'Not found' });

  const { maxPos } = db.prepare(
    'SELECT COALESCE(MAX(position), -1) as maxPos FROM shared_playlist_songs WHERE playlist_id = ?'
  ).get(req.params.id);
  db.prepare(
    'INSERT OR IGNORE INTO shared_playlist_songs (playlist_id, song_id, position, added_by) VALUES (?, ?, ?, ?)'
  ).run(req.params.id, songId, maxPos + 1, req.user.id);
  db.prepare("UPDATE shared_playlists SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/songs/:songId', (req, res) => {
  const db = getDb();
  if (!isMember(db, req.params.id, req.user.id)) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM shared_playlist_songs WHERE playlist_id = ? AND song_id = ?').run(req.params.id, req.params.songId);
  db.prepare("UPDATE shared_playlists SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Only the creator invites, and only someone already a friend of the
// creator — there's no public join-link system here, so "who can end up in
// my shared playlist" stays bounded by the same friend graph everywhere else.
router.post('/:id/members', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  const db = getDb();
  const playlist = db.prepare('SELECT * FROM shared_playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Not found' });
  if (playlist.created_by !== req.user.id) return res.status(403).json({ error: 'Only the creator can add members' });
  if (!areFriends(db, req.user.id, userId)) return res.status(400).json({ error: 'You can only add a friend' });

  db.prepare('INSERT OR IGNORE INTO shared_playlist_members (playlist_id, user_id) VALUES (?, ?)').run(playlist.id, userId);
  res.json({ ok: true });
});

// Either the creator removing someone, or a member leaving on their own —
// the creator can't be removed this way (would orphan the playlist); they
// delete the whole playlist (DELETE /:id) instead.
router.delete('/:id/members/:userId', (req, res) => {
  const db = getDb();
  const playlist = db.prepare('SELECT * FROM shared_playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Not found' });
  const isSelf = req.params.userId === req.user.id;
  const isOwnerRemovingOther = playlist.created_by === req.user.id && req.params.userId !== playlist.created_by;
  if (!isSelf && !isOwnerRemovingOther) return res.status(403).json({ error: 'Not allowed' });
  if (req.params.userId === playlist.created_by) return res.status(400).json({ error: "The creator can't be removed — delete the playlist instead" });

  db.prepare('DELETE FROM shared_playlist_members WHERE playlist_id = ? AND user_id = ?').run(playlist.id, req.params.userId);
  res.json({ ok: true });
});

module.exports = router;
