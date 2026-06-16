import { create } from 'zustand';
import usePlayerStore, { schedulePreload } from './playerStore';

// Module-level: not reactive, just dedup guards
const seenKeys = new Set();
let filling = false;
let songCountSinceLastFill = 0;

// Insert a radio song every RADIO_INTERVAL library songs
const RADIO_INTERVAL = 3;

const useRadioStore = create((set, get) => ({
  radioMode: JSON.parse(localStorage.getItem('quarc_radio') || 'true'),
  pendingDownloads: [], // [{ id, title, artist, progress }]

  toggleRadioMode() {
    const next = !get().radioMode;
    set({ radioMode: next });
    localStorage.setItem('quarc_radio', JSON.stringify(next));
    if (next) {
      seenKeys.clear();
      songCountSinceLastFill = 0;
      const { currentSong } = usePlayerStore.getState();
      if (currentSong) get().fillQueue(currentSong);
    }
  },

  async fillQueue(song) {
    if (!get().radioMode || filling) return;
    if (get().pendingDownloads.length >= 1) return; // one at a time

    filling = true;
    try {
      const params = new URLSearchParams({
        artist: song.artist || '',
        title: song.title || '',
      });
      const res = await fetch(`/api/radio/suggestions?${params}`);
      if (!res.ok) throw new Error('suggestions unavailable');

      const suggestions = await res.json();
      const fresh = suggestions.find(s => !seenKeys.has(`${s.artist}::${s.title}`));

      if (!fresh) {
        addLibrarySongToQueue();
      } else {
        seenKeys.add(`${fresh.artist}::${fresh.title}`);
        startRadioDownload(fresh);
      }
    } catch {
      // No Last.fm key or network error — fall back to library songs
      addLibrarySongToQueue();
    } finally {
      filling = false;
    }
  },
}));

async function startRadioDownload(track) {
  const downloadId = Math.random().toString(36).slice(2);
  useRadioStore.setState((s) => ({
    pendingDownloads: [...s.pendingDownloads, { id: downloadId, title: track.title, artist: track.artist, progress: 0 }],
  }));

  try {
    const res = await fetch('/api/radio/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: track.artist, title: track.title }),
    });
    const { jobId } = await res.json();
    if (!jobId) {
      useRadioStore.setState((s) => ({ pendingDownloads: s.pendingDownloads.filter((d) => d.id !== downloadId) }));
      addLibrarySongToQueue();
      return;
    }

    const song = await pollUntilDone(jobId, (progress) => {
      useRadioStore.setState((s) => ({
        pendingDownloads: s.pendingDownloads.map((d) => d.id === downloadId ? { ...d, progress } : d),
      }));
    });

    if (!useRadioStore.getState().radioMode) {
      useRadioStore.setState((s) => ({ pendingDownloads: s.pendingDownloads.filter((d) => d.id !== downloadId) }));
      return;
    }

    useRadioStore.setState((s) => ({ pendingDownloads: s.pendingDownloads.filter((d) => d.id !== downloadId) }));

    if (song) {
      insertSongIntoQueue(song);
    } else {
      addLibrarySongToQueue();
    }
  } catch {
    useRadioStore.setState((s) => ({ pendingDownloads: s.pendingDownloads.filter((d) => d.id !== downloadId) }));
    addLibrarySongToQueue();
  }
}

async function pollUntilDone(jobId, onProgress) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res = await fetch(`/api/radio/status/${jobId}`);
      const job = await res.json();
      if (onProgress && typeof job.progress === 'number') onProgress(job.progress);
      if (job.status === 'done') return job.song || null;
      if (job.status === 'error') return null;
    } catch {}
  }
  return null;
}

// Insert a radio song RADIO_INTERVAL positions ahead so it appears soon, not at the end
function insertSongIntoQueue(song) {
  const wasWaiting = usePlayerStore.getState().waitingForRadio;
  usePlayerStore.setState(s => {
    const insertAt = Math.min(s.queueIndex + RADIO_INTERVAL, s.queue.length);
    const newQueue = [
      ...s.queue.slice(0, insertAt),
      song,
      ...s.queue.slice(insertAt),
    ];
    schedulePreload(newQueue, s.queueIndex);
    return { queue: newQueue };
  });
  if (wasWaiting) {
    usePlayerStore.getState().next();
  }
}

async function addLibrarySongToQueue() {
  if (!useRadioStore.getState().radioMode) return;
  try {
    const res = await fetch('/api/music');
    if (!res.ok) return;
    const allSongs = await res.json();
    if (!allSongs.length) return;
    const { queue, queueIndex } = usePlayerStore.getState();
    // Prefer songs not already in the upcoming queue; allow repeats if all are queued
    const upcomingIds = new Set(queue.slice(queueIndex + 1).map(s => s.id));
    const eligible = allSongs.filter(s => !upcomingIds.has(s.id));
    const pool = eligible.length ? eligible : allSongs;
    const song = pool[Math.floor(Math.random() * pool.length)];
    insertSongIntoQueue(song);
  } catch {}
}

// Auto-fill queue whenever the current song changes.
// Also auto-set radio mode when the user explicitly starts a new play context:
//   playlist / liked songs → radio OFF
//   anything else          → radio ON
usePlayerStore.subscribe((state, prev) => {
  if (state.currentSong?.id !== prev.currentSong?.id && state.currentSong) {
    if (state.playContext !== prev.playContext) {
      const on = state.playContext !== 'playlist';
      useRadioStore.setState({ radioMode: on });
      localStorage.setItem('quarc_radio', JSON.stringify(on));
      songCountSinceLastFill = 0;
      if (on) useRadioStore.getState().fillQueue(state.currentSong);
    }
    // Trigger every RADIO_INTERVAL songs so radio is interleaved, not dumped at the end
    songCountSinceLastFill++;
    if (songCountSinceLastFill >= RADIO_INTERVAL) {
      songCountSinceLastFill = 0;
      useRadioStore.getState().fillQueue(state.currentSong);
    }
  }
  // Player hit end of queue — fill immediately
  if (state.waitingForRadio && !prev.waitingForRadio && state.currentSong) {
    filling = false;
    songCountSinceLastFill = 0;
    useRadioStore.getState().fillQueue(state.currentSong);
  }
});

export default useRadioStore;
