import { useState, useEffect } from 'react';
import { Clock, Music, Download, Flame, TrendingUp, BarChart2, Library } from 'lucide-react';

// Benford's Law expected percentages for first digits 1–9
const BENFORD = [30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];

function fmtTime(s) {
  if (!s) return '0 min';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 bg-zinc-700/80 rounded-lg flex items-center justify-center shrink-0">
        <Icon size={20} className={color} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-white truncate">{value}</p>
        <p className="text-zinc-500 text-sm">{label}</p>
      </div>
    </div>
  );
}

function fmt(s) {
  if (!s) return '0s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
}

function LibraryOverview({ data }) {
  const { total_songs, total_duration, avg_duration, median_duration, distribution, shortest_song, longest_song } = data;
  if (!total_songs) return null;

  const maxCount = Math.max(...distribution.map((d) => d.count), 1);
  const maxBenford = BENFORD[0];

  return (
    <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5 mt-5">
      <div className="flex items-center gap-2 mb-1">
        <Library size={16} className="text-violet-400" />
        <h2 className="text-white font-semibold">Library Duration Distribution</h2>
      </div>
      <p className="text-zinc-500 text-xs mb-5">
        First digit of each song's duration in seconds — {total_songs.toLocaleString()} songs total
      </p>

      {/* Key stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-zinc-700/40 rounded-lg p-3">
          <p className="text-white font-semibold text-lg">{fmtTime(total_duration)}</p>
          <p className="text-zinc-500 text-xs">Total library</p>
        </div>
        <div className="bg-zinc-700/40 rounded-lg p-3">
          <p className="text-white font-semibold text-lg">{fmt(avg_duration)}</p>
          <p className="text-zinc-500 text-xs">Avg song length</p>
        </div>
        <div className="bg-zinc-700/40 rounded-lg p-3">
          <p className="text-white font-semibold text-lg">{fmt(median_duration)}</p>
          <p className="text-zinc-500 text-xs">Median length</p>
        </div>
      </div>

      {/* Shortest / Longest */}
      {(shortest_song || longest_song) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          {shortest_song && (
            <div className="bg-zinc-700/40 rounded-lg p-3">
              <p className="text-zinc-500 text-xs mb-1">Shortest song</p>
              <p className="text-white text-sm font-medium truncate">{shortest_song.title}</p>
              <p className="text-zinc-400 text-xs truncate">{shortest_song.artist} · {fmt(Math.floor(shortest_song.duration))}</p>
            </div>
          )}
          {longest_song && (
            <div className="bg-zinc-700/40 rounded-lg p-3">
              <p className="text-zinc-500 text-xs mb-1">Longest song</p>
              <p className="text-white text-sm font-medium truncate">{longest_song.title}</p>
              <p className="text-zinc-400 text-xs truncate">{longest_song.artist} · {fmt(Math.floor(longest_song.duration))}</p>
            </div>
          )}
        </div>
      )}

      {/* Bar chart */}
      <div className="flex items-end gap-1.5 h-36 px-1">
        {distribution.map(({ digit, count, pct }) => {
          const benfordPct = BENFORD[digit - 1];
          const actualH = count > 0 ? Math.max((count / maxCount) * 100, 3) : 0;
          const benfordH = (benfordPct / maxBenford) * 100;
          return (
            <div key={digit} className="flex-1 flex flex-col items-center group">
              {/* Pct label on hover */}
              <div className="h-5 flex items-end justify-center">
                <span className="text-violet-300 text-[10px] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  {pct}%
                </span>
              </div>
              {/* Bar area */}
              <div className="relative w-full" style={{ height: '100px' }}>
                {/* Benford ghost bar — full column width, subtle */}
                <div
                  className="absolute bottom-0 inset-x-0 rounded-t-sm"
                  style={{ height: `${benfordH}%`, backgroundColor: 'rgba(255,255,255,0.12)' }}
                  title={`Benford expected: ${benfordPct}%`}
                />
                {/* Actual bar — narrower, sits on top */}
                <div
                  className="absolute bottom-0 rounded-t-sm transition-colors bg-violet-500/80 hover:bg-violet-400"
                  style={{ height: `${actualH}%`, left: '20%', right: '20%' }}
                  title={`Digit ${digit}: ${count} songs (${pct}%)`}
                />
              </div>
              <span className="text-zinc-400 text-xs font-semibold mt-1">{digit}</span>
              <span className="text-zinc-600 text-[10px]">{count}</span>
            </div>
          );
        })}
      </div>

      <p className="text-zinc-700 text-[10px] text-center mt-3">
        Purple bars = your library · light bars = Benford's Law expected distribution
      </p>
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [libraryStats, setLibraryStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me/stats')
      .then((r) => r.json())
      .then((data) => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
    fetch('/api/me/stats/library')
      .then((r) => r.json())
      .then(setLibraryStats)
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!stats) return null;

  const { totals, topSongs, topArtists, byDay, recentlyPlayed, streak } = stats;

  const maxDaySeconds = Math.max(...byDay.map((d) => d.seconds), 1);
  const maxArtistPlays = Math.max(...topArtists.map((a) => a.play_count), 1);

  // Fill every day of the last 30 days (so gaps appear as empty bars)
  const dayMap = {};
  byDay.forEach((d) => { dayMap[d.day] = d; });
  const days30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const key = d.toISOString().split('T')[0];
    return dayMap[key] || { day: key, plays: 0, seconds: 0 };
  });

  const isEmpty = totals.total_plays === 0;

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-white">Your Stats</h1>
          <p className="text-zinc-500 text-sm mt-1">Personal listening history — only visible to you</p>
        </div>
        {streak > 0 && (
          <div className="flex items-center gap-2 bg-orange-500/15 border border-orange-500/25 rounded-full px-4 py-2">
            <Flame size={16} className="text-orange-400" />
            <span className="text-orange-300 text-sm font-medium">{streak} day streak</span>
          </div>
        )}
      </div>

      {isEmpty ? (
        <div className="text-center py-24">
          <BarChart2 size={48} className="mx-auto text-zinc-700 mb-4" />
          <p className="text-zinc-400 text-lg">No listening data yet</p>
          <p className="text-zinc-600 text-sm mt-2">Start playing songs and your stats will appear here</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard icon={Clock} label="Listening time" value={fmtTime(totals.total_seconds)} color="text-blue-400" />
            <StatCard icon={Music} label="Total plays" value={totals.total_plays.toLocaleString()} color="text-green-400" />
            <StatCard icon={TrendingUp} label="Unique songs" value={totals.unique_songs.toLocaleString()} color="text-purple-400" />
            <StatCard icon={Download} label="Downloads" value={totals.downloads_count.toLocaleString()} color="text-red-400" />
          </div>

          {/* Activity chart */}
          <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5 mb-6">
            <h2 className="text-white font-semibold mb-4">Activity — last 30 days</h2>
            <div className="flex items-end gap-px h-16">
              {days30.map((d) => (
                <div
                  key={d.day}
                  className="flex-1 bg-white/10 rounded-sm hover:bg-white/25 transition-colors cursor-default"
                  style={{ height: `${d.seconds > 0 ? Math.max((d.seconds / maxDaySeconds) * 100, 6) : 0}%` }}
                  title={d.seconds > 0 ? `${d.day}: ${fmtTime(d.seconds)} (${d.plays} plays)` : d.day}
                />
              ))}
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-zinc-600 text-xs">30 days ago</span>
              <span className="text-zinc-600 text-xs">Today</span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-5 mb-5">
            {/* Top songs */}
            <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5">
              <h2 className="text-white font-semibold mb-4">Top Songs</h2>
              {topSongs.length === 0 ? (
                <p className="text-zinc-500 text-sm">No plays yet</p>
              ) : (
                <div className="space-y-3">
                  {topSongs.map((s, i) => (
                    <div key={s.song_id} className="flex items-center gap-3">
                      <span className="text-zinc-600 text-sm w-4 shrink-0 text-right">{i + 1}</span>
                      <div className="w-9 h-9 bg-zinc-700 rounded shrink-0 overflow-hidden">
                        {s.has_cover
                          ? <img src={`/api/music/${s.song_id}/cover`} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Music size={12} /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{s.title || 'Unknown'}</p>
                        <p className="text-zinc-500 text-xs truncate">{s.artist || 'Unknown'}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-white text-sm font-medium">{s.play_count}×</p>
                        <p className="text-zinc-600 text-xs">{fmtTime(s.total_seconds)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Top artists */}
            <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5">
              <h2 className="text-white font-semibold mb-4">Top Artists</h2>
              {topArtists.length === 0 ? (
                <p className="text-zinc-500 text-sm">No plays yet</p>
              ) : (
                <div className="space-y-4">
                  {topArtists.map((a) => (
                    <div key={a.artist}>
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-white text-sm truncate mr-3">{a.artist}</span>
                        <span className="text-zinc-500 text-xs shrink-0">
                          {a.play_count} plays · {fmtTime(a.total_seconds)}
                        </span>
                      </div>
                      <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-white/35 rounded-full"
                          style={{ width: `${(a.play_count / maxArtistPlays) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recently played */}
          {recentlyPlayed.length > 0 && (
            <div className="bg-zinc-800/60 rounded-xl p-4 md:p-5">
              <h2 className="text-white font-semibold mb-4">Recently Played</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {recentlyPlayed.map((s) => (
                  <div key={s.song_id} className="flex items-center gap-3 py-1.5">
                    <div className="w-9 h-9 bg-zinc-700 rounded shrink-0 overflow-hidden">
                      {s.has_cover
                        ? <img src={`/api/music/${s.song_id}/cover`} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-zinc-600"><Music size={12} /></div>}
                    </div>
                    <div className="min-w-0">
                      <p className="text-white text-sm truncate">{s.title || 'Unknown'}</p>
                      <p className="text-zinc-500 text-xs truncate">{s.artist || 'Unknown'}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Library-wide distribution — always shown as long as there are songs */}
      {libraryStats && <LibraryOverview data={libraryStats} />}
    </div>
  );
}
