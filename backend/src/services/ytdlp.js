const { spawn } = require('child_process');

const PROXY_ARGS = process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : [];
const RATE_ARGS = process.env.YTDLP_RATE_LIMIT ? ['--limit-rate', process.env.YTDLP_RATE_LIMIT] : [];

function searchYoutube(query, limit = 10) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '--socket-timeout', '10',
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

function scoreCandidate(candidate, queryWords, expectedSecs) {
  // Title similarity: Jaccard word overlap between query and result title
  const titleWords = normalizeWords(candidate.title);
  const titleSet = new Set(titleWords);
  const matches = queryWords.filter(w => titleSet.has(w)).length;
  const union = new Set([...queryWords, ...titleWords]).size;
  let titleScore = union > 0 ? matches / union : 0;

  // If the query contains version keywords (acoustic, live, remix…) but the
  // candidate title is missing them, heavily penalise — prevents the official
  // MV from beating an acoustic/live version just because it's more popular.
  const queryVersionWords = queryWords.filter(w => VERSION_KEYWORDS.has(w));
  if (queryVersionWords.length > 0) {
    const missing = queryVersionWords.filter(w => !titleSet.has(w)).length;
    if (missing > 0) titleScore *= 0.25;
  }

  // Duration proximity: penalises results that are way off the expected length.
  // >40% difference from expected → score approaches 0.
  let durationScore = 0.5; // neutral when no duration info available
  if (expectedSecs && candidate.duration) {
    const pct = Math.abs(candidate.duration - expectedSecs) / expectedSecs;
    durationScore = Math.max(0, 1 - pct * 2.5);
  }

  // When we have a duration hint, weight it at 70%; otherwise pure title match.
  const dWeight = expectedSecs ? 0.7 : 0;
  return titleScore * (1 - dWeight) + durationScore * dWeight;
}

// Search for up to 5 candidates, score them, download the best match.
// expectedSecs is the track duration from the source (Spotify CSV etc.) — null if unknown.
async function searchAndDownload(query, expectedSecs, outputDir, onProgress) {
  const candidates = await searchYoutube(query, 5);
  if (candidates.length === 0) throw new Error('No search results');

  const queryWords = normalizeWords(query);
  const best = candidates
    .map(c => ({ ...c, score: scoreCandidate(c, queryWords, expectedSecs) }))
    .sort((a, b) => b.score - a.score)[0];

  return downloadAudio(best.id, outputDir, onProgress);
}

module.exports = { searchYoutube, downloadAudio, downloadBySearch, searchAndDownload };
