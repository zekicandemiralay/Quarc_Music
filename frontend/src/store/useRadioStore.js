import { create } from 'zustand';
import usePlayerStore, { schedulePreload } from './playerStore';

// Module-level: not reactive, just dedup guards
const seenKeys = new Set();
let filling = false;

const useRadioStore = create((set, get) => ({
  radioMode: JSON.parse(localStorage.getItem('skynet_radio') || 'true'),
  pendingDownloads: [], // [{ id, title, artist, progress }]

  toggleRadioMode() {
    const next = !get().radioMode;
    set({ radioMode: next });
    localStorage.setItem('skynet_radio', JSON.stringify(next));
    if (next) {
      seenKeys.clear();
      const { currentSong } = usePlayerStore.getState();
      if (currentSong) get().fillQueue(currentSong);
    }
  },

  async fillQueue(song) {
    if (!get().radioMode || filling) return;

    const { queue, queueIndex } = usePlayerStore.getState();
    const ahead = queue.length - queueIndex - 1;
    if (ahead >= 3) return;
    const needed = 3 - ahead;

    filling = true;
    try {
      const params = new URLSearchParams({
        artist: song.artist || '',
        title: song.title || '',
      });
      const res = await fetch(`/api/radio/suggestions?${params}`);
      if (!res.ok) throw new Error('suggestions unavailable');

      const suggestions = await res.json();
      const fresh = suggestions
        .filter(s => !seenKeys.has(`${s.artist}::${s.title}`))
        .slice(0, needed);

      if (fresh.length === 0) {
        // All suggestions already seen or Last.fm returned nothing — use library songs
        for (let i = 0; i < needed; i++) addLibrarySongToQueue();
      } else {
        for (const track of fresh) {
          seenKeys.add(`${track.artist}::${track.title}`);
          startRadioDownload(track);
        }
      }
    } catch {
      // network or parse error — fall back to library songs
      for (let i = 0; i < needed; i++) addLibrarySongToQueue();
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
      await addLibrarySongToQueue();
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
      appendSongToQueue(song);
    } else {
      await addLibrarySongToQueue();
    }
  } catch {
    useRadioStore.setState((s) => ({ pendingDownloads: s.pendingDownloads.filter((d) => d.id !== downloadId) }));
    await addLibrarySongToQueue();
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

function appendSongToQueue(song) {
  const wasWaiting = usePlayerStore.getState().waitingForRadio;
  usePlayerStore.setState(s => {
    const newQueue = [...s.queue, song];
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
    const { queue } = usePlayerStore.getState();
    const queueIds = new Set(queue.map(s => s.id));
    const eligible = allSongs.filter(s => !queueIds.has(s.id));
    if (!eligible.length) return;
    const song = eligible[Math.floor(Math.random() * eligible.length)];
    appendSongToQueue(song);
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
      localStorage.setItem('skynet_radio', JSON.stringify(on));
    }
    useRadioStore.getState().fillQueue(state.currentSong);
  }
  // Player hit end of queue — kick off a fresh fill so downloads start immediately
  if (state.waitingForRadio && !prev.waitingForRadio && state.currentSong) {
    filling = false; // allow re-entry even if a prior fill just completed
    useRadioStore.getState().fillQueue(state.currentSong);
  }
});

export default useRadioStore;
