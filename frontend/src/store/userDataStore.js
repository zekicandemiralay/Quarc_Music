import { create } from 'zustand';

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
  lsSet(`skynet_${key}`, data);
  await fetch(`/api/me/data/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
}

async function load(key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`/api/me/data/${key}`, { signal: controller.signal });
    return res.ok ? res.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

const useUserDataStore = create((set, get) => ({
  likedSongs: [],   // string[] of song IDs
  playlists: [],    // { id, name, songs: string[] }[]
  loaded: false,

  load: async () => {
    // Show cached data immediately — no waiting
    set({
      likedSongs: lsGet('skynet_liked_songs') || [],
      playlists: lsGet('skynet_playlists') || [],
      loaded: true,
    });
    // Refresh from server in background
    try {
      const [liked, playlists] = await Promise.all([
        load('liked_songs'),
        load('playlists'),
      ]);
      const likedSongs = liked || lsGet('skynet_liked_songs') || [];
      const pls = playlists || lsGet('skynet_playlists') || [];
      lsSet('skynet_liked_songs', likedSongs);
      lsSet('skynet_playlists', pls);
      set({ likedSongs, playlists: pls });
    } catch {
      // Offline — already showing localStorage data above, nothing to do
    }
  },

  reset: () => set({ likedSongs: [], playlists: [], loaded: false }),

  // ── Liked songs ──────────────────────────────────────────────────────────

  toggleLike: async (songId) => {
    const prev = get().likedSongs;
    const next = prev.includes(songId) ? prev.filter((id) => id !== songId) : [...prev, songId];
    set({ likedSongs: next });
    await save('liked_songs', next);
  },

  isLiked: (songId) => get().likedSongs.includes(songId),

  // ── Playlists ─────────────────────────────────────────────────────────────

  createPlaylist: async (name) => {
    const playlist = { id: uuid(), name, songs: [] };
    const next = [...get().playlists, playlist];
    set({ playlists: next });
    await save('playlists', next);
    return playlist;
  },

  renamePlaylist: async (playlistId, name) => {
    const next = get().playlists.map((p) => (p.id === playlistId ? { ...p, name } : p));
    set({ playlists: next });
    await save('playlists', next);
  },

  deletePlaylist: async (playlistId) => {
    const next = get().playlists.filter((p) => p.id !== playlistId);
    set({ playlists: next });
    await save('playlists', next);
  },

  addToPlaylist: async (playlistId, songId) => {
    const next = get().playlists.map((p) =>
      p.id === playlistId && !p.songs.includes(songId)
        ? { ...p, songs: [...p.songs, songId] }
        : p
    );
    set({ playlists: next });
    await save('playlists', next);
  },

  removeFromPlaylist: async (playlistId, songId) => {
    const next = get().playlists.map((p) =>
      p.id === playlistId ? { ...p, songs: p.songs.filter((id) => id !== songId) } : p
    );
    set({ playlists: next });
    await save('playlists', next);
  },
}));

export default useUserDataStore;
