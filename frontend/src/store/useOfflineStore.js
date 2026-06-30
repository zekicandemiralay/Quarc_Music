import { create } from 'zustand';
import { saveAudio, getAudioBlob, removeAudio, getAllCachedIds, getStorageEstimate } from '../lib/offlineLib';
import { streamUrl } from '../lib/apiUrl';

// ── Wake Lock ────────────────────────────────────────────────────────────
let wakeLock = null;

async function acquireWakeLock() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    useOfflineStore.setState({ wakeLockActive: true });
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
      useOfflineStore.setState({ wakeLockActive: false });
    });
  } catch {}
}

async function releaseWakeLock() {
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
  useOfflineStore.setState({ wakeLockActive: false });
}

// Re-acquire when user unlocks screen while downloads are still running
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const { downloading } = useOfflineStore.getState();
      if (Object.keys(downloading).length > 0 && !wakeLock) acquireWakeLock();
    }
  });
}

const useOfflineStore = create((set, get) => ({
  cachedIds: new Set(),
  downloading: {},   // songId → number (0–100) | 'error'
  storageEstimate: null,
  initialized: false,
  wakeLockActive: false,

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

    // Acquire wake lock when first download starts
    if (Object.keys(downloading).length === 0) acquireWakeLock();
    set((s) => ({ downloading: { ...s.downloading, [song.id]: 0 } }));

    try {
      const res = await fetch(streamUrl(song.id));
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

      // Release wake lock when last download finishes
      if (Object.keys(get().downloading).length === 0) releaseWakeLock();
    } catch {
      set((s) => ({ downloading: { ...s.downloading, [song.id]: 'error' } }));
      setTimeout(() => {
        set((s) => {
          const { [song.id]: _removed, ...rest } = s.downloading;
          return { downloading: rest };
        });
        if (Object.keys(get().downloading).length === 0) releaseWakeLock();
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
