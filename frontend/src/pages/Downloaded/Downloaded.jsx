import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Music, Trash2, WifiOff, HardDrive } from 'lucide-react';
import usePlayerStore from '../../store/playerStore';
import useOfflineStore from '../../store/useOfflineStore';
import { coverUrl } from '../../lib/apiUrl';

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
  const { cachedSongs, removeSong, storageEstimate } = useOfflineStore();
  const playSong = usePlayerStore((s) => s.playSong);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const [confirmId, setConfirmId] = useState(null);

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

      <div className="space-y-0.5">
        {songs.map((song, i) => {
          const isCurrent = currentSong?.id === song.id;
          return (
            <div
              key={song.id}
              onClick={() => play(song, i)}
              className={`group flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors ${isCurrent ? 'bg-zinc-800' : 'hover:bg-zinc-800/60'}`}
            >
              <Cover song={song} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm truncate ${isCurrent ? 'text-green-400' : 'text-white'}`}>
                  {song.title || t('downloaded.unknownTitle')}
                </p>
                <p className="text-xs text-zinc-500 truncate">
                  {song.artist || t('downloaded.unknownArtist')}
                </p>
              </div>
              <span className="text-xs text-zinc-600 tabular-nums shrink-0">{fmtDuration(song.duration)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmId(song.id); }}
                className="p-1.5 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                title={t('downloaded.remove')}
              >
                <Trash2 size={15} />
              </button>
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
    </div>
  );
}
