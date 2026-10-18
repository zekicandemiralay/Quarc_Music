const { spawn } = require('child_process');

// Spotify/YouTube/Apple Music all play tracks back at a fixed target
// loudness instead of however loud the original master happens to be —
// the standard behind it is EBU R128 (ReplayGain works the same way): measure
// each file's integrated loudness once, store the gain needed to reach the
// target, and apply that gain at playback time rather than re-encoding the
// file. -14 LUFS is Spotify's own published target.
const TARGET_LUFS = -14;

// A quiet-but-fine recording and a genuinely near-silent/broken file both
// measure far below target — without a cap, the latter would compute an
// enormous "gain" that's really just amplifying noise or silence.
const MAX_GAIN_DB = 12;

// Headroom kept below full scale so boosting a quiet track can't push its
// own loudest moment into clipping — checked against the file's measured
// true peak below, not just assumed.
const HEADROOM_DB = 1;

function runLoudnormMeasure(filepath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', filepath,
      '-af', `loudnorm=I=${TARGET_LUFS}:TP=-${HEADROOM_DB}:LRA=11:print_format=json`,
      '-f', 'null',
      '-',
    ]);
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

// Measures `filepath`'s integrated loudness and returns the gain (dB) to
// apply at playback so it lands at TARGET_LUFS — clipping-protected against
// the file's own measured true peak. Returns null for anything unmeasurable
// (e.g. a near-silent file, which loudnorm reports as "-inf").
async function analyzeLoudness(filepath) {
  const result = await runLoudnormMeasure(filepath);
  const lufs = parseFloat(result.input_i);
  const truePeak = parseFloat(result.input_tp);
  if (!Number.isFinite(lufs)) return null;

  let gainDb = TARGET_LUFS - lufs;
  gainDb = Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, gainDb));
  if (Number.isFinite(truePeak)) {
    gainDb = Math.min(gainDb, -HEADROOM_DB - truePeak);
  }
  return { lufs, gainDb };
}

module.exports = { analyzeLoudness, TARGET_LUFS };
