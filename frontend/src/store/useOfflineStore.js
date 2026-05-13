import { create } from 'zustand';
import { saveAudio, getAudioBlob, removeAudio, getAllCachedIds, getStorageEstimate } from '../lib/offlineLib';

const useOfflineStore = create((set, get) => ({
  cachedIds: new Set(),
  downloading: {},   // songId → number (0–100) | 'error'
  storageEstimate: null,
  initialized: false,

  init: async () => {
    try {
      const ids = await getAllCachedIds();
      const storageEstimate = await getStorageEstimate();
      set({ cachedIds: new Set(ids), storageEstimate, initialized: true });
    } catch {
      set({ initialized: true });
    }
  },

  getAudioUrl: async (songId) => {
    if (!get().cachedIds.has(songId)) return null;
    try {
      const blob = await getAudioBlob(songId);
      return blob ? URL.createObjectURL(blob) : null;
    } catch {
      return null;
    }
  },

  cacheSong: async (song) => {
    const { cachedIds, downloading } = get();
    if (cachedIds.has(song.id) || downloading[song.id] !== undefined) return;

    set((s) => ({ downloading: { ...s.downloading, [song.id]: 0 } }));

    try {
      const res = await fetch(`/api/music/${song.id}/stream`);
      if (!res.ok) throw new Error('Fetch failed');

      const total = parseInt(res.headers.get('Content-Length') || '0', 10);
      const contentType = res.headers.get('Content-Type') || 'audio/mpeg';
      const reader = res.body.getReader();
      const chunks = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (total > 0) {
          set((s) => ({ downloading: { ...s.downloading, [song.id]: Math.round((loaded / total) * 100) } }));
        }
      }

      const blob = new Blob(chunks, { type: contentType });
      await saveAudio(song.id, blob);

      set((s) => {
        const newCached = new Set(s.cachedIds);
        newCached.add(song.id);
        const { [song.id]: _removed, ...rest } = s.downloading;
        return { cachedIds: newCached, downloading: rest };
      });

      const storageEstimate = await getStorageEstimate();
      if (storageEstimate) set({ storageEstimate });
    } catch {
      set((s) => ({ downloading: { ...s.downloading, [song.id]: 'error' } }));
      setTimeout(() => {
        set((s) => {
          const { [song.id]: _removed, ...rest } = s.downloading;
          return { downloading: rest };
        });
      }, 3000);
    }
  },

  // Downloads songs one at a time (avoids overwhelming mobile memory)
  cacheSongs: async (songs) => {
    for (const song of songs) {
      await get().cacheSong(song);
    }
  },

  removeSong: async (songId) => {
    await removeAudio(songId);
    set((s) => {
      const newCached = new Set(s.cachedIds);
      newCached.delete(songId);
      return { cachedIds: newCached };
    });
    const storageEstimate = await getStorageEstimate();
    if (storageEstimate) set({ storageEstimate });
  },

  removeSongs: async (songIds) => {
    for (const id of songIds) await removeAudio(id);
    set((s) => {
      const newCached = new Set(s.cachedIds);
      songIds.forEach((id) => newCached.delete(id));
      return { cachedIds: newCached };
    });
    const storageEstimate = await getStorageEstimate();
    if (storageEstimate) set({ storageEstimate });
  },
}));

export default useOfflineStore;
