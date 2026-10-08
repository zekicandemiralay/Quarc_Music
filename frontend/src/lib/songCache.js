// The library list, cached so the app has something to show offline.
//
// This used to be a bare `try { localStorage.setItem(...) } catch {}`, which
// hid the exact failure that broke offline mode: the API was shipping every
// song's full lyrics, the payload outgrew localStorage's ~5MB ceiling, every
// write threw QuotaExceededError, and the empty catch swallowed it. Nothing
// was ever cached and nothing ever said so.
//
// The API no longer sends lyrics in list responses, so the payload is a
// fraction of what it was — but a library only grows, so the ceiling is
// still real. Rather than fail silently again, fall back to the fields the
// UI actually renders, and say what happened either way.
const KEY = 'quarc_songs';

// Everything the library, player, queue and search actually read.
function essentials(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    duration: song.duration,
    track: song.track,
    has_cover: song.has_cover,
    play_count: song.play_count,
  };
}

export function loadCachedSongs() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveCachedSongs(songs) {
  if (!Array.isArray(songs)) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(songs));
    return true;
  } catch {
    // Almost certainly the quota. Retry with only what gets rendered.
    try {
      localStorage.setItem(KEY, JSON.stringify(songs.map(essentials)));
      console.warn(`Library cache: full record didn't fit in localStorage, stored ${songs.length} songs with display fields only.`);
      return true;
    } catch (err) {
      // Leave whatever was cached before rather than clearing it — a stale
      // library offline beats no library offline.
      console.error(`Library cache: could not store ${songs.length} songs (${err.name}). Offline mode will use the last cache that fit, if any.`);
      return false;
    }
  }
}

export function clearCachedSongs() {
  try { localStorage.removeItem(KEY); } catch {}
}
