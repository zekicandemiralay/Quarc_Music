import { create } from 'zustand';

const radioAudio = new Audio();
radioAudio.preload = 'none';

const useInternetRadioStore = create((set, get) => ({
  currentStation: null,
  isPlaying: false,
  error: null,

  play: (station) => {
    const { currentStation, isPlaying } = get();

    // Same station → toggle play / stop
    if (currentStation?.stationuuid === station.stationuuid) {
      if (isPlaying) {
        radioAudio.pause();
        set({ isPlaying: false });
      } else {
        set({ error: null });
        radioAudio.play().catch(() => set({ isPlaying: false, error: 'Stream failed to start' }));
        set({ isPlaying: true });
      }
      return;
    }

    // New station — tell the music player to stop first
    window.dispatchEvent(new Event('quarc-internet-radio-started'));

    set({ currentStation: station, isPlaying: true, error: null });
    radioAudio.src = station.url_resolved || station.url;
    radioAudio.play().catch(() => set({ isPlaying: false, error: 'Stream unavailable — try another station' }));

    if ('mediaSession' in navigator) {
      const tags = (station.tags || '').split(',').slice(0, 2).filter(Boolean).join(', ');
      navigator.mediaSession.metadata = new MediaMetadata({
        title: station.name,
        artist: tags || 'Radio',
        album: station.country || '',
        artwork: station.favicon ? [{ src: station.favicon, sizes: '96x96' }] : [],
      });
      navigator.mediaSession.setActionHandler('play', () => {
        radioAudio.play().catch(() => {});
        set({ isPlaying: true });
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        radioAudio.pause();
        set({ isPlaying: false });
      });
      navigator.mediaSession.setActionHandler('stop', () => get().stop());
      // Radio has no seeking — unregister seek handlers
      try { navigator.mediaSession.setActionHandler('seekto', null); } catch {}
    }
  },

  stop: () => {
    radioAudio.pause();
    radioAudio.src = '';
    set({ currentStation: null, isPlaying: false, error: null });
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = null; } catch {}
    }
  },
}));

// Stop radio when the music player starts playing
window.addEventListener('quarc-music-started', () => {
  if (!radioAudio.paused) radioAudio.pause();
  useInternetRadioStore.setState({ isPlaying: false, currentStation: null });
});

radioAudio.addEventListener('error', () => {
  useInternetRadioStore.setState({ isPlaying: false, error: 'Stream unavailable — try another station' });
});

export { radioAudio };
export default useInternetRadioStore;
