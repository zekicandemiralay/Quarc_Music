import usePlayerStore from '../../store/playerStore';
import { Play, Pause, SkipBack, SkipForward, Volume2, Music, Shuffle } from 'lucide-react';

function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
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
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ background: `linear-gradient(to right, white ${pct}%, #3f3f46 ${pct}%)` }}
      className="w-full"
    />
  );
}

function CoverThumb({ song }) {
  return (
    <div className="bg-zinc-800 rounded shrink-0 overflow-hidden w-12 h-12 md:w-14 md:h-14">
      {song?.has_cover ? (
        <img src={`/api/music/${song.id}/cover`} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-zinc-600">
          <Music size={16} />
        </div>
      )}
    </div>
  );
}

export default function Player() {
  const { currentSong, isPlaying, currentTime, duration, volume, shuffle, pause, resume, next, prev, seek, setVolume, toggleShuffle } =
    usePlayerStore();

  const controls = (
    <>
      <button
        onClick={toggleShuffle}
        className={`transition-colors ${shuffle ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
        title={shuffle ? 'Shuffle on' : 'Shuffle off'}
      >
        <Shuffle size={16} />
      </button>
      <button onClick={prev} disabled={!currentSong} className="text-zinc-400 hover:text-white transition-colors disabled:opacity-30">
        <SkipBack size={20} />
      </button>
      <button
        onClick={isPlaying ? pause : resume}
        disabled={!currentSong}
        className="w-9 h-9 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30 shrink-0"
      >
        {isPlaying ? <Pause size={16} className="text-black" /> : <Play size={16} className="text-black ml-0.5" />}
      </button>
      <button onClick={next} disabled={!currentSong} className="text-zinc-400 hover:text-white transition-colors disabled:opacity-30">
        <SkipForward size={20} />
      </button>
    </>
  );

  return (
    <div className="bg-zinc-900 border-t border-zinc-800 shrink-0">
      {/* ── Mobile player ── */}
      <div className="flex md:hidden items-center gap-3 px-3 py-2">
        <CoverThumb song={currentSong} />
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium truncate">{currentSong?.title ?? 'Nothing playing'}</p>
          <p className="text-zinc-400 text-xs truncate">{currentSong?.artist ?? ''}</p>
          {/* Mini seek bar */}
          <div className="mt-1">
            <TrackBar value={currentTime} max={duration} onChange={seek} />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {controls}
        </div>
      </div>

      {/* ── Desktop player ── */}
      <div className="hidden md:flex items-center px-4 py-0 h-24 gap-4">
        {/* Song info */}
        <div className="flex items-center gap-3 w-56 shrink-0 min-w-0">
          <CoverThumb song={currentSong} />
          {currentSong ? (
            <div className="min-w-0">
              <p className="text-white text-sm font-medium truncate">{currentSong.title}</p>
              <p className="text-zinc-400 text-xs truncate">{currentSong.artist}</p>
            </div>
          ) : (
            <p className="text-zinc-600 text-sm">Nothing playing</p>
          )}
        </div>

        {/* Center controls */}
        <div className="flex flex-col items-center flex-1 gap-2">
          <div className="flex items-center gap-6">{controls}</div>
          <div className="flex items-center gap-2 w-full max-w-md">
            <span className="text-zinc-500 text-xs w-10 text-right">{fmt(currentTime)}</span>
            <TrackBar value={currentTime} max={duration} onChange={seek} />
            <span className="text-zinc-500 text-xs w-10">{fmt(duration)}</span>
          </div>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2 w-36 shrink-0">
          <Volume2 size={16} className="text-zinc-400 shrink-0" />
          <TrackBar value={volume} max={1} onChange={setVolume} />
        </div>
      </div>
    </div>
  );
}
