// One-off/occasional bulk job — measures integrated loudness for every
// library song that hasn't been analyzed yet and, where a boost is needed,
// bakes the gain into the actual file via a real ffmpeg re-encode (see
// services/loudness.js; routes/youtube.js, routes/import.js and
// routes/radio.js do the same automatically for newly downloaded/imported
// songs — this script is only for catching everything already in the
// library from before that existed).
//
// Not run automatically and not part of any deploy step — this rewrites
// every matching song's audio file in place (one lossy re-encode
// generation each), which is a real, deliberate choice to make, not
// something to do silently as a side effect of a routine backfill.
//
// Usage (run inside the backend container):
//   node src/scripts/backfillLoudness.js
//   node src/scripts/backfillLoudness.js --recheck   # also re-measure already-analyzed songs
//
// Idempotent and resumable — safe to re-run or Ctrl+C and continue later,
// since already-analyzed songs (loudness_gain_db set) are skipped by default.
//
// Paced with a short delay between songs — confirmed in production that
// running this back-to-back with no gap starved concurrent song streaming
// of CPU/disk I/O badly enough that playback of anything not already
// cached offline stopped working for the whole library's duration. Each
// ffmpeg pass also now runs at low scheduling priority (see
// services/loudness.js), but the two mitigations are complementary, not
// redundant — this one paces the server's I/O duty cycle, not just CPU.
const { getDb, initDb } = require('../db');
const { analyzeLoudness, applyGain } = require('../services/loudness');

const RECHECK = process.argv.includes('--recheck');
const DELAY_MS = 1000;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  initDb();
  const db = getDb();

  const filter = RECHECK ? '1=1' : 'loudness_gain_db IS NULL';
  const songs = db.prepare(`SELECT id, filepath, artist, title FROM songs WHERE ${filter} ORDER BY artist, album, track`).all();

  console.log(`Analyzing loudness for ${songs.length} song(s)${RECHECK ? ' (re-checking all)' : ''}...`);

  let done = 0, failed = 0;
  const update = db.prepare('UPDATE songs SET loudness_lufs = ?, loudness_gain_db = 0 WHERE id = ?');

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    try {
      const result = await analyzeLoudness(song.filepath);
      if (result) {
        if (result.gainDb > 0) await applyGain(song.filepath, result.gainDb);
        update.run(result.lufs, song.id);
        done++;
      } else {
        failed++;
        console.error(`  ✗ "${song.artist} - ${song.title}": unmeasurable (near-silent file?)`);
      }
    } catch (err) {
      failed++;
      console.error(`  ✗ "${song.artist} - ${song.title}": ${err.message}`);
    }

    if ((i + 1) % 25 === 0 || i === songs.length - 1) {
      console.log(`[${i + 1}/${songs.length}] done=${done} failed=${failed}`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. analyzed=${done} failed=${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
