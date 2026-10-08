import { create } from 'zustand';
import { saveAudio, getAudioBlob, removeAudio, getAllCachedSongs, getStorageEstimate, setCachedMeta } from '../lib/offlineLib';
import { loadCachedSongs, saveCachedSongs } from '../lib/songCache';
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
  cachedSongs: [],   // [{ ...song, savedAt, bytes }] — enough to render with no network
  downloading: {},   // songId → number (0–100) | 'error'
  storageEstimate: null,
  initialized: false,
  wakeLockActive: false,

  init: async () => {
    try {
      const records = await getAllCachedSongs();
      const storageEstimate = await getStorageEstimate();

      // Songs downloaded before details were stored alongside the audio have
      // no meta of their own. Recover them from the library cache if it's
      // there, and write it back so this only has to happen once.
      const library = loadCachedSongs();
      const byId = new Map(library.map((s) => [s.id, s]));
      const cachedSongs = records.map((r) => {
        const meta = r.meta || byId.get(r.songId) || null;
        if (!r.meta && meta) setCachedMeta(r.songId, meta).catch(() => {});
        return { ...(meta || { id: r.songId, title: null, artist: null }), id: r.songId, savedAt: r.savedAt, bytes: r.bytes };
      });

      set({
        cachedIds: new Set(records.map((r) => r.songId)),
        cachedSongs,
        storageEstimate,
        initialized: true,
      });
    } catch {
      set({ initialized: true });
    }
  },

  // Fill in details for downloads that don't have any.
  //
  // init() runs when the app mounts, but the library cache is only written
  // when the Library page is actually visited — so anything downloaded before
  // details were stored beside the audio would find nothing to copy from and
  // stay nameless, which is what "Unknown title" was. Resolving it once at
  // startup was the mistake; this can be called whenever a library turns up,
  // and falls back to asking the server when the cache still can't answer.
  //
  // Whatever it resolves is written back to IndexedDB, so each song only
  // needs this once, and it works offline from then on.
  hydrateMeta: async () => {
    const needsMeta = () => get().cachedSongs.filter((c) => !c.title);
    if (!needsMeta().length) return;

    const apply = (library) => {
      if (!library.length) return;
      const byId = new Map(library.map((s) => [s.id, s]));
      let changed = false;
      const cachedSongs = get().cachedSongs.map((c) => {
        if (c.title) return c;
        const found = byId.get(c.id);
        if (!found) return c;
        changed = true;
        const meta = {
          id: found.id, title: found.title, artist: found.artist, album: found.album,
          duration: found.duration, has_cover: found.has_cover,
        };
        setCachedMeta(c.id, meta).catch(() => {});
        return { ...meta, savedAt: c.savedAt, bytes: c.bytes };
      });
      if (changed) set({ cachedSongs });
    };

    apply(loadCachedSongs());
    if (!needsMeta().length || !navigator.onLine) return;

    // The cache couldn't answer and we have a connection — ask the server,
    // and keep the result so the Library page benefits too.
    try {
      const res = await fetch('/api/music');
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      saveCachedSongs(data);
      apply(data);
    } catch {
      // Offline after all, or the server is down — the names stay unknown,
      // which is cosmetic. The audio still plays.
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
      // Keep only what's needed to display it — no play_count or other
      // server-side state that goes stale the moment it's written.
      const meta = {
        id: song.id, title: song.title, artist: song.artist, album: song.album,
        duration: song.duration, has_cover: song.has_cover,
      };
      await saveAudio(song.id, blob, meta);

      set((s) => {
        const newCached = new Set(s.cachedIds);
        newCached.add(song.id);
        const { [song.id]: _removed, ...rest } = s.downloading;
        return {
          cachedIds: newCached,
          downloading: rest,
          cachedSongs: [...s.cachedSongs.filter((c) => c.id !== song.id), { ...meta, savedAt: Date.now(), bytes: blob.size }],
        };
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
      return { cachedIds: newCached, cachedSongs: s.cachedSongs.filter((c) => c.id !== songId) };
    });
    const storageEstimate = await getStorageEstimate();
    if (storageEstimate) set({ storageEstimate });
  },

  removeSongs: async (songIds) => {
    for (const id of songIds) await removeAudio(id);
    set((s) => {
      const newCached = new Set(s.cachedIds);
      songIds.forEach((id) => newCached.delete(id));
      const gone = new Set(songIds);
      return { cachedIds: newCached, cachedSongs: s.cachedSongs.filter((c) => !gone.has(c.id)) };
    });
    const storageEstimate = await getStorageEstimate();
    if (storageEstimate) set({ storageEstimate });
  },
}));

export default useOfflineStore;
