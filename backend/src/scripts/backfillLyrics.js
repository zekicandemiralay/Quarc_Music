// One-off/occasional bulk job — fetches lyrics from lrclib.net for every
// library song that hasn't been checked yet and caches the result in the
// songs table (see db.js migration + routes/music.js's GET /:id/lyrics,
// which does the same lookup lazily on first request — this script just
// front-loads it for the whole existing library instead of waiting for
// each song to be opened once).
//
// Usage (run inside the backend container):
//   node src/scripts/backfillLyrics.js
//   node src/scripts/backfillLyrics.js --retry-not-found   # also retries past misses
//
// Idempotent and resumable — safe to re-run or Ctrl+C and continue later,
// since already-checked songs (status set) are skipped by default.
const { getDb, initDb } = require('../db');
const { fetchLyrics } = require('../services/lyrics');

const RETRY_NOT_FOUND = process.argv.includes('--retry-not-found');
const DELAY_MS = 300; // courtesy throttle — lrclib is a free community service

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  initDb();
  const db = getDb();

  const statusFilter = RETRY_NOT_FOUND
    ? `lyrics_status IS NULL OR lyrics_status = 'not_found'`
    : `lyrics_status IS NULL`;
  const songs = db.prepare(`SELECT * FROM songs WHERE ${statusFilter} ORDER BY artist, album, track`).all();

  console.log(`Backfilling lyrics for ${songs.length} song(s)${RETRY_NOT_FOUND ? ' (including past misses)' : ''}...`);

  let found = 0, approximate = 0, notFound = 0, instrumental = 0, failed = 0;
  const update = db.prepare('UPDATE songs SET lyrics_status = ?, lyrics_plain = ?, lyrics_synced = ? WHERE id = ?');

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    try {
      const result = await fetchLyrics(song.artist, song.title, song.album, song.duration);
      const status = result?.status || 'not_found';
      update.run(status, result?.plain || null, result?.synced || null, song.id);
      if (status === 'found') found++;
      else if (status === 'approximate') approximate++; // matched via the broad title-only fallback — plain text from the original song, not this exact recording
      else if (status === 'instrumental') instrumental++;
      else notFound++;
    } catch (err) {
      failed++;
      console.error(`  ✗ "${song.artist} - ${song.title}": ${err.message}`);
    }

    if ((i + 1) % 25 === 0 || i === songs.length - 1) {
      console.log(`[${i + 1}/${songs.length}] found=${found} approximate=${approximate} not_found=${notFound} instrumental=${instrumental} failed=${failed}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. found=${found} approximate=${approximate} not_found=${notFound} instrumental=${instrumental} failed=${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
