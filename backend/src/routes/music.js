const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');
const { getDb } = require('../db');
const { SONG_LIST_COLUMNS } = require('../lib/songColumns');
const { scanMusicDir } = require('../services/scanner');
const { fetchLyrics } = require('../services/lyrics');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/asyncRoute');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';

// In-process cover art cache — avoids re-parsing the full audio file on every
// request.
//
// Bounded by BYTES, not entry count, because cover sizes vary by more than an
// order of magnitude: files downloaded since the thumbnail change carry a
// ~18KB JPEG, but anything older (or imported from elsewhere) can hold a
// 500KB+ PNG. An unbounded Map warmed with every cover in the library —
// which is what this used to be — therefore has no predictable ceiling at
// all; it is however large the library's artwork happens to add up to, held
// resident forever. Least-recently-used entries are dropped once the budget
// is reached, which for a music player is a good proxy for what nobody is
// looking at.
const COVER_CACHE_BUDGET = Number(process.env.COVER_CACHE_MB || 192) * 1024 * 1024;

const coverCache = new Map(); // insertion order == LRU order; re-set on read
let coverCacheBytes = 0;

function cacheCover(id, entry) {
  if (coverCache.has(id)) coverCacheBytes -= coverCache.get(id).data.length;
  coverCache.set(id, entry);
  coverCacheBytes += entry.data.length;
  // Map iterates in insertion order, so the first key is the coldest.
  while (coverCacheBytes > COVER_CACHE_BUDGET && coverCache.size > 1) {
    const oldest = coverCache.keys().next().value;
    coverCacheBytes -= coverCache.get(oldest).data.length;
    coverCache.delete(oldest);
  }
}

function readCover(id) {
  const entry = coverCache.get(id);
  if (!entry) return null;
  coverCache.delete(id); // re-insert so it counts as recently used
  coverCache.set(id, entry);
  return entry;
}

// Warm the cache at startup so the first user request is never slow.
// Runs in the background with a small concurrency limit to avoid hammering the
// disk, and stops once the budget is full rather than reading artwork it would
// only evict again.
async function warmCoverCache() {
  try {
    const db = require('../db').getDb();
    const songs = db.prepare('SELECT id, filepath FROM songs WHERE has_cover = 1').all();
    const BATCH = 8;
    for (let i = 0; i < songs.length; i += BATCH) {
      if (coverCacheBytes >= COVER_CACHE_BUDGET) {
        console.log(`Cover cache warm-up stopped at the ${Math.round(COVER_CACHE_BUDGET / 1048576)}MB budget — ${coverCache.size}/${songs.length} covers loaded`);
        return;
      }
      await Promise.all(songs.slice(i, i + BATCH).map(async (s) => {
        if (coverCache.has(s.id)) return;
        try {
          const meta = await mm.parseFile(s.filepath, { skipCovers: false });
          const pic = meta.common.picture?.[0];
          if (pic) cacheCover(s.id, { data: pic.data, format: pic.format || 'image/jpeg' });
        } catch {}
      }));
    }
    console.log(`Cover cache warmed — ${coverCache.size} covers, ${Math.round(coverCacheBytes / 1048576)}MB`);
  } catch (err) {
    console.error('Cover cache warm-up failed:', err.message);
  }
}
// Delay slightly so the server is fully ready before hitting disk
setTimeout(warmCoverCache, 5000);

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
      SELECT ${SONG_LIST_COLUMNS}, COALESCE(pc.play_count, 0) as play_count
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

// Single-song lookup — used by "Play now" straight from the download page,
// which only has a song ID at that point, not the full record playSong()
// needs (title/artist/has_cover/duration/etc.).
router.get('/:id', (req, res) => {
  const song = getDb().prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });
  res.json(song);
});

router.post('/scan', async (_req, res) => {
  try {
    const count = await scanMusicDir(MUSIC_DIR);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Parse one byte range against a known file size, per RFC 7233.
//
// The old parser split on "-" and assumed both halves were numbers, which
// mishandles three real cases: a SUFFIX range ("bytes=-500" means the last
// 500 bytes, a perfectly valid request some players use to read trailing
// tags) came out as start=NaN; a start past the end of the file, or an
// inverted range, produced a negative Content-Length. All of them then made
// fs.createReadStream throw ERR_OUT_OF_RANGE — and because writeHead(206)
// had already run, the client was left holding a 206 with a nonsense length
// and a connection that dies mid-response instead of an honest error.
//
// Returns null when the range can't be satisfied, so the caller can answer
// 416 the way the spec asks.
function parseRange(rangeHeader, fileSize) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || '').trim());
  if (!m) return null;
  const [, startStr, endStr] = m;
  if (startStr === '' && endStr === '') return null;

  let start;
  let end;
  if (startStr === '') {
    // Suffix: "-N" is the last N bytes, not a range beginning at N.
    const suffix = parseInt(endStr, 10);
    if (!suffix) return null; // "-0" asks for nothing
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr === '' ? fileSize - 1 : parseInt(endStr, 10);
    end = Math.min(end, fileSize - 1); // clamp; asking past EOF is not an error
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= fileSize) return null;
  return { start, end };
}

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
    const parsed = parseRange(range, fileSize);
    if (!parsed) {
      // Tell the client the truth rather than opening a stream that can't work.
      res.set('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }
    const { start, end } = parsed;
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

  const cached = readCover(song.id);
  if (cached) {
    res.set('Content-Type', cached.format);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(cached.data);
  }

  try {
    const meta = await mm.parseFile(song.filepath, { skipCovers: false });
    const pic = meta.common.picture?.[0];
    if (!pic) return res.status(404).end();
    const entry = { data: pic.data, format: pic.format || 'image/jpeg' };
    cacheCover(song.id, entry);
    res.set('Content-Type', entry.format);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(entry.data);
  } catch {
    res.status(500).end();
  }
});

// Lazily fetched and cached in the songs table on first request — 'found' |
// 'not_found' | 'instrumental' short-circuits every request after the first
// so a song with no lyrics doesn't re-query lrclib forever. ?refresh=1
// forces a re-check (e.g. lyrics got added to lrclib since we last looked).
router.get('/:id/lyrics', asyncRoute(async (req, res) => {
  const db = getDb();
  const song = db.prepare('SELECT * FROM songs WHERE id = ?').get(req.params.id);
  if (!song) return res.status(404).json({ error: 'Song not found' });

  const force = req.query.refresh === '1';
  if (!force && song.lyrics_status) {
    return res.json({ status: song.lyrics_status, plain: song.lyrics_plain, synced: song.lyrics_synced });
  }

  const result = await fetchLyrics(song.artist, song.title, song.album, song.duration);
  const status = result?.status || 'not_found';
  db.prepare('UPDATE songs SET lyrics_status = ?, lyrics_plain = ?, lyrics_synced = ? WHERE id = ?')
    .run(status, result?.plain || null, result?.synced || null, song.id);

  res.json({ status, plain: result?.plain || null, synced: result?.synced || null });
}));

module.exports = router;
