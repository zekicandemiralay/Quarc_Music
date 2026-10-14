const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { searchYoutube, downloadAudioWithRetry, downloadBySearch } = require('../services/ytdlp');
const { getDb, setSongVideoId } = require('../db');
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

// jobId → AbortController, for exactly as long as that job is actually in
// flight. downloadAudioWithRetry already honours a signal all the way down
// to killing the real yt-dlp process (see services/ytdlp.js) — it just
// never had a route wired up to actually produce one for a single-song
// download (only the CSV/bulk import path did).
const activeDownloads = new Map();

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
    setSongVideoId(song?.id, videoId); // so radio can seed on it exactly, not by name
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

  const controller = new AbortController();
  activeDownloads.set(jobId, controller);

  downloadAudioWithRetry(videoId, MUSIC_DIR, onProgress, 3, controller.signal)
    .then(finish)
    .catch(async (err) => {
      if (err.cancelled) {
        db.prepare('UPDATE downloads SET status = ? WHERE id = ?').run('cancelled', jobId);
        return;
      }
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
    })
    .finally(() => activeDownloads.delete(jobId));

  res.json({ jobId });
});

// Scoped to req.user.id on both of these — jobId alone used to be enough to
// read or cancel anyone's download (any authenticated user could poll or
// abort any job just by knowing/guessing its id), which matters more now
// that a job can be resumed across a login on a shared device (see
// useDownloadsStore.js's resume()).
router.get('/download/status/:jobId', (req, res) => {
  const job = getDb().prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?').get(req.params.jobId, req.user.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

router.post('/download/:jobId/cancel', (req, res) => {
  const job = getDb().prepare('SELECT id FROM downloads WHERE id = ? AND user_id = ?').get(req.params.jobId, req.user.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const controller = activeDownloads.get(req.params.jobId);
  if (!controller) return res.status(404).json({ error: 'No active download with that id' });
  controller.abort();
  res.json({ ok: true });
});

module.exports = router;
