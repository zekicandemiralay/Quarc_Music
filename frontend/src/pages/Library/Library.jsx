import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, Search, RefreshCw, Music, Youtube, Heart, ListPlus, X, Shuffle, Download, WifiOff, Sparkles, Clock, Mic2, ListOrdered, MoreHorizontal, ListMusic, Share2 } from 'lucide-react';
import usePlayerStore from '../../store/playerStore';
import useUserDataStore from '../../store/userDataStore';
import useOfflineStore from '../../store/useOfflineStore';
import useMixStore from '../../store/useMixStore';
import useFeaturedStore from '../../store/useFeaturedStore';
import useRadioStore from '../../store/useRadioStore';

// Normalize for search: strips diacritics (ş→s, ü→u, é→e, etc.) and lowercases.
// ı (Turkish dotless-i, U+0131) has no NFD decomposition so we replace it explicitly.
function norm(s) {
  return (s || '').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function OfflineButton({ songs, playlistId }) {
  const { cachedIds, downloading, cacheSongs, removeSongs } = useOfflineStore();
  const setPlaylistOffline = useUserDataStore((s) => s.setPlaylistOffline);
  const [confirmRemove, setConfirmRemove] = useState(false);
  if (!songs.length) return null;

  const ids = songs.map((s) => s.id);
  const cachedCount = ids.filter((id) => cachedIds.has(id)).length;
  const activeDownloads = ids.filter((id) => typeof downloading[id] === 'number');
  const isDownloading = activeDownloads.length > 0;
  const allCached = cachedCount === songs.length;

  function handleSaveOffline() {
    if (playlistId) setPlaylistOffline(playlistId, true);
    cacheSongs(songs);
  }

  function handleRemoveOffline() {
    if (playlistId) setPlaylistOffline(playlistId, false);
    removeSongs(ids);
    setConfirmRemove(false);
  }

  if (isDownloading) {
    const overallProgress = Math.round(
      activeDownloads.reduce((sum, id) => sum + downloading[id], 0) / activeDownloads.length
    );
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-zinc-700/50 rounded-full text-sm text-zinc-400 shrink-0">
        <Download size={15} className="animate-pulse" />
        <span className="hidden sm:inline">{cachedCount + activeDownloads.length}/{songs.length} · {overallProgress}%</span>
      </div>
    );
  }

  if (allCached) {
    return (
      <>
        {confirmRemove && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
              <p className="text-white">Remove offline copies? You'll need to re-download to listen without internet.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setConfirmRemove(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleRemoveOffline}
                  className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}
        <button
          onClick={() => setConfirmRemove(true)}
          className="flex items-center gap-2 px-3 py-2 bg-green-900/30 hover:bg-red-900/30 text-green-400 hover:text-red-400 border border-green-800/40 hover:border-red-800/40 rounded-full text-sm font-medium transition-colors shrink-0"
          title="Available offline — click to remove"
        >
          <WifiOff size={15} />
          <span className="hidden sm:inline">Offline</span>
        </button>
      </>
    );
  }

  return (
    <button
      onClick={handleSaveOffline}
      className="flex items-center gap-2 px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors shrink-0"
      title="Save for offline listening"
    >
      <Download size={15} />
      <span className="hidden sm:inline">
        {cachedCount > 0 ? `Save offline (${songs.length - cachedCount} left)` : 'Save offline'}
      </span>
    </button>
  );
}

function fmt(s) {
  if (!s) return '--:--';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function AddToPlaylistMenu({ songId, song, onClose, onQueueAdded, position }) {
  const { playlists, addToPlaylist, createPlaylist } = useUserDataStore();
  const { addToQueue } = usePlayerStore();
  const [newName, setNewName] = useState('');

  function handleAddToQueue() {
    if (song) { addToQueue(song); onClose(); if (onQueueAdded) onQueueAdded(song.title); }
  }

  async function handleAdd(playlistId) {
    await addToPlaylist(playlistId, songId);
    onClose();
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const p = await createPlaylist(name);
    if (p) await addToPlaylist(p.id, songId);
    onClose();
  }

  return createPortal(
    <>
      {/* Invisible click-away layer */}
      <div className="fixed inset-0 z-[195]" onClick={onClose} />
      <div
        className="fixed z-[196] bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl w-52 py-1"
        style={{ top: position.top, right: position.right }}
        onClick={(e) => e.stopPropagation()}
      >
        {song && (
          <>
            <button
              onClick={handleAddToQueue}
              className="w-full text-left flex items-center gap-2 text-zinc-300 hover:text-white hover:bg-zinc-700 text-sm px-3 py-2 transition-colors"
            >
              <ListOrdered size={13} className="text-zinc-400 shrink-0" />
              Add to queue
            </button>
            <div className="border-t border-zinc-700/60 my-1" />
          </>
        )}
        <p className="text-zinc-500 text-xs px-3 py-1.5 font-semibold uppercase tracking-wider">Add to playlist</p>
        {playlists.length === 0 && (
          <p className="text-zinc-600 text-xs px-3 py-1.5">No playlists yet</p>
        )}
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => handleAdd(p.id)}
            className="w-full text-left text-zinc-300 hover:text-white hover:bg-zinc-700 text-sm px-3 py-2 transition-colors truncate"
          >
            {p.name}
          </button>
        ))}
        <div className="border-t border-zinc-700 mt-1 pt-1">
          <div className="flex items-center gap-1 px-2 py-1">
            <input
              autoFocus={playlists.length === 0}
              type="text"
              placeholder="New playlist…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              className="flex-1 bg-zinc-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none placeholder-zinc-500 min-w-0"
            />
            <button onClick={handleCreate} className="text-zinc-400 hover:text-white text-xs px-1.5 py-1.5">+</button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

async function shareSong(song) {
  const url = `${window.location.origin}/?share=${song.id}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Skynet Music', text: url, url }); return 'shared'; } catch { return null; }
  } else {
    try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return null; }
  }
}

function MobileSongActionSheet({ song, onClose, onQueueAdded, onShare, currentPlaylistId, onRemoveFromPlaylist }) {
  const { likedSongs, toggleLike, playlists, addToPlaylist, createPlaylist } = useUserDataStore();
  const { addToQueue } = usePlayerStore();
  const navigate = useNavigate();
  const liked = likedSongs.includes(song.id);
  const [newName, setNewName] = useState('');

  // Swipe-down to dismiss
  const sheetRef = useRef(null);
  const dragStartY = useRef(0);
  const dragging = useRef(false);
  const dragYRef = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const entered = useRef(false);

  const onDragStart = (e) => {
    if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
    dragStartY.current = e.touches[0].clientY;
    dragging.current = true;
    setSnapping(false);
  };
  const onDragEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragYRef.current > 80) {
      onClose();
    } else if (dragYRef.current > 0) {
      setSnapping(true);
      setDragY(0);
      dragYRef.current = 0;
      setTimeout(() => setSnapping(false), 280);
    }
  }, [onClose]);

  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!dragging.current) return;
      const delta = e.touches[0].clientY - dragStartY.current;
      if (delta > 0) {
        e.preventDefault();
        dragYRef.current = delta;
        setDragY(delta);
      }
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, []);

  const sheetStyle = (() => {
    if (dragY > 0) return { transform: `translateY(${dragY}px)` };
    if (snapping) return { transform: 'translateY(0)', transition: 'transform 0.25s ease-out' };
    if (!entered.current) return { animation: 'slideUp 0.25s ease-out forwards' };
    return {};
  })();

  async function handleAddToPlaylist(playlistId) {
    await addToPlaylist(playlistId, song.id);
    onClose();
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const p = await createPlaylist(name);
    if (p) await addToPlaylist(p.id, song.id);
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col justify-end bg-black/60" onClick={onClose}>
      <div
        ref={sheetRef}
        className="bg-zinc-900 rounded-t-2xl border-t border-zinc-800 max-h-[85vh] flex flex-col"
        style={sheetStyle}
        onAnimationEnd={() => { entered.current = true; }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onDragStart}
        onTouchEnd={onDragEnd}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        {/* Song info header */}
        <div className="flex items-center gap-3 px-4 pt-3 pb-4 border-b border-zinc-800 shrink-0">
          <div className="w-11 h-11 rounded bg-zinc-800 overflow-hidden shrink-0">
            {song.has_cover
              ? <img src={`/api/music/${song.id}/cover`} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Music size={14} /></div>}
          </div>
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{song.title}</p>
            <p className="text-zinc-400 text-xs truncate">{song.artist || 'Unknown'}</p>
          </div>
        </div>

        {/* Scrollable actions */}
        <div className="overflow-y-auto flex-1">
          {/* Like / Unlike */}
          <button
            onClick={() => { toggleLike(song.id); onClose(); }}
            className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800 transition-colors active:bg-zinc-800"
          >
            <Heart size={20} className={liked ? 'text-red-400 fill-current' : 'text-zinc-400'} />
            <span className="text-white text-sm">{liked ? 'Unlike' : 'Like'}</span>
          </button>

          {/* Add to queue */}
          <button
            onClick={() => { addToQueue(song); if (onQueueAdded) onQueueAdded(song.title); onClose(); }}
            className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800 transition-colors active:bg-zinc-800"
          >
            <ListOrdered size={20} className="text-zinc-400" />
            <span className="text-white text-sm">Add to queue</span>
          </button>

          {/* Remove from playlist (if in a playlist view) */}
          {currentPlaylistId && onRemoveFromPlaylist && (
            <button
              onClick={() => { onRemoveFromPlaylist(); onClose(); }}
              className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800 transition-colors active:bg-zinc-800"
            >
              <X size={20} className="text-red-400" />
              <span className="text-red-400 text-sm">Remove from playlist</span>
            </button>
          )}

          {/* Find on YouTube */}
          <button
            onClick={() => { navigate(`/youtube?q=${encodeURIComponent(`${song.artist} ${song.title}`)}`); onClose(); }}
            className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800 transition-colors active:bg-zinc-800"
          >
            <Youtube size={20} className="text-zinc-400" />
            <span className="text-white text-sm">Find on YouTube</span>
          </button>

          {/* Share */}
          <button
            onClick={() => onShare && onShare()}
            className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800 transition-colors active:bg-zinc-800"
          >
            <Share2 size={20} className="text-zinc-400" />
            <span className="text-white text-sm">Share song</span>
          </button>

          {/* Add to playlist */}
          <div className="border-t border-zinc-800 mt-1 pt-1">
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider px-5 py-2">Add to playlist</p>
            {playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => handleAddToPlaylist(p.id)}
                className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-zinc-800 transition-colors active:bg-zinc-800"
              >
                <ListMusic size={20} className="text-zinc-400" />
                <span className="text-white text-sm truncate">{p.name}</span>
              </button>
            ))}
            {/* New playlist */}
            <div className="flex items-center gap-2 px-5 py-3">
              <input
                type="text"
                placeholder="New playlist…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-2.5 focus:outline-none placeholder-zinc-500"
              />
              <button
                onClick={handleCreate}
                className="px-3 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg transition-colors"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Cancel */}
        <button
          onClick={onClose}
          className="w-full py-4 text-zinc-400 text-sm font-medium border-t border-zinc-800 shrink-0 active:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </div>,
    document.body
  );
}

const MIX_ICONS = {
  your_mix: <Sparkles size={32} className="text-purple-400" />,
  rediscovery: <Clock size={32} className="text-amber-400" />,
  artist_focus: <Mic2 size={32} className="text-blue-400" />,
  genre: <Music size={32} className="text-green-400" />,
};

export default function Library({ view = 'all' }) {
  const { playlistId, mixId, featuredId } = useParams();
  const mixData = useMixStore((s) => view === 'mix' ? s.getMix(mixId) : null);
  const featuredData = useFeaturedStore((s) => view === 'featured' ? s.getPlaylist(featuredId) : null);
  const [songs, setSongs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('skynet_songs') || '[]'); } catch { return []; }
  });
  // Only show loading spinner if we have no cached songs to display
  const [loading, setLoading] = useState(() => view !== 'mix' && view !== 'featured' && !localStorage.getItem('skynet_songs'));
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState(null); // brief feedback after scan
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null); // song ID with open playlist menu
  const [menuPosition, setMenuPosition] = useState({ top: 0, right: 0 });
  const [queueToast, setQueueToast] = useState(null); // brief "Added to queue" feedback
  const [actionSheet, setActionSheet] = useState(null); // song object for mobile action sheet
  const [visibleCount, setVisibleCount] = useState(50);
  const queueToastTimer = useRef(null);
  const swipeRef = useRef({ startX: 0, startY: 0, song: null, el: null, isH: false, lastDx: 0 });
  const songListRef = useRef(null);
  const { playSong, currentSong, isPlaying, shufflePlay, addToQueue } = usePlayerStore();
  const { cachedIds, downloading } = useOfflineStore();
  const { likedSongs, playlists, toggleLike, removeFromPlaylist } = useUserDataStore();
  const radioMode = useRadioStore((s) => s.radioMode);
  const isPlaylist = view === 'playlist' || view === 'liked';
  const loadMixes = useMixStore((s) => s.loadMixes);
  const navigate = useNavigate();

  function showToast(msg) {
    clearTimeout(queueToastTimer.current);
    setQueueToast(msg);
    queueToastTimer.current = setTimeout(() => setQueueToast(null), 2000);
  }
  function showQueueToast() { showToast('Added to queue'); }
  function showShareToast() { showToast('Link copied'); }

  useEffect(() => {
    const el = songListRef.current;
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
        if (inner) inner.style.transform = `translateX(${Math.min(dx, 110)}px)`;
        if (reveal) reveal.style.opacity = String(Math.min(dx / 80, 1));
      }
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, []);

  useEffect(() => { if (view !== 'mix' && view !== 'featured') load(); }, []);
  useEffect(() => { setVisibleCount(50); }, [search]);

  // Track recently accessed playlists for home page quick access
  useEffect(() => {
    if (view === 'playlist' && playlistId) {
      try {
        const recents = JSON.parse(localStorage.getItem('skynet_playlist_recents') || '{}');
        recents[playlistId] = Date.now();
        localStorage.setItem('skynet_playlist_recents', JSON.stringify(recents));
      } catch {}
    }
  }, [view, playlistId]);

  async function load() {
    // Only block the UI with a spinner when there are no cached songs to show yet.
    // If we already have something rendered, refresh silently in the background.
    if (!localStorage.getItem('skynet_songs')) setLoading(true);
    try {
      const controller = new AbortController();
      // 30s — enough for large libraries on a slow mobile connection
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch('/api/music', { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      setSongs(data);
      try { localStorage.setItem('skynet_songs', JSON.stringify(data)); } catch {}
    } catch {
      // Offline or timeout — keep cached songs
    } finally {
      setLoading(false);
    }
  }

  async function scan() {
    setScanning(true);
    setScanMsg(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const res = await fetch('/api/music/scan', { method: 'POST', signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      await load();
      setScanMsg(data.count != null ? `${data.count} songs` : 'Done');
    } catch {
      setScanMsg('Failed');
    } finally {
      setScanning(false);
      setTimeout(() => setScanMsg(null), 3000);
    }
  }

  // Resolve which songs to show based on view
  const currentPlaylist = view === 'playlist' ? playlists.find((p) => p.id === playlistId) : null;

  let visibleSongs = songs;
  if (view === 'liked') {
    // likedSongs is oldest-first (appended); reverse so newest liked appears at top
    visibleSongs = [...likedSongs].reverse().map((id) => songs.find((s) => s.id === id)).filter(Boolean);
  }
  if (view === 'playlist' && currentPlaylist) {
    // Oldest-first: matches Spotify playlist order (songs added later appear at the bottom)
    visibleSongs = [...currentPlaylist.songs].map((id) => songs.find((s) => s.id === id)).filter(Boolean);
  }
  if (view === 'mix') visibleSongs = mixData ? mixData.songs : [];
  if (view === 'featured') visibleSongs = featuredData ? featuredData.songs : [];

  const normSearch = norm(search);
  const filtered = visibleSongs.filter(
    (s) => !search || [s.title, s.artist, s.album].some((f) => norm(f).includes(normSearch))
  );

  // Paginate only on the main library view; search results and other views show all
  const PAGE = 50;
  const paginated = view === 'all' && !search ? filtered.slice(0, visibleCount) : filtered;

  const heading =
    view === 'liked' ? 'Liked Songs' :
    view === 'playlist' ? (currentPlaylist?.name || 'Playlist') :
    view === 'mix' ? (mixData?.name || 'Mix') :
    view === 'featured' ? (featuredData?.name || 'Collection') :
    'Your Library';

  const subheading =
    view === 'liked' ? `${filtered.length} liked songs` :
    view === 'playlist' ? `${filtered.length} songs` :
    view === 'mix' ? (mixData?.description || `${filtered.length} songs`) :
    view === 'featured' ? (featuredData?.description || `${filtered.length} songs`) :
    `${songs.length} songs`;

  return (
    <div className="p-4 md:p-6" ref={songListRef}>
      <div className="flex items-start justify-between mb-5 md:mb-6">
        <div className="flex items-center gap-3">
          {view === 'liked' && <Heart size={32} className="text-red-400 fill-current md:text-4xl" />}
          {view === 'mix' && mixData && MIX_ICONS[mixData.type]}
          {view === 'featured' && featuredData && (
            <div className="w-10 h-10 rounded-lg shrink-0" style={{ backgroundColor: featuredData.color + '33' }}>
              <div className="w-full h-full rounded-lg flex items-center justify-center" style={{ color: featuredData.color }}>
                <Music size={20} />
              </div>
            </div>
          )}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{heading}</h1>
            <p className="text-zinc-400 text-sm mt-1">{subheading}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {filtered.length > 0 && (
            <>
              <button
                onClick={() => shufflePlay(filtered, isPlaylist ? 'playlist' : 'single')}
                className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors"
              >
                <Shuffle size={15} />
                <span className="hidden sm:inline">Shuffle</span>
              </button>
              <OfflineButton songs={filtered} playlistId={view === 'playlist' ? playlistId : undefined} />
            </>
          )}
          {view === 'all' && (
            <button
              onClick={scan}
              disabled={scanning}
              className={`flex items-center gap-2 px-3 md:px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
                scanMsg === 'Failed' ? 'bg-red-700 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-white'
              }`}
            >
              <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">
                {scanning ? 'Scanning…' : scanMsg ?? 'Scan Library'}
              </span>
              {/* Mobile: show result message as tooltip-style badge */}
              {scanMsg && <span className="sm:hidden text-xs">{scanMsg}</span>}
            </button>
          )}
          {view === 'mix' && (
            <button
              onClick={loadMixes}
              className="flex items-center gap-2 px-3 md:px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors"
            >
              <RefreshCw size={15} />
              <span className="hidden sm:inline">Refresh Mix</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5 md:mb-6 flex-wrap">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-sm bg-zinc-800 text-white placeholder-zinc-500 rounded-full pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
          />
        </div>
        {search.trim() && (
          <button
            onClick={() => navigate(`/youtube?q=${encodeURIComponent(search.trim())}`)}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-red-400 transition-colors shrink-0"
          >
            <Youtube size={15} />
            Search in YouTube
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24">
          <Music size={48} className="mx-auto text-zinc-700 mb-4" />
          <p className="text-zinc-400 text-lg mb-2">
            {view === 'liked' ? 'No liked songs yet' :
             view === 'playlist' ? 'This playlist is empty' :
             view === 'mix' ? 'Mix is empty — keep listening to build it up' :
             view === 'featured' ? 'This collection is empty' :
             songs.length === 0 ? 'No music in library yet' : 'No results'}
          </p>
          {view === 'all' && songs.length === 0 && view !== 'mix' && (
            <button
              onClick={() => navigate('/youtube')}
              className="mt-3 inline-flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full text-sm font-medium transition-colors"
            >
              <Youtube size={16} />
              Find on YouTube
            </button>
          )}
        </div>
      ) : (
        <div>
          {/* Desktop-only header row */}
          <div className="hidden md:grid md:grid-cols-[2rem_1fr_1fr_1fr_4rem_3rem] gap-3 px-4 py-2 text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800 mb-1">
            <span>#</span>
            <span>Title</span>
            <span>Artist</span>
            <span>Album</span>
            <span className="text-right">Time</span>
            <span />
          </div>

          {paginated.map((song, i) => {
            const active = currentSong?.id === song.id;
            const liked = likedSongs.includes(song.id);
            const isHov = hovered === song.id;
            // Clicked song goes first, rest of view follows — avoids running out if song is near end
            const songQueue = [song, ...visibleSongs.filter((s) => s.id !== song.id)];
            return (
              <div key={song.id} className="relative overflow-hidden md:overflow-visible border-b border-zinc-800/50 md:border-0 last:border-0 rounded-md md:rounded-none">
                {/* Swipe-right reveal layer — mobile only */}
                <div
                  className="md:hidden absolute inset-0 flex items-center gap-2 px-5 pointer-events-none rounded-md"
                  style={{ background: '#0d2818', opacity: 0 }}
                >
                  <ListOrdered size={20} className="text-green-400" />
                  <span className="text-sm font-medium text-green-400">Add to queue</span>
                </div>
              <div
                className={`relative grid grid-cols-[1fr_3rem_3.5rem] md:grid-cols-[2rem_1fr_1fr_1fr_4rem_3rem] gap-2 md:gap-3 px-3 md:px-4 py-3 md:py-2 rounded-md cursor-pointer transition-colors items-center group ${
                  active ? 'bg-zinc-700/40' : 'bg-[#121212] md:bg-transparent hover:bg-zinc-700/20'
                }`}
                onClick={() => playSong(song, isPlaylist ? visibleSongs : songQueue, isPlaylist ? visibleSongs.indexOf(song) : 0, isPlaylist ? 'playlist' : 'single', heading)}
                onMouseEnter={() => setHovered(song.id)}
                onMouseLeave={() => setHovered(null)}
                onTouchStart={(e) => {
                  if (e.touches.length !== 1 || e.target.closest('button')) return;
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
                  if (isH && lastDx >= 80 && sw) { addToQueue(sw); showQueueToast(); }
                }}
              >
                {/* Index / play indicator — desktop only */}
                <div className="hidden md:flex items-center justify-center">
                  {active && !isHov ? (
                    <div className={`flex items-end gap-[2px] h-4 ${isPlaying ? '' : 'eq-paused'}`}>
                      <span className="eq-bar" />
                      <span className="eq-bar" />
                      <span className="eq-bar" />
                    </div>
                  ) : isHov ? (
                    <Play size={13} className={`fill-current ${active ? 'text-green-400' : 'text-white'}`} />
                  ) : (
                    <span className="text-sm text-zinc-500">{i + 1}</span>
                  )}
                </div>

                {/* Title + cover (artist shown below on mobile) */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="relative w-10 h-10 bg-zinc-800 rounded shrink-0 overflow-hidden">
                    {song.has_cover
                      ? <img src={`/api/music/${song.id}/cover`} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Music size={14} /></div>}
                    {/* Offline cached indicator */}
                    {cachedIds.has(song.id) && (
                      <div className="absolute bottom-0.5 right-0.5 w-2 h-2 bg-green-400 rounded-full" title="Available offline" />
                    )}
                    {/* Download progress overlay */}
                    {typeof downloading[song.id] === 'number' && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="text-white text-[9px] font-bold">{downloading[song.id]}%</span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate font-medium ${active ? 'text-green-400' : 'text-white'}`}>{song.title}</p>
                    <p className={`text-xs truncate md:hidden ${active ? 'text-green-400/70' : 'text-zinc-400'}`}>{song.artist}</p>
                  </div>
                </div>

                {/* Artist — desktop only */}
                <span className="hidden md:block text-zinc-400 text-sm truncate">{song.artist}</span>

                {/* Album — desktop only */}
                <span className="hidden md:block text-zinc-400 text-sm truncate">{song.album}</span>

                {/* Time */}
                <span className="text-zinc-500 text-xs md:text-sm text-right self-center">{fmt(song.duration)}</span>

                {/* Last grid column — mobile ⋮ + desktop liked indicator (non-interactive placeholder) */}
                <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => setActionSheet(song)}
                    className="md:hidden p-2 text-zinc-500 hover:text-white transition-colors"
                    title="More options"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                  {/* Liked indicator — visible when liked and not hovering; covered by overlay on hover */}
                  <Heart
                    size={15}
                    className={`hidden md:block mr-1.5 ${liked ? 'text-red-400 fill-current' : 'invisible'}`}
                  />
                </div>

                {/* Desktop hover overlay — absolute, covers right side of row */}
                <div
                  className={`absolute inset-y-0 right-0 hidden items-center gap-1 px-3 bg-gradient-to-l from-zinc-900 from-70% to-transparent ${menuOpen === song.id ? '!flex' : 'md:group-hover:flex'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => toggleLike(song.id)}
                    className={`p-1.5 transition-colors ${liked ? 'text-red-400' : 'text-zinc-500 hover:text-white'}`}
                    title={liked ? 'Unlike' : 'Like'}
                  >
                    <Heart size={14} className={liked ? 'fill-current' : ''} />
                  </button>
                  {view === 'playlist' && currentPlaylist && (
                    <button
                      onClick={() => removeFromPlaylist(currentPlaylist.id, song.id)}
                      className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                      title="Remove from playlist"
                    >
                      <X size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => { addToQueue(song); showQueueToast(); }}
                    className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                    title="Add to queue"
                  >
                    <ListOrdered size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      if (menuOpen === song.id) { setMenuOpen(null); return; }
                      const rect = e.currentTarget.getBoundingClientRect();
                      setMenuPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                      setMenuOpen(song.id);
                    }}
                    className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                    title="Add to playlist"
                  >
                    <ListPlus size={14} />
                  </button>
                  {menuOpen === song.id && (
                    <AddToPlaylistMenu songId={song.id} song={song} onClose={() => setMenuOpen(null)} onQueueAdded={showQueueToast} position={menuPosition} />
                  )}
                  <button
                    onClick={() => navigate(`/youtube?q=${encodeURIComponent(`${song.artist} ${song.title}`)}`)}
                    className="p-1.5 text-zinc-500 hover:text-red-400 transition-colors"
                    title="Find on YouTube"
                  >
                    <Youtube size={14} />
                  </button>
                  <button
                    onClick={async () => {
                      const result = await shareSong(song);
                      if (result === 'copied') showShareToast();
                    }}
                    className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                    title="Share song"
                  >
                    <Share2 size={14} />
                  </button>
                </div>
              </div>
              </div>
            );
          })}

          {/* Show more / Show all — library view only, when there are hidden songs */}
          {view === 'all' && !search && visibleCount < filtered.length && (
            <div className="flex items-center justify-center gap-3 pt-6 pb-2">
              <button
                onClick={() => setVisibleCount((c) => c + PAGE)}
                className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-full transition-colors"
              >
                Show more ({Math.min(PAGE, filtered.length - visibleCount)} more)
              </button>
              <button
                onClick={() => setVisibleCount(filtered.length)}
                className="px-5 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm font-medium rounded-full transition-colors"
              >
                Show all ({filtered.length})
              </button>
            </div>
          )}
        </div>
      )}

      {/* Toast — feedback for queue add, share, etc. */}
      {queueToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white text-black text-sm font-medium px-4 py-2 rounded-full shadow-xl z-50 pointer-events-none queue-toast">
          {queueToast}
        </div>
      )}

      {/* Mobile action sheet */}
      {actionSheet && (
        <MobileSongActionSheet
          song={actionSheet}
          onClose={() => setActionSheet(null)}
          onQueueAdded={showQueueToast}
          onShare={async () => {
            const result = await shareSong(actionSheet);
            setActionSheet(null);
            if (result === 'copied') showShareToast();
          }}
          currentPlaylistId={view === 'playlist' ? playlistId : null}
          onRemoveFromPlaylist={currentPlaylist ? () => removeFromPlaylist(currentPlaylist.id, actionSheet.id) : null}
        />
      )}
    </div>
  );
}
