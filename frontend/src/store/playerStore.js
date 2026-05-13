import { create } from 'zustand';

const audio = new Audio();
audio.preload = 'metadata';

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

  playSong: (song, queue = null, queueIndex = 0) => {
    const state = get();
    if (state.currentSong?.id === song.id) {
      state.isPlaying ? audio.pause() : audio.play();
      return;
    }
    // Flush previous song's play time before switching
    if (playTrack.songId) flushPlay(playTrack.songId);
    playTrack = { songId: song.id, accumulated: 0, resumeAt: null };

    audio.src = `/api/music/${song.id}/stream`;
    audio.play();
    applyMediaSessionMeta(song);
    set({ currentSong: song, isPlaying: true, currentTime: 0, queue: queue || [song], queueIndex });
  },

  pause: () => { audio.pause(); set({ isPlaying: false }); },
  resume: () => { audio.play(); set({ isPlaying: true }); },

  next: () => {
    const { queue, queueIndex, shuffle } = get();
    if (!queue.length) return;
    let idx;
    if (shuffle) {
      const available = queue.map((_, i) => i).filter((i) => i !== queueIndex);
      if (!available.length) return;
      idx = available[Math.floor(Math.random() * available.length)];
    } else {
      idx = queueIndex + 1;
      if (idx >= queue.length) return;
    }
    get().playSong(queue[idx], queue, idx);
  },

  prev: () => {
    const { queue, queueIndex, currentTime } = get();
    if (currentTime > 3) { audio.currentTime = 0; return; }
    if (queueIndex > 0) {
      const idx = queueIndex - 1;
      get().playSong(queue[idx], queue, idx);
    }
  },

  shufflePlay: (songs) => {
    if (!songs.length) return;
    const shuffled = [...songs].sort(() => Math.random() - 0.5);
    set({ shuffle: true });
    get().playSong(shuffled[0], shuffled, 0);
  },

  toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),

  seek: (time) => { audio.currentTime = time; set({ currentTime: time }); },
  setVolume: (v) => { audio.volume = v; set({ volume: v }); },
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

audio.addEventListener('play', () => {
  playTrack.resumeAt = Date.now();
  usePlayerStore.setState({ isPlaying: true });
});

audio.addEventListener('pause', () => {
  if (playTrack.resumeAt) {
    playTrack.accumulated += (Date.now() - playTrack.resumeAt) / 1000;
    playTrack.resumeAt = null;
  }
  usePlayerStore.setState({ isPlaying: false });
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
    audio.play();
    usePlayerStore.setState({ isPlaying: true });
  });
  navigator.mediaSession.setActionHandler('pause', () => {
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

export default usePlayerStore;
