import { useState, useEffect, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2, X, Music, Pause, Play, Square } from 'lucide-react';
import useUserDataStore from '../../store/userDataStore';

function UploadSection({ accept, endpoint, instructions, hint, onJobStart }) {
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  function addFiles(incoming) {
    const exts = accept.split(',').map(e => e.trim().toLowerCase());
    const valid = Array.from(incoming).filter(f =>
      exts.some(ext => f.name.toLowerCase().endsWith(ext))
    );
    if (valid.length !== incoming.length) setError(`Only ${accept} files are accepted`);
    else setError('');
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...valid.filter(f => !names.has(f.name))];
    });
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setUploading(true);
    setError('');
    const form = new FormData();
    for (const f of files) form.append('files', f);
    try {
      const res = await fetch(endpoint, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Upload failed'); setUploading(false); return; }
      onJobStart({
        status: 'running',
        done: 0,
        total: data.playlists.reduce((s, p) => s + p.tracks, 0),
        playlists: data.playlists.map(p => p.name),
        currentTrack: null,
        currentPlaylist: null,
        errors: [],
      });
      setFiles([]);
    } catch {
      setError('Upload failed — check your connection');
    }
    setUploading(false);
  }

  return (
    <div className="space-y-3">
      <div className="bg-zinc-900 rounded-xl p-4 space-y-2">
        {instructions}
      </div>

      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragging ? 'border-blue-400 bg-blue-400/5' : 'border-zinc-700 hover:border-zinc-500'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={28} className="mx-auto mb-3 text-zinc-500" />
        <p className="text-zinc-300 font-medium">Drop files here</p>
        <p className="text-zinc-500 text-sm mt-1">{hint}</p>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="bg-zinc-900 rounded-xl divide-y divide-zinc-800">
          {files.map(f => (
            <div key={f.name} className="flex items-center gap-3 px-4 py-2.5">
              <Music size={15} className="text-zinc-500 shrink-0" />
              <span className="flex-1 text-sm text-zinc-200 truncate">{f.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setFiles(prev => prev.filter(p => p.name !== f.name)); }}
                className="text-zinc-600 hover:text-zinc-300 shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleUpload}
        disabled={files.length === 0 || uploading}
        className="w-full bg-white text-black rounded-xl py-3 font-medium text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {uploading && <Loader2 size={16} className="animate-spin" />}
        {uploading ? 'Starting import…' : `Start Import${files.length > 1 ? ` (${files.length} files)` : ''}`}
      </button>
    </div>
  );
}

export default function Import() {
  const [tab, setTab] = useState('spotify');
  const [job, setJob] = useState(null);
  const pollRef = useRef(null);
  const pollCountRef = useRef(0);
  const loadUserData = useUserDataStore((s) => s.load);

  useEffect(() => {
    fetch('/api/import/status').then(r => r.json()).then(data => {
      if (data) setJob(data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const active = job?.status === 'running' || job?.status === 'paused';
    if (active) {
      pollCountRef.current = 0;
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/import/status');
          const data = await res.json();
          if (data) setJob(data);
          const stillActive = data?.status === 'running' || data?.status === 'paused';
          if (!stillActive) {
            clearInterval(pollRef.current);
            loadUserData();
          } else {
            pollCountRef.current++;
            if (pollCountRef.current % 10 === 0) loadUserData();
          }
        } catch {}
      }, 2000);
    }
    return () => clearInterval(pollRef.current);
  }, [job?.status]);

  async function clearJob() {
    await fetch('/api/import/status', { method: 'DELETE' });
    setJob(null);
  }

  async function pauseImport() {
    await fetch('/api/import/pause', { method: 'POST' });
  }

  async function resumeImport() {
    await fetch('/api/import/resume', { method: 'POST' });
  }

  async function cancelImport() {
    await fetch('/api/import/cancel', { method: 'POST' });
  }

  const pct = job?.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Import</h1>
        <p className="text-zinc-400 text-sm">
          Import your playlists from Spotify or YouTube Music. Songs are downloaded to the library automatically.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-xl p-1">
        <button
          onClick={() => setTab('spotify')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === 'spotify' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Spotify
        </button>
        <button
          onClick={() => setTab('youtube')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === 'youtube' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          YouTube Music
        </button>
      </div>

      {/* Upload section — hidden while a job is running/done */}
      {!job && tab === 'spotify' && (
        <UploadSection
          accept=".zip,.csv"
          endpoint="/api/import/spotify"
          hint="ZIP (all playlists) or individual CSV files — click to browse"
          onJobStart={setJob}
          instructions={
            <>
              <p className="text-zinc-300 text-sm font-medium">How to export from Spotify:</p>
              <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                <li>Go to <span className="text-zinc-200">exportify.net</span> and log in with Spotify</li>
                <li>Click <span className="text-zinc-200">"Export All"</span> for all playlists as a ZIP, or export individual playlists as CSVs</li>
                <li>Upload the file(s) below</li>
              </ol>
            </>
          }
        />
      )}

      {!job && tab === 'youtube' && (
        <UploadSection
          accept=".zip,.json"
          endpoint="/api/import/youtube"
          hint="Google Takeout ZIP or individual playlist JSON files — click to browse"
          onJobStart={setJob}
          instructions={
            <>
              <p className="text-zinc-300 text-sm font-medium">How to export from YouTube Music:</p>
              <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                <li>Go to <span className="text-zinc-200">takeout.google.com</span> and sign in</li>
                <li>Click <span className="text-zinc-200">"Deselect all"</span>, then check <span className="text-zinc-200">"YouTube and YouTube Music"</span></li>
                <li>Click the <span className="text-zinc-200">"All YouTube data included"</span> button and select <span className="text-zinc-200">playlists only</span></li>
                <li>Click <span className="text-zinc-200">"Next step"</span> → <span className="text-zinc-200">"Create export"</span> and wait for the email</li>
                <li>Download the ZIP and upload it below</li>
              </ol>
              <p className="text-zinc-500 text-xs mt-1">
                YouTube Music exports use exact video IDs — every download is a perfect match, no searching needed.
              </p>
            </>
          }
        />
      )}

      {/* Progress panel */}
      {job && (
        <div className="bg-zinc-900 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {job.status === 'running' && <Loader2 size={18} className="animate-spin text-blue-400" />}
              {job.status === 'paused' && <Pause size={18} className="text-amber-400" />}
              {job.status === 'done' && <CheckCircle size={18} className="text-green-400" />}
              {job.status === 'cancelled' && <Square size={18} className="text-zinc-400" />}
              {job.status === 'error' && <AlertCircle size={18} className="text-red-400" />}
              <span className="text-white font-medium">
                {job.status === 'running' && 'Importing…'}
                {job.status === 'paused' && (job.currentTrack === null && job.done > 0 ? `Interrupted — ${job.done} of ${job.total} done` : 'Paused')}
                {job.status === 'done' && 'Import complete'}
                {job.status === 'cancelled' && `Cancelled — ${job.done} of ${job.total} tracks done`}
                {job.status === 'error' && 'Import failed'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {job.status === 'running' && (
                <button onClick={pauseImport} className="text-zinc-400 hover:text-white transition-colors p-1" title="Pause">
                  <Pause size={15} />
                </button>
              )}
              {job.status === 'paused' && (
                <button onClick={resumeImport} className="text-zinc-400 hover:text-white transition-colors p-1" title="Resume">
                  <Play size={15} />
                </button>
              )}
              {(job.status === 'running' || job.status === 'paused') && (
                <button onClick={cancelImport} className="text-zinc-400 hover:text-red-400 transition-colors p-1" title="Cancel">
                  <Square size={15} />
                </button>
              )}
              {(job.status === 'done' || job.status === 'cancelled' || job.status === 'error') && (
                <button onClick={clearJob} className="text-zinc-500 hover:text-white transition-colors">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-500">
              <span>{job.done} / {job.total} tracks</span>
              <span>{pct}%</span>
            </div>
            <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {job.currentTrack && (
            <p className="text-zinc-400 text-sm truncate">
              Downloading: <span className="text-zinc-200">{job.currentTrack}</span>
            </p>
          )}

          {job.playlists?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">Playlists</p>
              {job.playlists.map(name => (
                <div key={name} className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                    job.currentPlaylist === name ? 'bg-blue-400' : 'bg-zinc-600'
                  }`} />
                  <span className={job.currentPlaylist === name ? 'text-white' : 'text-zinc-400'}>
                    {name}
                  </span>
                </div>
              ))}
            </div>
          )}

          {job.errors?.length > 0 && (
            <div className="space-y-1">
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">
                {job.errors.length} track{job.errors.length !== 1 ? 's' : ''} failed
              </p>
              <div className="max-h-28 overflow-y-auto space-y-0.5">
                {job.errors.map((e, i) => (
                  <p key={i} className="text-red-400 text-xs truncate">{e.track}</p>
                ))}
              </div>
            </div>
          )}

          {(job.status === 'done' || job.status === 'cancelled') && (
            <button
              onClick={clearJob}
              className="w-full bg-zinc-800 text-white rounded-lg py-2.5 text-sm hover:bg-zinc-700 transition-colors"
            >
              Import another file
            </button>
          )}
        </div>
      )}
    </div>
  );
}
