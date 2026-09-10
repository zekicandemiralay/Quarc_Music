// Resolve the YouTube video each library song came from, once, and store it on
// the song (songs.video_id). Radio then seeds its suggestions on that exact
// track instead of searching YouTube Music by artist+title every time it needs
// a queue.
//
// Why it matters: the name search is a guess, and a plausible wrong guess — a
// cover, a live cut, a different song sharing a title — produces a radio queue
// that looks perfectly valid and has nothing to do with what's playing. That
// is why suggestions were excellent for some songs and half-random for others.
// An id can't be spelled two ways.
//
// Songs downloaded through the app after this ships record their id at
// download time (see db.js setSongVideoId), and the db migration already
// carried across everything the downloads table knew. This script is for the
// rest: the bulk-imported and disk-scanned back catalogue.
//
// Usage (run inside the backend container):
//   node src/scripts/backfillVideoIds.js
//   node src/scripts/backfillVideoIds.js --dry-run # resolve and report, write nothing
//
// Idempotent and resumable — songs that already have an id are skipped, so
// it's safe to re-run or Ctrl+C and continue later. Songs it couldn't identify
// are simply left NULL rather than marked: they keep working through the
// runtime name search exactly as before, a later download can still record
// their real id, and re-running the script gives them another go.
const { getDb, initDb } = require('../db');
const { resolveVideoId } = require('../services/ytmusic');

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_MS = 400; // courtesy throttle — this is YouTube's private API

// Deliberately stricter than the runtime bar (MIN_MATCH, 0.5). At runtime a
// mediocre seed affects one queue and is forgotten; here it would be written
// to the song permanently, so a match has to agree on the artist too, not just
// the title. Anything below this keeps searching at runtime as it does today —
// no worse off than before, just not locked in wrong.
const MIN_CONFIDENCE = 0.85;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  initDb();
  const db = getDb();

  const songs = db.prepare('SELECT id, artist, title FROM songs WHERE video_id IS NULL ORDER BY artist, title').all();

  console.log(`Resolving YouTube ids for ${songs.length} song(s)${DRY_RUN ? ' — DRY RUN, nothing will be written' : ''}...`);

  const update = db.prepare('UPDATE songs SET video_id = ? WHERE id = ?');
  let resolved = 0, weak = 0, missing = 0, failed = 0;

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    try {
      const best = await resolveVideoId(song.artist, song.title);
      if (best && best.score >= MIN_CONFIDENCE) {
        if (!DRY_RUN) update.run(best.id, song.id);
        resolved++;
      } else if (best) {
        // Found something, but not convincingly enough to commit to. Left NULL
        // so runtime keeps searching by name, as it does today.
        weak++;
        console.log(`  ~ "${song.artist} - ${song.title}" → best match only ${best.score.toFixed(2)}, left for runtime search`);
      } else {
        missing++;
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ "${song.artist} - ${song.title}": ${err.message}`);
    }

    if ((i + 1) % 25 === 0 || i === songs.length - 1) {
      console.log(`[${i + 1}/${songs.length}] resolved=${resolved} low_confidence=${weak} not_found=${missing} failed=${failed}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. resolved=${resolved} low_confidence=${weak} not_found=${missing} failed=${failed}`);
  if (resolved) console.log(`${resolved} song(s) will now seed radio on their exact track instead of a name search.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
