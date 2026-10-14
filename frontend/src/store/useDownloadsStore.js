import { create } from 'zustand';

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

function loadPersisted() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
// Only the identifying fields, not live progress — a reload resumes polling
// from scratch and gets the real status back within one tick anyway.
function persist(jobs) {
  try {
    const active = jobs.filter((j) => j.status === 'pending' || j.status === 'downloading');
    localStorage.setItem(LS_KEY, JSON.stringify(active.map((j) => ({ jobId: j.jobId, videoId: j.videoId, title: j.title }))));
  } catch {}
}

const useDownloadsStore = create((set, get) => ({
  jobs: [], // [{jobId, videoId, title, status, progress, songId, error}]

  startJob: (jobId, videoId, title) => {
    set((s) => {
      const jobs = [...s.jobs.filter((j) => j.jobId !== jobId), { jobId, videoId, title, status: 'pending', progress: 0, songId: null, error: null }];
      persist(jobs);
      return { jobs };
    });
    get()._poll(jobId);
  },

  // Resumes polling for jobs that were still active when the page was last
  // closed/reloaded — called once from App.jsx on login.
  resume: () => {
    const persisted = loadPersisted();
    if (!persisted.length) return;
    set((s) => ({
      jobs: [...s.jobs, ...persisted.map((p) => ({ ...p, status: 'pending', progress: 0, songId: null, error: null }))],
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
        set((s) => {
          const jobs = s.jobs.map((j) => j.jobId === jobId
            ? { ...j, status: d.status, progress: d.progress, songId: d.song_id ?? j.songId, error: d.error ?? j.error }
            : j);
          persist(jobs);
          return { jobs };
        });
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
    set({ jobs: [] });
  },
}));

export default useDownloadsStore;
