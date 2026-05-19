import { create } from 'zustand';
import { getAudioBlob } from '../lib/offlineLib';
import useOfflineStore from './useOfflineStore';

// Weighted shuffle: songs played more tend to appear earlier in the queue
function weightedShuffle(songs) {
  const items = songs.map((s) => ({ song: s, w: Math.pow(1 + (s.play_count || 0), 0.3) }));
  const result = [];
  while (items.length) {
    const total = items.reduce((sum, x) => sum + x.w, 0);
    let r = Math.random() * total;
    let idx = items.length - 1;
    for (let i = 0; i < items.length; i++) {
      r -= items[i].w;
      if (r <= 0) { idx = i; break; }
    }
    result.push(items.splice(idx, 1)[0].song);
  }
  return result;
}

// Artist interleaving: prevents the same artist from playing back-to-back
function interleaveArtists(songs) {
  if (songs.length <= 3) return songs;
  const groups = {};
  for (const s of songs) {
    const key = s.artist || '';
    (groups[key] = groups[key] || []).push(s);
  }
  const queues = Object.values(groups);
  const result = [];
  let lastArtist = null;
  while (result.length < songs.length) {
    const avail = queues.filter((q) => q.length > 0 && (q[0].artist || '') !== lastArtist);
    const pool = avail.length ? avail : queues.filter((q) => q.length > 0);
    if (!pool.length) break;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    const song = chosen.shift();
    result.push(song);
    lastArtist = song.artist || '';
  }
  return result;
}

function smartShuffle(songs) {
  return interleaveArtists(weightedShuffle(songs));
}

const audio = new Audio();
audio.preload = 'metadata';

// Silent preloader — buffers the next song in the background so it starts instantly
const preloader = new Audio();
preloader.preload = 'auto';

function schedulePreload(queue, queueIndex) {
  const next = queue[queueIndex + 1];
  if (!next) return;
  const src = `/api/music/${next.id}/stream`;
  if (preloader.src !== src) preloader.src = src;
}

// iOS shows seek buttons whenever setPositionState is called — skip it on iOS
// so the lock screen always shows prev/next track buttons instead.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

// Tracks accumulated real-time seconds for the current song
let playTrack = { songId: null, accumulated: 0, resumeAt: null };

function flushPlay(songId) {
  const extra = playTrack.resumeAt ? (Date.now() - playTrack.resumeAt) / 1000 : 0;
  const total = playTrack.accumulated + extra;
  playTrack.accumulated = 0;
  playTrack.resumeAt = null;
  if (!songId || total < 10) return;
  fetch('/api/me/stats/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId, durationSeconds: Math.round(total) }),
  }).catch(() => {});
}

function applyMediaSessionMeta(song) {
  if (!('mediaSession' in navigator) || !song) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title || 'Unknown',
    artist: song.artist || '',
    album: song.album || '',
    artwork: song.has_cover
      ? [{ src: `/api/music/${song.id}/cover`, sizes: '512x512', type: 'image/jpeg' }]
      : [],
  });
}

const usePlayerStore = create((set, get) => ({
  currentSong: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  queue: [],
  queueIndex: -1,
  shuffle: false,
  playContext: 'single',
  waitingForRadio: false,

  playSong: async (song, queue = null, queueIndex = 0, context) => {
    const state = get();
    if (state.currentSong?.id === song.id) {
      // Re-clicking the current song restarts it from the beginning
      audio.currentTime = 0;
      audio.play().catch(() => {});
      set({ currentTime: 0 });
      return;
    }
    // Flush previous song's play time before switching
    if (playTrack.songId) flushPlay(playTrack.songId);
    playTrack = { songId: song.id, accumulated: 0, resumeAt: null };

    // Update state immediately so UI responds before the async cache check
    const newContext = context !== undefined ? context : get().playContext;
    set({ currentSong: song, isPlaying: true, currentTime: 0, queue: queue || [song], queueIndex, playContext: newContext, waitingForRadio: false });
    applyMediaSessionMeta(song);

    // Play immediately from stream URL — no await before play() so iOS keeps
    // the user gesture context and audio starts without delay.
    const streamSrc = `/api/music/${song.id}/stream`;
    audio.src = streamSrc;
    audio.play().catch(() => {});
    const { queue: q, queueIndex: qi } = usePlayerStore.getState();
    schedulePreload(q, qi);

    // Background: if this song is cached, load the blob and swap in only when
    // offline (stream would fail anyway) or before audio has started buffering.
    const { cachedIds } = useOfflineStore.getState();
    if (cachedIds.has(song.id)) {
      getAudioBlob(song.id).then((blob) => {
        if (!blob || usePlayerStore.getState().currentSong?.id !== song.id) return;
        if (navigator.onLine && audio.readyState >= 2) return; // stream already buffering — don't disrupt
        const blobUrl = URL.createObjectURL(blob);
        const t = audio.currentTime;
        const wasPlaying = !audio.paused;
        audio.src = blobUrl;
        if (t > 0) audio.currentTime = t;
        if (wasPlaying) audio.play().catch(() => {});
      }).catch(() => {});
    }
  },

  pause: () => { audio.pause(); set({ isPlaying: false }); },
  resume: () => {
    set({ isPlaying: true }); // optimistic — reverted below if play() rejects
    audio.play().catch(() => set({ isPlaying: false }));
  },

  next: () => {
    const { queue, queueIndex } = get();
    if (!queue.length) return;
    const idx = queueIndex + 1;
    if (idx >= queue.length) {
      // Queue exhausted — signal radio to resume playback when a new song arrives
      set({ waitingForRadio: true });
      return;
    }
    // If preloader already buffered this song, swap it in directly for instant start
    const nextSrc = `/api/music/${queue[idx].id}/stream`;
    if (preloader.src === nextSrc && !preloader.error) {
      if (playTrack.songId) flushPlay(playTrack.songId);
      playTrack = { songId: queue[idx].id, accumulated: 0, resumeAt: null };
      set({ currentSong: queue[idx], isPlaying: true, currentTime: 0, queueIndex: idx, waitingForRadio: false });
      applyMediaSessionMeta(queue[idx]);
      audio.src = nextSrc;
      audio.play().catch(() => {});
      schedulePreload(queue, idx);
    } else {
      get().playSong(queue[idx], queue, idx);
    }
  },

  prev: () => {
    const { queue, queueIndex, currentTime } = get();
    if (currentTime > 3) { audio.currentTime = 0; return; }
    if (queueIndex > 0) {
      const idx = queueIndex - 1;
      get().playSong(queue[idx], queue, idx);
    }
  },

  shufflePlay: (songs, context = 'single') => {
    if (!songs.length) return;
    const shuffled = smartShuffle(songs);
    set({ shuffle: true });
    get().playSong(shuffled[0], shuffled, 0, context);
  },

  toggleShuffle: () => {
    const { shuffle, queue, currentSong } = get();
    const newShuffle = !shuffle;
    if (newShuffle && queue.length > 1 && currentSong) {
      // Keep current song at index 0, smartShuffle everything else
      const others = queue.filter((s) => s.id !== currentSong.id);
      set({ shuffle: true, queue: [currentSong, ...smartShuffle(others)], queueIndex: 0 });
    } else {
      set({ shuffle: newShuffle });
    }
  },

  seek: (time) => { audio.currentTime = time; set({ currentTime: time }); },
  setVolume: (v) => { audio.volume = v; set({ volume: v }); },
}));

// Audio event → store sync
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime;
  usePlayerStore.setState({ currentTime: t });
  if (!isIOS && 'mediaSession' in navigator && !isNaN(audio.duration) && audio.duration > 0) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: t,
      });
    } catch {}
  }
});

audio.addEventListener('durationchange', () => usePlayerStore.setState({ duration: audio.duration || 0 }));
audio.addEventListener('error', () => usePlayerStore.setState({ isPlaying: false }));

audio.addEventListener('play', () => {
  playTrack.resumeAt = Date.now();
  usePlayerStore.setState({ isPlaying: true });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});

audio.addEventListener('pause', () => {
  if (playTrack.resumeAt) {
    playTrack.accumulated += (Date.now() - playTrack.resumeAt) / 1000;
    playTrack.resumeAt = null;
  }
  usePlayerStore.setState({ isPlaying: false });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});

audio.addEventListener('ended', () => {
  const sid = playTrack.songId;
  flushPlay(sid);
  playTrack = { songId: null, accumulated: 0, resumeAt: null };
  usePlayerStore.getState().next();
});

// Lock screen / headphone controls
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    const { currentSong, currentTime: storeTime } = usePlayerStore.getState();
    if (!currentSong) return;
    usePlayerStore.setState({ isPlaying: true });
    if (audio.readyState < 2) {
      // Stream connection dropped while screen was locked — reload before playing
      const t = audio.currentTime || storeTime;
      audio.src = `/api/music/${currentSong.id}/stream`;
      audio.addEventListener('canplay', () => {
        if (t > 0) audio.currentTime = t;
        audio.play().catch(() => usePlayerStore.setState({ isPlaying: false }));
      }, { once: true });
    } else {
      audio.play().catch(() => usePlayerStore.setState({ isPlaying: false }));
    }
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    audio.pause();
    usePlayerStore.setState({ isPlaying: false });
  });
  navigator.mediaSession.setActionHandler('nexttrack', () => usePlayerStore.getState().next());
  navigator.mediaSession.setActionHandler('previoustrack', () => usePlayerStore.getState().prev());
  // On iOS, registering seekforward/seekbackward/seekto causes the lock screen
  // to show seek buttons instead of prev/next. Skip all seek handlers on iOS.
  if (!isIOS) {
    navigator.mediaSession.setActionHandler('seekbackward', null);
    navigator.mediaSession.setActionHandler('seekforward', null);
    navigator.mediaSession.setActionHandler('seekto', (d) => {
      if (d.seekTime !== undefined) {
        audio.currentTime = d.seekTime;
        usePlayerStore.setState({ currentTime: d.seekTime });
      }
    });
  }
}

// ── Persist / restore last-played song ───────────────────────────────────────

function saveState() {
  const { currentSong, currentTime, queue, queueIndex, shuffle, playContext } = usePlayerStore.getState();
  if (!currentSong) return;
  try {
    // Keep up to 500 songs from current position to stay within storage limits
    const savedQueue = queue.length <= 500 ? queue : queue.slice(queueIndex, queueIndex + 500);
    const savedIndex = queue.length <= 500 ? queueIndex : 0;
    localStorage.setItem('skynet_player_state', JSON.stringify({
      song: currentSong,
      time: Math.floor(currentTime),
      queue: savedQueue,
      queueIndex: savedIndex,
      shuffle,
      playContext,
    }));
  } catch {}
}

// Save on song change immediately; throttle time saves to every 5 s
let saveTimer = null;
let lastSavedTime = 0;
usePlayerStore.subscribe((state, prev) => {
  if (state.currentSong?.id !== prev.currentSong?.id) { saveState(); return; }
  if (Math.abs(state.currentTime - lastSavedTime) >= 5) {
    lastSavedTime = state.currentTime;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, 500);
  }
});

// Restore on page load — show last song in bar, don't auto-play
try {
  const saved = JSON.parse(localStorage.getItem('skynet_player_state') || 'null');
  if (saved?.song) {
    usePlayerStore.setState({
      currentSong: saved.song,
      queue: saved.queue?.length ? saved.queue : [saved.song],
      queueIndex: saved.queueIndex ?? 0,
      shuffle: saved.shuffle ?? false,
      playContext: saved.playContext || 'single',
      currentTime: saved.time || 0,
      isPlaying: false,
    });
    audio.src = `/api/music/${saved.song.id}/stream`;
    if (saved.time > 0) {
      audio.addEventListener('loadedmetadata', function onMeta() {
        audio.currentTime = saved.time;
        audio.removeEventListener('loadedmetadata', onMeta);
      });
    }
    applyMediaSessionMeta(saved.song);
  }
} catch {}

export { schedulePreload };
export default usePlayerStore;
