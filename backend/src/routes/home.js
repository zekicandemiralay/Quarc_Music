const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const uid = req.user.id;

  // Last 8 distinct recently played songs with full song data
  const recentlyPlayed = db.prepare(`
    SELECT s.*
    FROM songs s
    INNER JOIN (
      SELECT song_id, MAX(played_at) as last_played
      FROM listening_history
      WHERE user_id = ?
      GROUP BY song_id
      ORDER BY last_played DESC
      LIMIT 8
    ) recent ON s.id = recent.song_id
    ORDER BY recent.last_played DESC
  `).all(uid);

  // Listening streak
  const streakDays = db.prepare(`
    SELECT DISTINCT DATE(played_at) as day
    FROM listening_history
    WHERE user_id = ?
    ORDER BY day DESC
    LIMIT 60
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

  // This week's listening time
  const weekStats = db.prepare(`
    SELECT COALESCE(SUM(duration_seconds), 0) as seconds
    FROM listening_history
    WHERE user_id = ? AND played_at >= datetime('now', '-7 days')
  `).get(uid);

  res.json({ recentlyPlayed, streak, weekSeconds: weekStats.seconds });
});

module.exports = router;
