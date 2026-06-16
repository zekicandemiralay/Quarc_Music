const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { searchYoutube, downloadAudio } = require('../services/ytdlp');
const { getDb } = require('../db');
const { scanFile } = require('../services/scanner');
const { requireAuth } = require('../middleware/auth');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

router.use(requireAuth);

router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  try {
    const results = await searchYoutube(q);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/download', (req, res) => {
  const { videoId, title, featuredPlaylistId } = req.body;
  if (!videoId) return res.status(400).json({ error: 'videoId required' });

  const jobId = uuidv4();
  const db = getDb();
  db.prepare('INSERT INTO downloads (id, video_id, title, status, user_id) VALUES (?, ?, ?, ?, ?)').run(
    jobId, videoId, title || 'Unknown', 'pending', req.user.id
  );

  downloadAudio(videoId, MUSIC_DIR, (progress) => {
    db.prepare('UPDATE downloads SET progress = ?, status = ? WHERE id = ?').run(
      progress, 'downloading', jobId
    );
  })
    .then(async (filepath) => {
      const song = filepath ? await scanFile(filepath) : null;
      db.prepare('UPDATE downloads SET status = ?, progress = 100, song_id = ? WHERE id = ?').run(
        'done', song?.id || null, jobId
      );
      // Auto-add to featured playlist if requested
      if (featuredPlaylistId && song?.id) {
        const { maxPos } = db.prepare(
          'SELECT COALESCE(MAX(position), -1) as maxPos FROM featured_playlist_songs WHERE playlist_id = ?'
        ).get(featuredPlaylistId);
        db.prepare(
          'INSERT OR IGNORE INTO featured_playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)'
        ).run(featuredPlaylistId, song.id, maxPos + 1);
      }
    })
    .catch((err) => {
      db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run(
        'error', err.message, jobId
      );
    });

  res.json({ jobId });
});

router.get('/download/status/:jobId', (req, res) => {
  const job = getDb().prepare('SELECT * FROM downloads WHERE id = ?').get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

module.exports = router;
