// One-off/occasional bulk job — measures integrated loudness for every
// library song that hasn't been analyzed yet and stores the gain needed to
// bring it to Spotify's -14 LUFS target (see services/loudness.js; routes/
// youtube.js and routes/import.js do the same analysis automatically for
// newly downloaded/imported songs — this script is only for catching
// everything already in the library before that existed, plus anything
// that slips in through radio's own auto-downloads or the seed scripts).
//
// Usage (run inside the backend container):
//   node src/scripts/backfillLoudness.js
//   node src/scripts/backfillLoudness.js --recheck   # also re-measure already-analyzed songs
//
// Idempotent and resumable — safe to re-run or Ctrl+C and continue later,
// since already-analyzed songs (loudness_gain_db set) are skipped by default.
const { getDb, initDb } = require('../db');
const { analyzeLoudness } = require('../services/loudness');

const RECHECK = process.argv.includes('--recheck');

async function main() {
  initDb();
  const db = getDb();

  const filter = RECHECK ? '1=1' : 'loudness_gain_db IS NULL';
  const songs = db.prepare(`SELECT id, filepath, artist, title FROM songs WHERE ${filter} ORDER BY artist, album, track`).all();

  console.log(`Analyzing loudness for ${songs.length} song(s)${RECHECK ? ' (re-checking all)' : ''}...`);

  let done = 0, failed = 0;
  const update = db.prepare('UPDATE songs SET loudness_lufs = ?, loudness_gain_db = ? WHERE id = ?');

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    try {
      const result = await analyzeLoudness(song.filepath);
      if (result) {
        update.run(result.lufs, result.gainDb, song.id);
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
  }

  console.log(`\nDone. analyzed=${done} failed=${failed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
