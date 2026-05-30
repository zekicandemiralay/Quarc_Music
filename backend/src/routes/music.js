const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');
const { getDb } = require('../db');
const { scanMusicDir } = require('../services/scanner');
const { requireAuth } = require('../middleware/auth');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

// In-process cover art cache — avoids re-parsing the full audio file on every request.
// Covers are small (~100-300 KB each) and rarely change, so caching all of them is fine.
const coverCache = new Map();

router.use(requireAuth);

const MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg',
  '.aac': 'audio/aac',
};

router.get('/', (req, res) => {
  const songs = getDb()
    .prepare(`
      SELECT s.*, COALESCE(pc.play_count, 0) as play_count
      FROM songs s
      LEFT JOIN (
        SELECT song_id, COUNT(*) as play_count
        FROM listening_history
        WHERE user_id = ?
        GROUP BY song_id
      ) pc ON s.id = pc.song_id
      ORDER BY s.artist, s.album, s.track, s.title
    `)
    .all(req.user.id);
  res.json(songs);
});

router.post('/scan', async (_req, res) => {
  try {
    const count = await scanMusicDir(MUSIC_DIR);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/stream', (req, res) => {
  const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song || !fs.existsSync(song.filepath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(song.filepath);
  const fileSize = stat.size;
  const contentType = MIME[path.extname(song.filepath).toLowerCase()] || 'audio/mpeg';
  const range = req.headers.range;

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
    });
    fs.createReadStream(song.filepath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
    });
    fs.createReadStream(song.filepath).pipe(res);
  }
});

router.get('/:id/cover', async (req, res) => {
  const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song || !song.has_cover) return res.status(404).end();

  if (coverCache.has(song.id)) {
    const { data, format } = coverCache.get(song.id);
    res.set('Content-Type', format);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(data);
  }

  try {
    const meta = await mm.parseFile(song.filepath, { skipCovers: false });
    const pic = meta.common.picture?.[0];
    if (!pic) return res.status(404).end();
    const entry = { data: pic.data, format: pic.format || 'image/jpeg' };
    coverCache.set(song.id, entry);
    res.set('Content-Type', entry.format);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(entry.data);
  } catch {
    res.status(500).end();
  }
});

module.exports = router;
