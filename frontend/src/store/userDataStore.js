import { create } from 'zustand';
import useOfflineStore from './useOfflineStore';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

async function save(key, data) {
  lsSet(`quarc_${key}`, data);
  await fetch(`/api/me/data/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

async function loadFromServer(key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`/api/me/data/${key}`, { signal: controller.signal });
    return res.ok ? res.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

// Returns the cached songs list from localStorage (used for auto-download lookups)
function getCachedSongs() {
  try { return JSON.parse(localStorage.getItem('quarc_songs') || '[]'); } catch { return []; }
}

const useUserDataStore = create((set, get) => ({
  likedSongs: [],      // string[] of song IDs
  playlists: [],       // { id, name, songs: string[] }[]
  radioFavorites: [],  // { stationuuid, name, url_resolved, favicon, tags, country, bitrate }[]
  loaded: false,
  _mut: 0,             // increments on every mutation; prevents stale server loads from overwriting

  load: () => {
    const genAtLoad = get()._mut;
    // Show cached data immediately — synchronous, no waiting
    set({
      likedSongs: lsGet('quarc_liked_songs') || [],
      playlists: lsGet('quarc_playlists') || [],
      radioFavorites: lsGet('quarc_radio_favorites') || [],
      loaded: true,
    });
    // Refresh from server, but only write back if no mutations happened while waiting
    Promise.all([
      loadFromServer('liked_songs'),
      loadFromServer('playlists'),
      loadFromServer('radio_favorites'),
    ]).then(([liked, playlists, radioFavs]) => {
        if (get()._mut !== genAtLoad) return; // a mutation happened — server data is stale
        const likedSongs = liked || lsGet('quarc_liked_songs') || [];
        const pls = playlists || lsGet('quarc_playlists') || [];
        const radioFavorites = radioFavs || lsGet('quarc_radio_favorites') || [];
        lsSet('quarc_liked_songs', likedSongs);
        lsSet('quarc_playlists', pls);
        lsSet('quarc_radio_favorites', radioFavorites);
        set({ likedSongs, playlists: pls, radioFavorites });
      })
      .catch(() => {});
  },

  reset: () => set({ likedSongs: [], playlists: [], radioFavorites: [], loaded: false, _mut: 0 }),

  // ── Liked songs ──────────────────────────────────────────────────────────

  toggleLike: async (songId) => {
    const prev = get().likedSongs;
    const next = prev.includes(songId) ? prev.filter((id) => id !== songId) : [...prev, songId];
    set((s) => ({ likedSongs: next, _mut: s._mut + 1 }));
    await save('liked_songs', next);
  },

  isLiked: (songId) => get().likedSongs.includes(songId),

  // ── Playlists ─────────────────────────────────────────────────────────────

  createPlaylist: async (name) => {
    const playlist = { id: uuid(), name, songs: [] };
    const next = [...get().playlists, playlist];
    set((s) => ({ playlists: next, _mut: s._mut + 1 }));
    await save('playlists', next);
    return playlist;
  },

  renamePlaylist: async (playlistId, name) => {
    const next = get().playlists.map((p) => (p.id === playlistId ? { ...p, name } : p));
    set((s) => ({ playlists: next, _mut: s._mut + 1 }));
    await save('playlists', next);
  },

  deletePlaylist: async (playlistId) => {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    const next = get().playlists.filter((p) => p.id !== playlistId);
    set((s) => ({ playlists: next, _mut: s._mut + 1 }));
    await save('playlists', next);

    // Remove cached audio for songs that are no longer in any other offline playlist
    if (playlist?.offline && playlist.songs.length > 0) {
      const { cachedIds, removeSongs } = useOfflineStore.getState();
      const toRemove = playlist.songs.filter(
        (id) => cachedIds.has(id) && !next.some((p) => p.offline && p.songs.includes(id))
      );
      if (toRemove.length > 0) removeSongs(toRemove);
    }
  },

  addToPlaylist: async (playlistId, songId) => {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    const next = get().playlists.map((p) =>
      p.id === playlistId && !p.songs.includes(songId)
        ? { ...p, songs: [...p.songs, songId] }
        : p
    );
    set((s) => ({ playlists: next, _mut: s._mut + 1 }));
    await save('playlists', next);

    // Auto-download if the playlist is marked as offline
    if (playlist?.offline) {
      const { cachedIds, cacheSong } = useOfflineStore.getState();
      if (!cachedIds.has(songId)) {
        const song = getCachedSongs().find((s) => s.id === songId);
        if (song) cacheSong(song);
      }
    }
  },

  setPlaylistOffline: async (playlistId, offline) => {
    const next = get().playlists.map((p) =>
      p.id === playlistId ? { ...p, offline } : p
    );
    set((s) => ({ playlists: next, _mut: s._mut + 1 }));
    await save('playlists', next);
  },

  // ── Radio favourites ─────────────────────────────────────────────────────────

  toggleRadioFavorite: async (station) => {
    const { radioFavorites } = get();
    // Store only the fields we need (avoid storing stale API fields)
    const slim = {
      stationuuid: station.stationuuid,
      name: station.name,
      url_resolved: station.url_resolved || station.url,
      favicon: station.favicon || '',
      tags: station.tags || '',
      country: station.country || '',
      bitrate: station.bitrate || 0,
    };
    const next = radioFavorites.some((f) => f.stationuuid === station.stationuuid)
      ? radioFavorites.filter((f) => f.stationuuid !== station.stationuuid)
      : [...radioFavorites, slim];
    set((s) => ({ radioFavorites: next, _mut: s._mut + 1 }));
    await save('radio_favorites', next);
  },

  removeFromPlaylist: async (playlistId, songId) => {
    const playlist = get().playlists.find((p) => p.id === playlistId);
    const next = get().playlists.map((p) =>
      p.id === playlistId ? { ...p, songs: p.songs.filter((id) => id !== songId) } : p
    );
    set((s) => ({ playlists: next, _mut: s._mut + 1 }));
    await save('playlists', next);

    // Remove cached audio if playlist was offline and no other offline playlist needs this song
    if (playlist?.offline) {
      const stillNeeded = next.some((p) => p.offline && p.songs.includes(songId));
      if (!stillNeeded) {
        const { cachedIds, removeSong } = useOfflineStore.getState();
        if (cachedIds.has(songId)) removeSong(songId);
      }
    }
  },
}));

export default useUserDataStore;
