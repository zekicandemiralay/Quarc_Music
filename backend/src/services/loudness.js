const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

// Spotify/YouTube/Apple Music normalize tracks DOWN to a shared, fairly
// quiet broadcast target (-14 LUFS for Spotify). This app's use case is the
// opposite: the user wants everything as loud as a phone/laptop's 100%
// volume can physically produce, for playback at parties — consistency
// across tracks is not a goal here, maximum loudness is. -6 LUFS is an
// aggressive-but-still-clip-safe "club" target (actual ceiling is still
// enforced per-file via HEADROOM_DB/true-peak below, so this is a target,
// not a guarantee every track lands exactly here).
const TARGET_LUFS = -6;

// A quiet-but-fine recording and a genuinely near-silent/broken file both
// measure far below target — without a cap, the latter would compute an
// enormous "gain" that's really just amplifying noise or silence.
const MAX_GAIN_DB = 12;

// Headroom kept below full scale so boosting a quiet track can't push its
// own loudest moment into clipping — checked against the file's measured
// true peak below, not just assumed.
const HEADROOM_DB = 1;

// Below this, re-encoding the file just to apply the gain isn't worth the
// generation loss (lossy re-encode) for a change nobody would hear.
const MIN_APPLY_DB = 0.2;

function runLoudnormMeasure(filepath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-threads', '1', // this is a single-track audio filter pass, not a video transcode — no need to compete for every core
      '-i', filepath,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=-${HEADROOM_DB}:LRA=11:print_format=json`,
      '-f', 'null',
      '-',
    ]);
    // Lower scheduling priority (a direct setpriority(2) call, not a shell-
    // out to `nice` — no extra binary to depend on) so this never competes
    // with anything else for CPU, especially a bulk backfill running many
    // of these back-to-back. Confirmed in production: a backfill run
    // starved concurrent song streaming badly enough that playback of
    // anything not already cached offline stopped working entirely.
    try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_LOW); } catch {}
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', () => {
      // loudnorm writes its measurement as JSON to stderr (ffmpeg logs
      // everything there). Anchored on "input_i" specifically, rather than
      // just grabbing the first {...} block, so a stray brace anywhere else
      // in ffmpeg's own logging can't be mistaken for it.
      const m = stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
      if (!m) return reject(new Error('ffmpeg loudnorm produced no measurement'));
      try {
        resolve(JSON.parse(m[0]));
      } catch {
        reject(new Error('Could not parse ffmpeg loudnorm output'));
      }
    });
  });
}

// Measures `filepath`'s integrated loudness and returns the gain (dB)
// needed to bring it up to TARGET_LUFS — clipping-protected against the
// file's own measured true peak. Floored at 0: a track already louder than
// TARGET_LUFS is left alone rather than turned down to match it, since the
// goal here is maximum loudness, not cross-track consistency. Returns null
// for anything unmeasurable (e.g. a near-silent file, which loudnorm
// reports as "-inf").
async function analyzeLoudness(filepath) {
  const result = await runLoudnormMeasure(filepath);
  const lufs = parseFloat(result.input_i);
  const truePeak = parseFloat(result.input_tp);
  if (!Number.isFinite(lufs)) return null;

  let gainDb = Math.max(0, TARGET_LUFS - lufs);
  gainDb = Math.min(gainDb, MAX_GAIN_DB);
  if (Number.isFinite(truePeak)) {
    // Can still pull this below what the LUFS target alone would give — a
    // track with a low integrated loudness but one sharp loud peak (common
    // in dynamic recordings) needs less boost than the target implies, or
    // clipping protection would be defeated by the very gain meant to be
    // safe. Floored at 0 regardless: a source that's already clipping on
    // its own (true peak already above 0 dBFS, before any gain of ours) is
    // a pre-existing problem this function has no business "fixing" by
    // attenuating it — that would still violate "never attenuate," just
    // for a different reason. Leaving it at 0 means we add no further
    // boost to it, without actively turning it down either.
    gainDb = Math.max(0, Math.min(gainDb, -HEADROOM_DB - truePeak));
  }
  return { lufs, gainDb };
}

// Bakes `gainDb` into the actual audio data via a real ffmpeg re-encode,
// rather than storing it as a number applied at playback time. Necessary
// because playback-time gain here is just audio.volume (userVolume *
// multiplier, see playerStore.js), which is hard-capped at 1.0 — any boost
// is silently thrown away once the user's own volume slider is already at
// its max, which is exactly the "even at full volume it's too quiet" case
// this exists to fix. A real-time Web Audio GainNode would also solve the
// ceiling, but was already tried for this app's loudness feature and
// reverted after it broke iOS background playback (see playerStore.js) —
// baking the gain into the file once avoids reintroducing that risk
// entirely, at the cost of one lossy re-encode generation.
async function applyGain(filepath, gainDb) {
  if (!Number.isFinite(gainDb) || Math.abs(gainDb) < MIN_APPLY_DB) return;

  const dir = path.dirname(filepath);
  const ext = path.extname(filepath);
  const tmpPath = path.join(dir, `.loudness-${uuidv4()}${ext}`);

  await new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-i', filepath,
      '-map_metadata', '0',
      '-c:v', 'copy', // embedded cover art, if any — passed through untouched
      '-c:a', 'libmp3lame', '-q:a', '0', // matches yt-dlp's own --audio-quality 0 extraction
      '-af', `volume=${gainDb}dB`,
      tmpPath,
    ]);
    try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_LOW); } catch {}
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg gain apply exited ${code}: ${stderr.slice(-500)}`));
    });
  }).catch((err) => {
    fs.rm(tmpPath, { force: true }, () => {});
    throw err;
  });

  fs.renameSync(tmpPath, filepath);
}

module.exports = { analyzeLoudness, applyGain, TARGET_LUFS };
