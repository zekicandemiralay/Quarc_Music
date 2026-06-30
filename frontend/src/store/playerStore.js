import { create } from 'zustand';
import { getAudioBlob } from '../lib/offlineLib';
import useOfflineStore from './useOfflineStore';
import { coverUrl, streamUrl } from '../lib/apiUrl';

function weightedShuffle(songs) {
  const arr = [...songs];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
// iOS requires the audio element to be attached to the document for the
// lock screen media session to activate (Apple's MediaSession API spec).
document.body.appendChild(audio);

// iOS releases the web audio session the moment audio stops playing, letting
// native apps (Spotify etc.) steal the lock-screen media controls.
// Keep the session alive during pauses with a looping silent audio clip.
// play()/pause() are called synchronously from user-gesture handlers so iOS
// allows it without a "NotAllowedError".
const _SILENT_WAV = 'data:audio/wav;base64,UklGRiQIAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAIAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
const _silentAudio = new Audio(_SILENT_WAV);
_silentAudio.loop = true;
document.body.appendChild(_silentAudio);
function _startSilentKeepAlive() {
  if (!isIOS) return;
  _silentAudio.play().catch(() => {});
}
function _stopSilentKeepAlive() {
  if (!isIOS) return;
  _silentAudio.pause();
}

// Native foreground service — keeps CPU/network alive when screen locks on Android.
// window.Capacitor is injected by the native WebView; no-op in a regular browser.
function nativeService(method, data) {
  try { window?.Capacitor?.Plugins?.MusicService?.[method]?.(data ?? {}); } catch {}
}

// Fetch, resize to 512×512, and base64-encode cover art for the native service.
// Doing this in JS avoids SSL trust differences between WebView and native HTTP stack.
const coverB64Cache = new Map();
async function fetchCoverBase64(songId) {
  if (coverB64Cache.has(songId)) return coverB64Cache.get(songId);
  try {
    const res = await fetch(coverUrl(songId));
    if (!res.ok) return null;
    const blob = await res.blob();
    const img = document.createElement('img');
    const blobUrl = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = blobUrl; });
    URL.revokeObjectURL(blobUrl);
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    const jpegBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
    const b64 = await new Promise(r => {
      const fr = new FileReader();
      fr.onloadend = () => r(fr.result?.split(',')[1] ?? null);
      fr.readAsDataURL(jpegBlob);
    });
    if (b64) {
      if (coverB64Cache.size >= 10) coverB64Cache.delete(coverB64Cache.keys().next().value);
      coverB64Cache.set(songId, b64);
    }
    return b64;
  } catch { return null; }
}

// Track the last song for which we called nativeService('start') so we can
// distinguish a new-song start from a resume (same song, same ID).
let lastNativeStartSongId = null;

// Silent preloader — buffers the next song in the background so it starts instantly
const preloader = new Audio();
preloader.preload = 'auto';

function schedulePreload(queue, queueIndex) {
  const next = queue[queueIndex + 1];
  if (!next) return;
  const src = streamUrl(next.id);
  if (preloader.src !== src) preloader.src = src;
}

// Pre-buffer the next N songs as blobs while the current song streams.
// When a pre-buffered song starts, it plays entirely from memory — no network
// dependency, so the OS suspending connections on screen-lock can't stop it.
// The current song still streams (no mid-song swap = no stutter).
const PREBUFFER_COUNT = 3;
const blobCache = new Map(); // songId → objectURL
const blobFetching = new Set(); // songIds currently being fetched

function pruneCache(keepIds) {
  for (const [id, url] of blobCache.entries()) {
    if (!keepIds.has(id)) { URL.revokeObjectURL(url); blobCache.delete(id); }
  }
  for (const id of blobFetching) {
    if (!keepIds.has(id)) blobFetching.delete(id);
  }
}

async function prefetchBlob(songId) {
  if (blobCache.has(songId) || blobFetching.has(songId)) return;
  const { cachedIds } = useOfflineStore.getState();
  if (cachedIds.has(songId)) return; // offline cache already handles it
  blobFetching.add(songId);
  try {
    const res = await fetch(streamUrl(songId));
    if (res.ok) {
      const blob = await res.blob();
      if (blobFetching.has(songId)) { // still relevant
        blobCache.set(songId, URL.createObjectURL(blob));
      }
    }
  } catch {}
  blobFetching.delete(songId);
}

function startPrebuffering(queue, currentIndex) {
  // Include current song so its blob is ready if Tailscale drops mid-stream.
  const upcoming = new Set(
    queue.slice(currentIndex, currentIndex + PREBUFFER_COUNT + 1).map((s) => s.id)
  );
  pruneCache(upcoming);
  for (const song of queue.slice(currentIndex, currentIndex + 1 + PREBUFFER_COUNT)) {
    prefetchBlob(song.id);
  }
}

// Seek buttons on iOS appear when seekforward/seekbackward handlers are registered,
// NOT from calling setPositionState — so we still skip those handlers below.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

// Tracks accumulated real-time seconds for the current song
let playTrack = { songId: null, accumulated: 0, resumeAt: null };

// Play history for the back button — stores snapshots of previous songs
const playHistory = [];
// Forward stack: when the user presses Back, the current snapshot is pushed here
// so that pressing Next replays it with its original queue intact (browser-style redo).
const forwardStack = [];
let goingBack = false;
// When true, the current song was restored from localStorage and was never
// explicitly played — skip pushing it to history on the next playSong call.
let restoredFromStorage = false;

// Distinguish user-initiated pauses from iOS audio interruptions (phone calls, Siri).
// Only user-initiated pauses set isPlaying=false; interruptions keep it true so
// visibilitychange can auto-resume when the app returns to foreground.
let pausedByUser = false;

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
      ? [{ src: coverUrl(song.id), sizes: '512x512', type: 'image/jpeg' }]
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
  playContextLabel: '',
  manualQueue: [],
  waitingForRadio: false,

  playSong: async (song, queue = null, queueIndex = 0, context, contextLabel, navigating = false) => {
    const state = get();
    if (state.currentSong?.id === song.id) {
      // Re-clicking the current song restarts it from the beginning
      audio.currentTime = 0;
      audio.play().catch(() => {});
      set({ currentTime: 0 });
      return;
    }
    // Manual play clears the forward stack — user started a new context.
    if (!navigating && !goingBack) forwardStack.length = 0;

    // Save current song to history so back button can return to it.
    // Skip if it was only restored from localStorage (never played this session).
    if (!goingBack && state.currentSong && !restoredFromStorage) {
      playHistory.push({ song: state.currentSong, queue: state.queue, queueIndex: state.queueIndex, playContext: state.playContext, playContextLabel: state.playContextLabel });
      if (playHistory.length > 50) playHistory.shift();
    }
    restoredFromStorage = false;

    // Flush previous song's play time before switching
    if (playTrack.songId) flushPlay(playTrack.songId);
    playTrack = { songId: song.id, accumulated: 0, resumeAt: null };

    const newContext = context !== undefined ? context : get().playContext;
    const newContextLabel = contextLabel !== undefined ? contextLabel : get().playContextLabel;

    // Shuffle the queue only when the user explicitly starts a new play context.
    // When navigating prev/next the existing queue order must be preserved.
    let finalQueue = queue || [song];
    let finalIndex = queueIndex;
    if (state.shuffle && finalQueue.length > 1 && !navigating) {
      const others = finalQueue.filter((s) => s.id !== song.id);
      finalQueue = [song, ...smartShuffle(others)];
      finalIndex = 0;
    }

    // Update state immediately so UI responds before the async cache check
    set({
      currentSong: song,
      isPlaying: true,
      currentTime: 0,
      queue: finalQueue,
      queueIndex: finalIndex,
      playContext: newContext,
      playContextLabel: newContextLabel,
      waitingForRadio: false,
    });
    applyMediaSessionMeta(song);

    // If this song was pre-buffered as a blob, use it from the very first frame
    // (no stutter, no network needed). Otherwise stream normally.
    audio.src = blobCache.has(song.id)
      ? blobCache.get(song.id)
      : streamUrl(song.id);
    audio.play().catch(() => set({ isPlaying: false }));
    schedulePreload(finalQueue, finalIndex);
    startPrebuffering(finalQueue, finalIndex);

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

  pause: () => { pausedByUser = true; _startSilentKeepAlive(); audio.pause(); set({ isPlaying: false }); },
  resume: () => {
    set({ isPlaying: true }); // optimistic — reverted below if play() rejects
    audio.play().catch(() => set({ isPlaying: false }));
  },

  next: () => {
    const { queue, queueIndex, manualQueue, playContext, playContextLabel } = get();

    // Manual queue items always play before the auto-queue (Spotify behaviour)
    if (manualQueue.length > 0) {
      const [nextSong, ...rest] = manualQueue;
      set({ manualQueue: rest });
      // Keep auto-queue position intact so after manual items the auto-queue continues
      get().playSong(nextSong, queue, queueIndex, playContext, playContextLabel);
      return;
    }

    // If the user went back, replay forward in the exact original order via the forward stack.
    if (forwardStack.length > 0) {
      const snap = forwardStack.pop();
      // playSong saves current song to history (goingBack=false) and preserves queue order (navigating=true)
      get().playSong(snap.song, snap.queue, snap.queueIndex, snap.playContext, snap.playContextLabel, true);
      return;
    }

    if (!queue.length) return;
    const idx = queueIndex + 1;
    if (idx >= queue.length) {
      // Queue exhausted — signal radio to resume playback when a new song arrives
      set({ waitingForRadio: true });
      return;
    }
    // If preloader already buffered this song, swap it in directly for instant start
    const nextSrc = streamUrl(queue[idx].id);
    if (preloader.src === nextSrc && !preloader.error) {
      // Save current song to history (playSong normally does this but is bypassed here)
      if (!goingBack) {
        const cur = get();
        if (cur.currentSong) {
          playHistory.push({ song: cur.currentSong, queue: cur.queue, queueIndex: cur.queueIndex, playContext: cur.playContext, playContextLabel: cur.playContextLabel });
          if (playHistory.length > 50) playHistory.shift();
        }
      }
      if (playTrack.songId) flushPlay(playTrack.songId);
      playTrack = { songId: queue[idx].id, accumulated: 0, resumeAt: null };
      set({ currentSong: queue[idx], isPlaying: true, currentTime: 0, queueIndex: idx, waitingForRadio: false });
      applyMediaSessionMeta(queue[idx]);
      audio.src = blobCache.has(queue[idx].id) ? blobCache.get(queue[idx].id) : nextSrc;
      audio.play().catch(() => {});
      schedulePreload(queue, idx);
      startPrebuffering(queue, idx);
    } else {
      get().playSong(queue[idx], queue, idx, playContext, playContextLabel, true);
    }
  },

  prev: () => {
    if (audio.currentTime > 5 || playHistory.length === 0) { audio.currentTime = 0; return; }
    const { currentSong, queue, queueIndex, playContext, playContextLabel } = get();
    // Push current position onto the forward stack so Next can redo it exactly.
    forwardStack.push({ song: currentSong, queue, queueIndex, playContext, playContextLabel });
    goingBack = true;
    const snap = playHistory.pop();
    get().playSong(snap.song, snap.queue, snap.queueIndex, snap.playContext, snap.playContextLabel, true);
    goingBack = false;
  },

  shufflePlay: (songs, context = 'single', contextLabel = '') => {
    if (!songs.length) return;
    const shuffled = smartShuffle(songs);
    set({ shuffle: true });
    get().playSong(shuffled[0], shuffled, 0, context, contextLabel);
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

  // ── Manual queue management ──────────────────────────────────────────────
  addToQueue: (song) => set((s) => ({ manualQueue: [...s.manualQueue, song] })),

  removeFromManualQueue: (idx) =>
    set((s) => ({ manualQueue: s.manualQueue.filter((_, i) => i !== idx) })),

  reorderManualQueue: (from, to) =>
    set((s) => {
      const q = [...s.manualQueue];
      const [item] = q.splice(from, 1);
      q.splice(to, 0, item);
      return { manualQueue: q };
    }),

  clearManualQueue: () => set({ manualQueue: [] }),
}));

// Audio event → store sync
audio.addEventListener('timeupdate', () => {
  const t = audio.currentTime;
  usePlayerStore.setState({ currentTime: t });
  if ('mediaSession' in navigator && !isNaN(audio.duration) && audio.duration > 0) {
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
  _stopSilentKeepAlive(); // real audio is playing — release the silent session hold
  playTrack.resumeAt = Date.now();
  usePlayerStore.setState({ isPlaying: true });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  const { currentSong } = usePlayerStore.getState();
  const title = currentSong?.title ?? 'Quarc Music';
  const artist = currentSong?.artist ?? '';
  // Re-apply metadata now that audio is active — iOS only registers it once playing
  applyMediaSessionMeta(currentSong);
  const isNewSong = currentSong?.id !== lastNativeStartSongId;
  if (isNewSong) {
    lastNativeStartSongId = currentSong?.id ?? null;
    nativeService('start', { title, artist });
    if (currentSong?.has_cover && currentSong.id) {
      fetchCoverBase64(currentSong.id).then(coverBase64 => {
        if (!coverBase64) return;
        if (usePlayerStore.getState().currentSong?.id !== currentSong.id) return;
        nativeService('update', { title, artist, isPlaying: true, coverBase64 });
        // Replace URL-based artwork with data URL so iOS system can display it
        // without needing auth cookies (the system fetches artwork out-of-process)
        if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
          navigator.mediaSession.metadata.artwork = [
            { src: `data:image/jpeg;base64,${coverBase64}`, sizes: '512x512', type: 'image/jpeg' }
          ];
        }
      });
    }
  } else {
    nativeService('update', { title, artist, isPlaying: true });
    // For resumes, push cached artwork as data URL if we have it
    if (currentSong?.has_cover && currentSong.id && coverB64Cache.has(currentSong.id)) {
      const b64 = coverB64Cache.get(currentSong.id);
      if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
        navigator.mediaSession.metadata.artwork = [
          { src: `data:image/jpeg;base64,${b64}`, sizes: '512x512', type: 'image/jpeg' }
        ];
      }
    }
  }
});

audio.addEventListener('pause', () => {
  if (playTrack.resumeAt) {
    playTrack.accumulated += (Date.now() - playTrack.resumeAt) / 1000;
    playTrack.resumeAt = null;
  }
  if (pausedByUser) {
    // Intentional pause — update notification to paused state but keep service alive
    pausedByUser = false;
    usePlayerStore.setState({ isPlaying: false });
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    const { currentSong } = usePlayerStore.getState();
    nativeService('update', {
      title: currentSong?.title ?? 'Quarc Music',
      artist: currentSong?.artist ?? '',
      isPlaying: false,
    });
  }
  // iOS interruption (phone call, Siri): keep isPlaying=true so visibilitychange resumes
});

audio.addEventListener('ended', () => {
  const sid = playTrack.songId;
  flushPlay(sid);
  playTrack = { songId: null, accumulated: 0, resumeAt: null };
  usePlayerStore.getState().next();
});

// When the stream stalls while the screen is locked, immediately switch to the
// pre-buffered blob so music keeps playing without waiting for screen unlock.
audio.addEventListener('waiting', () => {
  if (document.visibilityState !== 'hidden') return;
  const { currentSong, currentTime: storeTime } = usePlayerStore.getState();
  if (!currentSong || !blobCache.has(currentSong.id)) return;
  const blobUrl = blobCache.get(currentSong.id);
  if (audio.src === blobUrl) return;
  const t = audio.currentTime || storeTime;
  audio.src = blobUrl;
  audio.addEventListener('canplay', () => {
    if (t > 0) audio.currentTime = t;
    audio.play().catch(() => {});
  }, { once: true });
});

// Native lock-screen buttons (Android notification prev/play-pause/next via MusicServicePlugin)
try {
  window?.Capacitor?.Plugins?.MusicService?.addListener?.('mediaControl', (event) => {
    const action = event?.action;
    const state = usePlayerStore.getState();
    if (action === 'play') {
      const { currentSong, currentTime: storeTime } = state;
      usePlayerStore.setState({ isPlaying: true });
      if (currentSong && blobCache.has(currentSong.id)) {
        const blobUrl = blobCache.get(currentSong.id);
        const t = audio.currentTime || storeTime;
        if (audio.src !== blobUrl) {
          audio.src = blobUrl;
          audio.addEventListener('canplay', () => {
            if (t > 0) audio.currentTime = t;
            audio.play().catch(() => usePlayerStore.setState({ isPlaying: false }));
          }, { once: true });
        } else {
          audio.play().catch(() => usePlayerStore.setState({ isPlaying: false }));
        }
      } else {
        audio.play().catch(() => {
          if (currentSong) {
            audio.src = streamUrl(currentSong.id);
            audio.addEventListener('canplay', () => {
              audio.play().catch(() => usePlayerStore.setState({ isPlaying: false }));
            }, { once: true });
          } else {
            usePlayerStore.setState({ isPlaying: false });
          }
        });
      }
    } else if (action === 'pause') {
      pausedByUser = true;
      audio.pause();
    } else if (action === 'next') {
      state.next();
    } else if (action === 'previous') {
      state.prev();
    }
  });
} catch {}

// Lock screen / headphone controls
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => {
    const { currentSong, currentTime: storeTime } = usePlayerStore.getState();
    if (!currentSong) return;
    usePlayerStore.setState({ isPlaying: true });
    const t = audio.currentTime || storeTime;

    // Pre-buffered blob: swap src synchronously then call play() immediately.
    // iOS requires audio.play() to be called synchronously within the user-gesture
    // context of this handler — calling it inside a canplay callback loses that.
    if (blobCache.has(currentSong.id)) {
      const blobUrl = blobCache.get(currentSong.id);
      if (audio.src !== blobUrl) {
        audio.src = blobUrl;
        audio.addEventListener('loadedmetadata', () => { if (t > 0) audio.currentTime = t; }, { once: true });
      }
      audio.play().catch(() => usePlayerStore.setState({ isPlaying: false }));
      return;
    }

    // Buffer still valid (most common after a brief lock-screen pause): direct resume.
    if (audio.readyState >= 2) {
      audio.play().catch(() => {
        // play() rejected — only reload from network if screen is visible.
        // When locked, iOS blocks new network connections; keep isPlaying=true
        // so that visibilitychange resumes once the screen unlocks.
        if (document.visibilityState === 'hidden') return;
        audio.src = streamUrl(currentSong.id);
        const onCanPlay = () => { clearTimeout(tmo); if (t > 0) audio.currentTime = t; audio.play().catch(() => usePlayerStore.setState({ isPlaying: false })); };
        const tmo = setTimeout(() => { audio.removeEventListener('canplay', onCanPlay); usePlayerStore.setState({ isPlaying: false }); }, 5000);
        audio.addEventListener('canplay', onCanPlay, { once: true });
      });
      return;
    }

    // Buffer cleared and no blob: reload from stream only when visible.
    // If the screen is locked, keep isPlaying=true so visibilitychange picks it up.
    if (document.visibilityState === 'hidden') return;
    audio.src = streamUrl(currentSong.id);
    const onCanPlay = () => { clearTimeout(tmo); if (t > 0) audio.currentTime = t; audio.play().catch(() => usePlayerStore.setState({ isPlaying: false })); };
    const tmo = setTimeout(() => { audio.removeEventListener('canplay', onCanPlay); usePlayerStore.setState({ isPlaying: false }); }, 5000);
    audio.addEventListener('canplay', onCanPlay, { once: true });
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    pausedByUser = true;
    _startSilentKeepAlive();
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

// Sync state on unlock: if the store says playing but audio is paused after
// the screen was locked, resume from blob (no network) if available, else reload stream.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const { isPlaying, currentSong, currentTime: storeTime } = usePlayerStore.getState();
  if (isPlaying && audio.paused) {
    const t = audio.currentTime || storeTime;
    // Blob is in memory — resume without needing Tailscale to reconnect
    if (currentSong && blobCache.has(currentSong.id)) {
      const blobUrl = blobCache.get(currentSong.id);
      if (audio.src !== blobUrl) {
        audio.src = blobUrl;
        audio.addEventListener('canplay', () => {
          if (t > 0) audio.currentTime = t;
          audio.play().catch(() => {
            usePlayerStore.setState({ isPlaying: false });
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
          });
        }, { once: true });
      } else {
        audio.play().catch(() => {
          usePlayerStore.setState({ isPlaying: false });
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        });
      }
      return;
    }
    if (audio.readyState < 2 && currentSong) {
      audio.src = streamUrl(currentSong.id);
      audio.addEventListener('canplay', () => {
        if (t > 0) audio.currentTime = t;
        audio.play().catch(() => {
          usePlayerStore.setState({ isPlaying: false });
          if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
        });
      }, { once: true });
    } else {
      audio.play().catch(() => {
        usePlayerStore.setState({ isPlaying: false });
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
      });
    }
  }
});

// ── Persist / restore last-played song ───────────────────────────────────────

function saveState() {
  const { currentSong, currentTime, queue, queueIndex, shuffle, playContext, playContextLabel, manualQueue } =
    usePlayerStore.getState();
  if (!currentSong) return;
  try {
    // Keep up to 500 songs from current position to stay within storage limits
    const savedQueue = queue.length <= 500 ? queue : queue.slice(queueIndex, queueIndex + 500);
    const savedIndex = queue.length <= 500 ? queueIndex : 0;
    localStorage.setItem('quarc_player_state', JSON.stringify({
      song: currentSong,
      time: Math.floor(currentTime),
      queue: savedQueue,
      queueIndex: savedIndex,
      shuffle,
      playContext,
      playContextLabel: playContextLabel || '',
      manualQueue: manualQueue.slice(0, 20), // cap at 20 manual items
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
  const saved = JSON.parse(localStorage.getItem('quarc_player_state') || 'null');
  if (saved?.song) {
    restoredFromStorage = true;
    usePlayerStore.setState({
      currentSong: saved.song,
      queue: saved.queue?.length ? saved.queue : [saved.song],
      queueIndex: saved.queueIndex ?? 0,
      shuffle: saved.shuffle ?? false,
      playContext: saved.playContext || 'single',
      playContextLabel: saved.playContextLabel || '',
      manualQueue: saved.manualQueue || [],
      currentTime: saved.time || 0,
      isPlaying: false,
    });
    audio.src = streamUrl(saved.song.id);
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
