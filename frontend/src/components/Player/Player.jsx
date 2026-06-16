import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import usePlayerStore from '../../store/playerStore';
import useUserDataStore from '../../store/userDataStore';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music, Shuffle, ChevronDown, Heart, ListPlus, Radio, ListOrdered, Share2 } from 'lucide-react';
import useRadioStore from '../../store/useRadioStore';
import QueuePanel from './QueuePanel';

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function ScrollingText({ text, className }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const c = containerRef.current;
    const t = textRef.current;
    if (!c || !t) return;
    const d = t.scrollWidth - c.clientWidth;
    setOffset(d > 0 ? d : 0);
  }, [text]);

  const duration = Math.max(5, offset / 14);

  return (
    <div ref={containerRef} className="overflow-hidden min-w-0 flex-1">
      <span
        ref={textRef}
        className={`${className} whitespace-nowrap inline-block`}
        style={offset > 0 ? {
          animation: `marquee-slide ${duration}s linear infinite`,
          '--marquee-offset': `-${offset}px`,
        } : {}}
      >
        {text}
      </span>
    </div>
  );
}

function TrackBar({ value, max, onChange }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <input
      type="range"
      min={0}
      max={max || 0}
      value={value}
      step={0.1}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ '--pct': `${pct}%` }}
      className="w-full"
    />
  );
}

function EqBars({ isPlaying, size = 'sm' }) {
  return (
    <div className={`flex items-end gap-[2px] shrink-0 ${size === 'lg' ? 'h-5' : 'h-3.5'} ${isPlaying ? '' : 'eq-paused'}`}>
      <span className="eq-bar" />
      <span className="eq-bar" />
      <span className="eq-bar" />
    </div>
  );
}

function Cover({ song, className = '' }) {
  return (
    <div className={`bg-zinc-800 overflow-hidden flex items-center justify-center flex-shrink-0 ${className}`}>
      {song?.has_cover
        ? <img src={`/api/music/${song.id}/cover`} alt="" loading="lazy" className="w-full h-full object-cover" />
        : <Music size={24} className="text-zinc-600" />}
    </div>
  );
}

function SongActionsMenu({ songId, song, onClose, upward = false }) {
  const { playlists, addToPlaylist, createPlaylist } = useUserDataStore();
  const { addToQueue } = usePlayerStore();
  const [newName, setNewName] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [onClose]);

  function handleAddToQueue() {
    if (song) { addToQueue(song); onClose(); }
  }

  async function handleAdd(playlistId) { await addToPlaylist(playlistId, songId); onClose(); }
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
      className={`absolute right-0 z-50 bg-zinc-800 border border-zinc-700 rounded-xl shadow-xl w-52 py-1 overflow-hidden ${upward ? 'bottom-full mb-2' : 'top-full mt-2'}`}
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
      {playlists.length === 0 && <p className="text-zinc-600 text-xs px-3 py-1.5">No playlists yet</p>}
      {playlists.map((p) => (
        <button key={p.id} onClick={() => handleAdd(p.id)}
          className="w-full text-left text-zinc-300 hover:text-white hover:bg-zinc-700 text-sm px-3 py-2 transition-colors truncate block">
          {p.name}
        </button>
      ))}
      <div className="border-t border-zinc-700 mt-1 pt-1">
        <div className="flex items-center gap-1 px-2 py-1">
          <input
            type="text" placeholder="New playlist…" value={newName}
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

function NowPlayingExpanded({ onClose, onOpenQueue }) {
  const {
    currentSong, isPlaying, currentTime, duration, shuffle, volume,
    pause, resume, next, prev, seek, toggleShuffle, setVolume,
  } = usePlayerStore();
  const { likedSongs, toggleLike } = useUserDataStore();
  const { radioMode, toggleRadioMode } = useRadioStore();
  const liked = currentSong ? likedSongs.includes(currentSong.id) : false;

  // 0 = off, 1 = shuffle, 2 = smart shuffle (shuffle + radio)
  const shuffleMode = !shuffle ? 0 : !radioMode ? 1 : 2;
  function cycleShuffleMode() {
    if (shuffleMode === 0) {
      if (!shuffle) toggleShuffle();
      if (radioMode) toggleRadioMode();
    } else if (shuffleMode === 1) {
      if (!radioMode) toggleRadioMode();
    } else {
      if (shuffle) toggleShuffle();
      if (radioMode) toggleRadioMode();
    }
  }

  function handleShare() {
    if (!currentSong) return;
    const text = `${currentSong.title}${currentSong.artist ? ` — ${currentSong.artist}` : ''}`;
    if (navigator.share) {
      navigator.share({ title: currentSong.title, text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).catch(() => {});
    }
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const [showMenu, setShowMenu] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const startY = useRef(0);
  const dragging = useRef(false);
  const entered = useRef(false);
  const panelRef = useRef(null);
  const dragYRef = useRef(0);

  const onTouchStart = (e) => {
    if (e.target.tagName === 'INPUT') return;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
    setSnapping(false);
  };
  const onTouchEnd = useCallback(() => {
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

  // Non-passive touchmove so we can preventDefault and stop background scroll
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!dragging.current || e.target.tagName === 'INPUT') return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 0) {
        e.preventDefault();
        dragYRef.current = delta;
        setDragY(delta);
      }
    };
    el.addEventListener('touchmove', handler, { passive: false });
    return () => el.removeEventListener('touchmove', handler);
  }, []);

  const panelStyle = (() => {
    if (dragY > 0) return { zIndex: 200, transform: `translateY(${dragY}px)` };
    if (snapping) return { zIndex: 200, transform: 'translateY(0)', transition: 'transform 0.25s ease-out' };
    if (!entered.current) return { zIndex: 200, animation: 'slideUp 0.3s ease-out forwards' };
    return { zIndex: 200 };
  })();

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 bg-zinc-950 flex flex-col"
      style={panelStyle}
      onAnimationEnd={() => { entered.current = true; }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1 shrink-0">
        <div className="w-10 h-1 rounded-full bg-zinc-700" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
        <button
          onClick={onClose}
          className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
        >
          <ChevronDown size={22} />
        </button>
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Now Playing</p>
        <div className="w-24" />
      </div>

      {/* Album art */}
      <div className="flex-1 flex items-center justify-center px-10 py-4 min-h-0">
        <div className="w-full max-w-xs aspect-square rounded-2xl overflow-hidden shadow-2xl">
          <Cover song={currentSong} className="w-full h-full" />
        </div>
      </div>

      {/* Song info + controls */}
      <div className="px-8 pb-10 pt-2 space-y-5 shrink-0">
        {/* Song title row — like button on the right */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {currentSong && <EqBars isPlaying={isPlaying} size="lg" />}
              <h2 className="text-2xl font-bold text-green-400 truncate">{currentSong?.title ?? 'Nothing playing'}</h2>
            </div>
            <p className="text-zinc-400 text-base truncate">{currentSong?.artist}</p>
            {currentSong?.album && <p className="text-zinc-600 text-sm truncate mt-0.5">{currentSong.album}</p>}
          </div>
          <button
            onClick={() => currentSong && toggleLike(currentSong.id)}
            className={`p-2 mt-0.5 shrink-0 transition-colors ${liked ? 'text-red-400' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            <Heart size={24} className={liked ? 'fill-current' : ''} />
          </button>
        </div>

        {/* Seek bar */}
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            step={0.1}
            onChange={(e) => seek(parseFloat(e.target.value))}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            style={{ '--pct': `${pct}%` }}
            className="w-full track-bar-large"
          />
          <div className="flex justify-between text-xs text-zinc-500">
            <span>{fmt(currentTime)}</span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Volume — desktop only */}
        <div className="hidden md:flex items-center gap-3 max-w-xs mx-auto w-full">
          <button onClick={() => setVolume(volume > 0 ? 0 : 1)} className="text-zinc-500 hover:text-white transition-colors shrink-0">
            {volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            value={volume}
            step={0.01}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            style={{ '--pct': `${volume * 100}%` }}
            className="flex-1 track-bar-slim"
          />
        </div>

        {/* Main controls: SmartShuffle | Prev Play Next | spacer */}
        <div className="flex items-center justify-between">
          <button
            onClick={cycleShuffleMode}
            title={['Shuffle off', 'Shuffle on', 'Smart Shuffle'][shuffleMode]}
            className={`p-2 transition-colors relative ${shuffleMode === 0 ? 'text-zinc-600 hover:text-zinc-400' : 'text-green-400'}`}
          >
            <Shuffle size={22} />
            {shuffleMode === 2 && (
              <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-green-400 text-black text-[8px] font-bold rounded-full flex items-center justify-center leading-none">+</span>
            )}
          </button>
          <button onClick={prev} disabled={!currentSong} className="p-2 text-zinc-300 hover:text-white disabled:opacity-30">
            <SkipBack size={32} className="fill-current" />
          </button>
          <button
            onClick={isPlaying ? pause : resume}
            disabled={!currentSong}
            className="w-16 h-16 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg disabled:opacity-30"
          >
            {isPlaying ? <Pause size={26} className="text-black" /> : <Play size={26} className="text-black ml-1" />}
          </button>
          <button onClick={next} disabled={!currentSong} className="p-2 text-zinc-300 hover:text-white disabled:opacity-30">
            <SkipForward size={32} className="fill-current" />
          </button>
          {/* spacer matches shuffle button width */}
          <div className="w-10" />
        </div>

        {/* Second row: Share | Queue + AddToPlaylist */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleShare}
            disabled={!currentSong}
            className="p-2 text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-30"
            title="Share"
          >
            <Share2 size={20} />
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { onClose(); onOpenQueue(); }}
              className="p-2 text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Queue"
            >
              <ListOrdered size={20} />
            </button>
            <div className="relative">
              <button
                onClick={() => currentSong && setShowMenu((v) => !v)}
                className={`p-2 transition-colors ${showMenu ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                title="Add to playlist"
              >
                <ListPlus size={20} />
              </button>
              {showMenu && currentSong && <SongActionsMenu songId={currentSong.id} song={currentSong} onClose={() => setShowMenu(false)} upward />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Player() {
  const {
    currentSong, isPlaying, currentTime, duration, volume, shuffle,
    pause, resume, next, prev, seek, setVolume, toggleShuffle,
  } = usePlayerStore();
  const { likedSongs, toggleLike } = useUserDataStore();
  const { radioMode, toggleRadioMode } = useRadioStore();
  const liked = currentSong ? likedSongs.includes(currentSong.id) : false;

  const [expanded, setExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  const openExpanded = () => { if (currentSong) setExpanded(true); };
  const closeExpanded = () => setExpanded(false);
  const openQueue = () => setShowQueue(true);
  const closeQueue = () => setShowQueue(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => { if (e.key === 'Escape') closeExpanded(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== ' ') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      if (isPlaying) pause(); else if (currentSong) resume();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isPlaying, currentSong, pause, resume]);

  // Buttons inside the bar stop propagation so they don't open the expanded view.
  // Clicking anywhere else on the bar (empty space) does open it.
  const sp = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <>
      {expanded && createPortal(<NowPlayingExpanded onClose={closeExpanded} onOpenQueue={openQueue} />, document.body)}
      {showQueue && <QueuePanel onClose={closeQueue} />}

      <div
        className={`bg-zinc-900 border-t border-zinc-800 shrink-0 ${currentSong ? 'cursor-pointer' : ''}`}
        onClick={openExpanded}
      >
        {/* Progress line — mobile only; desktop has the full seek bar */}
        <div className="md:hidden h-0.5 bg-zinc-800 w-full">
          {currentSong && duration > 0 && (
            <div
              className="h-full bg-white"
              style={{ width: `${(currentTime / duration) * 100}%`, transition: 'none' }}
            />
          )}
        </div>

        {/* ── Mobile player ── */}
        <div className="flex md:hidden items-center gap-3 px-3 py-3">
          <Cover song={currentSong} className="w-12 h-12 rounded" />
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 min-w-0">
              {currentSong && <EqBars isPlaying={isPlaying} />}
              <ScrollingText
                text={currentSong?.title ?? 'Nothing playing'}
                className={`text-base font-semibold ${currentSong ? 'text-green-400' : 'text-zinc-500'}`}
              />
            </div>
            <p className="text-sm text-zinc-400 truncate">{currentSong?.artist ?? ''}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={sp(() => currentSong && toggleLike(currentSong.id))}
              disabled={!currentSong}
              className={`p-2 transition-colors disabled:opacity-30 ${liked ? 'text-red-400' : 'text-zinc-500 hover:text-white'}`}
            >
              <Heart size={18} className={liked ? 'fill-current' : ''} />
            </button>
            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => currentSong && setShowMenu((v) => !v)}
                disabled={!currentSong}
                className={`p-2 transition-colors disabled:opacity-30 ${showMenu ? 'text-white' : 'text-zinc-500 hover:text-white'}`}
              >
                <ListPlus size={18} />
              </button>
              {showMenu && currentSong && <SongActionsMenu songId={currentSong.id} song={currentSong} onClose={() => setShowMenu(false)} upward />}
            </div>
            <button
              onClick={sp(isPlaying ? pause : resume)}
              disabled={!currentSong}
              className="w-9 h-9 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30"
            >
              {isPlaying ? <Pause size={16} className="text-black" /> : <Play size={16} className="text-black ml-0.5" />}
            </button>
            <button onClick={sp(next)} disabled={!currentSong} className="p-2 text-zinc-400 hover:text-white disabled:opacity-30">
              <SkipForward size={20} />
            </button>
          </div>
        </div>

        {/* ── Desktop player ── */}
        <div className="hidden md:flex items-center px-4 h-24 gap-6">

          {/* Song info + actions — left section */}
          <div className="flex items-center gap-3 min-w-0 w-1/3">
            <Cover song={currentSong} className="w-14 h-14 rounded shrink-0" />
            {currentSong ? (
              <>
                <div className="min-w-0 overflow-hidden flex items-center gap-2 flex-1">
                  <EqBars isPlaying={isPlaying} />
                  <div className="min-w-0 overflow-hidden">
                    <p className="text-green-400 text-base font-semibold truncate">{currentSong.title}</p>
                    <p className="text-zinc-400 text-sm truncate">{currentSong.artist}</p>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={sp(() => toggleLike(currentSong.id))}
                    className={`p-1.5 transition-colors ${liked ? 'text-red-400' : 'text-zinc-600 hover:text-zinc-300'}`}
                  >
                    <Heart size={15} className={liked ? 'fill-current' : ''} />
                  </button>
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setShowMenu((v) => !v)}
                      className={`p-1.5 transition-colors ${showMenu ? 'text-white' : 'text-zinc-600 hover:text-zinc-300'}`}
                    >
                      <ListPlus size={15} />
                    </button>
                    {showMenu && <SongActionsMenu songId={currentSong.id} song={currentSong} onClose={() => setShowMenu(false)} upward />}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-zinc-600 text-sm">Nothing playing</p>
            )}
          </div>

          {/* Center controls + seek */}
          <div className="flex flex-col items-center flex-1 gap-2">
            <div className="flex items-center gap-4">
              <button onClick={sp(toggleShuffle)} className={`p-2 transition-colors ${shuffle ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`} title={shuffle ? 'Shuffle on' : 'Shuffle off'}>
                <Shuffle size={16} />
              </button>
              <button onClick={sp(toggleRadioMode)} title={radioMode ? 'Radio on' : 'Radio off'} className={`p-2 transition-colors ${radioMode ? 'text-green-400' : 'text-zinc-600 hover:text-zinc-400'}`}>
                <Radio size={16} />
              </button>
              <button onClick={sp(prev)} disabled={!currentSong} className="p-2 text-zinc-400 hover:text-white transition-colors disabled:opacity-30">
                <SkipBack size={20} />
              </button>
              <button
                onClick={sp(isPlaying ? pause : resume)}
                disabled={!currentSong}
                className="w-9 h-9 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30 shrink-0"
              >
                {isPlaying ? <Pause size={16} className="text-black" /> : <Play size={16} className="text-black ml-0.5" />}
              </button>
              <button onClick={sp(next)} disabled={!currentSong} className="p-2 text-zinc-400 hover:text-white transition-colors disabled:opacity-30">
                <SkipForward size={20} />
              </button>
            </div>
            <div className="flex items-center gap-2 w-full max-w-md">
              <span className="text-zinc-500 text-xs w-10 text-right">{fmt(currentTime)}</span>
              <TrackBar value={currentTime} max={duration} onChange={seek} />
              <span className="text-zinc-500 text-xs w-10">{fmt(duration)}</span>
            </div>
          </div>

          {/* Volume + Queue */}
          <div className="flex items-center gap-2 w-36 shrink-0">
            <button
              onClick={sp(openQueue)}
              disabled={!currentSong}
              className={`p-2 transition-colors disabled:opacity-30 shrink-0 ${showQueue ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
              title="View queue"
            >
              <ListOrdered size={16} />
            </button>
            <Volume2 size={16} className="text-zinc-400 shrink-0" onClick={(e) => e.stopPropagation()} />
            <TrackBar value={volume} max={1} onChange={setVolume} />
          </div>
        </div>
      </div>
    </>
  );
}
