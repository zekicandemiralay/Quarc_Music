import { create } from 'zustand';
import usePlayerStore from './playerStore';

// The actual download is a genuine server-side job (backend/src/routes/
// youtube.js fires it and responds immediately) — it already keeps running
// regardless of the client. What didn't survive was *tracking* it: the old
// code kept jobId/progress/status in a page component's local state, so
// navigating away (or the screen locking long enough for the tab to be
// backgrounded) unmounted it and the job vanished from view, even though it
// was still running fine on the server. Living here instead — a module-level
// store, not tied to any page — means it polls and renders from anywhere,
// the whole time.
const POLL_MS = 1200;
const LS_KEY = 'quarc_active_downloads';
const pollers = new Map(); // jobId -> intervalId — module-level, survives store resets

// "Download & play" / "Download & add to queue": the choice is made up front
// and rides along on the job (`then`), so nobody has to sit watching a
// progress bar and wait for the Play button to appear. It's carried out HERE,
// when the job completes, rather than in the YouTube page — the page may be
// long gone by then (that's the whole point of not waiting).
//
// An intent is only honoured for a while after the click. If the app was
// closed and reopened much later, the song suddenly starting to play (or
// queueing itself) with no connection to anything you just did would be a
// surprise, not a feature — it then just finishes as a normal download.
const THEN_MAX_AGE_MS = 10 * 60 * 1000;

let noticeTimer = null;

function loadPersisted() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
// Only the identifying fields, not live progress — a reload resumes polling
// from scratch and gets the real status back within one tick anyway.
function persist(jobs) {
  try {
    const active = jobs.filter((j) => j.status === 'pending' || j.status === 'downloading');
    localStorage.setItem(LS_KEY, JSON.stringify(active.map((j) => ({
      jobId: j.jobId, videoId: j.videoId, title: j.title, then: j.then ?? null, startedAt: j.startedAt ?? null,
    }))));
  } catch {}
}

const useDownloadsStore = create((set, get) => ({
  jobs: [], // [{jobId, videoId, title, status, progress, songId, error, then, startedAt, handled}]
  // Brief "Playing X" / "Added X to queue" message for when the download
  // finishes while you're somewhere else in the app — { id, kind, title } | null
  notice: null,

  // then: null (just download) | 'play' | 'queue'
  startJob: (jobId, videoId, title, then = null) => {
    set((s) => {
      const jobs = [...s.jobs.filter((j) => j.jobId !== jobId), {
        jobId, videoId, title, status: 'pending', progress: 0, songId: null, error: null,
        then, startedAt: Date.now(), handled: false,
      }];
      persist(jobs);
      return { jobs };
    });
    get()._poll(jobId);
  },

  // Carries out the job's `then` once its song exists. `queue` with nothing
  // loaded in the player has nothing to queue behind — adding it would leave
  // the app silent with the song parked in a list, so it just plays instead.
  _runThen: async ({ then, songId }) => {
    try {
      const r = await fetch(`/api/music/${songId}`);
      if (!r.ok) return;
      const song = await r.json();
      const player = usePlayerStore.getState();
      const kind = then === 'play' || !player.currentSong ? 'playing' : 'queued';
      if (kind === 'playing') {
        // Same entry as "Play now" on the finished card: a free library play,
        // so it uses the library group's remembered Shuffle/Radio settings.
        await player.playSong(song, null, 0, 'single', 'Your Library');
      } else {
        player.addToQueue(song);
      }
      get()._notify(kind, song.title);
    } catch {}
  },

  _notify: (kind, title) => {
    clearTimeout(noticeTimer);
    set({ notice: { id: Date.now(), kind, title } });
    noticeTimer = setTimeout(() => set({ notice: null }), 3000);
  },

  // Resumes polling for jobs that were still active when the page was last
  // closed/reloaded — called once from App.jsx on login.
  resume: () => {
    const persisted = loadPersisted();
    if (!persisted.length) return;
    set((s) => ({
      jobs: [...s.jobs, ...persisted.map((p) => ({ ...p, status: 'pending', progress: 0, songId: null, error: null, handled: false }))],
    }));
    persisted.forEach((p) => get()._poll(p.jobId));
  },

  _poll: (jobId) => {
    if (pollers.has(jobId)) return; // already polling this one
    const tick = async () => {
      try {
        const r = await fetch(`/api/youtube/download/status/${jobId}`);
        if (!r.ok) return; // might not exist in the DB yet, microseconds after creation — keep trying
        const d = await r.json();
        // Claimed inside the update so it happens exactly once even if two
        // polls overlap (a slow response + the next interval tick) and both
        // see 'done'.
        let claimed = null;
        set((s) => {
          const jobs = s.jobs.map((j) => {
            if (j.jobId !== jobId) return j;
            const next = { ...j, status: d.status, progress: d.progress, songId: d.song_id ?? j.songId, error: d.error ?? j.error };
            if (d.status === 'done' && next.songId && next.then && !j.handled) {
              next.handled = true;
              if (j.startedAt && Date.now() - j.startedAt < THEN_MAX_AGE_MS) claimed = { then: next.then, songId: next.songId };
            }
            return next;
          });
          persist(jobs);
          return { jobs };
        });
        if (claimed) get()._runThen(claimed);
        if (d.status === 'done' || d.status === 'error' || d.status === 'cancelled') {
          clearInterval(pollers.get(jobId));
          pollers.delete(jobId);
          if (d.status === 'done') {
            try { localStorage.removeItem('quarc_songs'); } catch {}
          }
        }
      } catch {}
    };
    pollers.set(jobId, setInterval(tick, POLL_MS));
    tick(); // don't make the UI wait a full interval for the first update
  },

  cancelJob: async (jobId) => {
    try { await fetch(`/api/youtube/download/${jobId}/cancel`, { method: 'POST' }); } catch {}
  },

  // Removes a finished/failed/cancelled job from view — active ones can't be
  // dismissed this way, cancel them first.
  dismissJob: (jobId) => {
    set((s) => {
      const jobs = s.jobs.filter((j) => j.jobId !== jobId);
      persist(jobs);
      return { jobs };
    });
  },

  // On logout — also clears the persisted job list, not just in-memory
  // state, so a different user logging in on the same device later doesn't
  // try to resume jobs that were never theirs (harmless either way, since
  // the backend now checks ownership, but there's no reason to even try).
  reset: () => {
    pollers.forEach((id) => clearInterval(id));
    pollers.clear();
    try { localStorage.removeItem(LS_KEY); } catch {}
    clearTimeout(noticeTimer);
    set({ jobs: [], notice: null });
  },
}));

export default useDownloadsStore;
