import { create } from 'zustand';

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

const useSharedPlaylistsStore = create((set, get) => ({
  playlists: [], // [{id, name, created_by, song_count, member_count}]
  loaded: false,

  load: async () => {
    try {
      const playlists = await getJson('/api/shared-playlists');
      set({ playlists, loaded: true });
    } catch { /* keep whatever was already loaded */ }
  },

  reset: () => set({ playlists: [], loaded: false }),

  create: async (name) => {
    const playlist = await getJson('/api/shared-playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    set((s) => ({ playlists: [playlist, ...s.playlists] }));
    return playlist;
  },

  deletePlaylist: async (id) => {
    await getJson(`/api/shared-playlists/${id}`, { method: 'DELETE' });
    set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
  },

  // Detail (members + songs) isn't kept in this store's list state — the
  // playlist page fetches and owns its own copy, same as Library.jsx does
  // for the main song list, since it's a different shape (songs + members).
  getDetail: (id) => getJson(`/api/shared-playlists/${id}`),

  addSong: (id, songId) => getJson(`/api/shared-playlists/${id}/songs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId }),
  }),

  removeSong: (id, songId) => getJson(`/api/shared-playlists/${id}/songs/${songId}`, { method: 'DELETE' }),

  addMember: (id, userId) => getJson(`/api/shared-playlists/${id}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  }),

  removeMember: (id, userId) => getJson(`/api/shared-playlists/${id}/members/${userId}`, { method: 'DELETE' }),
}));

export default useSharedPlaylistsStore;
