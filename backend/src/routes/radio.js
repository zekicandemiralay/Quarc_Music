const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { downloadBySearch } = require('../services/ytdlp');
const { getDb } = require('../db');
const { scanFile } = require('../services/scanner');
const { requireAuth } = require('../middleware/auth');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

// Radio Browser is a community-run directory backed by several independent
// mirror servers, not one canonical host — hardcoding a single mirror (the
// frontend used to call de1.api.radio-browser.info directly) means the whole
// feature goes down with "Failed to fetch" whenever that ONE mirror has a
// blip, even though the directory as a whole is healthy. Try each in turn.
// Also: their docs require a descriptive User-Agent, which browsers flatly
// refuse to let client-side JS set (it's a forbidden fetch header) — routing
// through the backend is the only way to actually comply.
const RADIO_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fr1.api.radio-browser.info',
];
const RADIO_USER_AGENT = 'QuarcMusic/1.0 (self-hosted personal music app; +https://github.com/zekicandemiralay/Quarc_Music)';

async function radioBrowserFetch(path, params) {
  let lastErr;
  for (const mirror of RADIO_MIRRORS) {
    try {
      const res = await fetch(`${mirror}${path}?${params}`, {
        headers: { 'User-Agent': RADIO_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      // try the next mirror
    }
  }
  throw lastErr || new Error('All Radio Browser mirrors unreachable');
}

router.use(requireAuth);

// Proxies Radio Browser's station search. Filters beyond hidebroken (which
// only catches what their own periodic checker has already flagged):
// is_https avoids stations whose stream silently fails from mixed-content
// blocking on this HTTPS-served app, and lastcheckok double-checks the
// stream was reachable on its last health check. order=votes sorts by
// cumulative listener popularity — the closest thing to "fame" the API has.
router.get('/stations', async (req, res) => {
  const { tag = '', name = '', limit = '60', offset = '0' } = req.query;
  try {
    const params = new URLSearchParams({
      limit,
      offset,
      order: 'votes',
      reverse: 'true',
      hidebroken: 'true',
      lastcheckok: '1',
      is_https: 'true',
    });
    if (tag) params.set('tag', tag);
    if (name) params.set('name', name);

    const data = await radioBrowserFetch('/json/stations/search', params);
    res.json(data.filter((s) => s.url_resolved));
  } catch (err) {
    res.status(502).json({ error: 'Radio directory unreachable — try again in a moment' });
  }
});

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
