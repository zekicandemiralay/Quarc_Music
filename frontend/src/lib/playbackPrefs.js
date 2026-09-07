// Playback settings that survive across sessions, and are remembered
// SEPARATELY for the two kinds of listening:
//
//   'library' — the all-songs library view, header search results, and
//               "Play now" straight after downloading. Free browsing.
//   'list'    — playlists, Liked Songs, Daily Mixes, Collections. Curated
//               lists you play through as a set.
//
// Turning Radio off while browsing the library must not turn it off for
// your playlists, and vice versa — and either choice has to still be there
// next session. Previously radioMode was a single flag that got force-set
// on every context change ("not a playlist? radio on"), which silently
// overwrote whatever the user had chosen, so it could never be remembered.
const KEY = 'quarc_playback_prefs';

// Defaults match the behaviour the app had before these became real
// settings: radio on for free library listening, off for curated lists.
const DEFAULTS = {
  volume: 1,
  radio: { library: true, list: false },
  shuffle: { library: false, list: false },
};

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw) return { ...DEFAULTS };
    return {
      volume: typeof raw.volume === 'number' ? raw.volume : DEFAULTS.volume,
      radio: { ...DEFAULTS.radio, ...(raw.radio || {}) },
      shuffle: { ...DEFAULTS.shuffle, ...(raw.shuffle || {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(prefs) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
}

// playContext is 'playlist' for every curated list (playlists, Liked Songs,
// Mixes, Collections) and 'single' for free library/search/download plays.
export function contextGroup(playContext) {
  return playContext === 'playlist' ? 'list' : 'library';
}

export function getVolume() { return read().volume; }
export function setVolume(volume) { const p = read(); p.volume = volume; write(p); }

export function getRadio(group) { return read().radio[group]; }
export function setRadio(group, on) { const p = read(); p.radio[group] = on; write(p); }

export function getShuffle(group) { return read().shuffle[group]; }
export function setShuffle(group, on) { const p = read(); p.shuffle[group] = on; write(p); }
