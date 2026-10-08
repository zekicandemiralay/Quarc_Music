import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, ListOrdered, ListPlus, ListMusic, Heart, X, Youtube, Share2, Download, WifiOff, ChevronLeft } from 'lucide-react';
import useUserDataStore from '../../store/userDataStore';
import useOfflineStore from '../../store/useOfflineStore';
import { shareSong } from '../../lib/share';
import ContextMenu, { MenuItem, MenuDivider, MenuLabel } from './ContextMenu';

// The right-click equivalent of the mobile long-press action sheet
// (MobileSongActionSheet in Library.jsx) — same actions, popup instead of a
// bottom sheet. Context-specific actions (play, queue, remove-from-X) are
// opt-in via callbacks so each page only wires up what applies to it; the
// rest (like, add to playlist, download, find on YouTube, share) always
// apply to any song and are handled here directly.
export default function SongContextMenu({
  x, y, song, onClose,
  onPlay, onAddToQueue, onRemoveFromPlaylist, onRemoveFromQueue, onRemoveFromCollection,
  onToast,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { likedSongs, toggleLike, playlists, addToPlaylist, createPlaylist } = useUserDataStore();
  const { cachedIds, downloading, cacheSong, removeSong } = useOfflineStore();
  const [view, setView] = useState('main'); // 'main' | 'playlists'
  const [newName, setNewName] = useState('');

  if (!song) return null;
  const liked = likedSongs.includes(song.id);
  const cached = cachedIds.has(song.id);
  const isDownloading = typeof downloading[song.id] === 'number';

  async function handleAddToPlaylist(playlistId) {
    await addToPlaylist(playlistId, song.id);
    onClose();
  }

  async function handleCreatePlaylist() {
    const name = newName.trim();
    if (!name) return;
    const p = await createPlaylist(name);
    if (p) await addToPlaylist(p.id, song.id);
    onClose();
  }

  async function handleShare() {
    const result = await shareSong(song);
    onClose();
    if (result !== 'shared' && onToast) onToast(t(result === 'copied' ? 'common.linkCopied' : 'common.copyFailed'));
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {view === 'playlists' ? (
        <>
          <button
            onClick={() => setView('main')}
            className="w-full flex items-center gap-2 text-left text-sm px-3 py-2 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors"
          >
            <ChevronLeft size={15} className="text-zinc-400 shrink-0" />
            {t('common.back')}
          </button>
          <MenuDivider />
          <MenuLabel>{t('library.addToPlaylist')}</MenuLabel>
          {playlists.length === 0 && <p className="text-zinc-600 text-xs px-3 py-1.5">{t('library.noPlaylistsYet')}</p>}
          <div className="max-h-48 overflow-y-auto">
            {playlists.map((p) => (
              <MenuItem key={p.id} icon={ListMusic} label={p.name} onClick={() => handleAddToPlaylist(p.id)} />
            ))}
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5">
            <input
              autoFocus
              type="text"
              placeholder={t('library.newPlaylistPlaceholder')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePlaylist(); }}
              className="flex-1 bg-zinc-700 text-white text-xs rounded px-2 py-1.5 focus:outline-none placeholder-zinc-500 min-w-0"
            />
            <button onClick={handleCreatePlaylist} className="text-zinc-400 hover:text-white text-xs px-1.5 py-1.5">+</button>
          </div>
        </>
      ) : (
        <>
          {onPlay && <MenuItem icon={Play} label={t('contextMenu.play')} onClick={() => { onPlay(); onClose(); }} />}
          {onAddToQueue && <MenuItem icon={ListOrdered} label={t('library.addToQueue')} onClick={() => { onAddToQueue(); onClose(); }} />}
          <MenuItem icon={ListPlus} label={t('library.addToPlaylist')} onClick={() => setView('playlists')} />
          <MenuItem
            icon={Heart}
            label={liked ? t('library.unlike') : t('library.like')}
            onClick={() => { toggleLike(song.id); onClose(); }}
          />

          {(onRemoveFromPlaylist || onRemoveFromQueue || onRemoveFromCollection) && <MenuDivider />}
          {onRemoveFromPlaylist && (
            <MenuItem icon={X} label={t('library.removeFromPlaylist')} danger onClick={() => { onRemoveFromPlaylist(); onClose(); }} />
          )}
          {onRemoveFromQueue && (
            <MenuItem icon={X} label={t('queue.removeFromQueue')} danger onClick={() => { onRemoveFromQueue(); onClose(); }} />
          )}
          {onRemoveFromCollection && (
            <MenuItem icon={X} label={t('contextMenu.removeFromCollection')} danger onClick={() => { onRemoveFromCollection(); onClose(); }} />
          )}

          <MenuDivider />
          {isDownloading ? (
            <MenuItem icon={Download} label={`${t('contextMenu.download')}… ${downloading[song.id]}%`} disabled />
          ) : cached ? (
            <MenuItem icon={WifiOff} label={t('contextMenu.removeDownload')} onClick={() => { removeSong(song.id); onClose(); }} />
          ) : (
            <MenuItem icon={Download} label={t('contextMenu.download')} onClick={() => { cacheSong(song); onClose(); }} />
          )}

          <MenuDivider />
          <MenuItem
            icon={Youtube}
            label={t('library.findOnYoutubeAction')}
            onClick={() => { navigate(`/youtube?q=${encodeURIComponent(`${song.artist} ${song.title}`)}`); onClose(); }}
          />
          <MenuItem icon={Share2} label={t('library.shareSong')} onClick={handleShare} />
        </>
      )}
    </ContextMenu>
  );
}
