import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, Search, RefreshCw, Music, Youtube, Heart, ListPlus, X, Shuffle, Download, WifiOff } from 'lucide-react';
import usePlayerStore from '../../store/playerStore';
import useUserDataStore from '../../store/userDataStore';
import useOfflineStore from '../../store/useOfflineStore';

function OfflineButton({ songs }) {
  const { cachedIds, downloading, cacheSongs, removeSongs } = useOfflineStore();
  if (!songs.length) return null;

  const ids = songs.map((s) => s.id);
  const cachedCount = ids.filter((id) => cachedIds.has(id)).length;
  const activeDownloads = ids.filter((id) => typeof downloading[id] === 'number');
  const isDownloading = activeDownloads.length > 0;
  const allCached = cachedCount === songs.length;

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
      <button
        onClick={() => removeSongs(ids)}
        className="flex items-center gap-2 px-3 py-2 bg-green-900/30 hover:bg-red-900/30 text-green-400 hover:text-red-400 border border-green-800/40 hover:border-red-800/40 rounded-full text-sm font-medium transition-colors shrink-0"
        title="Available offline — click to remove"
      >
        <WifiOff size={15} />
        <span className="hidden sm:inline">Offline</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => cacheSongs(songs)}
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

function AddToPlaylistMenu({ songId, onClose }) {
  const { playlists, addToPlaylist, createPlaylist } = useUserDataStore();
  const [newName, setNewName] = useState('');
  const ref = useRef();

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

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

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-40 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl w-52 py-1 overflow-hidden"
    >
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
  );
}

export default function Library({ view = 'all' }) {
  const { playlistId } = useParams();
  const [songs, setSongs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('quarc_songs') || '[]'); } catch { return []; }
  });
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [search, setSearch] = useState('');
  const [hovered, setHovered] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null); // song ID with open playlist menu
  const { playSong, currentSong, isPlaying, shufflePlay } = usePlayerStore();
  const { cachedIds, downloading } = useOfflineStore();
  const { likedSongs, playlists, toggleLike, removeFromPlaylist } = useUserDataStore();
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/music');
      const data = await res.json();
      setSongs(data);
      try { localStorage.setItem('quarc_songs', JSON.stringify(data)); } catch {}
    } catch {
      // Offline — keep whatever was restored from localStorage
    } finally {
      setLoading(false);
    }
  }

  async function scan() {
    setScanning(true);
    try { await fetch('/api/music/scan', { method: 'POST' }); await load(); }
    finally { setScanning(false); }
  }

  // Resolve which songs to show based on view
  const currentPlaylist = view === 'playlist' ? playlists.find((p) => p.id === playlistId) : null;

  let visibleSongs = songs;
  if (view === 'liked') visibleSongs = songs.filter((s) => likedSongs.includes(s.id));
  if (view === 'playlist' && currentPlaylist) {
    const order = currentPlaylist.songs;
    visibleSongs = order.map((id) => songs.find((s) => s.id === id)).filter(Boolean);
  }

  const filtered = visibleSongs.filter(
    (s) => !search || [s.title, s.artist, s.album].some((f) => f?.toLowerCase().includes(search.toLowerCase()))
  );

  const heading =
    view === 'liked' ? 'Liked Songs' :
    view === 'playlist' ? (currentPlaylist?.name || 'Playlist') :
    'Your Library';

  const subheading =
    view === 'liked' ? `${filtered.length} liked songs` :
    view === 'playlist' ? `${filtered.length} songs` :
    `${songs.length} songs`;

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-start justify-between mb-5 md:mb-6">
        <div className="flex items-center gap-3">
          {view === 'liked' && <Heart size={32} className="text-red-400 fill-current md:text-4xl" />}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{heading}</h1>
            <p className="text-zinc-400 text-sm mt-1">{subheading}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {filtered.length > 0 && (
            <>
              <button
                onClick={() => shufflePlay(filtered)}
                className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors"
              >
                <Shuffle size={15} />
                <span className="hidden sm:inline">Shuffle</span>
              </button>
              <OfflineButton songs={filtered} />
            </>
          )}
          {view === 'all' && (
            <button
              onClick={scan}
              disabled={scanning}
              className="flex items-center gap-2 px-3 md:px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw size={15} className={scanning ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{scanning ? 'Scanning…' : 'Scan Library'}</span>
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
             songs.length === 0 ? 'No music in library yet' : 'No results'}
          </p>
          {search.trim() ? (
            <button
              onClick={() => navigate(`/youtube?q=${encodeURIComponent(search.trim())}`)}
              className="mt-3 inline-flex items-center gap-2 px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-full text-sm font-medium transition-colors"
            >
              <Youtube size={16} />
              Search "{search.trim()}" on YouTube
            </button>
          ) : view === 'all' && songs.length === 0 && (
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
          <div className="hidden md:grid md:grid-cols-[2rem_1fr_1fr_1fr_4rem_5rem] gap-3 px-4 py-2 text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800 mb-1">
            <span>#</span>
            <span>Title</span>
            <span>Artist</span>
            <span>Album</span>
            <span className="text-right">Time</span>
            <span />
          </div>

          {filtered.map((song, i) => {
            const active = currentSong?.id === song.id;
            const liked = likedSongs.includes(song.id);
            const isHov = hovered === song.id;
            return (
              <div
                key={song.id}
                className={`grid grid-cols-[1fr_3rem_3.5rem] md:grid-cols-[2rem_1fr_1fr_1fr_4rem_5rem] gap-2 md:gap-3 px-3 md:px-4 py-3 md:py-2 rounded-md cursor-pointer transition-colors items-center group border-b border-zinc-800/50 md:border-0 last:border-0 ${
                  active ? 'bg-zinc-700/40' : 'hover:bg-zinc-700/20'
                }`}
                onClick={() => playSong(song, filtered, i)}
                onMouseEnter={() => setHovered(song.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {/* Index / play indicator — desktop only */}
                <div className="hidden md:flex items-center justify-center">
                  {isHov || active
                    ? <Play size={13} className={`fill-current ${active && isPlaying ? 'text-green-400' : 'text-white'}`} />
                    : <span className={`text-sm ${active ? 'text-green-400' : 'text-zinc-500'}`}>{i + 1}</span>}
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
                  <div className="min-w-0">
                    <p className={`text-sm truncate ${active ? 'text-green-400' : 'text-white'}`}>{song.title}</p>
                    <p className="text-xs text-zinc-400 truncate md:hidden">{song.artist}</p>
                  </div>
                </div>

                {/* Artist — desktop only */}
                <span className="hidden md:block text-zinc-400 text-sm truncate">{song.artist}</span>

                {/* Album — desktop only */}
                <span className="hidden md:block text-zinc-400 text-sm truncate">{song.album}</span>

                {/* Time */}
                <span className="text-zinc-500 text-xs md:text-sm text-right self-center">{fmt(song.duration)}</span>

                {/* Actions */}
                <div className="flex items-center justify-end gap-0.5 md:gap-1 relative" onClick={(e) => e.stopPropagation()}>
                  {/* Like button — always visible on mobile, hover-only on desktop */}
                  <button
                    onClick={() => toggleLike(song.id)}
                    className={`p-2 md:p-1.5 transition-colors ${liked ? 'text-red-400' : 'text-zinc-500 hover:text-zinc-300 md:opacity-0 md:group-hover:opacity-100'}`}
                    title={liked ? 'Unlike' : 'Like'}
                  >
                    <Heart size={15} className={liked ? 'fill-current' : ''} />
                  </button>

                  {/* Remove from playlist — desktop only */}
                  {view === 'playlist' && currentPlaylist && (
                    <button
                      onClick={() => removeFromPlaylist(currentPlaylist.id, song.id)}
                      className="hidden md:block p-1.5 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove from playlist"
                    >
                      <X size={14} />
                    </button>
                  )}

                  {/* Add to playlist — desktop only */}
                  <div className="relative hidden md:block">
                    <button
                      onClick={() => setMenuOpen(menuOpen === song.id ? null : song.id)}
                      className="p-1.5 text-zinc-600 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100"
                      title="Add to playlist"
                    >
                      <ListPlus size={14} />
                    </button>
                    {menuOpen === song.id && (
                      <AddToPlaylistMenu
                        songId={song.id}
                        onClose={() => setMenuOpen(null)}
                      />
                    )}
                  </div>

                  {/* Find on YouTube — desktop only */}
                  <button
                    className="hidden md:block p-1.5 text-zinc-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    title="Find on YouTube"
                    onClick={() => navigate(`/youtube?q=${encodeURIComponent(`${song.artist} ${song.title}`)}`)}
                  >
                    <Youtube size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
