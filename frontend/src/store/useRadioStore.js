import { create } from 'zustand';
import usePlayerStore, { schedulePreload } from './playerStore';
import { contextGroup, getRadio, setRadio } from '../lib/playbackPrefs';

// Module-level: not reactive, just dedup guards
const seenKeys = new Set();     // artist+title of everything this stream has used
const seenVideoIds = new Set(); // YouTube ids, when a suggestion carries one
const playedIds = new Set();    // library ids, for the random fallback
// Songs that belong to the theme: the seed, plus everything reached through a
// suggestion. Songs that arrived as a random-library fallback are deliberately
// NOT in here — see the anchor pool in fillQueue for why that matters.
const onThemeIds = new Set();
// Every artist YouTube Music has named as similar to this stream's seed —
// ~49 per lookup, so this fills up fast. It's what makes the fallback stay in
// the right neighbourhood without collapsing onto a single artist.
const themeArtists = new Set();
let filling = false;
let songCountSinceLastFill = 0;

// Bumped every time the stream restarts (a manual play, a context switch, a
// radio toggle). Everything async carries the generation it started under and
// bails if it no longer matches, so a suggestion requested for the OLD seed
// can't land in the new stream — which is what made a manually-picked song
// still be followed by the previous seed's leftovers. The download itself is
// already server-side and still finishes into the library permanently; it
// just doesn't get queued here.
let streamId = 0;

// How far along the "anchor chain" a seed-anchored stream has walked. Last.fm
// returns a limited set of similar tracks (20), so once every one of them has
// played, the seed is used up. Rather than dropping to random library songs at
// that point, the anchor advances to the 2nd song of the stream, then the 3rd,
// and so on — each still genuinely related to what came before, so the stream
// keeps going and widens naturally instead of dead-ending. Reset whenever a
// new stream starts.
let anchorIndex = 0;

// Match keys loosely — Last.fm's spelling of an artist rarely matches a
// downloaded file's tags character for character ("Zeki Müren" / "zeki
// muren"), and an exact-string set would happily let the same song through
// twice under two spellings.
function trackKey(artist, title) {
  const norm = (v) => (v || '')
    .replace(/[İIı]/g, 'i')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, '');  // spacing too: "Elbet Birgün" and "Elbet Bir Gün"
  return `${norm(artist)}::${norm(title)}`;
}

// A stream is "one uninterrupted listen": until the user manually starts
// something else, no song repeats — not across the 20 suggestions of one
// anchor, and not when the anchor steps forward to the 2nd song, the 3rd,
// and so on. Starting another song by hand wipes all of it and begins again
// with no filtering at all.
function resetStream() {
  streamId++;
  seenKeys.clear();
  seenVideoIds.clear();
  playedIds.clear();
  onThemeIds.clear();
  themeArtists.clear();
  anchorIndex = 0;
  songCountSinceLastFill = 0;
  filling = false;
  if (useRadioStore.getState().pendingDownloads.length) {
    useRadioStore.setState({ pendingDownloads: [] });
  }
}

function remember(song) {
  if (!song) return;
  seenKeys.add(trackKey(song.artist, song.title));
  if (song.id != null) playedIds.add(song.id);
}

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
      resetStream();
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
    const gen = streamId;
    try {
      const anchored = isSeedAnchored();
      const { seedSong, queue, queueIndex } = usePlayerStore.getState();
      // Nothing already in this stream is a candidate — including the seed
      // itself, which Last.fm will happily suggest back at you.
      queue.forEach(remember);
      // Anchor suggestions to the song the listen STARTED from, not whatever
      // is playing right now — otherwise each suggestion seeds the next and
      // the stream drifts steadily away from what the user actually picked.
      // The chain is the songs already played in this stream, so when the
      // seed runs dry the anchor steps to the 2nd song, then the 3rd, etc.
      // Only songs that are actually part of the theme can become the next
      // anchor. A random-library fallback lands in the queue like any other
      // song, and anchoring on one re-points the whole stream at something the
      // listener never asked for — one unrelated track and everything after it
      // is suggestions for THAT, which is how a Turkish rock stream ends up
      // playing belly dance for the rest of the night.
      if (seedSong?.id != null) onThemeIds.add(seedSong.id);
      const chain = anchored
        ? queue.slice(0, queueIndex + 1).filter((s) => s?.id != null && onThemeIds.has(s.id))
        : [];
      const MAX_ANCHOR_HOPS = 4; // bound the requests one fill can make

      for (let hop = 0; hop < (anchored ? MAX_ANCHOR_HOPS : 1); hop++) {
        const basis = anchored
          ? (chain[anchorIndex] || chain[chain.length - 1] || seedSong || song)
          : song;
        if (!basis) break;

        let suggestions;
        try {
          const params = new URLSearchParams({
            artist: basis.artist || '',
            title: basis.title || '',
          });
          const res = await fetch(`/api/radio/suggestions?${params}`);
          if (!res.ok) throw new Error('suggestions unavailable');
          suggestions = await res.json();
        } catch {
          break; // no Last.fm key or network error — library fallback below
        }

        if (gen !== streamId) return; // seed changed while we were waiting

        // Take a RANDOM one of the ~20 unplayed suggestions rather than
        // always the top-scoring one: Last.fm returns the same ordered list
        // every time, so picking the head made the same seed produce the
        // same stream in the same order on every listen.
        // A YouTube Music suggestion carries its own videoId, which identifies
        // the track exactly — no spelling to get wrong. Name matching stays as
        // the fallback for Last.fm suggestions, which have nothing else.
        for (const t of (Array.isArray(suggestions) ? suggestions : [])) {
          if (t.artist) themeArtists.add(trackKey(t.artist, ''));
        }

        const unseen = (Array.isArray(suggestions) ? suggestions : []).filter(t =>
          !seenKeys.has(trackKey(t.artist, t.title))
          && !(t.videoId && seenVideoIds.has(t.videoId))
        );
        if (unseen.length) {
          const fresh = unseen[Math.floor(Math.random() * unseen.length)];
          seenKeys.add(trackKey(fresh.artist, fresh.title));
          if (fresh.videoId) seenVideoIds.add(fresh.videoId);
          startRadioDownload(fresh, gen);
          return;
        }

        // Every suggestion for this anchor has already played. Step the
        // anchor forward through the stream; give up once it runs out.
        if (!anchored || anchorIndex >= chain.length - 1) break;
        anchorIndex++;
      }

      addLibrarySongToQueue(gen);
    } finally {
      filling = false;
    }
  },
}));

async function startRadioDownload(track, gen) {
  const downloadId = Math.random().toString(36).slice(2);
  // gen is the stream this download belongs to; once the user starts another
  // song by hand the stream is gone and so is this download's place in it.
  const stale = () => gen !== streamId;
  const drop = () => useRadioStore.setState((s) => ({
    pendingDownloads: s.pendingDownloads.filter((d) => d.id !== downloadId),
  }));
  useRadioStore.setState((s) => ({
    pendingDownloads: [...s.pendingDownloads, { id: downloadId, title: track.title, artist: track.artist, progress: 0 }],
  }));

  try {
    const res = await fetch('/api/radio/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist: track.artist, title: track.title, videoId: track.videoId || null }),
    });
    const data = await res.json();

    // Already in the library — radio keeps everything it downloads, so its own
    // suggestions turn up again all the time. Play the copy we have instead of
    // spending a minute fetching a second one.
    if (data.song) {
      drop();
      if (stale() || !useRadioStore.getState().radioMode) return;
      insertSongIntoQueue(data.song);
      return;
    }

    const jobId = data.jobId;
    if (!jobId) {
      drop();
      addLibrarySongToQueue(gen);
      return;
    }

    const song = await pollUntilDone(jobId, (progress) => {
      if (stale()) return;
      useRadioStore.setState((s) => ({
        pendingDownloads: s.pendingDownloads.map((d) => d.id === downloadId ? { ...d, progress } : d),
      }));
    }, stale);

    drop();
    // The user picked something else while this was downloading, or turned
    // radio off. The file is already in the library to keep — it just has no
    // business being queued behind a song it isn't a suggestion for.
    if (stale() || !useRadioStore.getState().radioMode) return;

    if (song) {
      insertSongIntoQueue(song);
    } else {
      addLibrarySongToQueue(gen);
    }
  } catch {
    drop();
    addLibrarySongToQueue(gen);
  }
}

async function pollUntilDone(jobId, onProgress, stale) {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    if (stale && stale()) return null; // stop polling for an abandoned stream
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
function insertSongIntoQueue(song, { allowRepeat = false, onTheme = true } = {}) {
  // Name matching is best-effort — Last.fm and a downloaded file's tags can
  // spell the same track differently enough to slip past trackKey. The
  // library id can't be spelled two ways, so it's the real guarantee that a
  // stream never plays the same song twice: whatever the suggestion was
  // called, if it resolved to a song this stream already played, take
  // something else instead.
  if (!allowRepeat && song?.id != null && playedIds.has(song.id)) {
    addLibrarySongToQueue(streamId);
    return;
  }
  remember(song); // the file's own tags, which needn't match the suggestion's
  if (onTheme && song?.id != null) onThemeIds.add(song.id);
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

async function addLibrarySongToQueue(gen) {
  if (!useRadioStore.getState().radioMode) return;
  if (gen !== undefined && gen !== streamId) return;
  try {
    const res = await fetch('/api/music');
    if (!res.ok) return;
    const allSongs = await res.json();
    if (!allSongs.length) return;
    if (gen !== undefined && gen !== streamId) return;
    const { queue, queueIndex } = usePlayerStore.getState();
    // Nothing already queued ahead, and nothing this stream has played —
    // "no repeats until the user changes song" covers the random fallback
    // too, not just the suggestions. Repeats are allowed only once the
    // library has genuinely nothing left to offer.
    const upcomingIds = new Set(queue.slice(queueIndex + 1).map(s => s.id));
    const eligible = allSongs.filter(s => !upcomingIds.has(s.id) && !playedIds.has(s.id));
    const exhausted = !eligible.length; // nothing unplayed left to offer

    // A uniform pick out of thousands of songs is how a Turkish rock stream
    // suddenly plays a belly-dance track. But narrowing to the seed's OWN
    // artist is the opposite mistake — the stream turns into one artist on
    // repeat, which is worse than an occasional odd song.
    //
    // So the pool is every library song by an artist YouTube Music has already
    // named as similar to this seed. That's dozens of different artists, all
    // genuinely on-theme, which keeps the variety while dropping the whiplash.
    const onThemeSongs = themeArtists.size
      ? eligible.filter((s) => s.artist && themeArtists.has(trackKey(s.artist, '')))
      : [];
    const pool = exhausted ? allSongs : (onThemeSongs.length ? onThemeSongs : eligible);
    const song = pool[Math.floor(Math.random() * pool.length)];
    // onTheme: false — this song is filler, not a suggestion. It plays, but it
    // never gets to steer what comes next.
    insertSongIntoQueue(song, { allowRepeat: exhausted, onTheme: false });
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
      resetStream();
    }
    // A new deliberate play re-seeds the stream, even within the same context
    // (clicking another library song). Everything the previous seed built up
    // goes with it: its suggestion history, how far its anchor had walked,
    // and any download still in flight for it. The new song starts from a
    // clean slate with nothing filtered out.
    else if (state.seedSong?.id !== prev.seedSong?.id) {
      resetStream();
    }
    remember(state.currentSong);
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
