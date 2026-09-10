const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { searchAndDownload, downloadAudioWithRetry } = require('../services/ytdlp');
const { cleanTitle, primaryArtist, normalizeWords } = require('../services/textClean');
const { relatedTracks, lastFailureReason } = require('../services/ytmusic');
const { getDb, setSongVideoId } = require('../db');
const { scanFile } = require('../services/scanner');
const { requireAuth } = require('../middleware/auth');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

// Last.fm is the fallback when YouTube Music can't confidently identify a
// song. Silencing it (RADIO_LASTFM_FALLBACK=off) makes YouTube Music the only
// source, so its real hit rate is visible instead of being quietly papered
// over — a lookup it fails now shows up as "no suggestions" rather than
// looking like a success. The Last.fm code stays put and is one .env line
// away from coming back. Every lookup logs which source answered, so
//   docker compose logs backend | grep '\[radio\]'
// is the reliability record.
const LASTFM_FALLBACK = (process.env.RADIO_LASTFM_FALLBACK || 'on').toLowerCase() !== 'off';

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
  const { artist = '', title = '', videoId = '', songId = '' } = req.query;
  if (!artist && !title) return res.status(400).json({ error: 'artist or title required' });

  // Every song in the library came from a YouTube video, so when we know which
  // one, seed the radio on it directly. Searching YouTube Music by artist+title
  // instead is a guess, and a plausible wrong guess — a cover, a live cut, a
  // different song of the same name — produces a queue that looks fine and
  // isn't. That guess is why suggestions were excellent for some songs and
  // half-random for others.
  let seedVideoId = videoId || null;
  if (!seedVideoId && songId) {
    seedVideoId = getDb().prepare('SELECT video_id FROM songs WHERE id = ?').get(songId)?.video_id || null;
  }

  // YouTube Music first — it's Google's recommender rather than Last.fm's
  // scrobble counts, and the difference is decisive outside Anglo pop: for
  // Turkish sanat müziği, Last.fm routinely returns nothing at all while this
  // returns the genre's canon. Each track comes back with its own videoId, so
  // downloading it later needs no name matching whatsoever. Returns [] (never
  // throws) when the song can't be confidently identified, so Last.fm still
  // gets its turn. See services/ytmusic.js.
  const label = `"${artist} - ${title}"`;
  const fromYouTube = await relatedTracks(artist, title, seedVideoId);
  if (fromYouTube.length) {
    console.log(`[radio] youtube-music → ${fromYouTube.length} suggestions for ${label}${seedVideoId ? ' (exact seed)' : ' (matched by name)'}`);
    res.set('X-Radio-Source', 'youtube-music');
    return res.json(fromYouTube.map((t) => ({ artist: t.artist, title: t.title, videoId: t.videoId })));
  }

  if (!LASTFM_FALLBACK) {
    // Deliberately empty rather than falling through: the client drops to a
    // random library song, which is the honest outcome of YouTube Music not
    // finding this one.
    const why = lastFailureReason();
    if (why && /40[39]/.test(why)) {
      // Not a matching problem — YouTube is refusing us outright, so EVERY
      // song fails, not just this one, and radio is on random library picks
      // until it lifts. Usually self-inflicted by a bulk job on the same API.
      console.error(`[radio] youtube-music BLOCKED (${why}) — radio is degraded for everyone until this clears. Set RADIO_LASTFM_FALLBACK=on to keep suggestions working.`);
    } else {
      console.warn(`[radio] youtube-music → NOTHING for ${label}${why ? ` (${why})` : ''} (last.fm fallback is off)`);
    }
    res.set('X-Radio-Source', 'none');
    return res.json([]);
  }

  if (!apiKey) return res.status(503).json({ error: 'Radio not configured — set LASTFM_API_KEY in .env' });

  // Last.fm matches on an exact artist + track pair, so it has to be given
  // the performer and the song name — not the raw tags a downloaded file
  // carries. An artist field listing every credited writer
  // ("Zeki Müren, M. Seyran") matches no artist at all and returns zero
  // similar tracks, which is how a perfectly well-known song ends up
  // silently falling back to random library picks. See services/textClean.js.
  const lookupArtist = primaryArtist(artist);
  const lookupTitle = cleanTitle(title);

  try {
    const url = new URL('http://ws.audioscrobbler.com/2.0/');
    url.searchParams.set('method', 'track.getSimilar');
    url.searchParams.set('artist', lookupArtist);
    url.searchParams.set('track', lookupTitle);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '20');
    url.searchParams.set('autocorrect', '1');

    const response = await fetch(url.toString());
    const data = await response.json();
    const tracks = data.similartracks?.track || [];

    console.log(`[radio] last.fm → ${tracks.length} suggestions for ${label} (youtube-music found nothing)`);
    res.set('X-Radio-Source', 'lastfm');
    res.json(tracks.map(t => ({
      artist: t.artist.name,
      title: t.name,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Compare the way a listener would, not the way a string comparison does:
// case, diacritics, punctuation and spacing all differ freely between a
// suggestion's name and the tags on a file already sitting in the library
// ("Elbet Birgün" / "Elbet Bir Gün").
function libraryKey(artist, title) {
  return `${normalizeWords(primaryArtist(artist)).join('')}::${normalizeWords(cleanTitle(title)).join('')}`;
}

// Radio additions are permanent, so over time the library accumulates exactly
// the songs radio likes to suggest — and re-downloading one costs a minute of
// waiting for a file we already have. Two ways to recognise it: the download
// history knows the precise YouTube id we fetched before, and failing that,
// the tags.
function findInLibrary(db, { artist, title, videoId }) {
  if (videoId) {
    const prev = db.prepare(
      "SELECT song_id FROM downloads WHERE video_id = ? AND status = 'done' AND song_id IS NOT NULL ORDER BY created_at DESC LIMIT 1"
    ).get(videoId);
    if (prev?.song_id) {
      const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(prev.song_id);
      if (song) return song; // exact — same video, same file
    }
  }

  const want = libraryKey(artist, title);
  const hit = db.prepare('SELECT id, artist, title FROM songs').all()
    .find((r) => libraryKey(r.artist, r.title) === want);
  return hit ? db.prepare('SELECT * FROM songs WHERE id = ?').get(hit.id) : null;
}

router.post('/download', (req, res) => {
  const { artist, title, videoId } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const db = getDb();

  // Already have it — hand it straight back. No job, no download, no wait.
  const existing = findInLibrary(db, { artist, title, videoId });
  if (existing) return res.json({ song: existing, source: 'library' });

  const query = artist ? `${artist} - ${title}` : title;
  const jobId = uuidv4();

  // Record the real video id when the suggestion carried one, so the next
  // time this track comes up the exact-match check above finds it.
  db.prepare(
    'INSERT INTO downloads (id, video_id, title, status, user_id) VALUES (?, ?, ?, ?, ?)'
  ).run(jobId, videoId || `radio:${jobId}`, query, 'pending', req.user.id);

  // searchAndDownload, not downloadBySearch: it scores several candidates on
  // title/artist match and version keywords (live/acoustic/remix) and falls
  // through to the next one if the top pick is a dead video, instead of
  // blindly taking the first YouTube hit. Radio picks songs the user never
  // explicitly chose AND keeps them in the library permanently, so grabbing
  // a cover or an unrelated upload is worse here than anywhere else.
  const onProgress = (progress) => {
    db.prepare('UPDATE downloads SET progress = ?, status = ? WHERE id = ?').run(
      progress, 'downloading', jobId
    );
  };

  // A suggestion from YouTube Music already names the exact upload, so there
  // is nothing to search for or score — fetch that video. Only a Last.fm
  // suggestion (name only) has to go hunting.
  const job = videoId
    ? downloadAudioWithRetry(videoId, MUSIC_DIR, onProgress)
    : searchAndDownload(artist || null, title, null, null, MUSIC_DIR, onProgress);

  job
    .then(async (filepath) => {
      const song = filepath ? await scanFile(filepath) : null;
      setSongVideoId(song?.id, videoId); // null when this came from a name-only suggestion
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
