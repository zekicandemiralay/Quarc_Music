import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Shuffle, Music, Trash2, WifiOff, HardDrive, MoreHorizontal, ListOrdered } from 'lucide-react';
import usePlayerStore from '../../store/playerStore';
import useOfflineStore from '../../store/useOfflineStore';
import { coverUrl } from '../../lib/apiUrl';
import ArtistLink from '../../components/ArtistLink/ArtistLink';
import useBackableOverlay from '../../hooks/useBackableOverlay';
import useContextMenu from '../../hooks/useContextMenu';
import { shareSong } from '../../lib/share';
import SongContextMenu from '../../components/ContextMenu/SongContextMenu';
import { MobileSongActionSheet } from '../Library/Library.jsx';

function fmtDuration(s) {
  if (!s) return '--:--';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function fmtBytes(b) {
  if (!b) return '';
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// Cover art comes from the server, which by definition isn't there when this
// page matters most. Fall back to the icon rather than leaving a broken image.
function Cover({ song }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="w-10 h-10 bg-zinc-800 rounded overflow-hidden flex items-center justify-center shrink-0">
      {song.has_cover && !failed
        ? <img src={coverUrl(song.id)} alt="" loading="lazy" className="w-full h-full object-cover" onError={() => setFailed(true)} />
        : <Music size={16} className="text-zinc-600" />}
    </div>
  );
}

export default function Downloaded() {
  const { t } = useTranslation();
  const { cachedSongs, removeSong, storageEstimate, hydrateMeta } = useOfflineStore();
  const playSong = usePlayerStore((s) => s.playSong);
  const shufflePlay = usePlayerStore((s) => s.shufflePlay);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const [confirmId, setConfirmId] = useState(null);

  // Same action surface as a normal playlist row (queue, like, add to
  // playlist, share, find on YouTube) via the exact same shared menus —
  // deliberately NOT the page-level "save offline" toggle a playlist gets,
  // since every song here is, by construction, already offline.
  const [actionSheet, setActionSheet] = useState(null);
  const [queueToast, setQueueToast] = useState(null);
  const queueToastTimer = useRef(null);
  const swipeRef = useRef({ startX: 0, startY: 0, song: null, el: null, isH: false, lastDx: 0 });
  const songListRef = useRef(null);
  const { menu: ctxMenu, open: openCtxMenu, close: closeCtxMenu } = useContextMenu();

  function showToast(msg) {
    clearTimeout(queueToastTimer.current);
    setQueueToast(msg);
    queueToastTimer.current = setTimeout(() => setQueueToast(null), 2000);
  }
  function showQueueToast() { showToast(t('common.addedToQueue')); }
  function showShareToast(result) { showToast(t(result === 'copied' ? 'common.linkCopied' : 'common.copyFailed')); }

  // Android back button/gesture should close the sheet, not leave the page —
  // see Library.jsx's identical use of this for the same overlay.
  useBackableOverlay([{ isOpen: !!actionSheet, onClose: () => setActionSheet(null) }]);

  // Anything downloaded before details were stored with the audio arrives
  // here nameless. Resolve it now rather than relying on whatever the app
  // happened to have cached when it started.
  useEffect(() => { hydrateMeta(); }, [hydrateMeta]);

  // Swipe-right-to-queue — identical gesture to Library.jsx's playlist rows.
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

  // Newest download first — the reason you came to this page is usually the
  // thing you just saved.
  const songs = [...cachedSongs].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  const totalBytes = songs.reduce((sum, s) => sum + (s.bytes || 0), 0);

  // 'playlist' context on purpose: this is a fixed set you play through, and
  // it keeps radio off by default — radio would try to download suggestions,
  // which is precisely what can't happen on the connection this page exists
  // for. See lib/playbackPrefs.js for how the two context groups differ.
  function play(song, index) {
    playSong(song, songs, index, 'playlist', t('nav.downloaded'));
  }

  if (!songs.length) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white mb-1">{t('nav.downloaded')}</h1>
        <p className="text-zinc-500 text-sm mb-10">{t('downloaded.subtitle')}</p>
        <div className="flex flex-col items-center justify-center text-center py-20 text-zinc-500">
          <WifiOff size={40} className="mb-4 text-zinc-700" />
          <p className="text-white font-medium mb-1">{t('downloaded.emptyTitle')}</p>
          <p className="text-sm max-w-sm">{t('downloaded.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">{t('nav.downloaded')}</h1>
          <p className="text-zinc-500 text-sm">{t('downloaded.subtitle')}</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => play(songs[0], 0)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-zinc-200 text-black rounded-full text-sm font-semibold transition-colors"
          >
            <Play size={15} className="fill-current" />
            {t('common.play')}
          </button>
          {songs.length > 1 && (
            <button
              onClick={() => shufflePlay(songs, 'playlist', t('nav.downloaded'))}
              className="flex items-center gap-2 px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors"
            >
              <Shuffle size={15} />
              {t('library.shuffle')}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-4">
        <HardDrive size={13} />
        <span>
          {t('downloaded.count', { n: songs.length })}
          {totalBytes > 0 && ` · ${fmtBytes(totalBytes)}`}
          {storageEstimate?.quota
            ? ` · ${t('downloaded.ofQuota', { total: fmtBytes(storageEstimate.quota) })}`
            : ''}
        </span>
      </div>

      <div className="space-y-0.5" ref={songListRef}>
        {songs.map((song, i) => {
          const isCurrent = currentSong?.id === song.id;
          return (
            <div key={song.id} className="relative overflow-hidden rounded-lg">
              {/* Swipe-right reveal layer — mobile only */}
              <div
                className="absolute inset-0 flex items-center gap-2 px-5 pointer-events-none rounded-lg"
                style={{ background: '#0d2818', opacity: 0 }}
              >
                <ListOrdered size={20} className="text-green-400" />
                <span className="text-sm font-medium text-green-400">{t('library.addToQueue')}</span>
              </div>
              <div
                onClick={() => play(song, i)}
                onContextMenu={(e) => openCtxMenu(e, song)}
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
                className={`group relative flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors ${isCurrent ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
              >
                <Cover song={song} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm truncate ${isCurrent ? 'text-green-400' : 'text-white'}`}>
                    {song.title || t('downloaded.unknownTitle')}
                  </p>
                  <ArtistLink artist={song.artist} fallback={t('downloaded.unknownArtist')} className="text-xs text-zinc-500 truncate inline-block max-w-full" />
                </div>
                <span className="text-xs text-zinc-600 tabular-nums shrink-0">{fmtDuration(song.duration)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setConfirmId(song.id); }}
                  className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                  title={t('downloaded.remove')}
                >
                  <Trash2 size={15} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setActionSheet(song); }}
                  className="p-1.5 text-zinc-600 hover:text-white transition-colors shrink-0"
                  title="More options"
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {confirmId && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setConfirmId(null)}>
          <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-white">{t('downloaded.confirmRemove')}</p>
            <p className="text-zinc-500 text-sm">{t('downloaded.confirmRemoveHint')}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmId(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { removeSong(confirmId); setConfirmId(null); }}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                {t('downloaded.remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Added-to-queue / share feedback */}
      {queueToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-zinc-800 text-white text-sm px-4 py-2 rounded-full shadow-lg z-50">
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
            if (result !== 'shared') showShareToast(result);
          }}
        />
      )}

      {/* Desktop right-click menu */}
      {ctxMenu && (
        <SongContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          song={ctxMenu.data}
          onClose={closeCtxMenu}
          onPlay={() => play(ctxMenu.data, songs.indexOf(ctxMenu.data))}
          onAddToQueue={() => { addToQueue(ctxMenu.data); showQueueToast(); }}
          onToast={showToast}
        />
      )}
    </div>
  );
}
