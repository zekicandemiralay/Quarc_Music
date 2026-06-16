const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.post('/play', (req, res) => {
  const { songId, durationSeconds } = req.body;
  if (!songId || !durationSeconds || durationSeconds < 10) return res.json({ ok: true });
  const song = getDb().prepare('SELECT id FROM songs WHERE id = ?').get(songId);
  if (!song) return res.json({ ok: true });
  getDb()
    .prepare('INSERT INTO listening_history (user_id, song_id, duration_seconds) VALUES (?, ?, ?)')
    .run(req.user.id, songId, Math.round(durationSeconds));
  res.json({ ok: true });
});

router.get('/', (req, res) => {
  const db = getDb();
  const uid = req.user.id;

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_plays,
      COUNT(DISTINCT song_id) as unique_songs,
      COALESCE(SUM(duration_seconds), 0) as total_seconds
    FROM listening_history WHERE user_id = ?
  `).get(uid);

  const { downloads_count } = db.prepare(
    'SELECT COUNT(*) as downloads_count FROM downloads WHERE user_id = ?'
  ).get(uid);

  const topSongs = db.prepare(`
    SELECT
      lh.song_id,
      s.title,
      s.artist,
      s.has_cover,
      COUNT(*) as play_count,
      COALESCE(SUM(lh.duration_seconds), 0) as total_seconds
    FROM listening_history lh
    LEFT JOIN songs s ON s.id = lh.song_id
    WHERE lh.user_id = ?
    GROUP BY lh.song_id
    ORDER BY play_count DESC
    LIMIT 15
  `).all(uid);

  const topArtists = db.prepare(`
    SELECT
      COALESCE(s.artist, 'Unknown') as artist,
      COUNT(*) as play_count,
      COALESCE(SUM(lh.duration_seconds), 0) as total_seconds,
      COUNT(DISTINCT lh.song_id) as unique_songs
    FROM listening_history lh
    LEFT JOIN songs s ON s.id = lh.song_id
    WHERE lh.user_id = ?
    GROUP BY COALESCE(s.artist, 'Unknown')
    ORDER BY play_count DESC
    LIMIT 10
  `).all(uid);

  const byDay = db.prepare(`
    SELECT
      DATE(played_at) as day,
      COUNT(*) as plays,
      COALESCE(SUM(duration_seconds), 0) as seconds
    FROM listening_history
    WHERE user_id = ? AND played_at >= datetime('now', '-30 days')
    GROUP BY DATE(played_at)
    ORDER BY day ASC
  `).all(uid);

  const recentlyPlayed = db.prepare(`
    SELECT
      lh.song_id,
      s.title,
      s.artist,
      s.has_cover,
      MAX(lh.played_at) as last_played
    FROM listening_history lh
    LEFT JOIN songs s ON s.id = lh.song_id
    WHERE lh.user_id = ?
    GROUP BY lh.song_id
    ORDER BY last_played DESC
    LIMIT 20
  `).all(uid);

  // Compute consecutive-day listening streak
  const streakDays = db.prepare(`
    SELECT DISTINCT DATE(played_at) as day
    FROM listening_history
    WHERE user_id = ?
    ORDER BY day DESC
  `).all(uid);

  let streak = 0;
  const todayStr = new Date().toISOString().split('T')[0];
  let expected = todayStr;
  for (const { day } of streakDays) {
    if (day === expected) {
      streak++;
      const d = new Date(expected);
      d.setDate(d.getDate() - 1);
      expected = d.toISOString().split('T')[0];
    } else if (streak === 0) {
      // Haven't listened today — check if streak starts from yesterday
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().split('T')[0];
      if (day === yStr) {
        streak++;
        const d = new Date(yStr);
        d.setDate(d.getDate() - 1);
        expected = d.toISOString().split('T')[0];
      } else {
        break;
      }
    } else {
      break;
    }
  }

  res.json({
    totals: { ...totals, downloads_count },
    topSongs,
    topArtists,
    byDay,
    recentlyPlayed,
    streak,
  });
});

// ── Library-wide duration distribution (all users, updates on every scan/download) ──

router.get('/library', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT duration FROM songs WHERE duration IS NOT NULL AND duration > 0').all();

  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
  let totalDuration = 0;
  let minDur = Infinity;
  let maxDur = 0;
  const durations = [];

  for (const { duration } of rows) {
    const secs = Math.floor(duration);
    totalDuration += secs;
    if (secs < minDur) minDur = secs;
    if (secs > maxDur) maxDur = secs;
    durations.push(secs);
    const fd = parseInt(String(secs)[0], 10);
    if (fd >= 1 && fd <= 9) dist[fd]++;
  }

  durations.sort((a, b) => a - b);
  const total = rows.length;
  const medianDuration = total ? durations[Math.floor(total / 2)] : 0;

  const distribution = Object.entries(dist).map(([digit, count]) => ({
    digit: parseInt(digit, 10),
    count,
    pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
  }));

  const shortestSong = total
    ? db.prepare('SELECT title, artist, duration FROM songs WHERE duration IS NOT NULL AND duration > 0 ORDER BY duration ASC LIMIT 1').get()
    : null;
  const longestSong = total
    ? db.prepare('SELECT title, artist, duration FROM songs WHERE duration IS NOT NULL AND duration > 0 ORDER BY duration DESC LIMIT 1').get()
    : null;

  res.json({
    total_songs: total,
    total_duration: totalDuration,
    avg_duration: total > 0 ? Math.round(totalDuration / total) : 0,
    median_duration: medianDuration,
    min_duration: minDur === Infinity ? 0 : minDur,
    max_duration: maxDur,
    distribution,
    shortest_song: shortestSong || null,
    longest_song: longestSong || null,
  });
});

module.exports = router;
