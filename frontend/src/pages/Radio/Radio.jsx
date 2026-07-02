import { useState, useEffect, useCallback } from 'react';
import { Search, X, Heart, Play, Pause } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useInternetRadioStore from '../../store/useInternetRadioStore';
import useUserDataStore from '../../store/userDataStore';

const RADIO_API = 'https://de1.api.radio-browser.info/json';

const GENRES = [
  { id: '', label: 'All' },
  { id: 'pop', label: 'Pop' },
  { id: 'rock', label: 'Rock' },
  { id: 'jazz', label: 'Jazz' },
  { id: 'classical', label: 'Classical' },
  { id: 'electronic', label: 'Electronic' },
  { id: 'hip-hop', label: 'Hip-Hop' },
  { id: 'dance', label: 'Dance' },
  { id: 'r&b', label: 'R&B' },
  { id: 'soul', label: 'Soul' },
  { id: 'metal', label: 'Metal' },
  { id: 'reggae', label: 'Reggae' },
  { id: 'folk', label: 'Folk' },
  { id: 'country', label: 'Country' },
  { id: 'ambient', label: 'Ambient' },
  { id: 'blues', label: 'Blues' },
  { id: 'talk', label: 'Talk' },
  { id: 'news', label: 'News' },
];

const PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4'];
function stationColor(name) {
  let h = 0;
  for (const c of name || '') h = (h << 5) - h + c.charCodeAt(0);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function EqBars() {
  return (
    <div className="flex items-end gap-[2px] h-4 shrink-0">
      <span className="eq-bar" />
      <span className="eq-bar" />
      <span className="eq-bar" />
    </div>
  );
}

function StationAvatar({ station, large = false }) {
  const [failed, setFailed] = useState(false);
  const color = stationColor(station.name);
  const textSize = large ? 'text-4xl' : 'text-xl';

  if (station.favicon && !failed) {
    return (
      <div className="w-full h-full flex items-center justify-center p-3" style={{ backgroundColor: color + '15' }}>
        <img
          src={station.favicon}
          alt=""
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: color + '20' }}>
      <span className={`${textSize} font-bold`} style={{ color }}>
        {(station.name || '?')[0].toUpperCase()}
      </span>
    </div>
  );
}

function StationCard({ station, isActive, isPlaying, isFavorite, onPlay, onToggleFavorite }) {
  const tags = (station.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 2);

  return (
    <div
      className={`relative group rounded-2xl overflow-hidden transition-all cursor-pointer select-none
        ${isActive ? 'ring-2 ring-pink-500 bg-zinc-800' : 'bg-zinc-800/60 hover:bg-zinc-800 hover:scale-[1.02]'}`}
      onClick={() => onPlay(station)}
    >
      {/* Logo / avatar area */}
      <div className="aspect-square w-full relative overflow-hidden">
        <StationAvatar station={station} large />

        {/* Equalizer when playing */}
        {isActive && isPlaying ? (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <EqBars />
          </div>
        ) : (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors flex items-center justify-center">
            <div className="w-11 h-11 bg-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100 shadow-lg">
              {isActive
                ? <Pause size={18} className="text-black" />
                : <Play size={18} className="text-black ml-0.5" />}
            </div>
          </div>
        )}

        {/* LIVE badge */}
        {isActive && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">
            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </div>
        )}
      </div>

      {/* Station info */}
      <div className="px-3 pb-3 pt-2">
        <p className={`text-sm font-semibold truncate mb-1.5 ${isActive ? 'text-pink-400' : 'text-white'}`}>
          {station.name}
        </p>
        <div className="flex items-center gap-1 flex-wrap">
          {tags.map((tag) => (
            <span key={tag} className="text-[10px] text-zinc-400 bg-zinc-700/60 px-1.5 py-0.5 rounded capitalize">
              {tag}
            </span>
          ))}
          {station.bitrate > 0 && (
            <span className="text-[10px] text-zinc-500 ml-auto">{station.bitrate}k</span>
          )}
        </div>
      </div>

      {/* Favourite button — always visible when fav, shown on hover otherwise */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(station); }}
        className={`absolute top-2 right-2 p-1.5 rounded-full bg-black/50 backdrop-blur-sm transition-all
          ${isFavorite ? 'text-red-400 opacity-100' : 'text-white/60 opacity-0 group-hover:opacity-100 hover:text-white'}`}
      >
        <Heart size={13} className={isFavorite ? 'fill-current' : ''} />
      </button>
    </div>
  );
}

export default function Radio() {
  const { t } = useTranslation();
  const { currentStation, isPlaying, error, play } = useInternetRadioStore();
  const { radioFavorites, toggleRadioFavorite } = useUserDataStore();

  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState('');
  const [genre, setGenre] = useState('');

  const fetchStations = useCallback(async (tag, name) => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams({
        limit: '60',
        order: 'votes',
        reverse: 'true',
        hidebroken: 'true',
      });
      if (tag) params.set('tag', tag);
      if (name) params.set('name', name);

      const res = await fetch(`${RADIO_API}/stations/search?${params}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`Radio Browser API error ${res.status}`);
      const data = await res.json();
      setStations(data.filter((s) => s.url_resolved));
    } catch (e) {
      setFetchError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStations(genre, '');
    setSearch('');
  }, [genre, fetchStations]);

  function handleSearch(e) {
    e.preventDefault();
    fetchStations(genre, search.trim());
  }

  return (
    <div className="min-h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-4 py-3 space-y-3">
        {/* Search bar */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('radio.searchPlaceholder')}
              className="w-full bg-zinc-800 text-white placeholder-zinc-500 rounded-full px-4 py-2 pr-10 text-sm border border-zinc-700 focus:outline-none focus:border-pink-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); fetchStations(genre, ''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-pink-600 hover:bg-pink-500 text-white rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 shrink-0"
          >
            <Search size={14} />
            {t('youtube.search')}
          </button>
        </form>

        {/* Genre chips */}
        <div className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5 -mx-1 px-1">
          {GENRES.map((g) => (
            <button
              key={g.id}
              onClick={() => setGenre(g.id)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors
                ${genre === g.id
                  ? 'bg-pink-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'}`}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Stream error */}
        {error && (
          <div className="text-red-400 text-sm text-center py-2 bg-red-500/10 rounded-xl px-4">
            {error}
          </div>
        )}

        {/* ── Favourites ── */}
        {radioFavorites.length > 0 && (
          <section>
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Heart size={11} className="text-red-400 fill-current" />
              {t('radio.favourites')}
              <span className="text-zinc-600">({radioFavorites.length})</span>
            </p>
            <div className="flex gap-3 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
              {radioFavorites.map((station) => (
                <div key={station.stationuuid} className="w-36 shrink-0">
                  <StationCard
                    station={station}
                    isActive={currentStation?.stationuuid === station.stationuuid}
                    isPlaying={isPlaying}
                    isFavorite
                    onPlay={play}
                    onToggleFavorite={toggleRadioFavorite}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="text-center py-20">
            <div className="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-zinc-500 text-sm">{t('radio.loading')}</p>
          </div>
        )}

        {/* ── Fetch error ── */}
        {fetchError && !loading && (
          <div className="text-center py-20">
            <p className="text-red-400 mb-3">{fetchError}</p>
            <button
              onClick={() => fetchStations(genre, search)}
              className="text-zinc-400 hover:text-white text-sm underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Station grid ── */}
        {!loading && !fetchError && stations.length > 0 && (
          <section>
            <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-3">
              {t('radio.topStations')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {stations.map((station) => (
                <StationCard
                  key={station.stationuuid}
                  station={station}
                  isActive={currentStation?.stationuuid === station.stationuuid}
                  isPlaying={isPlaying}
                  isFavorite={radioFavorites.some((f) => f.stationuuid === station.stationuuid)}
                  onPlay={play}
                  onToggleFavorite={toggleRadioFavorite}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── No results ── */}
        {!loading && !fetchError && stations.length === 0 && (
          <div className="text-center py-20">
            <p className="text-zinc-400">{t('radio.noResults')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
