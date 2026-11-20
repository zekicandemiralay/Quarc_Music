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
//   node src/scripts/backfillLyrics.js --recheck-weak      # also re-checks every
//       result that isn't a confident synced match (not_found / approximate /
//       instrumental). Worth running after a matching improvement: an
//       'approximate' song (plain text from a different recording) may now
//       resolve to a proper time-synced match, or — under the stricter rules —
//       correctly turn into not_found.
//   node src/scripts/backfillLyrics.js --recheck-all       # re-checks EVERYTHING,
//       including 'found'. Slow (one pass over the whole library) and not
//       resumable — it starts over each run — but it is the only way to catch a
//       'found' that was a wrong match (the old matcher trusted the first
//       search hit without checking its title or length).
//
// Idempotent and resumable (except --recheck-all) — safe to re-run or Ctrl+C
// and continue later, since already-checked songs (status set) are skipped by
// default. A song whose lookup could not be completed (lrclib down/timing out)
// is left exactly as it was, never overwritten with "not found".
const { getDb, initDb } = require('../db');
const { fetchLyrics } = require('../services/lyrics');

const RETRY_NOT_FOUND = process.argv.includes('--retry-not-found');
const RECHECK_WEAK = process.argv.includes('--recheck-weak');
const RECHECK_ALL = process.argv.includes('--recheck-all');
const DELAY_MS = 300; // courtesy throttle — lrclib is a free community service
const MAX_CONSECUTIVE_FAILURES = 10; // lrclib is plainly unreachable — stop instead of grinding on

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  initDb();
  const db = getDb();

  const statusFilter = RECHECK_ALL
    ? '1 = 1'
    : RECHECK_WEAK
      ? `lyrics_status IS NULL OR lyrics_status IN ('not_found', 'approximate', 'instrumental')`
      : RETRY_NOT_FOUND
        ? `lyrics_status IS NULL OR lyrics_status = 'not_found'`
        : `lyrics_status IS NULL`;
  const songs = db.prepare(`SELECT * FROM songs WHERE ${statusFilter} ORDER BY artist, album, track`).all();

  const scope = RECHECK_ALL ? ' (re-checking everything, including past matches)'
    : RECHECK_WEAK ? ' (re-checking everything but confident matches)'
      : RETRY_NOT_FOUND ? ' (including past misses)' : '';
  console.log(`Backfilling lyrics for ${songs.length} song(s)${scope}...`);

  let found = 0, approximate = 0, notFound = 0, instrumental = 0, failed = 0, consecutiveFailures = 0;
  const update = db.prepare('UPDATE songs SET lyrics_status = ?, lyrics_plain = ?, lyrics_synced = ? WHERE id = ?');

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    try {
      const result = await fetchLyrics(song.artist, song.title, song.album, song.duration);
      const status = result?.status || 'not_found';
      update.run(status, result?.plain || null, result?.synced || null, song.id);
      consecutiveFailures = 0;
      if (status === 'found') found++;
      else if (status === 'approximate') approximate++; // same-titled song of similar length, plain text only — not this exact recording
      else if (status === 'instrumental') instrumental++;
      else notFound++;
    } catch (err) {
      // Includes LyricsUnavailableError: the row is deliberately left untouched.
      failed++;
      consecutiveFailures++;
      console.error(`  ✗ "${song.artist} - ${song.title}": ${err.message}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n${MAX_CONSECUTIVE_FAILURES} lookups in a row failed — lrclib looks unreachable. Stopping; nothing was overwritten. Re-run later to continue.`);
        console.log(`[${i + 1}/${songs.length}] found=${found} approximate=${approximate} not_found=${notFound} instrumental=${instrumental} failed=${failed}`);
        process.exit(1);
      }
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
