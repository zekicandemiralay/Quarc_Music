import { create } from 'zustand';

const radioAudio = new Audio();
radioAudio.preload = 'none';

// Internet radio plays through this <audio> element with nothing else
// involved — no Capacitor plugin call, unlike normal song playback, which
// is exactly why it used to die shortly after the screen locked. Android
// suspends a backgrounded WebView process once nothing has told it an
// audio session is active; the main player avoids that by starting a
// foreground service (see playerStore.js's own nativeService()), and radio
// simply never did the same. No-ops safely on web/desktop/iOS, same as the
// main player's copy of this helper — kept as a separate local copy rather
// than importing playerStore.js's, so the two stores stay decoupled (they
// otherwise only ever talk to each other through window events).
function nativeRadio(method, data) {
  try { window?.Capacitor?.Plugins?.MusicService?.[method]?.(data ?? {}); } catch {}
}

// Live radio streams (Icecast/Shoutcast, mostly) drop and hiccup routinely —
// a brief network blip, the station's own encoder restarting, a mid-stream
// metadata change some servers handle by momentarily closing the
// connection. None of that means the station is actually gone. There was no
// retry at all here: one `error` event and the whole thing just stopped,
// silently, with nothing attempting to pick it back up — which is exactly
// what "radio stops suddenly and fast" looks like from the listening end.
//
// Two distinct failure shapes, both handled below:
//   - an explicit `error` event (the connection was actively refused/reset)
//   - going quiet with NO error at all — a live stream can simply stop
//     delivering data while technically still "connected," which never
//     fires `error` on its own. caught by a stall watchdog, same idea as
//     the backend's yt-dlp stall-kill: reset on every sign of life, fire if
//     it goes quiet too long.
const STALL_MS = 10_000;
const MAX_RECONNECT_ATTEMPTS = 4;

let reconnectAttempts = 0;
let reconnectTimer = null;
let stallTimer = null;

function clearStallTimer() {
  clearTimeout(stallTimer);
  stallTimer = null;
}

// Rearmed on every bit of evidence the stream is actually alive — progress
// events, or a fresh play() attempt. Not on 'playing' alone: a station can
// fire 'playing' once and then silently stop delivering bytes, which is
// precisely the failure mode with no 'error' event to catch it otherwise.
function armStallTimer(station) {
  clearStallTimer();
  stallTimer = setTimeout(() => {
    const { currentStation, isPlaying } = useInternetRadioStore.getState();
    if (currentStation?.stationuuid !== station.stationuuid || !isPlaying) return;
    attemptReconnect(station);
  }, STALL_MS);
}

function clearReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
}

function attemptReconnect(station) {
  if (!station) return;
  clearStallTimer();
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    nativeRadio('stopRadio'); // genuinely done — no reason to keep the wake lock for a dead stream
    useInternetRadioStore.setState({ isPlaying: false, reconnecting: false, error: 'Stream unavailable — try another station' });
    return;
  }
  useInternetRadioStore.setState({ reconnecting: true, error: null });
  // Not stopped here — a reconnect attempt is still the SAME ongoing radio
  // session as far as the native side needs to know; it only cares about
  // the overall start/stop, not individual retries.

  // 1s, 2s, 4s, 8s — enough room for a genuinely transient drop to clear up
  // on its own without hammering a station that's actually gone for good.
  const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 8000);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    // The user may have switched stations, stopped radio, or started music
    // during the backoff delay — only reconnect if this is still the thing
    // that's supposed to be playing.
    const { currentStation } = useInternetRadioStore.getState();
    if (currentStation?.stationuuid !== station.stationuuid) return;
    radioAudio.src = station.url_resolved || station.url;
    radioAudio.play().then(() => {
      useInternetRadioStore.setState({ reconnecting: false, isPlaying: true, error: null });
      armStallTimer(station);
    }).catch(() => attemptReconnect(station));
  }, delay);
}

const useInternetRadioStore = create((set, get) => ({
  currentStation: null,
  isPlaying: false,
  reconnecting: false,
  error: null,
  volume: 1,

  play: (station) => {
    const { currentStation, isPlaying } = get();

    // Same station → toggle play / stop
    if (currentStation?.stationuuid === station.stationuuid) {
      if (isPlaying) {
        clearReconnect();
        clearStallTimer();
        nativeRadio('stopRadio');
        radioAudio.pause();
        set({ isPlaying: false, reconnecting: false });
      } else {
        clearReconnect();
        set({ error: null });
        nativeRadio('startRadio', { name: station.name });
        radioAudio.play()
          .then(() => armStallTimer(station))
          .catch(() => set({ isPlaying: false, error: 'Stream failed to start' }));
        set({ isPlaying: true });
      }
      return;
    }

    // New station — tell the music player to stop first
    window.dispatchEvent(new Event('quarc-internet-radio-started'));

    clearReconnect();
    clearStallTimer();
    nativeRadio('startRadio', { name: station.name });
    set({ currentStation: station, isPlaying: true, reconnecting: false, error: null });
    radioAudio.volume = get().volume;
    radioAudio.src = station.url_resolved || station.url;
    radioAudio.play()
      .then(() => armStallTimer(station))
      .catch(() => set({ isPlaying: false, error: 'Stream unavailable — try another station' }));

    if ('mediaSession' in navigator) {
      const tags = (station.tags || '').split(',').slice(0, 2).filter(Boolean).join(', ');
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name,
        artist: tags || 'Radio',
        album: station.country || '',
        artwork: station.favicon ? [{ src: station.favicon, sizes: '96x96' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => {
        nativeRadio('startRadio', { name: station.name });
        radioAudio.play().then(() => armStallTimer(station)).catch(() => {});
        set({ isPlaying: true });
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        clearReconnect();
        clearStallTimer();
        nativeRadio('stopRadio');
        radioAudio.pause();
        set({ isPlaying: false, reconnecting: false });
      });
      navigator.mediaSession.setActionHandler('stop', () => get().stop());
      // Radio has no seeking — unregister seek handlers
      try { navigator.mediaSession.setActionHandler('seekto', null); } catch {}
    }
  },

  stop: () => {
    clearReconnect();
    clearStallTimer();
    nativeRadio('stopRadio');
    radioAudio.pause();
    radioAudio.src = '';
    set({ currentStation: null, isPlaying: false, reconnecting: false, error: null });
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = null; } catch {}
    }
  },

  setVolume: (v) => { radioAudio.volume = v; set({ volume: v }); },
}));

// Stop radio when the music player starts playing
window.addEventListener('quarc-music-started', () => {
  clearReconnect();
  clearStallTimer();
  nativeRadio('stopRadio'); // music's own 'play' event starts the service for itself right after
  if (!radioAudio.paused) radioAudio.pause();
  useInternetRadioStore.setState({ isPlaying: false, reconnecting: false, currentStation: null });
});

// An explicit error (connection actively refused/reset) — try to recover
// rather than treating it as final. attemptReconnect itself gives up after
// MAX_RECONNECT_ATTEMPTS and sets the same user-visible error this used to
// set immediately.
radioAudio.addEventListener('error', () => {
  const { currentStation, isPlaying } = useInternetRadioStore.getState();
  if (!currentStation || !isPlaying) return;
  attemptReconnect(currentStation);
});

// Signs of life — anything that means bytes are actually arriving rearms
// the stall watchdog so a station that's genuinely fine doesn't get
// reconnected out from under itself.
radioAudio.addEventListener('timeupdate', () => {
  const { currentStation, isPlaying } = useInternetRadioStore.getState();
  if (currentStation && isPlaying) armStallTimer(currentStation);
});
radioAudio.addEventListener('playing', () => {
  reconnectAttempts = 0;
  const { currentStation, isPlaying } = useInternetRadioStore.getState();
  if (currentStation && isPlaying) armStallTimer(currentStation);
});

export { radioAudio };
export default useInternetRadioStore;
