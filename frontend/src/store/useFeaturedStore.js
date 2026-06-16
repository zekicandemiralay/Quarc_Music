import { create } from 'zustand';

const useFeaturedStore = create((set, get) => ({
  playlists: [],
  loaded: false,

  load: async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/featured', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) set({ playlists: await res.json(), loaded: true });
    } catch {}
  },

  getPlaylist: (id) => get().playlists.find((p) => p.id === id) || null,

  reset: () => set({ playlists: [], loaded: false }),
}));

export default useFeaturedStore;
