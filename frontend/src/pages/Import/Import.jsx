import { useState, useEffect, useRef } from 'react';
import { Upload, CheckCircle, AlertCircle, Loader2, X, Music, Pause, Play, Square, Download, Heart, ListMusic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useUserDataStore from '../../store/userDataStore';
import { apiUrl } from '../../lib/apiUrl';

// Triggers a real file download from a fetch Response, regardless of method
// (GET or POST) — works reliably across web/desktop/mobile WebViews, unlike
// window.open() which can't handle POST responses and is silently dropped in
// some WebViews.
async function downloadResponse(res, fallbackFilename) {
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Export failed');
  const match = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/);
  const filename = match?.[1] || fallbackFilename;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function ExportSection() {
  const { t } = useTranslation();
  const { likedSongs, playlists } = useUserDataStore();
  const [selected, setSelected] = useState(new Set());
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const allKeys = ['liked', ...playlists.map((p) => p.id)];
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allKeys));
  }
  function toggleOne(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function handleExport() {
    if (selected.size === 0) return;
    setExporting(true);
    setError(null);
    try {
      if (selected.size === 1) {
        const key = [...selected][0];
        if (key === 'liked') {
          await downloadResponse(await fetch(apiUrl('/api/export/liked-songs')), 'Liked Songs.csv');
        } else {
          const pl = playlists.find((p) => p.id === key);
          await downloadResponse(await fetch(apiUrl(`/api/export/playlist/${key}`)), `${pl?.name || 'playlist'}.csv`);
        }
      } else {
        const items = [...selected].map((key) => (key === 'liked' ? { type: 'liked' } : { type: 'playlist', id: key }));
        const res = await fetch(apiUrl('/api/export/bulk'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        await downloadResponse(res, 'Quarc Music Export.zip');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-zinc-900 rounded-xl p-4 space-y-2">
        <p className="text-zinc-300 text-sm font-medium">{t('import.exportInstructions')}</p>
        <p className="text-zinc-500 text-xs">{t('import.exportHint')}</p>
      </div>

      <div className="bg-zinc-900 rounded-xl divide-y divide-zinc-800 max-h-80 overflow-y-auto">
        <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-800/50">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="shrink-0" />
          <span className="text-sm font-medium text-white">{t('import.selectAll')}</span>
        </label>

        <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-800/50">
          <input type="checkbox" checked={selected.has('liked')} onChange={() => toggleOne('liked')} className="shrink-0" />
          <Heart size={15} className="text-red-400 shrink-0" />
          <span className="flex-1 text-sm text-zinc-200 truncate">{t('library.likedSongs')}</span>
          <span className="text-xs text-zinc-500">{likedSongs.length}</span>
        </label>

        {playlists.map((p) => (
          <label key={p.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-zinc-800/50">
            <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} className="shrink-0" />
            <ListMusic size={15} className="text-zinc-500 shrink-0" />
            <span className="flex-1 text-sm text-zinc-200 truncate">{p.name}</span>
            <span className="text-xs text-zinc-500">{p.songs.length}</span>
          </label>
        ))}

        {playlists.length === 0 && (
          <p className="px-4 py-6 text-center text-zinc-500 text-sm">{t('import.noPlaylists')}</p>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleExport}
        disabled={selected.size === 0 || exporting}
        className="w-full bg-white text-black rounded-xl py-3 font-medium text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
        {exporting
          ? t('import.exporting')
          : selected.size > 1
          ? t('import.exportSelectedCount', { n: selected.size })
          : t('import.exportSelected')}
      </button>
    </div>
  );
}

function UploadSection({ accept, endpoint, instructions, hint, onJobStart }) {
  const { t } = useTranslation();
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
    if (valid.length !== incoming.length) setError(t('import.onlyAccepted', { accept }));
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
        <p className="text-zinc-300 font-medium">{t('import.dropFiles')}</p>
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
        {uploading
          ? t('import.starting')
          : files.length > 1
          ? t('import.startImportCount', { n: files.length })
          : t('import.startImport')}
      </button>
    </div>
  );
}

export default function Import() {
  const { t } = useTranslation();
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
        <h1 className="text-2xl font-bold text-white mb-1">{t('import.title')}</h1>
        <p className="text-zinc-400 text-sm">{t('import.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-xl p-1">
        <button
          onClick={() => setTab('spotify')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === 'spotify' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          {t('import.spotify')}
        </button>
        <button
          onClick={() => setTab('youtube')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === 'youtube' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          {t('import.youtubeMusic')}
        </button>
        <button
          onClick={() => setTab('export')}
          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
            tab === 'export' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          {t('import.export')}
        </button>
      </div>

      {tab === 'export' && <ExportSection />}

      {/* Upload section — hidden while a job is running/done */}
      {tab !== 'export' && !job && tab === 'spotify' && (
        <UploadSection
          accept=".zip,.csv"
          endpoint="/api/import/spotify"
          hint={t('import.spotifyHint')}
          onJobStart={setJob}
          instructions={
            <>
              <p className="text-zinc-300 text-sm font-medium">{t('import.spotifyInstructions')}</p>
              <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                <li>{t('import.spotifyStep1')}</li>
                <li>{t('import.spotifyStep2')}</li>
                <li>{t('import.spotifyStep3')}</li>
              </ol>
            </>
          }
        />
      )}

      {!job && tab === 'youtube' && (
        <UploadSection
          accept=".zip,.json"
          endpoint="/api/import/youtube"
          hint={t('import.youtubeHint')}
          onJobStart={setJob}
          instructions={
            <>
              <p className="text-zinc-300 text-sm font-medium">{t('import.youtubeInstructions')}</p>
              <ol className="text-zinc-400 text-sm space-y-1 list-decimal list-inside">
                <li>{t('import.youtubeStep1')}</li>
                <li>{t('import.youtubeStep2')}</li>
                <li>{t('import.youtubeStep3')}</li>
                <li>{t('import.youtubeStep4')}</li>
                <li>{t('import.youtubeStep5')}</li>
              </ol>
              <p className="text-zinc-500 text-xs mt-1">{t('import.youtubeNote')}</p>
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
                {job.status === 'running' && t('import.importing')}
                {job.status === 'paused' && (
                  job.currentTrack === null && job.done > 0
                    ? t('import.interrupted', { done: job.done, total: job.total })
                    : t('import.paused')
                )}
                {job.status === 'done' && t('import.importComplete')}
                {job.status === 'cancelled' && t('import.cancelled', { done: job.done, total: job.total })}
                {job.status === 'error' && t('import.importFailed')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {job.status === 'running' && (
                <button onClick={pauseImport} className="text-zinc-400 hover:text-white transition-colors p-1" title={t('import.pause')}>
                  <Pause size={15} />
                </button>
              )}
              {job.status === 'paused' && (
                <button onClick={resumeImport} className="text-zinc-400 hover:text-white transition-colors p-1" title={t('import.resume')}>
                  <Play size={15} />
                </button>
              )}
              {(job.status === 'running' || job.status === 'paused') && (
                <button onClick={cancelImport} className="text-zinc-400 hover:text-red-400 transition-colors p-1" title={t('import.cancel')}>
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
              <span>{t('import.tracks', { done: job.done, total: job.total })}</span>
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
              {t('import.downloading')} <span className="text-zinc-200">{job.currentTrack}</span>
            </p>
          )}

          {job.playlists?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-semibold">{t('import.playlists')}</p>
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
                {t('import.failedTracks', { n: job.errors.length, count: job.errors.length })}
              </p>
              <div className="max-h-28 overflow-y-auto space-y-0.5">
                {job.errors.map((e, i) => (
                  <p key={i} className="text-red-400 text-xs truncate" title={e.error}>
                    {e.track}{e.error ? <span className="text-red-400/60"> — {e.error}</span> : null}
                  </p>
                ))}
              </div>
            </div>
          )}

          {(job.status === 'done' || job.status === 'cancelled') && (
            <button
              onClick={clearJob}
              className="w-full bg-zinc-800 text-white rounded-lg py-2.5 text-sm hover:bg-zinc-700 transition-colors"
            >
              {t('import.importAnother')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
