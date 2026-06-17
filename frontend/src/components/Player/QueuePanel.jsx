import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Music, ChevronUp, ChevronDown, Download, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import usePlayerStore from '../../store/playerStore';
import useRadioStore from '../../store/useRadioStore';

function QueueSongRow({ song, active, isManual, onRemove, onMoveUp, onMoveDown, onPlay }) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center gap-3 py-2 px-2 rounded-lg group transition-colors ${
        active ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/40 cursor-pointer'
      }`}
      onClick={!active && onPlay ? onPlay : undefined}
    >
      <div className="w-10 h-10 shrink-0 rounded overflow-hidden bg-zinc-800 flex items-center justify-center">
        {song.has_cover
          ? <img src={`/api/music/${song.id}/cover`} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <Music size={14} className="text-zinc-600" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${active ? 'text-green-400' : 'text-white'}`}>{song.title}</p>
        <p className="text-xs text-zinc-400 truncate">{song.artist || t('common.unknown')}</p>
      </div>
      {isManual && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {onMoveUp && (
            <button
              onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
              className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors"
              title={t('queue.moveUp')}
            >
              <ChevronUp size={14} />
            </button>
          )}
          {onMoveDown && (
            <button
              onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
              className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors"
              title={t('queue.moveDown')}
            >
              <ChevronDown size={14} />
            </button>
          )}
          {onRemove && (
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="p-1.5 text-zinc-500 hover:text-red-400 rounded transition-colors"
              title={t('queue.removeFromQueue')}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function QueuePanel({ onClose }) {
  const { t } = useTranslation();
  const {
    currentSong, isPlaying, queue, queueIndex,
    manualQueue, playContextLabel,
    removeFromManualQueue, reorderManualQueue, clearManualQueue, playSong,
  } = usePlayerStore();
  const { pendingDownloads } = useRadioStore();

  const upNext = queue.slice(queueIndex + 1);
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

  const onTouchStart = (e) => {
    if (e.target.closest('button') || e.target.tagName === 'INPUT') return;
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

  const contextLabel = playContextLabel || 'Library';
  const isEmpty = !currentSong && manualQueue.length === 0 && upNext.length === 0 && pendingDownloads.length === 0;

  return createPortal(
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
      <div className="flex items-center justify-between px-5 pt-3 pb-4 border-b border-zinc-800 shrink-0">
        <h2 className="text-white font-bold text-lg">{t('queue.title')}</h2>
        <div className="flex items-center gap-4">
          {manualQueue.length > 0 && (
            <button
              onClick={clearManualQueue}
              className="text-zinc-400 hover:text-white text-sm transition-colors"
            >
              {t('queue.clearQueue')}
            </button>
          )}
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto pb-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <Music size={48} className="text-zinc-700 mb-4" />
            <p className="text-zinc-400 text-sm">{t('queue.emptyTitle')}</p>
            <p className="text-zinc-600 text-xs mt-1">{t('queue.emptyHint')}</p>
          </div>
        ) : (
          <>
            {/* Now Playing */}
            {currentSong && (
              <section className="px-4 pt-5 pb-3">
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2 px-2">{t('queue.nowPlaying')}</p>
                <QueueSongRow song={currentSong} active />
              </section>
            )}

            {/* Next in queue — manual items */}
            {manualQueue.length > 0 && (
              <section className="px-4 pb-3 border-t border-zinc-800 pt-4">
                <div className="flex items-center justify-between mb-2 px-2">
                  <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">
                    {t('queue.nextInQueue')}
                    <span className="ml-1.5 text-zinc-600 normal-case font-normal">({manualQueue.length})</span>
                  </p>
                </div>
                {manualQueue.map((song, i) => (
                  <QueueSongRow
                    key={`manual-${i}-${song.id}`}
                    song={song}
                    isManual
                    onRemove={() => removeFromManualQueue(i)}
                    onMoveUp={i > 0 ? () => reorderManualQueue(i, i - 1) : null}
                    onMoveDown={i < manualQueue.length - 1 ? () => reorderManualQueue(i, i + 1) : null}
                    onPlay={() => {
                      const { queue: q, queueIndex: qi, playContext, playContextLabel: pcl } = usePlayerStore.getState();
                      removeFromManualQueue(i);
                      playSong(song, q, qi, playContext, pcl);
                    }}
                  />
                ))}
              </section>
            )}

            {/* Pending radio downloads */}
            {pendingDownloads.length > 0 && (
              <section className="px-4 pb-3 border-t border-zinc-800 pt-4">
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2 px-2">{t('queue.downloadingForRadio')}</p>
                {pendingDownloads.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 py-2 px-2">
                    <div className="w-10 h-10 shrink-0 rounded bg-zinc-800 flex items-center justify-center">
                      <Download size={14} className="text-zinc-500 animate-pulse" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-zinc-300 truncate">{d.title}</p>
                      <p className="text-xs text-zinc-500 truncate">{d.artist}</p>
                      <div className="mt-1.5 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all duration-500"
                          style={{ width: `${d.progress > 0 ? d.progress : 5}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-zinc-500 shrink-0 tabular-nums ml-2">
                      {d.progress > 0 ? `${Math.round(d.progress)}%` : '…'}
                    </span>
                  </div>
                ))}
              </section>
            )}

            {/* Next from source — auto queue */}
            {upNext.length > 0 && (
              <section className="px-4 pb-3 border-t border-zinc-800 pt-4">
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-2 px-2">
                  {t('queue.nextFrom')} <span className="text-zinc-400 normal-case font-medium">{contextLabel}</span>
                  <span className="ml-1.5 text-zinc-600 normal-case font-normal">({upNext.length})</span>
                </p>
                {upNext.slice(0, 100).map((song, i) => (
                  <QueueSongRow
                    key={`auto-${queueIndex + 1 + i}-${song.id}`}
                    song={song}
                    onPlay={() => playSong(song, queue, queueIndex + 1 + i)}
                  />
                ))}
                {upNext.length > 100 && (
                  <p className="text-zinc-600 text-xs px-2 pt-2">{t('queue.moreSongs', { n: upNext.length - 100 })}</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
