const { spawn } = require('child_process');

const PROXY_ARGS = process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : [];
const RATE_ARGS = process.env.YTDLP_RATE_LIMIT ? ['--limit-rate', process.env.YTDLP_RATE_LIMIT] : [];

function searchYoutube(query, limit = 20) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
    ]);

    const results = [];
    let buffer = '';
    let errorOut = '';

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
      if (code !== 0 && results.length === 0) {
        reject(new Error(`yt-dlp search failed: ${errorOut.slice(0, 300)}`));
      } else {
        resolve(results);
      }
    });

    proc.on('error', reject);
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

        const dest = line.match(/\[(?:ExtractAudio|download)\] Destination: (.+)/);
        if (dest) lastFile = dest[1].trim();

        const already = line.match(/\[download\] (.+) has already been downloaded/);
        if (already) { lastFile = already[1].trim(); onProgress(100); }
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

module.exports = { searchYoutube, downloadAudio, downloadBySearch };
