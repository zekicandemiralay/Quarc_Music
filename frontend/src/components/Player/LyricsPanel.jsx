import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Music2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import usePlayerStore from '../../store/playerStore';
import { coverUrl } from '../../lib/apiUrl';
import { parseLrc, activeLrcIndex } from '../../lib/lrc';

// In-memory cache so re-opening the panel for a song already viewed this
// session doesn't refetch — the backend itself caches in the DB after the
// first request, this just skips the network round-trip too.
const cache = new Map();

function useLyrics(songId) {
  const [state, setState] = useState(() => cache.get(songId) || { loading: true });

  useEffect(() => {
    if (!songId) return;
    const cached = cache.get(songId);
    if (cached) { setState(cached); return; }

    setState({ loading: true });
    let cancelled = false;
    fetch(`/api/music/${songId}/lyrics`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        const result = { loading: false, ...data };
        cache.set(songId, result);
        setState(result);
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, status: 'error' });
      });
    return () => { cancelled = true; };
  }, [songId]);

  return state;
}

export default function LyricsPanel({ onClose }) {
  const { t } = useTranslation();
  const { currentSong, currentTime, seek } = usePlayerStore();
  const lyrics = useLyrics(currentSong?.id);

  const lines = useMemo(() => parseLrc(lyrics.synced), [lyrics.synced]);
  const activeIndex = useMemo(() => activeLrcIndex(lines, currentTime), [lines, currentTime]);

  const lineRefs = useRef([]);
  useEffect(() => {
    const el = lineRefs.current[activeIndex];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  const panelRef = useRef(null);
  const dragYRef = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const entered = useRef(false);
  const [dragY, setDragY] = useState(0);
  const [snapping, setSnapping] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Deliberately only on the handle+header (see JSX below), not the whole
  // panel — the content is scrollable, and "scroll back up toward the top"
  // is, gesture-wise, indistinguishable from "swipe down to dismiss". With
  // this on the whole panel, every downward swipe inside the lyrics text
  // got treated as a dismiss attempt instead of a scroll. Worst on plain-
  // text/approximate lyrics specifically, since that view has no protected
  // zones at all (synced lyrics at least exclude touches starting directly
  // on a line).
  const onTouchStart = (e) => {
    if (e.target.closest('button')) return;
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

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!dragging.current) return;
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
    if (dragY > 0) return { zIndex: 210, transform: `translateY(${dragY}px)` };
    if (snapping) return { zIndex: 210, transform: 'translateY(0)', transition: 'transform 0.25s ease-out' };
    if (!entered.current) return { zIndex: 210, animation: 'slideUp 0.3s ease-out forwards' };
    return { zIndex: 210 };
  })();

  return createPortal(
    <div
      ref={panelRef}
      className="fixed inset-0 bg-zinc-950 flex flex-col overflow-hidden"
      style={panelStyle}
      onAnimationEnd={() => { entered.current = true; }}
      onTouchEnd={onTouchEnd}
    >
      {/* Blurred cover-art backdrop, matching Spotify's lyrics-view treatment */}
      {currentSong?.has_cover && (
        <div
          className="absolute inset-0 opacity-25 blur-3xl scale-110 pointer-events-none"
          style={{ backgroundImage: `url(${coverUrl(currentSong.id)})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/40 via-zinc-950/80 to-zinc-950 pointer-events-none" />

      {/* Drag handle + header — only zone a dismiss-drag can START from */}
      <div onTouchStart={onTouchStart}>
        <div className="relative flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
        </div>

        <div className="relative flex items-center justify-between px-5 pt-3 pb-4 shrink-0">
        <div className="min-w-0">
          <h2 className="text-white font-bold text-lg">{t('lyrics.title')}</h2>
          {currentSong && (
            <p className="text-zinc-400 text-xs truncate">{currentSong.title} — {currentSong.artist}</p>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white transition-colors shrink-0">
          <X size={20} />
        </button>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-y-auto px-6 pb-24">
        {!currentSong ? (
          <EmptyState icon={<Music2 size={40} className="text-zinc-700 mb-3" />} title={t('lyrics.nothingPlaying')} />
        ) : lyrics.loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
          </div>
        ) : lyrics.status === 'instrumental' ? (
          <EmptyState icon={<Music2 size={40} className="text-zinc-700 mb-3" />} title={t('lyrics.instrumental')} />
        ) : lines.length > 0 ? (
          <div className="max-w-xl mx-auto py-[35vh] space-y-6">
            {lines.map((line, i) => (
              <p
                key={i}
                ref={(el) => (lineRefs.current[i] = el)}
                data-lyric-line
                onClick={() => seek(line.time)}
                className={`cursor-pointer transition-all duration-300 font-bold leading-snug ${
                  i === activeIndex
                    ? 'text-white text-2xl md:text-3xl scale-100'
                    : 'text-zinc-500 hover:text-zinc-300 text-xl md:text-2xl opacity-70'
                }`}
              >
                {line.text || '♪'}
              </p>
            ))}
          </div>
        ) : lyrics.plain ? (
          <div className="max-w-xl mx-auto py-10">
            <p className="text-zinc-300 text-xl font-semibold leading-relaxed whitespace-pre-line">{lyrics.plain}</p>
            <p className="text-zinc-600 text-xs mt-8">
              {lyrics.status === 'approximate' ? t('lyrics.approximate') : t('lyrics.notSynced')}
            </p>
          </div>
        ) : (
          <EmptyState icon={<Music2 size={40} className="text-zinc-700 mb-3" />} title={t('lyrics.notFound')} hint={t('lyrics.notFoundHint')} />
        )}
      </div>
    </div>,
    document.body
  );
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      {icon}
      <p className="text-zinc-400 text-sm">{title}</p>
      {hint && <p className="text-zinc-600 text-xs mt-1">{hint}</p>}
    </div>
  );
}
