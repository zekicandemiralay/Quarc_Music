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
    // no lyrics available — caller records 'not_found'
  }

  return null;
}

module.exports = { fetchLyrics };
