import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search, UserPlus, Check, X, Music, Play, Plus, ListMusic, Users } from 'lucide-react';
import useFriendsStore from '../../store/useFriendsStore';
import useSharedPlaylistsStore from '../../store/useSharedPlaylistsStore';
import usePlayerStore from '../../store/playerStore';
import { coverUrl } from '../../lib/apiUrl';
import ArtistLink from '../../components/ArtistLink/ArtistLink';

const STATUS_LABEL_KEY = {
  friends: 'friends.alreadyFriends',
  pending_outgoing: 'friends.requestSent',
  pending_incoming: 'friends.respondBelow',
};

function timeAgo(t, iso) {
  if (!iso) return '';
  const secs = Math.max(0, (Date.now() - new Date(iso.replace(' ', 'T') + 'Z').getTime()) / 1000);
  if (secs < 60) return t('friends.justNow');
  if (secs < 3600) return t('friends.minutesAgo', { n: Math.floor(secs / 60) });
  if (secs < 86400) return t('friends.hoursAgo', { n: Math.floor(secs / 3600) });
  return t('friends.daysAgo', { n: Math.floor(secs / 86400) });
}

function AddFriendSearch() {
  const { t } = useTranslation();
  const { searchResults, searching, search, sendRequest } = useFriendsStore();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => search(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5 mb-6">
      <h2 className="text-white font-semibold mb-3">{t('friends.addFriend')}</h2>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          placeholder={t('friends.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-zinc-700 text-white placeholder-zinc-500 rounded-full pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
        />
      </div>
      {query.trim().length >= 2 && (
        <div className="mt-3 space-y-1">
          {searching ? (
            <p className="text-zinc-500 text-sm px-1">{t('common.search')}…</p>
          ) : searchResults.length === 0 ? (
            <p className="text-zinc-600 text-sm px-1">{t('friends.noUsersFound')}</p>
          ) : (
            searchResults.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 py-2 px-1">
                <span className="text-white text-sm truncate">{u.username}</span>
                {u.status === 'none' ? (
                  <button
                    onClick={() => sendRequest(u.id, u.username)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-black rounded-full text-xs font-semibold hover:bg-zinc-200 transition-colors shrink-0"
                  >
                    <UserPlus size={13} />
                    {t('friends.add')}
                  </button>
                ) : (
                  <span className="text-zinc-500 text-xs shrink-0">{t(STATUS_LABEL_KEY[u.status])}</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Requests() {
  const { t } = useTranslation();
  const { incomingRequests, outgoingRequests, acceptRequest, declineRequest } = useFriendsStore();
  if (incomingRequests.length === 0 && outgoingRequests.length === 0) return null;

  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5 mb-6">
      <h2 className="text-white font-semibold mb-3">{t('friends.requests')}</h2>
      <div className="space-y-2">
        {incomingRequests.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3">
            <span className="text-white text-sm truncate">{r.username}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => acceptRequest(r.id)} className="p-1.5 bg-green-900/30 hover:bg-green-900/50 text-green-400 rounded-full transition-colors" title={t('friends.accept')}>
                <Check size={15} />
              </button>
              <button onClick={() => declineRequest(r.id)} className="p-1.5 bg-zinc-700 hover:bg-red-900/40 text-zinc-400 hover:text-red-400 rounded-full transition-colors" title={t('friends.decline')}>
                <X size={15} />
              </button>
            </div>
          </div>
        ))}
        {outgoingRequests.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3">
            <span className="text-zinc-400 text-sm truncate">{t('friends.requestedUser', { username: r.username })}</span>
            <button onClick={() => declineRequest(r.id)} className="text-zinc-500 hover:text-red-400 text-xs shrink-0 transition-colors">
              {t('friends.cancel')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { t } = useTranslation();
  const { friends, activity, loadActivity } = useFriendsStore();
  const { playSong } = usePlayerStore();

  useEffect(() => {
    const interval = setInterval(loadActivity, 30000);
    return () => clearInterval(interval);
  }, []);

  if (friends.length === 0) return null;

  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5 mb-6">
      <h2 className="text-white font-semibold mb-3">{t('friends.activity')}</h2>
      <div className="space-y-1">
        {activity.map((a) => {
          const song = a.nowPlaying || a.recentlyPlayed;
          return (
            <div key={a.userId} className="flex items-center gap-3 py-2">
              <div className="w-10 h-10 bg-zinc-700 rounded shrink-0 overflow-hidden flex items-center justify-center">
                {song?.has_cover
                  ? <img src={coverUrl(song.id)} alt="" className="w-full h-full object-cover" />
                  : <Music size={14} className="text-zinc-500" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{a.username}</p>
                {song ? (
                  <p className="text-zinc-400 text-xs truncate flex items-center gap-1.5">
                    {a.nowPlaying && <span className="w-1.5 h-1.5 bg-green-400 rounded-full shrink-0 animate-pulse" />}
                    {song.title} — <ArtistLink artist={song.artist} />
                    {!a.nowPlaying && <span className="text-zinc-600">· {timeAgo(t, song.played_at)}</span>}
                  </p>
                ) : (
                  <p className="text-zinc-600 text-xs">{t('friends.nothingYet')}</p>
                )}
              </div>
              {song && (
                <button
                  onClick={() => playSong(song, [song], 0, 'single', a.username)}
                  className="p-2 text-zinc-500 hover:text-white transition-colors shrink-0"
                  title={t('contextMenu.play')}
                >
                  <Play size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FriendsList() {
  const { t } = useTranslation();
  const { friends, removeFriend } = useFriendsStore();
  if (friends.length === 0) return null;

  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5 mb-6">
      <h2 className="text-white font-semibold mb-3">{t('friends.yourFriends', { n: friends.length })}</h2>
      <div className="space-y-1">
        {friends.map((f) => (
          <div key={f.id} className="flex items-center justify-between gap-3 py-1 group">
            <span className="text-white text-sm truncate">{f.username}</span>
            <button
              onClick={() => removeFriend(f.id)}
              className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 text-xs transition-colors shrink-0"
            >
              {t('friends.unfriend')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SharedPlaylists() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playlists, create } = useSharedPlaylistsStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef(null);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const playlist = await create(trimmed);
    setName('');
    setCreating(false);
    navigate(`/shared-playlist/${playlist.id}`);
  }

  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-semibold">{t('friends.sharedPlaylists')}</h2>
        <button
          onClick={() => { setCreating((v) => !v); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-full text-xs font-medium transition-colors"
        >
          <Plus size={13} />
          {t('friends.newSharedPlaylist')}
        </button>
      </div>
      {creating && (
        <div className="flex items-center gap-2 mb-3">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            placeholder={t('friends.playlistNamePlaceholder')}
            className="flex-1 bg-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none placeholder-zinc-500"
          />
          <button onClick={handleCreate} className="px-3 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors">
            {t('friends.create')}
          </button>
        </div>
      )}
      {playlists.length === 0 ? (
        <p className="text-zinc-600 text-sm">{t('friends.noSharedPlaylists')}</p>
      ) : (
        <div className="space-y-1">
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/shared-playlist/${p.id}`)}
              className="w-full flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-zinc-700/40 transition-colors text-left"
            >
              <div className="w-9 h-9 bg-zinc-700 rounded flex items-center justify-center shrink-0">
                <ListMusic size={15} className="text-zinc-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{p.name}</p>
                <p className="text-zinc-500 text-xs">{t('friends.playlistMeta', { songs: p.song_count, members: p.member_count })}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Friends() {
  const { t } = useTranslation();
  const { loaded, load } = useFriendsStore();
  const loadSharedPlaylists = useSharedPlaylistsStore((s) => s.load);

  useEffect(() => { load(); loadSharedPlaylists(); }, []);

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Users size={28} className="text-violet-400" />
        <h1 className="text-2xl md:text-3xl font-bold text-white">{t('friends.title')}</h1>
      </div>

      <AddFriendSearch />
      <Requests />
      {loaded && (
        <>
          <ActivityFeed />
          <FriendsList />
        </>
      )}
      <SharedPlaylists />
    </div>
  );
}
