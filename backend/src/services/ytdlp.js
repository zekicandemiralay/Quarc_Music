const { spawn } = require('child_process');

const PROXY_ARGS = process.env.YTDLP_PROXY ? ['--proxy', process.env.YTDLP_PROXY] : [];
const RATE_ARGS = process.env.YTDLP_RATE_LIMIT ? ['--limit-rate', process.env.YTDLP_RATE_LIMIT] : [];
const JS_ARGS = ['--js-runtimes', 'node'];
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

// Classical scores are sometimes titled with British note-duration names instead of
// the American ones Spotify tends to use (e.g. movement tempo markings like "Quarter
// Note = 108" vs "Crotchet = 108") — fold to one form so they're recognised as the
// same word rather than scoring as a partial/missing match.
const NOTE_DURATION_SYNONYMS = [
  [/whole[\s-]+notes?/gi, 'semibreve'],
  [/half[\s-]+notes?/gi, 'minim'],
  [/quarter[\s-]+notes?/gi, 'crotchet'],
  [/eighth[\s-]+notes?/gi, 'quaver'],
  [/sixteenth[\s-]+notes?/gi, 'semiquaver'],
  [/thirty[\s-]*second[\s-]+notes?/gi, 'demisemiquaver'],
];

function normalizeWords(s) {
  let str = s || '';
  for (const [pattern, replacement] of NOTE_DURATION_SYNONYMS) str = str.replace(pattern, replacement);
  return str
    // Turkish İ/ı fold to plain 'i' — JS's locale-independent toLowerCase() turns
    // 'İ' into 'i' + a combining dot-above (U+0307), which the \w filter below
    // would then strip as punctuation, splitting one word into two ("i", "stanbul").
    // Handling it before case-folding avoids that split entirely.
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // fold remaining diacritics (ç, ş, ğ, ö, ü…)
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// Words that identify a specific version — if the query has one, the result must too.
// Matched by stem (startsWith), not exact string, so plurals/inflections like
// "instrumentals" or "covers" are recognised without listing every form.
const VERSION_KEYWORDS = [
  'acoustic', 'acustic', 'akustik',
  'live', 'concert', 'unplugged',
  'remix', 'edit',
  'instrumental', 'karaoke',
  'cover',
  'extended', 'radio',
  'demo', 'stripped', 'piano',
  'remaster',
  'slowed', 'sped', 'nightcore',
];

// Returns the canonical keyword stem a word matches ("instrumentals" -> "instrumental"), or null.
function versionStem(word) {
  return VERSION_KEYWORDS.find(kw => word === kw || word.startsWith(kw)) || null;
}

function scoreCandidate(candidate, artistWords, titleWords, versionWords, expectedSecs) {
  // Song-title match: fraction of the actual song's words found in the candidate
  // (recall), computed on the SONG NAME only (artist is scored separately below) —
  // NOT a symmetric Jaccard overlap. A candidate with extra, legitimate words
  // (channel prefix, "(acoustic cover)", "(Official Audio)"…) shouldn't be
  // penalised for saying more than the bare title; a same-titled upload from an
  // unrelated channel shouldn't win over the real artist's own upload just for
  // omitting extra (accurate) words.
  const candWords = normalizeWords(candidate.title);
  const candSet = new Set(candWords);
  const matches = titleWords.filter(w => candSet.has(w)).length;
  let titleScore = titleWords.length > 0 ? matches / titleWords.length : 0;

  // If this track is a specific version (acoustic, live, remix… — drawn from
  // both the title AND the album name, since compilation exports often store
  // this in the album field instead) but the candidate is missing that word,
  // heavily penalise — prevents the official MV from beating an acoustic/live
  // version just because it's more popular.
  if (versionWords.length > 0) {
    const missing = versionWords.filter(stem => !candWords.some(w => w === stem || w.startsWith(stem))).length;
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
  const total = titleScore * tWeight + durationScore * dWeight + artistScore * aWeight;

  // If the candidate shares literally no words with the actual song title, it's
  // almost certainly the wrong song — an artist-name or duration coincidence
  // (e.g. a different track by a same-named artist) must not be enough to win.
  const score = matches === 0 ? total * 0.15 : total;
  return { score, titleScore, durationScore, artistScore };
}

// Search queries should skip version-descriptor words ("Instrumental", "Live"...) —
// the real YouTube upload rarely repeats them literally, so keeping them in the
// query text just drags in unrelated results. They're still used for scoring below.
function stripVersionWordsForSearch(title) {
  const kept = (title || '').split(/\s+/).filter(w => {
    const bare = w.toLowerCase().replace(/[^\w]/g, '');
    if (!bare) return false; // drop bare punctuation/separator tokens ("-", "(", ")")
    return !versionStem(bare);
  });
  return kept.join(' ').trim();
}

// Search for candidates, score them, download the best match.
// expectedSecs is the track duration from the source (Spotify CSV etc.) — null if unknown.
// album is an optional fallback artist hint — Spotify's "Artist Name(s)" field is
// sometimes wrong or a compilation/session credit (common for classical/soundtrack
// tracks), which can send YouTube search completely off-track; the real composer
// often ends up in the album name instead, so it's tried as an extra search angle.
async function searchAndDownload(artist, title, album, expectedSecs, outputDir, onProgress) {
  const searchTitle = stripVersionWordsForSearch(title) || title;

  // Title alone is the most reliable search — prepending a wrong/generic artist
  // credit can bury the correct video entirely (verified: it can push YouTube's
  // search to return completely unrelated results). Try it first, then widen.
  //
  // Album before artist: across every real mismatch diagnosed so far, Spotify's
  // "Artist Name(s)" field was the unreliable one (a compilation credit, an
  // unrelated phrase, or outright wrong), while the real artist/composer had
  // ended up in the Album field instead. Album+title had a perfect track record
  // recovering the correct video; artist+title only helped when that field
  // happened to already contain something real, and actively hurt when it
  // didn't — so it's kept only as a further fallback, tried last.
  const queries = [searchTitle];
  const albumDiffersFromArtist = album && album.trim().toLowerCase() !== (artist || '').trim().toLowerCase();
  if (albumDiffersFromArtist) queries.push(`${album} - ${searchTitle}`);
  if (artist) queries.push(`${artist} - ${searchTitle}`);

  const artistWords = normalizeWords(artist);
  const titleWords = normalizeWords(title);
  // Version descriptors can end up in the title, artist, OR album field — Spotify's
  // own metadata for compilations/soundtracks isn't consistent about which field
  // gets the "(Akustik Versiyon)"-style annotation, so all three are checked.
  const versionWords = [...new Set([...titleWords, ...artistWords, ...normalizeWords(album)].map(versionStem).filter(Boolean))];

  // Each extra query is a full yt-dlp subprocess call (re-solving YouTube's bot-
  // check JS challenge every time), which dominates import time — so only widen
  // past the title-only search when it didn't already turn up a confident match.
  const CONFIDENT_ENOUGH = 0.4;
  const seen = new Map(); // dedupe candidates across queries by video id
  const scored = [];
  let best = null;
  for (const query of queries) {
    let candidates;
    try {
      candidates = await searchYoutube(query, 10);
    } catch {
      continue;
    }
    for (const c of candidates) {
      if (seen.has(c.id)) continue;
      seen.set(c.id, true);
      const entry = { ...c, ...scoreCandidate(c, artistWords, titleWords, versionWords, expectedSecs) };
      scored.push(entry);
      if (!best || entry.score > best.score) best = entry;
    }
    // A high score from title-recall alone isn't trustworthy corroboration when
    // the title is short/generic — e.g. "Cleaning Apartment" also gets a perfect
    // title-only match against unrelated cleaning vlogs. Require the duration or
    // artist signal to be at least plausible too before treating a title-only hit
    // as confident enough to skip the wider (costlier) queries.
    const corroborated = best && (best.durationScore > 0.3 || best.artistScore > 0.3);
    if (best && best.score >= CONFIDENT_ENOUGH && corroborated) break;
  }
  if (!best) throw new Error('No search results');

  // Log the pick + runner-ups so a mismatch can be diagnosed from server logs
  // directly (`docker logs`) instead of re-guessing against a different region's
  // YouTube search results — the backend's VPN egress may see different results
  // than a local/unproxied search would.
  const top3 = scored.sort((a, b) => b.score - a.score).slice(0, 3)
    .map(c => `${c.score.toFixed(3)} "${c.title}" (${c.id}, ${c.duration}s)`).join(' | ');
  console.log(`[import] "${artist ? artist + ' - ' : ''}${title}" expected=${expectedSecs ?? '?'}s -> ${top3}`);

  return downloadAudio(best.id, outputDir, onProgress);
}

module.exports = { searchYoutube, downloadAudio, downloadBySearch, searchAndDownload };
