import { useState, useEffect } from 'react';
import { Clock, Music, Download, Flame, TrendingUp, BarChart2 } from 'lucide-react';

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

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/me/stats')
      .then((r) => r.json())
      .then((data) => { setStats(data); setLoading(false); })
      .catch(() => setLoading(false));
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
    </div>
  );
}
