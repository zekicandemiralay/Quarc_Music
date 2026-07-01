import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X, Download, CheckCircle, AlertCircle, Play, ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useUserDataStore from '../../store/userDataStore';

function fmtDur(s) {
  if (!s) return '';
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (!n) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K views`;
  return `${n} views`;
}

function PlaylistPicker({ songId, onClose }) {
  const { t } = useTranslation();
  const { playlists, addToPlaylist } = useUserDataStore();
  const [added, setAdded] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  async function handleAdd(playlistId) {
    await addToPlaylist(playlistId, String(songId));
    setAdded(playlistId);
    setTimeout(onClose, 900);
  }

  return (
    <div ref={ref} className="absolute bottom-full left-0 mb-2 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl z-20 min-w-44 max-h-56 overflow-y-auto">
      {playlists.length === 0 ? (
        <p className="text-zinc-500 text-xs px-3 py-3">{t('nav.noPlaylists')}</p>
      ) : playlists.map((p) => (
        <button
          key={p.id}
          onClick={() => handleAdd(p.id)}
          className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 text-white flex items-center justify-between gap-2 first:rounded-t-xl last:rounded-b-xl"
        >
          <span className="truncate">{p.name}</span>
          {added === p.id && <CheckCircle size={13} className="text-green-400 shrink-0" />}
        </button>
      ))}
    </div>
  );
}

function DownloadBtn({ videoId, title }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [songId, setSongId] = useState(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    if (!jobId || status === 'done' || status === 'error') return;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/youtube/download/status/${jobId}`);
        const d = await r.json();
        setProgress(d.progress);
        setStatus(d.status);
        if (d.status === 'done') {
          setSongId(d.song_id ?? null);
          try { localStorage.removeItem('quarc_songs'); } catch {}
          clearInterval(timer);
        }
        if (d.status === 'error') { setErrorMsg(d.error || null); clearInterval(timer); }
      } catch {}
    }, 1000);
    return () => clearInterval(timer);
  }, [jobId, status]);

  async function start() {
    setStatus('pending');
    setErrorMsg(null);
    try {
      const r = await fetch('/api/youtube/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId, title }),
      });
      if (!r.ok) { setStatus('error'); return; }
      const d = await r.json();
      if (!d.jobId) { setStatus('error'); return; }
      setJobId(d.jobId);
      setStatus('downloading');
    } catch { setStatus('error'); }
  }

  if (status === 'done')
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-green-400 text-sm">
          <CheckCircle size={15} />{t('youtube.savedToLibrary')}
        </span>
        {songId && (
          <div className="relative">
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white rounded-full text-xs font-medium transition-colors"
            >
              <ListPlus size={13} />
              {t('library.addToPlaylist')}
            </button>
            {showPicker && <PlaylistPicker songId={songId} onClose={() => setShowPicker(false)} />}
          </div>
        )}
      </div>
    );
  if (status === 'error')
    return (
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-red-400 text-sm"><AlertCircle size={15} />{t('youtube.failed')}</span>
        {errorMsg && <span className="text-xs text-zinc-500 max-w-xs truncate" title={errorMsg}>{errorMsg}</span>}
      </div>
    );
  if (status === 'downloading' || status === 'pending')
    return (
      <div className="flex items-center gap-2 text-zinc-400 text-sm">
        <div className="w-28 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
          <div className="h-full bg-red-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <span>{Math.round(progress)}%</span>
      </div>
    );

  return (
    <button
      onClick={start}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors"
    >
      <Download size={14} />
      {t('youtube.downloadMp3')}
    </button>
  );
}

function VideoCard({ video, onSelect }) {
  return (
    <div className="cursor-pointer group" onClick={() => onSelect(video)}>
      <div className="relative aspect-video bg-zinc-800 rounded-xl overflow-hidden mb-3">
        <img
          src={video.thumbnail}
          alt={video.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />
        {video.duration && (
          <span className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded font-mono">
            {fmtDur(video.duration)}
          </span>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
          <div className="w-12 h-12 bg-white/90 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={20} className="text-black fill-current ml-1" />
          </div>
        </div>
      </div>
      <h3 className="text-white text-sm font-medium leading-snug line-clamp-2 mb-1">{video.title}</h3>
      <p className="text-zinc-400 text-xs">{video.channel}</p>
      {video.viewCount && <p className="text-zinc-600 text-xs">{fmtViews(video.viewCount)}</p>}
    </div>
  );
}

async function openExternal(url) {
  if (window.__TAURI_INTERNALS__) {
    try {
      await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: url });
      return;
    } catch {}
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function Modal({ video, onClose }) {
  const { t } = useTranslation();
  if (!video) return null;
  return (
    // Full-screen on mobile, centred card on desktop
    <div className="fixed inset-0 z-50 flex flex-col md:items-center md:justify-center md:p-4 md:bg-black/80" onClick={onClose}>
      <div
        className="bg-zinc-900 flex flex-col w-full h-full md:h-auto md:rounded-2xl md:overflow-hidden md:max-w-4xl md:max-h-[90vh] md:overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close bar — visible on mobile at top */}
        <div className="flex items-center justify-between px-4 py-3 md:hidden border-b border-zinc-800 shrink-0">
          <p className="text-white text-sm font-medium truncate pr-4">{video.title}</p>
          <button onClick={onClose} className="text-zinc-400 hover:text-white shrink-0">
            <X size={22} />
          </button>
        </div>

        <div className="aspect-video bg-black w-full shrink-0">
          <iframe
            src={`https://www.youtube.com/embed/${video.id}?autoplay=1`}
            title={video.title}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>

        <div className="p-4 md:p-6 overflow-y-auto flex-1">
          <div className="hidden md:flex items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <h2 className="text-white text-xl font-bold mb-1">{video.title}</h2>
              <p className="text-zinc-400 text-sm">{video.channel}</p>
              {video.viewCount && <p className="text-zinc-600 text-sm">{fmtViews(video.viewCount)}</p>}
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors shrink-0">
              <X size={22} />
            </button>
          </div>
          {/* Mobile: show channel below video */}
          <div className="md:hidden mb-3">
            <p className="text-zinc-400 text-sm">{video.channel}</p>
            {video.viewCount && <p className="text-zinc-600 text-xs">{fmtViews(video.viewCount)}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-zinc-800">
            <DownloadBtn videoId={video.id} title={video.title} />
            <button
              onClick={() => openExternal(`https://www.youtube.com/watch?v=${video.id}`)}
              className="text-zinc-500 hover:text-white text-sm transition-colors"
            >
              {t('youtube.openInYoutube')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function YouTube() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const q = searchParams.get('q');
    if (q) { setQuery(q); doSearch(q); }
  }, [searchParams.get('q')]);

  async function doSearch(q) {
    if (!q?.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/youtube/search?q=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error('Search failed');
      setResults(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearchParams({ q: query });
  }

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-6 py-4">
        <form onSubmit={submit} className="flex gap-3 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('youtube.searchPlaceholder')}
              className="w-full bg-zinc-800 text-white placeholder-zinc-500 rounded-full px-5 py-2.5 pr-10 text-sm border border-zinc-700 focus:outline-none focus:border-red-500"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                <X size={15} />
              </button>
            )}
          </div>
          <button type="submit" className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-full text-sm font-medium transition-colors flex items-center gap-2">
            <Search size={15} />
            {t('youtube.search')}
          </button>
        </form>
      </div>

      <div className="p-6">
        {loading && (
          <div className="text-center py-24">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">{t('youtube.searching')}</p>
          </div>
        )}

        {error && !loading && (
          <div className="text-center py-24">
            <AlertCircle size={44} className="mx-auto text-red-500 mb-4" />
            <p className="text-red-400 mb-1">{error}</p>
            <p className="text-zinc-600 text-sm">{t('youtube.backendError')}</p>
          </div>
        )}

        {!loading && !error && results.length === 0 && !searchParams.get('q') && (
          <div className="text-center py-24">
            <Search size={44} className="mx-auto text-zinc-700 mb-4" />
            <p className="text-zinc-400 text-lg">{t('youtube.emptyTitle')}</p>
            <p className="text-zinc-600 text-sm mt-2">{t('youtube.emptyHint')}</p>
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
            {results.map((v) => <VideoCard key={v.id} video={v} onSelect={setSelected} />)}
          </div>
        )}
      </div>

      <Modal video={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
