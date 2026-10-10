import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Play, Shuffle, Music, X, UserPlus, Trash2, ListMusic, Search } from 'lucide-react';
import usePlayerStore from '../../store/playerStore';
import useFriendsStore from '../../store/useFriendsStore';
import useSharedPlaylistsStore from '../../store/useSharedPlaylistsStore';
import useAuthStore from '../../store/authStore';
import { coverUrl } from '../../lib/apiUrl';
import useContextMenu from '../../hooks/useContextMenu';
import SongContextMenu from '../../components/ContextMenu/SongContextMenu';
import ArtistLink from '../../components/ArtistLink/ArtistLink';

function fmt(s) {
  if (!s) return '--:--';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function AddSongPanel({ playlistId, currentSongIds, onAdded }) {
  const { t } = useTranslation();
  const { addSong } = useSharedPlaylistsStore();
  const [allSongs, setAllSongs] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/music').then((r) => r.ok ? r.json() : []).then((d) => { if (Array.isArray(d)) setAllSongs(d); }).catch(() => {});
  }, []);

  const filtered = allSongs
    .filter((s) => !currentSongIds.has(s.id))
    .filter((s) => !search || [s.title, s.artist].some((f) => f?.toLowerCase().includes(search.toLowerCase())))
    .slice(0, 20);

  async function handleAdd(songId) {
    await addSong(playlistId, songId);
    onAdded();
  }

  return (
    <div className="bg-zinc-800/80 rounded-xl p-3 space-y-2 mb-4">
      <div className="relative">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          placeholder={t('friends.searchYourLibrary')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-zinc-700 text-white text-sm rounded-lg pl-8 pr-3 py-2 focus:outline-none placeholder-zinc-500"
        />
      </div>
      {filtered.length > 0 && (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {filtered.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-1">
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{s.title}</p>
                <p className="text-zinc-500 text-xs truncate">{s.artist}</p>
              </div>
              <button
                onClick={() => handleAdd(s.id)}
                className="flex items-center gap-1 px-3 py-1.5 bg-zinc-600 hover:bg-zinc-500 text-white rounded-full text-xs transition-colors shrink-0"
              >
                {t('friends.addSong')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddMemberPanel({ playlistId, currentMemberIds, onAdded, onClose }) {
  const { t } = useTranslation();
  const { friends } = useFriendsStore();
  const { addMember } = useSharedPlaylistsStore();
  const eligible = friends.filter((f) => !currentMemberIds.has(f.id));

  async function handleAdd(userId) {
    await addMember(playlistId, userId);
    onAdded();
  }

  return (
    <div className="bg-zinc-800/80 rounded-xl p-3 space-y-1 mb-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-zinc-400 text-xs font-semibold uppercase tracking-wider">{t('friends.addMember')}</p>
        <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={14} /></button>
      </div>
      {eligible.length === 0 ? (
        <p className="text-zinc-600 text-sm py-1">{t('friends.noEligibleFriends')}</p>
      ) : (
        eligible.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-2 py-1.5">
            <span className="text-white text-sm truncate">{f.username}</span>
            <button
              onClick={() => handleAdd(f.id)}
              className="flex items-center gap-1 px-3 py-1 bg-zinc-600 hover:bg-zinc-500 text-white rounded-full text-xs transition-colors shrink-0"
            >
              <UserPlus size={12} />
              {t('friends.add')}
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export default function SharedPlaylist() {
  const { t } = useTranslation();
  const { playlistId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { playSong, shufflePlay, currentSong, isPlaying, addToQueue } = usePlayerStore();
  const { getDetail, removeSong, removeMember, deletePlaylist } = useSharedPlaylistsStore();
  const { menu: ctxMenu, open: openCtxMenu, close: closeCtxMenu } = useContextMenu();
  const [playlist, setPlaylist] = useState(null);
  const [showAddSong, setShowAddSong] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  async function reload() {
    try { setPlaylist(await getDetail(playlistId)); } catch { navigate('/'); }
  }
  useEffect(() => { reload(); }, [playlistId]);
  // Needed for the "Add member" picker — load() here too since this page
  // can be reached directly (bookmark/back button), not only via /friends.
  useEffect(() => { useFriendsStore.getState().load(); }, []);

  if (!playlist) return null;
  const isOwner = playlist.created_by === user?.id;
  const songs = playlist.songs;

  async function handleDelete() {
    await deletePlaylist(playlistId);
    navigate('/');
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center text-violet-400">
            <ListMusic size={20} />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{playlist.name}</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {t('friends.playlistSubtitle', { songs: songs.length, members: playlist.members.map((m) => m.username).join(', ') })}
            </p>
          </div>
        </div>
        {isOwner && (
          <button onClick={() => setDeleteConfirm(true)} className="p-2 text-zinc-500 hover:text-red-400 transition-colors shrink-0" title={t('common.delete')}>
            <Trash2 size={18} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {songs.length > 0 && (
          <>
            <button
              onClick={() => playSong(songs[0], songs, 0, 'playlist', playlist.name)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors"
            >
              <Play size={15} className="fill-current" />
              {t('contextMenu.play')}
            </button>
            <button
              onClick={() => shufflePlay(songs, 'playlist', playlist.name)}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors"
            >
              <Shuffle size={15} />
              {t('library.shuffle')}
            </button>
          </>
        )}
        <button
          onClick={() => setShowAddSong((v) => !v)}
          className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors"
        >
          {t('friends.addSong')}
        </button>
        {isOwner && (
          <button
            onClick={() => setShowAddMember((v) => !v)}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-sm font-medium transition-colors"
          >
            {t('friends.addMember')}
          </button>
        )}
      </div>

      {showAddSong && (
        <AddSongPanel
          playlistId={playlistId}
          currentSongIds={new Set(songs.map((s) => s.id))}
          onAdded={() => { reload(); }}
        />
      )}
      {showAddMember && (
        <AddMemberPanel
          playlistId={playlistId}
          currentMemberIds={new Set(playlist.members.map((m) => m.id))}
          onAdded={() => { reload(); setShowAddMember(false); }}
          onClose={() => setShowAddMember(false)}
        />
      )}

      {songs.length === 0 ? (
        <div className="text-center py-20">
          <Music size={44} className="mx-auto text-zinc-700 mb-3" />
          <p className="text-zinc-400">{t('friends.emptySharedPlaylist')}</p>
        </div>
      ) : (
        <div>
          {songs.map((song, i) => {
            const active = currentSong?.id === song.id;
            return (
              <div
                key={song.id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors group ${active ? 'bg-zinc-700/40' : 'hover:bg-zinc-700/20'}`}
                onClick={() => playSong(song, songs, i, 'playlist', playlist.name)}
                onContextMenu={(e) => openCtxMenu(e, song)}
              >
                <span className="w-5 text-sm text-zinc-500 text-center shrink-0">
                  {active ? <Music size={13} className={isPlaying ? 'text-green-400' : 'text-zinc-500'} /> : i + 1}
                </span>
                <div className="w-10 h-10 bg-zinc-800 rounded shrink-0 overflow-hidden">
                  {song.has_cover
                    ? <img src={coverUrl(song.id)} alt="" loading="lazy" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Music size={14} /></div>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm truncate font-medium ${active ? 'text-green-400' : 'text-white'}`}>{song.title}</p>
                  <ArtistLink artist={song.artist} className="text-xs truncate text-zinc-400 block" />
                </div>
                <span className="text-zinc-500 text-xs shrink-0">{fmt(song.duration)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeSong(playlistId, song.id).then(reload); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-800 rounded-2xl p-6 w-full max-w-sm space-y-4">
            <p className="text-white">{t('friends.deletePlaylistConfirm', { name: playlist.name })}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConfirm(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">{t('common.cancel')}</button>
              <button onClick={handleDelete} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {ctxMenu && (
        <SongContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          song={ctxMenu.data}
          onClose={closeCtxMenu}
          onPlay={() => playSong(ctxMenu.data, songs, songs.indexOf(ctxMenu.data), 'playlist', playlist.name)}
          onAddToQueue={() => addToQueue(ctxMenu.data)}
          onRemoveFromPlaylist={() => removeSong(playlistId, ctxMenu.data.id).then(reload)}
        />
      )}
    </div>
  );
}
