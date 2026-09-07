import { create } from 'zustand';
import usePlayerStore, { schedulePreload } from './playerStore';
import { contextGroup, getRadio, setRadio } from '../lib/playbackPrefs';

// Module-level: not reactive, just dedup guards
const seenKeys = new Set();
let filling = false;
let songCountSinceLastFill = 0;

// Insert a radio song every RADIO_INTERVAL library songs
const RADIO_INTERVAL = 3;

// Radio is "seed-anchored" while browsing the library with it on: the queue
// is nothing but suggestions based on the one song the listen started from.
// In a curated list (playlist / Liked / Mix / Collection) radio instead just
// interleaves the occasional suggestion into the list, as before.
function isSeedAnchored() {
  return useRadioStore.getState().radioMode
    && contextGroup(usePlayerStore.getState().playContext) === 'library';
}

const useRadioStore = create((set, get) => ({
  radioMode: getRadio(contextGroup(usePlayerStore.getState().playContext)),
  pendingDownloads: [], // [{ id, title, artist, progress }]

  toggleRadioMode() {
    const next = !get().radioMode;
    const { currentSong, playContext } = usePlayerStore.getState();
    const group = contextGroup(playContext);
    set({ radioMode: next });
    setRadio(group, next); // remembered per context group, across sessions
    if (next) {
      seenKeys.clear();
      songCountSinceLastFill = 0;
      if (currentSong) {
        // Turning radio on while browsing the library switches to a
        // seed-anchored stream from whatever is playing now — drop the rest
        // of the queued library and let suggestions take it from here.
        if (group === 'library') {
          usePlayerStore.setState({ queue: [currentSong], queueIndex: 0, seedSong: currentSong });
        }
        get().fillQueue(currentSong);
      }
    }
  },

  async fillQueue(song) {
    if (!get().radioMode || filling) return;
    if (get().pendingDownloads.length >= 1) return; // one at a time

    filling = true;
    try {
      // Anchor suggestions to the song the listen STARTED from, not whatever
      // is playing right now — otherwise each suggestion seeds the next and
      // the stream drifts steadily away from what the user actually picked.
      const { seedSong } = usePlayerStore.getState();
      const basis = (isSeedAnchored() && seedSong) ? seedSong : song;
      const params = new URLSearchParams({
        artist: basis.artist || '',
        title: basis.title || '',
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
      // Adopt this context group's REMEMBERED radio setting. This used to
      // force radio on/off purely from the context ("not a playlist? on"),
      // silently overwriting the user's own choice every time they moved
      // between the library and a playlist — which is why turning radio off
      // never stuck. See lib/playbackPrefs.js.
      useRadioStore.setState({ radioMode: getRadio(contextGroup(state.playContext)) });
      seenKeys.clear();
      songCountSinceLastFill = 0;
    }
    songCountSinceLastFill++;
    // A seed-anchored stream is the whole queue, so keep a couple of songs
    // buffered ahead or playback stalls waiting on each download. In a
    // curated list, interleave one suggestion every RADIO_INTERVAL songs.
    const upcoming = state.queue.length - state.queueIndex - 1;
    const needsFill = isSeedAnchored()
      ? upcoming < 2
      : songCountSinceLastFill >= RADIO_INTERVAL;
    if (needsFill) {
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
