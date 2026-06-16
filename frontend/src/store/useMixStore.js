import { create } from 'zustand';

const useMixStore = create((set, get) => ({
  mixes: [],
  loaded: false,

  loadMixes: async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/mixes', { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const mixes = await res.json();
        set({ mixes, loaded: true });
      }
    } catch {
      // Offline or error — keep empty list, don't block UI
    }
  },

  getMix: (id) => get().mixes.find((m) => m.id === id) || null,

  reset: () => set({ mixes: [], loaded: false }),
}));

export default useMixStore;
