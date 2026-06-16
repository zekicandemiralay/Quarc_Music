const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { downloadBySearch } = require('../services/ytdlp');
const { getDb } = require('../db');
const { scanFile } = require('../services/scanner');
const { requireAuth } = require('../middleware/auth');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

router.use(requireAuth);

router.get('/suggestions', async (req, res) => {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Radio not configured — set LASTFM_API_KEY in .env' });

  const { artist = '', title = '' } = req.query;
  if (!artist && !title) return res.status(400).json({ error: 'artist or title required' });

  try {
    const url = new URL('http://ws.audioscrobbler.com/2.0/');
    url.searchParams.set('method', 'track.getSimilar');
    url.searchParams.set('artist', artist);
    url.searchParams.set('track', title);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '20');
    url.searchParams.set('autocorrect', '1');

    const response = await fetch(url.toString());
    const data = await response.json();
    const tracks = data.similartracks?.track || [];

    res.json(tracks.map(t => ({
      artist: t.artist.name,
      title: t.name,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/download', (req, res) => {
  const { artist, title } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const query = artist ? `${artist} - ${title}` : title;
  const jobId = uuidv4();
  const db = getDb();

  db.prepare(
    'INSERT INTO downloads (id, video_id, title, status, user_id) VALUES (?, ?, ?, ?, ?)'
  ).run(jobId, `radio:${jobId}`, query, 'pending', req.user.id);

  downloadBySearch(query, MUSIC_DIR, (progress) => {
    db.prepare('UPDATE downloads SET progress = ?, status = ? WHERE id = ?').run(
      progress, 'downloading', jobId
    );
  })
    .then(async (filepath) => {
      const song = filepath ? await scanFile(filepath) : null;
      db.prepare('UPDATE downloads SET status = ?, progress = 100, song_id = ? WHERE id = ?').run(
        'done', song?.id ?? null, jobId
      );
    })
    .catch((err) => {
      db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run(
        'error', err.message, jobId
      );
    });

  res.json({ jobId });
});

router.get('/status/:jobId', (req, res) => {
  const db = getDb();
  const job = db.prepare('SELECT * FROM downloads WHERE id = ?').get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'done' && job.song_id) {
    const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(job.song_id);
    return res.json({ ...job, song: song || null });
  }

  res.json(job);
});

module.exports = router;
