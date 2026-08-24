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
// Track the last song for which we set MediaMetadata so we don't recreate it
// on every resume — iOS may reset the lock screen widget when metadata changes.
let lastMetadataSongId = null;

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
const blobFetching = new Map(); // songId → in-flight fetch Promise<url|null>

function pruneCache(keepIds) {
  for (const [id, url] of blobCache.entries()) {
    if (!keepIds.has(id)) { URL.revokeObjectURL(url); blobCache.delete(id); }
  }
  for (const id of blobFetching.keys()) {
    if (!keepIds.has(id)) blobFetching.delete(id);
  }
}

// Returns a Promise for the full song's blob URL, deduped — multiple callers
// (prebuffering + the quick-start handoff below) share the same in-flight
// fetch instead of downloading the file twice.
function prefetchBlob(songId) {
  if (blobCache.has(songId)) return Promise.resolve(blobCache.get(songId));
  if (blobFetching.has(songId)) return blobFetching.get(songId);
  const { cachedIds } = useOfflineStore.getState();
  if (cachedIds.has(songId)) return Promise.resolve(null); // offline cache already handles it
  const p = (async () => {
    try {
      const res = await fetch(streamUrl(songId));
      if (res.ok) {
        const blob = await res.blob();
        if (blobFetching.get(songId) === p) { // still relevant
          const url = URL.createObjectURL(blob);
          blobCache.set(songId, url);
          return url;
        }
      }
    } catch {}
    return null;
  })();
  blobFetching.set(songId, p);
  p.finally(() => { if (blobFetching.get(songId) === p) blobFetching.delete(songId); });
  return p;
}

// Runs `fn` once real audible playback begins (the 'playing' event fires
// whether that's via quickStart's blob swap or the native stream buffering
// on its own), instead of immediately — kicking off startPrebuffering/
// schedulePreload's heavy full-file fetches in the same instant as
// quickStart's small "first few seconds" chunk request made them compete
// for the same bandwidth right when startup latency matters most. A longer
// current song makes this worse: its own full-file prefetch (deduped with
// quickStart's eventual full-blob fetch) stays open longer, extending
// exactly how long that contention lasts. A timeout fallback still runs it
// even if 'playing' never fires (autoplay blocked, playback failed, etc.),
// so prebuffering/gapless-next never silently stops working.
// Superseding token so a rapid string of skips (before any of them actually
// reaches 'playing') doesn't leave several stale calls all firing their
// prebuffering for songs that aren't current anymore — only the most recent
// deferUntilPlaying call's fn ever actually runs; earlier ones just clean up.
let deferToken = 0;
function deferUntilPlaying(fn) {
  const myToken = ++deferToken;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    audio.removeEventListener('playing', run);
    clearTimeout(fallback);
  };
  const run = () => {
    cleanup();
    if (myToken === deferToken) fn();
  };
  audio.addEventListener('playing', run);
  const fallback = setTimeout(run, 4000);
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

// Cold-start latency fix: a network-streamed <audio> element waits for a large,
// duration-based amount of buffered audio (measured ~70-80s worth) before it
// will start playing, regardless of connection speed or bitrate — because it
// can't be sure more data won't stall it. A Blob has no such uncertainty (it's
// already fully "downloaded" from the browser's point of view), so fetching
// just a small leading chunk as a Blob and playing from that starts audible
// playback almost immediately. The full song is fetched in the background via
// the existing prebuffer/blob-cache mechanism (deduped — this never downloads
// the same bytes twice) and swapped in seamlessly, at the same playback
// position, once ready. Only used for "cold" plays not already pre-buffered —
// most songs during normal queue playback already have a full blob ready before
// they're ever clicked, via startPrebuffering, and skip this path entirely.
const QUICK_START_BYTES = 600 * 1024; // ~15-20s of audio at max quality — enough headroom for the full fetch to usually finish first
async function quickStart(songId) {
  const { cachedIds } = useOfflineStore.getState();
  if (cachedIds.has(songId)) return; // offline blob swap already handles this song
  let chunkUrl = null;
  try {
    const res = await fetch(streamUrl(songId), { headers: { Range: `bytes=0-${QUICK_START_BYTES - 1}` } });
    if (usePlayerStore.getState().currentSong?.id !== songId) return; // song changed while fetching
    if (!res.ok) return;
    if (audio.readyState >= 2) return; // network stream already buffering fine — don't disrupt it
    const chunkBlob = await res.blob();
    if (usePlayerStore.getState().currentSong?.id !== songId || audio.readyState >= 2) return;

    chunkUrl = URL.createObjectURL(chunkBlob);
    const t = audio.currentTime;
    const wasPlaying = !audio.paused;
    audio.src = chunkUrl;
    if (t > 0) audio.currentTime = t;
    if (wasPlaying) audio.play().catch(() => {});

    // Safety net: if playback runs past the end of this partial chunk before
    // the full blob is ready, fall back to the live network stream rather
    // than stalling. Fires at most once — after that, either the fallback
    // stream or the full-blob handoff below is in control.
    const onRunDry = () => {
      if (usePlayerStore.getState().currentSong?.id !== songId || blobCache.has(songId)) return;
      const tt = audio.currentTime;
      audio.src = streamUrl(songId);
      if (tt > 0) audio.currentTime = tt;
      audio.play().catch(() => {});
    };
    audio.addEventListener('waiting', onRunDry, { once: true });

    const fullUrl = await prefetchBlob(songId); // shares the fetch startPrebuffering already kicked off
    audio.removeEventListener('waiting', onRunDry);
    if (!fullUrl || usePlayerStore.getState().currentSong?.id !== songId) return;

    const t2 = audio.currentTime;
    const wasPlaying2 = !audio.paused;
    audio.src = fullUrl;
    if (t2 > 0) audio.currentTime = t2;
    if (wasPlaying2) audio.play().catch(() => {});
  } catch {
    // Quick-start is a pure optimization — any failure just leaves the
    // already-started network stream (from playSong) in control.
  } finally {
    if (chunkUrl) URL.revokeObjectURL(chunkUrl);
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
    // (no stutter, no network needed). Otherwise stream normally as a guaranteed
    // fallback, and race a quick-start chunk in parallel — see quickStart().
    const preBuffered = blobCache.has(song.id);
    audio.src = preBuffered ? blobCache.get(song.id) : streamUrl(song.id);
    audio.play().catch(() => set({ isPlaying: false }));
    if (!preBuffered) quickStart(song.id);
    deferUntilPlaying(() => {
      schedulePreload(finalQueue, finalIndex);
      startPrebuffering(finalQueue, finalIndex);
    });

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

  pause: () => { pausedByUser = true; audio.pause(); set({ isPlaying: false }); },
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
      // navigating=true — this is just advancing, not starting a new context, so
      // the shuffled auto-queue position/order must be preserved. Without it,
      // playSong's shuffle-on-fresh-start logic reshuffles the ENTIRE auto-queue
      // (including songs already played earlier this session) on every manual
      // queue item, which is how an already-played song can resurface a few
      // tracks later.
      get().playSong(nextSong, queue, queueIndex, playContext, playContextLabel, true);
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
      deferUntilPlaying(() => {
        schedulePreload(queue, idx);
        startPrebuffering(queue, idx);
      });
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
    const { shuffle, queue, queueIndex, currentSong } = get();
    const newShuffle = !shuffle;
    if (newShuffle && queue.length > 1 && currentSong) {
      // Leave everything already played (indices 0..queueIndex) exactly where it
      // is and shuffle only the not-yet-played remainder — reshuffling the whole
      // queue would toss songs from earlier this session back into the pool,
      // letting one resurface just a few tracks after it already played.
      const played = queue.slice(0, queueIndex + 1);
      const upcoming = queue.slice(queueIndex + 1);
      set({ shuffle: true, queue: [...played, ...smartShuffle(upcoming)], queueIndex });
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
  window.dispatchEvent(new Event('quarc-music-started'));
  playTrack.resumeAt = Date.now();
  usePlayerStore.setState({ isPlaying: true });
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  const { currentSong } = usePlayerStore.getState();
  const title = currentSong?.title ?? 'Quarc Music';
  const artist = currentSong?.artist ?? '';
  // Set MediaMetadata once per song after audio is active (iOS ignores it before play).
  // Don't recreate on resumes — rebuilding MediaMetadata resets the lock screen widget.
  if (currentSong?.id !== lastMetadataSongId) {
    lastMetadataSongId = currentSong?.id ?? null;
    applyMediaSessionMeta(currentSong);
  }
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

// Stop music when internet radio takes over
window.addEventListener('quarc-internet-radio-started', () => {
  pausedByUser = true;
  audio.pause();
  usePlayerStore.setState({ isPlaying: false });
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
    audio.play().catch(() => {
      // Direct resume failed — try from blob cache or reload stream.
      // Don't touch audio.src while screen is locked (iOS blocks network then);
      // keep isPlaying=true so visibilitychange resumes on unlock.
      if (document.visibilityState === 'hidden') return;
      const t = audio.currentTime || storeTime;
      const src = blobCache.has(currentSong.id) ? blobCache.get(currentSong.id) : streamUrl(currentSong.id);
      audio.src = src;
      const onCanPlay = () => { clearTimeout(tmo); if (t > 0) audio.currentTime = t; audio.play().catch(() => usePlayerStore.setState({ isPlaying: false })); };
      const tmo = setTimeout(() => { audio.removeEventListener('canplay', onCanPlay); usePlayerStore.setState({ isPlaying: false }); }, 5000);
      audio.addEventListener('canplay', onCanPlay, { once: true });
    });
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    pausedByUser = true;
    audio.pause();
    usePlayerStore.setState({ isPlaying: false });
  });
  navigator.mediaSession.setActionHandler('nexttrack', () => usePlayerStore.getState().next());
  navigator.mediaSession.setActionHandler('previoustrack', () => usePlayerStore.getState().prev());
  navigator.mediaSession.setActionHandler('seekto', (d) => {
    if (d.seekTime !== undefined) {
      audio.currentTime = d.seekTime;
      usePlayerStore.setState({ currentTime: d.seekTime });
    }
  });
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
