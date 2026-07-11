const { spawn } = require('child_process');

const PROXY_ARGS = process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : [];
const RATE_ARGS = process.env.YTDLP_RATE_LIMIT ? ['--limit-rate', process.env.YTDLP_RATE_LIMIT] : [];
const JS_ARGS = ['--js-runtimes', 'nodejs'];
const FRAG_ARGS = ['--concurrent-fragments', process.env.YTDLP_CONCURRENT_FRAGMENTS || '4'];

function searchYoutube(query, limit = 10) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--socket-timeout', '10',
      ...PROXY_ARGS,
      ...JS_ARGS,
    ]);

    const results = [];
    let buffer = '';
    let errorOut = '';
    let settled = false;

    function finish(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    }

    // Kill yt-dlp if it stalls (rate-limited, VPN reconnecting, etc.)
    // Return partial results if any arrived; otherwise reject so the UI shows an error.
    const timer = setTimeout(() => {
      proc.kill();
      finish(() => results.length > 0 ? resolve(results) : reject(new Error('Search timed out — yt-dlp took too long')));
    }, 45000);

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          results.push({
            id: d.id,
            title: d.title,
            thumbnail: d.thumbnail || `https://i.ytimg.com/vi/${d.id}/hqdefault.jpg`,
            duration: d.duration || null,
            channel: d.channel || d.uploader || null,
            viewCount: d.view_count || null,
          });
        } catch {}
      }
    });

    proc.stderr.on('data', (c) => { errorOut += c.toString(); });

    proc.on('close', (code) => {
      finish(() => {
        if (code !== 0 && results.length === 0) {
          reject(new Error(`yt-dlp search failed: ${errorOut.slice(0, 300)}`));
        } else {
          resolve(results);
        }
      });
    });

    proc.on('error', (err) => finish(() => reject(err)));
  });
}

function downloadAudio(videoId, outputDir, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      `https://www.youtube.com/watch?v=${videoId}`,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--embed-metadata',
      '--embed-thumbnail',
      '--parse-metadata', 'title:%(artist)s - %(title)s',
      '--newline',
      '-o', `${outputDir}/%(uploader)s/%(title)s.%(ext)s`,
      '--no-playlist',
      ...PROXY_ARGS,
      ...RATE_ARGS,
      ...JS_ARGS,
      ...FRAG_ARGS,
    ]);

    let lastFile = '';
    let errorOut = '';

    proc.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const pct = line.match(/\[download\]\s+([\d.]+)%/);
        if (pct) onProgress(parseFloat(pct[1]));

        const dest = line.match(/\[(?:ExtractAudio|download|Merger)\] Destination: (.+)/);
        if (dest) lastFile = dest[1].trim();

        const moved = line.match(/\[MoveFiles\] Moving file "(.+)" to "(.+)"/);
        if (moved) lastFile = moved[2].trim();

        const already = line.match(/\[download\] (.+) has already been downloaded/);
        if (already) { lastFile = already[1].trim().replace(/\.\w+$/, '.mp3'); onProgress(100); }
      }
    });

    proc.stderr.on('data', (c) => { errorOut += c.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`Download failed: ${errorOut.slice(0, 300)}`));
      else resolve(lastFile);
    });

    proc.on('error', reject);
  });
}

function downloadBySearch(query, outputDir, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      `ytsearch1:${query}`,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--embed-metadata',
      '--embed-thumbnail',
      '--parse-metadata', 'title:%(artist)s - %(title)s',
      '--newline',
      '-o', `${outputDir}/%(uploader)s/%(title)s.%(ext)s`,
      '--no-playlist',
      ...PROXY_ARGS,
      ...RATE_ARGS,
      ...JS_ARGS,
      ...FRAG_ARGS,
    ]);

    let lastFile = '';
    let errorOut = '';

    proc.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const pct = line.match(/\[download\]\s+([\d.]+)%/);
        if (pct) onProgress(parseFloat(pct[1]));

        const dest = line.match(/\[(?:ExtractAudio|download|Merger)\] Destination: (.+)/);
        if (dest) lastFile = dest[1].trim();

        const moved = line.match(/\[MoveFiles\] Moving file "(.+)" to "(.+)"/);
        if (moved) lastFile = moved[2].trim();

        const already = line.match(/\[download\] (.+) has already been downloaded/);
        if (already) { lastFile = already[1].trim().replace(/\.\w+$/, '.mp3'); onProgress(100); }
      }
    });

    proc.stderr.on('data', (c) => { errorOut += c.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`Download failed: ${errorOut.slice(0, 300)}`));
      else resolve(lastFile || null);
    });

    proc.on('error', reject);
  });
}

function normalizeWords(s) {
  return (s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

// Words that identify a specific version — if the query has one, the result must too.
const VERSION_KEYWORDS = new Set([
  'acoustic', 'acustic', 'akustik',
  'live', 'concert', 'unplugged',
  'remix', 'remixed', 'edit',
  'instrumental', 'karaoke',
  'cover', 'covered',
  'extended', 'radio',
  'demo', 'stripped', 'piano',
  'remaster', 'remastered',
  'slowed', 'sped', 'nightcore',
]);

function scoreCandidate(candidate, artistWords, titleWords, expectedSecs) {
  // Song-title similarity: Jaccard word overlap, computed on the SONG NAME only
  // (artist name is scored separately below) — otherwise any video by the right
  // artist gets a free title-score boost even when it's the wrong song entirely.
  const candWords = normalizeWords(candidate.title);
  const candSet = new Set(candWords);
  const matches = titleWords.filter(w => candSet.has(w)).length;
  const union = new Set([...titleWords, ...candWords]).size;
  let titleScore = union > 0 ? matches / union : 0;

  // If the song title contains version keywords (acoustic, live, remix…) but the
  // candidate title is missing them, heavily penalise — prevents the official
  // MV from beating an acoustic/live version just because it's more popular.
  const titleVersionWords = titleWords.filter(w => VERSION_KEYWORDS.has(w));
  if (titleVersionWords.length > 0) {
    const missing = titleVersionWords.filter(w => !candSet.has(w)).length;
    if (missing > 0) titleScore *= 0.25;
  }

  // Artist presence: does the candidate title mention the artist at all?
  let artistScore = 0.5; // neutral when artist unknown
  if (artistWords.length > 0) {
    artistScore = artistWords.filter(w => candSet.has(w)).length / artistWords.length;
  }

  // Duration proximity: penalises results that are way off the expected length.
  // >40% difference from expected → score approaches 0.
  let durationScore = 0.5; // neutral when no duration info available
  if (expectedSecs && candidate.duration) {
    const pct = Math.abs(candidate.duration - expectedSecs) / expectedSecs;
    durationScore = Math.max(0, 1 - pct * 2.5);
  }

  // Song title match is the primary signal — duration and artist presence support
  // it but must not be able to outweigh a wrong song title on their own.
  const dWeight = expectedSecs ? 0.35 : 0;
  const aWeight = 0.15;
  const tWeight = 1 - dWeight - aWeight;
  return titleScore * tWeight + durationScore * dWeight + artistScore * aWeight;
}

// Search for up to 5 candidates, score them, download the best match.
// expectedSecs is the track duration from the source (Spotify CSV etc.) — null if unknown.
async function searchAndDownload(artist, title, expectedSecs, outputDir, onProgress) {
  const query = artist ? `${artist} - ${title}` : title;
  const candidates = await searchYoutube(query, 5);
  if (candidates.length === 0) throw new Error('No search results');

  const artistWords = normalizeWords(artist);
  const titleWords = normalizeWords(title);
  const best = candidates
    .map(c => ({ ...c, score: scoreCandidate(c, artistWords, titleWords, expectedSecs) }))
    .sort((a, b) => b.score - a.score)[0];

  return downloadAudio(best.id, outputDir, onProgress);
}

module.exports = { searchYoutube, downloadAudio, downloadBySearch, searchAndDownload };
