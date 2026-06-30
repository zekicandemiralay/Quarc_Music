import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { Menu, WifiOff, ServerCrash, Download, Search, X, Music, Youtube, ListOrdered, RefreshCw } from 'lucide-react';
import Sidebar from '../Sidebar/Sidebar';
import Player from '../Player/Player';
import useNetworkStatus from '../../hooks/useNetworkStatus';
import useOfflineStore from '../../store/useOfflineStore';
import usePlayerStore from '../../store/playerStore';
import { coverUrl } from '../../lib/apiUrl';

function norm(s) {
  return (s || '').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState([]);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const [toastVisible, setToastVisible] = useState(false);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const swipeRef = useRef({ startX: 0, startY: 0, song: null, el: null, isH: false, lastDx: 0 });
  const toastTimer = useRef(null);
  const { playSong, addToQueue } = usePlayerStore();
  const navigate = useNavigate();

  useEffect(() => {
    try { setSongs(JSON.parse(localStorage.getItem('quarc_songs') || '[]')); } catch {}
    fetch('/api/music').then((r) => r.json()).then(setSongs).catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const q = norm(query);
    setResults(songs.filter((s) => [s.title, s.artist, s.album].some((f) => norm(f).includes(q))).slice(0, 20));
  }, [query, songs]);

  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropdownStyle({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 320) });
  }, [open, query]);

  // Close when touching/clicking outside both the input container AND the dropdown portal
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, []);

  // Non-passive touchmove for swipe-right on dropdown rows
  useEffect(() => {
    const el = dropdownRef.current;
    if (!el) return;
    const handler = (e) => {
      const sr = swipeRef.current;
      if (!sr.song || !e.touches[0]) return;
      const dx = e.touches[0].clientX - sr.startX;
      const dy = e.touches[0].clientY - sr.startY;
      if (!sr.isH) {
        if (Math.abs(dy) > 8) { sr.song = null; return; }
        if (Math.abs(dx) > 8) {
          if (dx > 0) sr.isH = true;
          else { sr.song = null; return; }
        }
        return;
      }
      if (dx > 0) {
        e.preventDefault();
        sr.lastDx = dx;
        const inner = sr.el;
        const reveal = inner?.previousElementSibling;
        if (inner) inner.style.transform = `translateX(${Math.min(dx, 90)}px)`;
        if (reveal) reveal.style.opacity = String(Math.min(dx / 70, 1));
      }
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, [open, results.length]);

  const showDropdown = open && (results.length > 0 || query.trim().length > 0);

  function showToast() {
    clearTimeout(toastTimer.current);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2000);
  }

  function handleSelect(song) {
    const songQueue = [song, ...songs.filter((s) => s.id !== song.id)];
    playSong(song, songQueue, 0, 'single', 'Your Library');
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
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search your library…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setQuery(''); setOpen(false); inputRef.current?.blur(); }
            if (e.key === 'Enter' && query.trim()) handleYouTube();
          }}
          className="w-full bg-zinc-800 hover:bg-zinc-700 focus:bg-zinc-700 text-white placeholder-zinc-500 rounded-full pl-10 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors"
        />
        {query && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {showDropdown && createPortal(
        <div
          ref={dropdownRef}
          className="fixed bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl overflow-y-auto"
          style={{ ...dropdownStyle, zIndex: 400, maxHeight: '60vh' }}
        >
          {results.length === 0 && query.trim() && (
            <p className="text-zinc-500 text-xs px-4 py-3">No matches in library</p>
          )}

          {results.map((song) => (
            <div key={song.id} className="relative overflow-hidden">
              {/* Swipe-right reveal */}
              <div
                className="absolute inset-0 flex items-center gap-2 px-4 pointer-events-none"
                style={{ background: '#0d2818', opacity: 0 }}
              >
                <ListOrdered size={16} className="text-green-400" />
                <span className="text-xs font-medium text-green-400">Add to queue</span>
              </div>
              {/* Row */}
              <div
                className="relative flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors bg-zinc-900 hover:bg-zinc-800"
                onClick={() => handleSelect(song)}
                onTouchStart={(e) => {
                  if (e.touches.length !== 1) return;
                  swipeRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, song, el: e.currentTarget, isH: false, lastDx: 0 };
                }}
                onTouchEnd={() => {
                  const { song: sw, el, isH, lastDx } = swipeRef.current;
                  swipeRef.current = { startX: 0, startY: 0, song: null, el: null, isH: false, lastDx: 0 };
                  if (!el) return;
                  const reveal = el.previousElementSibling;
                  el.style.transition = 'transform 0.2s ease-out';
                  el.style.transform = '';
                  if (reveal) { reveal.style.transition = 'opacity 0.2s ease-out'; reveal.style.opacity = '0'; }
                  setTimeout(() => { el.style.transition = ''; if (reveal) reveal.style.transition = ''; }, 250);
                  if (isH && lastDx >= 70 && sw) { addToQueue(sw); showToast(); }
                }}
              >
                <div className="w-9 h-9 bg-zinc-800 rounded shrink-0 overflow-hidden">
                  {song.has_cover
                    ? <img src={coverUrl(song.id)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><Music size={12} className="text-zinc-600" /></div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-white truncate">{song.title}</p>
                  <p className="text-xs text-zinc-400 truncate">{song.artist || 'Unknown'}</p>
                </div>
              </div>
            </div>
          ))}

          {query.trim() && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleYouTube}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800 cursor-pointer transition-colors border-t border-zinc-800 sticky bottom-0 bg-zinc-900"
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

      {/* Toast */}
      {toastVisible && createPortal(
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white text-black text-sm font-medium px-4 py-2 rounded-full shadow-xl z-[500] pointer-events-none queue-toast">
          Added to queue
        </div>,
        document.body
      )}
    </div>
  );
}

function useHideSearch() {
  const { pathname } = useLocation();
  return (
    pathname.startsWith('/youtube') ||
    pathname.startsWith('/library') ||
    pathname.startsWith('/liked') ||
    pathname.startsWith('/playlist') ||
    pathname.startsWith('/mix') ||
    pathname.startsWith('/featured')
  );
}

function useUpdateCheck() {
  const [update, setUpdate] = useState(null); // { version, url, platform }
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const isCapacitor = window?.Capacitor?.isNativePlatform?.();
    const isTauri = !!window?.__TAURI__;
    if (!isCapacitor && !isTauri) return;

    const check = async () => {
      try {
        let currentVersion;
        if (isCapacitor) {
          const info = await window.Capacitor.Plugins.App.getInfo();
          currentVersion = info.version;
        } else {
          currentVersion = await window.__TAURI__.app.getVersion();
        }

        const release = await fetch(
          'https://api.github.com/repos/zekicandemiralay/Quarc_Music/releases/latest'
        ).then(r => r.json());

        const latest = release.tag_name?.replace(/^v/, '');
        if (!latest || latest === currentVersion) return;

        if (isCapacitor) {
          const apk = release.assets?.find(a => a.name.endsWith('.apk'));
          if (apk) setUpdate({ version: latest, url: apk.browser_download_url, platform: 'android' });
        } else {
          // Find the Windows x64 installer; fall back to the release page
          const exe = release.assets?.find(a => a.name.includes('x64-setup.exe'));
          setUpdate({ version: latest, url: exe?.browser_download_url ?? release.html_url, platform: 'desktop' });
        }
      } catch {}
    };
    const t = setTimeout(check, 6000);
    return () => clearTimeout(t);
  }, []);

  return { update: dismissed ? null : update, dismiss: () => setDismissed(true) };
}

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { online, serverOk } = useNetworkStatus();
  const showBanner = !online || !serverOk;
  const wakeLockActive = useOfflineStore((s) => s.wakeLockActive);
  const downloading = useOfflineStore((s) => s.downloading);
  const showDownloadBanner = wakeLockActive && Object.keys(downloading).length > 0;
  const { update, dismiss: dismissUpdate } = useUpdateCheck();
  const showUpdateBanner = !!update;
  const bannerCount = (showBanner ? 1 : 0) + (showDownloadBanner ? 1 : 0) + (showUpdateBanner ? 1 : 0);

  function handleInstallUpdate() {
    if (update.platform === 'android') {
      window?.Capacitor?.Plugins?.MusicService?.downloadUpdate({ url: update.url, version: update.version });
    } else {
      // Desktop: open the installer download in the system browser.
      // The NSIS installer updates in place — offline songs are preserved.
      window.__TAURI__.shell.open(update.url);
    }
    dismissUpdate();
  }
  const hideSearch = useHideSearch();

  return (
    <div className="flex flex-col overflow-hidden bg-black h-full">

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
        </div>
      )}

      {/* Content row: sidebar + main (fills all space above the player bar) */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Sidebar — fixed overlay on mobile, static column on desktop */}
        <div className={`
          fixed md:static inset-y-0 left-0 z-50
          transform transition-transform duration-300 ease-in-out md:transform-none
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </div>

        {/* Scrollable content area */}
        <main className={`flex-1 overflow-y-auto bg-gradient-to-b from-zinc-800 to-zinc-900 pb-[72px] md:pb-0 ${
          bannerCount === 3 ? (hideSearch ? 'pt-[143px] md:pt-[90px]' : 'pt-[143px]') :
          bannerCount === 2 ? (hideSearch ? 'pt-[113px] md:pt-[60px]' : 'pt-[113px]') :
          bannerCount === 1 ? (hideSearch ? 'pt-[83px] md:pt-[30px]'  : 'pt-[83px]')  :
                              (hideSearch ? 'pt-[53px] md:pt-0'        : 'pt-[53px]')
        }`}>
          {children}
        </main>

      </div>

      {/* Top bar */}
      <div className={`fixed top-0 left-0 right-0 md:left-64 z-30 flex items-center gap-3 px-4 py-3 bg-zinc-900 border-b border-zinc-800 ${
        hideSearch ? 'md:hidden' : ''
      }`}>
        <button onClick={() => setSidebarOpen(true)} className="md:hidden text-zinc-400 hover:text-white transition-colors shrink-0">
          <Menu size={22} />
        </button>
        {hideSearch
          ? <span className="text-white font-bold text-base md:hidden">Quarc Music</span>
          : <GlobalSearch />
        }
      </div>

      {/* Network status banner */}
      {showBanner && (
        <div className={`fixed top-[53px] left-0 ${hideSearch ? 'md:left-64 md:top-0' : 'md:left-64'} right-0 z-20 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium ${
          !online ? 'bg-[#1DB954] text-black' : 'bg-amber-600 text-amber-50'
        }`}>
          {!online ? <WifiOff size={13} /> : <ServerCrash size={13} />}
          {!online ? "You're offline" : 'Server not reachable — some features may be unavailable'}
        </div>
      )}

      {/* Download wake lock banner */}
      {showDownloadBanner && (
        <div className={`fixed ${showBanner ? (hideSearch ? 'top-[83px] md:top-[30px]' : 'top-[83px]') : (hideSearch ? 'top-[53px] md:top-0' : 'top-[53px]')} left-0 md:left-64 right-0 z-20 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium bg-blue-600 text-white`}>
          <Download size={13} className="animate-bounce" />
          Downloading offline songs — screen won&apos;t lock automatically
        </div>
      )}

      {/* Update available banner */}
      {showUpdateBanner && (() => {
        const above = (showBanner ? 1 : 0) + (showDownloadBanner ? 1 : 0);
        const topPx = 53 + above * 30;
        return (
          <div
            className={`fixed left-0 md:left-64 right-0 z-20 flex items-center justify-center gap-2 px-4 py-1.5 text-xs font-medium bg-emerald-700 text-white`}
            style={{ top: topPx }}
          >
            <RefreshCw size={13} />
            Update available — v{update.version}
            <button
              onClick={handleInstallUpdate}
              className="ml-2 underline underline-offset-2 hover:text-emerald-200 transition-colors"
            >
              Install now
            </button>
            <button onClick={dismissUpdate} className="ml-1 hover:text-emerald-200 transition-colors">
              <X size={13} />
            </button>
          </div>
        );
      })()}

      {/* Player — fixed on mobile, static flex child on desktop so sidebar stops above it */}
      <div className="fixed md:static bottom-0 left-0 right-0 z-30 md:z-auto md:shrink-0">
        <Player />
      </div>

    </div>
  );
}
