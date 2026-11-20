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
//       including 'found'. Slow (one pass over the whole library), but it is the
//       only way to catch a 'found' that was a wrong match (the old matcher
//       trusted the first search hit without checking its title or length).
//   --fresh   ignore a saved progress file and start the pass from the beginning
//
// A full pass over a few thousand songs takes about an hour: lrclib rate-limits
// (HTTP 429 at roughly 4 requests/s), so the lyrics service paces every request
// and waits out any 429. To run it detached and watch it:
//   docker compose exec -d backend sh -c 'node src/scripts/backfillLyrics.js --recheck-weak > /tmp/lyrics-backfill.log 2>&1'
//   docker compose exec backend tail -f /tmp/lyrics-backfill.log
//
// Resumable: every finished song is recorded in a progress file next to the
// database, so after Ctrl+C, a crash, or the "lrclib looks unreachable" stop,
// running the SAME command again continues where it left off (the re-check
// modes would otherwise start over, since a re-checked song can still qualify).
// The file is deleted when a pass completes. A song whose lookup could not be
// completed is left exactly as it was — never overwritten with "not found" —
// and is retried on the next run.
const fs = require('fs');
const path = require('path');
const { getDb, initDb } = require('../db');
const { fetchLyrics } = require('../services/lyrics');

const RETRY_NOT_FOUND = process.argv.includes('--retry-not-found');
const RECHECK_WEAK = process.argv.includes('--recheck-weak');
const RECHECK_ALL = process.argv.includes('--recheck-all');
const FRESH = process.argv.includes('--fresh');
const MAX_CONSECUTIVE_FAILURES = 10; // lrclib is plainly unreachable — stop instead of grinding on

const MODE = RECHECK_ALL ? 'recheck-all' : RECHECK_WEAK ? 'recheck-weak' : RETRY_NOT_FOUND ? 'retry-not-found' : 'default';
// Same data folder as the database, so it survives container restarts (it's a volume).
const PROGRESS_FILE = process.env.LYRICS_BACKFILL_PROGRESS
  || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'music.db')), 'lyrics-backfill-progress.txt');

// First line: {mode, startedAt}. Every following line: the id of a finished song.
function loadProgress() {
  const none = { done: new Set(), startedAt: null };
  if (FRESH || !fs.existsSync(PROGRESS_FILE)) return none;
  const [head, ...ids] = fs.readFileSync(PROGRESS_FILE, 'utf8').split('\n').filter(Boolean);
  let meta;
  try { meta = JSON.parse(head); } catch { return none; }
  if (!meta || meta.mode !== MODE) return none; // a different kind of pass — don't mix them up
  return { done: new Set(ids), startedAt: meta.startedAt };
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

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
  const candidates = db.prepare(`SELECT * FROM songs WHERE ${statusFilter} ORDER BY artist, album, track`).all();

  const progress = loadProgress();
  const songs = candidates.filter((s) => !progress.done.has(String(s.id)));
  if (progress.startedAt) {
    // (Counts what the earlier run finished, not how many of those still qualify
    // for this pass — a song that turned out "found" leaves a weak-only pass.)
    console.log(`Resuming the ${MODE} pass started ${progress.startedAt}: ${progress.done.size} song(s) were finished earlier and are skipped. (Use --fresh to start over.)`);
  } else {
    fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, `${JSON.stringify({ mode: MODE, startedAt: new Date().toISOString() })}\n`);
  }

  const scope = RECHECK_ALL ? ' (re-checking everything, including past matches)'
    : RECHECK_WEAK ? ' (re-checking everything but confident matches)'
      : RETRY_NOT_FOUND ? ' (including past misses)' : '';
  console.log(`Backfilling lyrics for ${songs.length} song(s)${scope}...`);

  let found = 0, approximate = 0, notFound = 0, instrumental = 0, failed = 0, consecutiveFailures = 0;
  const update = db.prepare('UPDATE songs SET lyrics_status = ?, lyrics_plain = ?, lyrics_synced = ? WHERE id = ?');
  const t0 = Date.now();
  const summary = (i) => {
    const elapsed = Date.now() - t0;
    const eta = i > 0 ? ` | ${fmtDuration(elapsed)} elapsed, ~${fmtDuration((elapsed / (i + 1)) * (songs.length - i - 1))} left` : '';
    return `[${i + 1}/${songs.length}] found=${found} approximate=${approximate} not_found=${notFound} instrumental=${instrumental} failed=${failed}${eta}`;
  };

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    try {
      const result = await fetchLyrics(song.artist, song.title, song.album, song.duration);
      const status = result?.status || 'not_found';
      update.run(status, result?.plain || null, result?.synced || null, song.id);
      fs.appendFileSync(PROGRESS_FILE, `${song.id}\n`);
      consecutiveFailures = 0;
      if (status === 'found') found++;
      else if (status === 'approximate') approximate++; // same-titled song of similar length, plain text only — not this exact recording
      else if (status === 'instrumental') instrumental++;
      else notFound++;
    } catch (err) {
      // Includes LyricsUnavailableError: the row is deliberately left untouched
      // (and not recorded as done), so the next run tries it again.
      failed++;
      consecutiveFailures++;
      console.error(`  ✗ "${song.artist} - ${song.title}": ${err.message}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n${MAX_CONSECUTIVE_FAILURES} lookups in a row failed — lrclib looks unreachable. Stopping; nothing was overwritten.`);
        console.error('Run the same command again later to continue where this left off.');
        console.log(summary(i));
        process.exit(1);
      }
    }

    if ((i + 1) % 25 === 0 || i === songs.length - 1) console.log(summary(i));
  }

  if (failed === 0) {
    fs.rmSync(PROGRESS_FILE, { force: true }); // pass complete — nothing left to resume
  } else {
    console.log(`\n${failed} song(s) could not be checked and were left as they were — run the same command again to retry just those.`);
  }
  console.log(`\nDone. found=${found} approximate=${approximate} not_found=${notFound} instrumental=${instrumental} failed=${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
