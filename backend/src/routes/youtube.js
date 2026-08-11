const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { searchYoutube, downloadAudioWithRetry, downloadBySearch } = require('../services/ytdlp');
const { getDb } = require('../db');
const { scanFile } = require('../services/scanner');
const { requireAuth } = require('../middleware/auth');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

// A "sign in to confirm you're not a bot" on one specific video/session isn't
// necessarily a fleet-wide problem (that's what autoheal.sh's VPN rotation is
// for) — YouTube can flag one upload/PO-token combo while a different upload
// of the exact same song is unaffected. searchAndDownload already falls
// through candidates for CSV imports; do the same here for a manual pick
// before surfacing a failure to the user.
const BOT_CHECK_PATTERN = /sign in to confirm|login_required/i;

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

  const onProgress = (progress) => {
    db.prepare('UPDATE downloads SET progress = ?, status = ? WHERE id = ?').run(
      progress, 'downloading', jobId
    );
  };

  const finish = async (filepath) => {
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
  };

  downloadAudioWithRetry(videoId, MUSIC_DIR, onProgress)
    .then(finish)
    .catch(async (err) => {
      if (title && BOT_CHECK_PATTERN.test(err.message)) {
        try {
          const filepath = await downloadBySearch(title, MUSIC_DIR, onProgress);
          if (filepath) return await finish(filepath);
        } catch {
          // fall through to recording the original error below
        }
      }
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
