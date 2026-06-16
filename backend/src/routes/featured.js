const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', (req, res) => {
  const db = getDb();
  const playlists = db.prepare(
    'SELECT * FROM featured_playlists ORDER BY sort_order, name'
  ).all();

  const result = playlists.map((pl) => {
    const songs = db.prepare(`
      SELECT s.*
      FROM songs s
      JOIN featured_playlist_songs fps ON s.id = fps.song_id
      WHERE fps.playlist_id = ?
      ORDER BY fps.position
    `).all(pl.id);
    return { ...pl, songs };
  });

  res.json(result);
});

module.exports = router;
