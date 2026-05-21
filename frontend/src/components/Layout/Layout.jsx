import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Menu, WifiOff, ServerCrash, Download, Search, X, Music, Youtube } from 'lucide-react';
import Sidebar from '../Sidebar/Sidebar';
import Player from '../Player/Player';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import useOfflineStore from '../../store/useOfflineStore';
import usePlayerStore from '../../store/playerStore';

function norm(s) {
  return (s || '').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState([]);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const { playSong } = usePlayerStore();
  const navigate = useNavigate();

  useEffect(() => {
    try { setSongs(JSON.parse(localStorage.getItem('skynet_songs') || '[]')); } catch {}
    fetch('/api/music').then((r) => r.json()).then(setSongs).catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const q = norm(query);
    setResults(songs.filter((s) => [s.title, s.artist, s.album].some((f) => norm(f).includes(q))).slice(0, 8));
  }, [query, songs]);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 280) });
  }, [open, query]);

  useEffect(() => {
    const handler = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, []);

  const showDropdown = open && (results.length > 0 || query.trim().length > 0);

  function handleSelect(song) {
    playSong(song, results.length > 1 ? results : [song], results.indexOf(song), 'single', 'Search results');
    setQuery('');
    setOpen(false);
  }

  function handleYouTube() {
    if (!query.trim()) return;
    navigate(`/youtube?q=${encodeURIComponent(query.trim())}`);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative flex-1 max-w-sm">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search songs…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setQuery(''); setOpen(false); inputRef.current?.blur(); }
            if (e.key === 'Enter' && query.trim()) handleYouTube();
          }}
          className="w-full bg-zinc-800 text-white placeholder-zinc-500 rounded-full pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
        />
        {query && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {showDropdown && createPortal(
        <div
          className="fixed bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
          style={{ ...dropdownStyle, zIndex: 400 }}
        >
          {results.length === 0 && query.trim() && (
            <p className="text-zinc-500 text-xs px-4 py-2.5">No matches in library</p>
          )}
          {results.map((song) => (
            <div
              key={song.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(song)}
              className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-800 cursor-pointer transition-colors"
            >
              <div className="w-9 h-9 bg-zinc-800 rounded shrink-0 overflow-hidden">
                {song.has_cover
                  ? <img src={`/api/music/${song.id}/cover`} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center"><Music size={12} className="text-zinc-600" /></div>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{song.title}</p>
                <p className="text-xs text-zinc-400 truncate">{song.artist || 'Unknown'}</p>
              </div>
            </div>
          ))}
          {query.trim() && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleYouTube}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800 cursor-pointer transition-colors border-t border-zinc-800"
            >
              <div className="w-9 h-9 bg-red-950/50 rounded flex items-center justify-center shrink-0">
                <Youtube size={14} className="text-red-400" />
              </div>
              <p className="text-sm text-zinc-300 truncate">
                Search <span className="text-white">"{query}"</span> on YouTube
              </p>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { online, serverOk } = useNetworkStatus();
  const showBanner = !online || !serverOk;
  const wakeLockActive = useOfflineStore((s) => s.wakeLockActive);
  const downloading = useOfflineStore((s) => s.downloading);
  const showDownloadBanner = wakeLockActive && Object.keys(downloading).length > 0;
  const bannerCount = (showBanner ? 1 : 0) + (showDownloadBanner ? 1 : 0);

  return (
    <div className="flex overflow-hidden bg-black h-full">

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
        </div>
      )}

      {/* Sidebar — fixed overlay on mobile, static column on desktop */}
      <div className={`
        fixed md:static inset-y-0 left-0 z-50
        transform transition-transform duration-300 ease-in-out md:transform-none
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </div>

      {/* Scrollable content area — padded so content never hides under fixed bars */}
      <main className={`flex-1 overflow-y-auto bg-gradient-to-b from-zinc-800 to-zinc-900 pb-[72px] md:pb-24 ${
        bannerCount === 2 ? 'pt-[113px]' :
        bannerCount === 1 ? 'pt-[83px]' : 'pt-[53px]'
      }`}>
        {children}
      </main>

      {/* Top bar — mobile + desktop */}
      <div className="fixed top-0 left-0 right-0 md:left-64 z-30 flex items-center gap-3 px-4 py-3 bg-zinc-900 border-b border-zinc-800">
        <button onClick={() => setSidebarOpen(true)} className="md:hidden text-zinc-400 hover:text-white transition-colors shrink-0">
          <Menu size={22} />
        </button>
        <GlobalSearch />
      </div>

      {/* Network status banner */}
      {showBanner && (
        <div className={`fixed top-[53px] left-0 md:left-64 right-0 z-20 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium ${
          !online ? 'bg-[#1DB954] text-black' : 'bg-amber-600 text-amber-50'
        }`}>
          {!online ? <WifiOff size={13} /> : <ServerCrash size={13} />}
          {!online ? "You're offline" : 'Server not reachable — some features may be unavailable'}
        </div>
      )}

      {/* Download wake lock banner */}
      {showDownloadBanner && (
        <div className={`fixed ${showBanner ? 'top-[83px]' : 'top-[53px]'} left-0 md:left-64 right-0 z-20 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium bg-blue-600 text-white`}>
          <Download size={13} className="animate-bounce" />
          Downloading offline songs — screen won&apos;t lock automatically
        </div>
      )}

      {/* Player — fixed so it stays at bottom regardless of scroll position */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 z-30">
        <Player />
      </div>

    </div>
  );
}
