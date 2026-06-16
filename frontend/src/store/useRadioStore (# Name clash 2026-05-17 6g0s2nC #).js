import { create } from 'zustand';
import usePlayerStore, { schedulePreload } from './playerStore';

// Module-level: not reactive, just dedup guards
const seenKeys = new Set();
let filling = false;

const useRadioStore = create((set, get) => ({
  radioMode: JSON.parse(localStorage.getItem('quarc_radio') || 'true'),

  toggleRadioMode() {
    const next = !get().radioMode;
    set({ radioMode: next });
    localStorage.setItem('quarc_radio', JSON.stringify(next));
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

    filling = true;
    try {
      const params = new URLSearchParams({
        artist: song.artist || '',
        title: song.title || '',
      });
      const res = await fetch(`/api/radio/suggestions?${params}`);
      if (!res.ok) return;

      const suggestions = await res.json();
      const needed = 3 - ahead;
      const fresh = suggestions
        .filter(s => !seenKeys.has(`${s.artist}::${s.title}`))
        .slice(0, needed);

      for (const track of fresh) {
        seenKeys.add(`${track.artist}::${track.title}`);
        startRadioDownload(track);
      }
    } catch {
      // network or parse error — fail silently
    } finally {
      filling = false;
    }
  },
}));

async function startRadioDownload(track) {
  try {
    const res = await fetch('/api/radio/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: track.artist, title: track.title }),
    });
    const { jobId } = await res.json();
    if (!jobId) return;

    const song = await pollUntilDone(jobId);
    if (!song) return;
    if (!useRadioStore.getState().radioMode) return;

    usePlayerStore.setState(s => {
      const newQueue = [...s.queue, song];
      schedulePreload(newQueue, s.queueIndex);
      return { queue: newQueue };
    });
  } catch {}
}

async function pollUntilDone(jobId) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res = await fetch(`/api/radio/status/${jobId}`);
      const job = await res.json();
      if (job.status === 'done' && job.song) return job.song;
      if (job.status === 'error') return null;
    } catch {}
  }
  return null;
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
    }
    useRadioStore.getState().fillQueue(state.currentSong);
  }
});

export default useRadioStore;
