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

module.exports = router;
