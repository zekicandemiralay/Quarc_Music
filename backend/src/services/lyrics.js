// lrclib.net client — free, keyless, community-sourced lyrics DB (both plain
// and LRC-format synced text). No official rate limit is published, but a
// descriptive User-Agent is requested courtesy, and the backfill script
// throttles itself so a whole-library run doesn't hammer a free service.
const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'QuarcMusic/1.0 (+https://github.com/zekicandemiralay/Quarc_Music)';

function normalizeResult(data) {
  if (!data) return null;
  if (data.instrumental) return { status: 'instrumental', plain: null, synced: null };
  const plain = data.plainLyrics || null;
  const synced = data.syncedLyrics || null;
  if (!plain && !synced) return null;
  return { status: 'found', plain, synced };
}

async function getJson(path, params) {
  const url = `${LRCLIB_BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return null;
  return res.json();
}

// Lightweight word-overlap scorer for the broad fallback below — not the
// full candidate-scoring machinery ytdlp.js uses for picking a download
// (duration gating, version-keyword penalties, etc.), because none of that
// applies here: lrclib candidates carry no duration to compare against, and
// "acoustic"/"live"/etc. in a title is actually fine to ignore for lyrics
// purposes (the words are usually the same across versions of a song).
function normalizeWords(s) {
  return (s || '')
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function wordOverlap(wordsA, wordsB) {
  if (!wordsA.length) return 0;
  const setB = new Set(wordsB);
  return wordsA.filter((w) => setB.has(w)).length / wordsA.length;
}

// Broad fallback: a title-only search across every artist/version lrclib
// has, scored to find the closest real match. Used when the recording
// itself — a cover, remix, or otherwise non-original YouTube upload, often
// tagged with a wrong or generic artist — isn't in lrclib's database under
// its own attribution, but the ORIGINAL song's lyrics (same words,
// whichever performance) almost certainly are. Deliberately PLAIN TEXT
// ONLY: a different recording's synced timing (different tempo, intro
// length, etc.) won't line up with this audio, so synced lines are dropped
// even if the matched candidate has them — showing wrongly-timed karaoke
// highlighting would be worse than no highlighting at all.
async function fetchLyricsBroad(artist, title) {
  let results;
  try {
    results = await getJson('/search', { track_name: title });
  } catch {
    return null;
  }
  if (!Array.isArray(results) || !results.length) return null;

  const titleWords = normalizeWords(title);
  const artistWords = normalizeWords(artist);
  let best = null;
  for (const r of results) {
    if (!r.plainLyrics) continue; // nothing usable without at least plain text
    const score = wordOverlap(titleWords, normalizeWords(r.trackName)) * 0.75
      + wordOverlap(artistWords, normalizeWords(r.artistName)) * 0.25;
    if (!best || score > best.score) best = { ...r, score };
  }
  // Require real confidence in the title match — this is "a different
  // recording of the same song", not "a vaguely similar title".
  if (!best || best.score < 0.6) return null;
  return { status: 'approximate', plain: best.plainLyrics, synced: null };
}

// artist/title/album come from the song's own tags; durationSecs (if known)
// lets lrclib's exact-match endpoint confirm it's the same recording, not
// just the same title — falls back to fuzzy search (no duration check) when
// the exact match misses, since our tags are sometimes messier than a
// well-curated lyrics DB expects (feat. credits, "(Official Audio)", etc.).
async function fetchLyrics(artist, title, album, durationSecs) {
  if (!title) return null;

  try {
    const params = { track_name: title, artist_name: artist || '' };
    if (album) params.album_name = album;
    if (durationSecs) params.duration = Math.round(durationSecs);
    const exact = await getJson('/get', params);
    const result = normalizeResult(exact);
    if (result) return result;
  } catch {
    // fall through to fuzzy search
  }

  try {
    const results = await getJson('/search', { track_name: title, artist_name: artist || '' });
    if (Array.isArray(results) && results.length) {
      const result = normalizeResult(results[0]);
      if (result) return result;
    }
  } catch {
    // fall through to the broad fallback
  }

  // Last resort — see fetchLyricsBroad for why this is plain-text-only.
  return fetchLyricsBroad(artist, title);
}

module.exports = { fetchLyrics };
