const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

function sanitizeFolder(name) {
  return (name || '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 100);
}

function letterBucket(filepath) {
  const first = path.basename(filepath, path.extname(filepath))[0]?.toUpperCase() || '';
  return /[A-Z]/.test(first) ? first : '#';
}

router.use(requireAdmin);

router.get('/users', (_req, res) => {
  const users = getDb()
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at')
    .all();
  res.json(users);
});

router.post('/users', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(password, 12);

  try {
    const id = uuidv4();
    getDb().prepare(
      'INSERT INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)'
    ).run(id, username, hash, salt, 'user');
    res.json({ id, username, role: 'user' });
  } catch {
    res.status(409).json({ error: 'Username already taken' });
  }
});

router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  getDb().prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Reset password — data is preserved since there is no encryption key tied to the password
router.post('/users/:id/reset-password', async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.params.id);
  res.json({ ok: true });
});

// ── Featured Playlists ────────────────────────────────────────────────────────

router.get('/featured', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT fp.*, COUNT(fps.song_id) as song_count
    FROM featured_playlists fp
    LEFT JOIN featured_playlist_songs fps ON fp.id = fps.playlist_id
    GROUP BY fp.id
    ORDER BY fp.sort_order, fp.name
  `).all();
  res.json(rows);
});

router.post('/featured', (req, res) => {
  const { name, description, color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const id = uuidv4();
  getDb().prepare(
    'INSERT INTO featured_playlists (id, name, description, color) VALUES (?, ?, ?, ?)'
  ).run(id, name.trim(), description || '', color || '#7c3aed');
  res.json({ id, name: name.trim(), description: description || '', color: color || '#7c3aed', song_count: 0 });
});

router.put('/featured/:id', (req, res) => {
  const { name, description, color, sort_order } = req.body;
  const db = getDb();
  if (name !== undefined) db.prepare('UPDATE featured_playlists SET name=?, updated_at=datetime(\'now\') WHERE id=?').run(name, req.params.id);
  if (description !== undefined) db.prepare('UPDATE featured_playlists SET description=?, updated_at=datetime(\'now\') WHERE id=?').run(description, req.params.id);
  if (color !== undefined) db.prepare('UPDATE featured_playlists SET color=?, updated_at=datetime(\'now\') WHERE id=?').run(color, req.params.id);
  if (sort_order !== undefined) db.prepare('UPDATE featured_playlists SET sort_order=?, updated_at=datetime(\'now\') WHERE id=?').run(sort_order, req.params.id);
  res.json({ ok: true });
});

router.delete('/featured/:id', (req, res) => {
  getDb().prepare('DELETE FROM featured_playlists WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/featured/:id/songs', (req, res) => {
  const songs = getDb().prepare(`
    SELECT s.* FROM songs s
    JOIN featured_playlist_songs fps ON s.id = fps.song_id
    WHERE fps.playlist_id = ? ORDER BY fps.position
  `).all(req.params.id);
  res.json(songs);
});

router.post('/featured/:id/songs', (req, res) => {
  const { songId } = req.body;
  if (!songId) return res.status(400).json({ error: 'songId required' });
  const db = getDb();
  const { maxPos } = db.prepare(
    'SELECT COALESCE(MAX(position), -1) as maxPos FROM featured_playlist_songs WHERE playlist_id = ?'
  ).get(req.params.id);
  db.prepare(
    'INSERT OR IGNORE INTO featured_playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)'
  ).run(req.params.id, songId, maxPos + 1);
  res.json({ ok: true });
});

router.delete('/featured/:id/songs/:songId', (req, res) => {
  getDb().prepare(
    'DELETE FROM featured_playlist_songs WHERE playlist_id = ? AND song_id = ?'
  ).run(req.params.id, req.params.songId);
  res.json({ ok: true });
});

// ── Library reorganization ────────────────────────────────────────────────────

router.post('/reorganize', async (req, res) => {
  const db = getDb();
  const songs = db.prepare('SELECT * FROM songs').all();
  const update = db.prepare('UPDATE songs SET filepath = ? WHERE id = ?');

  let moved = 0, skipped = 0, errors = 0;

  for (const song of songs) {
    if (!fs.existsSync(song.filepath)) { errors++; continue; }

    // Already in a subfolder → skip
    const rel = path.relative(MUSIC_DIR, song.filepath);
    if (rel.includes(path.sep)) { skipped++; continue; }

    // Prefer DB artist; fall back to embedded ID3 tag
    let artist = song.artist && song.artist !== 'Unknown Artist' ? song.artist : null;
    if (!artist) {
      try {
        const meta = await mm.parseFile(song.filepath, { skipCovers: true, duration: false });
        artist = meta.common.artist || null;
      } catch {}
    }

    const folder = artist ? sanitizeFolder(artist) : letterBucket(song.filepath);
    const artistDir = path.join(MUSIC_DIR, folder);
    const filename = path.basename(song.filepath);
    let dest = path.join(artistDir, filename);

    // Resolve name collision
    if (fs.existsSync(dest) && dest !== song.filepath) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      dest = path.join(artistDir, `${base}_${song.id.slice(0, 6)}${ext}`);
    }

    try {
      fs.mkdirSync(artistDir, { recursive: true });
      fs.renameSync(song.filepath, dest);
      update.run(dest, song.id);
      moved++;
    } catch (err) {
      console.error(`Reorganize: failed to move ${song.filepath}:`, err.message);
      errors++;
    }
  }

  res.json({ total: songs.length, moved, skipped, errors });
});

module.exports = router;
