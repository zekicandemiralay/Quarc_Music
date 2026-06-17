import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Music, Flame, Sparkles, Clock, Mic2, Library, ChevronRight, ListMusic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useAuthStore from '../../store/authStore';
import usePlayerStore from '../../store/playerStore';
import useUserDataStore from '../../store/userDataStore';
import useMixStore from '../../store/useMixStore';
import useFeaturedStore from '../../store/useFeaturedStore';

const MIX_STYLES = {
  your_mix:     { icon: Sparkles, bg: 'from-purple-900/60 to-purple-800/30', border: 'border-purple-700/30', iconColor: 'text-purple-400' },
  rediscovery:  { icon: Clock,    bg: 'from-amber-900/60  to-amber-800/30',  border: 'border-amber-700/30',  iconColor: 'text-amber-400'  },
  artist_focus: { icon: Mic2,     bg: 'from-blue-900/60   to-blue-800/30',   border: 'border-blue-700/30',   iconColor: 'text-blue-400'   },
  genre:        { icon: Music,    bg: 'from-green-900/60  to-green-800/30',  border: 'border-green-700/30',  iconColor: 'text-green-400'  },
};

function fmtTime(s) {
  if (!s) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h > 0 && m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return null;
}

function SongCard({ song, queue, queueIndex, onPlay }) {
  const { currentSong, isPlaying } = usePlayerStore();
  const active = currentSong?.id === song.id;

  return (
    <button
      onClick={() => onPlay(song, queue, queueIndex)}
      className={`group flex items-center gap-3 rounded-lg p-2.5 text-left transition-colors w-full ${
        active ? 'bg-zinc-700/60' : 'bg-zinc-800/50 hover:bg-zinc-700/50'
      }`}
    >
      <div className="relative w-11 h-11 bg-zinc-700 rounded shrink-0 overflow-hidden">
        {song.has_cover
          ? <img src={`/api/music/${song.id}/cover`} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-zinc-500"><Music size={14} /></div>}
        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
          active && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}>
          <Play size={14} className="fill-current text-white ml-0.5" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium truncate ${active ? 'text-green-400' : 'text-white'}`}>{song.title}</p>
        <p className="text-xs text-zinc-400 truncate">{song.artist}</p>
      </div>
    </button>
  );
}

function CollectionCard({ playlist }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(`/featured/${playlist.id}`)}
      className="group relative flex flex-col gap-3 p-4 rounded-xl text-left hover:scale-[1.02] transition-transform w-full border"
      style={{
        background: `linear-gradient(135deg, ${playlist.color}33, ${playlist.color}11)`,
        borderColor: playlist.color + '44',
      }}
    >
      <div className="flex items-start justify-between">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: playlist.color + '33', color: playlist.color }}>
          <Music size={16} />
        </div>
        <span className="text-zinc-500 text-xs">{t('home.songs', { n: playlist.songs?.length || 0 })}</span>
      </div>
      <div>
        <p className="text-white font-semibold text-sm">{playlist.name}</p>
        {playlist.description && <p className="text-zinc-400 text-xs mt-0.5 line-clamp-2">{playlist.description}</p>}
      </div>
      <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg">
          <Play size={12} className="fill-current text-black ml-0.5" />
        </div>
      </div>
    </button>
  );
}

function MixCard({ mix }) {
  const navigate = useNavigate();
  const style = MIX_STYLES[mix.type] || MIX_STYLES.genre;
  const Icon = style.icon;

  return (
    <button
      onClick={() => navigate(`/mix/${mix.id}`)}
      className={`group relative flex flex-col gap-3 p-4 rounded-xl bg-gradient-to-br ${style.bg} border ${style.border} text-left hover:scale-[1.02] transition-transform w-full`}
    >
      <div className="flex items-start justify-between">
        <Icon size={22} className={style.iconColor} />
        <span className="text-zinc-500 text-xs">{mix.songs.length} songs</span>
      </div>
      <div>
        <p className="text-white font-semibold text-sm leading-tight">{mix.name}</p>
        <p className="text-zinc-400 text-xs mt-0.5 line-clamp-2">{mix.description}</p>
      </div>
      <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-lg">
          <Play size={12} className="fill-current text-black ml-0.5" />
        </div>
      </div>
    </button>
  );
}

function getRecentPlaylists(playlists) {
  try {
    const recents = JSON.parse(localStorage.getItem('quarc_playlist_recents') || '{}');
    return [...playlists]
      .filter((p) => p.songs?.length > 0 || recents[p.id])
      .sort((a, b) => (recents[b.id] || 0) - (recents[a.id] || 0))
      .slice(0, 6);
  } catch { return playlists.slice(0, 6); }
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const { playSong, shufflePlay } = usePlayerStore();
  const { playlists: userPlaylists } = useUserDataStore();
  const { mixes } = useMixStore();
  const { playlists: featuredPlaylists } = useFeaturedStore();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [allSongs, setAllSongs] = useState([]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    fetch('/api/home', { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    fetch('/api/music')
      .then((r) => r.ok ? r.json() : [])
      .then(setAllSongs)
      .catch(() => {});
  }, []);

  function handleJumpBackIn(song) {
    const lib = allSongs.length ? allSongs : [song];
    const queue = [song, ...lib.filter((s) => s.id !== song.id)];
    playSong(song, queue, 0, 'single', 'Your Library');
  }

  const recentlyPlayed = data?.recentlyPlayed || [];
  const streak = data?.streak || 0;
  const weekTime = fmtTime(data?.weekSeconds);
  const recentPlaylists = getRecentPlaylists(userPlaylists);
  const isEmpty = recentlyPlayed.length === 0 && mixes.length === 0 && featuredPlaylists.length === 0 && recentPlaylists.length === 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">{(() => {
            const h = new Date().getHours();
            const key = h < 12 ? 'home.morningGreeting' : h < 18 ? 'home.afternoonGreeting' : 'home.eveningGreeting';
            return t(key, { username: user?.username || '' });
          })()}</h1>
          {weekTime && <p className="text-zinc-400 text-sm mt-1">{t('home.weekTime', { time: weekTime })}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {streak > 0 && (
            <div className="flex items-center gap-1.5 bg-orange-500/15 border border-orange-500/25 rounded-full px-3 py-1.5">
              <Flame size={14} className="text-orange-400" />
              <span className="text-orange-300 text-sm font-medium">{t('home.dayStreak', { n: streak })}</span>
            </div>
          )}
        </div>
      </div>

      {isEmpty ? (
        /* ── Empty state ─────────────────────────────────────────────────── */
        <div className="text-center py-20">
          <Music size={52} className="mx-auto text-zinc-700 mb-4" />
          <h2 className="text-white text-xl font-semibold mb-2">{t('home.welcomeTitle')}</h2>
          <p className="text-zinc-400 text-sm mb-6 max-w-xs mx-auto">
            {t('home.welcomeText')}
          </p>
          <button
            onClick={() => navigate('/library')}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-full text-sm font-semibold hover:bg-zinc-200 transition-colors"
          >
            <Library size={16} />
            {t('home.goToLibrary')}
          </button>
        </div>
      ) : (
        <>
          {/* ── Your Playlists ───────────────────────────────────────────── */}
          {recentPlaylists.length > 0 && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-white font-bold text-lg">{t('home.yourPlaylists')}</h2>
                {userPlaylists.length > 6 && (
                  <button onClick={() => navigate('/liked')} className="flex items-center gap-1 text-zinc-400 hover:text-white text-sm transition-colors">
                    {t('home.seeAll')} <ChevronRight size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {recentPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => navigate(`/playlist/${pl.id}`)}
                    className="flex items-center gap-3 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg p-2.5 text-left transition-colors group"
                  >
                    <div className="w-10 h-10 bg-zinc-700 rounded flex items-center justify-center shrink-0">
                      <ListMusic size={16} className="text-zinc-400" />
                    </div>
                    <span className="text-white text-sm font-medium truncate">{pl.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ── Jump back in ─────────────────────────────────────────────── */}
          {recentlyPlayed.length > 0 && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-white font-bold text-lg">{t('home.jumpBackIn')}</h2>
                <button
                  onClick={() => shufflePlay(allSongs.length ? allSongs : recentlyPlayed, 'single', 'Your Library')}
                  className="flex items-center gap-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
                >
                  <Play size={13} className="fill-current" />
                  {t('home.playAll')}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {recentlyPlayed.map((song) => (
                  <SongCard
                    key={song.id}
                    song={song}
                    queue={[]}
                    queueIndex={0}
                    onPlay={handleJumpBackIn}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Your Mixes ───────────────────────────────────────────────── */}
          {mixes.length > 0 && (
            <section className="mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-white font-bold text-lg">{t('home.yourMixes')}</h2>
                {mixes.length > 6 && (
                  <button
                    onClick={() => navigate('/library')}
                    className="flex items-center gap-1 text-zinc-400 hover:text-white text-sm transition-colors"
                  >
                    {t('home.seeAll')} <ChevronRight size={14} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {mixes.slice(0, 6).map((mix) => (
                  <MixCard key={mix.id} mix={mix} />
                ))}
              </div>
            </section>
          )}

          {/* ── Collections (admin-curated) ──────────────────────────────── */}
          {featuredPlaylists.length > 0 && (
            <section className="mb-8">
              <h2 className="text-white font-bold text-lg mb-3">{t('home.collectionsTitle')}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {featuredPlaylists.map((pl) => (
                  <CollectionCard key={pl.id} playlist={pl} />
                ))}
              </div>
            </section>
          )}

          {/* ── Prompt for new users with only Rediscovery ───────────────── */}
          {recentlyPlayed.length === 0 && mixes.length > 0 && (
            <div className="bg-zinc-800/40 rounded-xl p-4 mb-6 border border-zinc-700/30">
              <p className="text-white text-sm font-medium mb-1">{t('home.mixesBuilding')}</p>
              <p className="text-zinc-400 text-xs">
                {t('home.mixesBuildingText')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
