const { getDb } = require('../db');

function slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '');
}

function generateMixesForUser(userId) {
  const db = getDb();
  const mixes = [];

  // Shared subquery for per-user play counts
  const pcSub = `(SELECT song_id, COUNT(*) as play_count FROM listening_history WHERE user_id = ? GROUP BY song_id)`;

  // ── Your Mix: top songs played in the last 30 days ────────────────────────
  const yourMixSongs = db.prepare(`
    SELECT s.*, COALESCE(pc.play_count, 0) as play_count
    FROM songs s
    JOIN listening_history lh ON s.id = lh.song_id
    LEFT JOIN ${pcSub} pc ON s.id = pc.song_id
    WHERE lh.user_id = ? AND lh.played_at > datetime('now', '-30 days')
    GROUP BY s.id
    ORDER BY COUNT(lh.id) DESC
    LIMIT 30
  `).all(userId, userId);

  if (yourMixSongs.length >= 5) {
    mixes.push({
      id: 'your-mix',
      name: 'Your Mix',
      type: 'your_mix',
      description: 'Songs you\'ve been loving lately',
      songs: yourMixSongs,
    });
  }

  // ── Rediscovery: songs not played in 60+ days (or never) ─────────────────
  const rediscoverySongs = db.prepare(`
    SELECT s.*, 0 as play_count
    FROM songs s
    WHERE s.id NOT IN (
      SELECT DISTINCT song_id FROM listening_history
      WHERE user_id = ? AND played_at > datetime('now', '-60 days')
    )
    ORDER BY RANDOM()
    LIMIT 30
  `).all(userId);

  if (rediscoverySongs.length >= 5) {
    mixes.push({
      id: 'rediscovery',
      name: 'Rediscovery',
      type: 'rediscovery',
      description: 'Songs you haven\'t heard in a while',
      songs: rediscoverySongs,
    });
  }

  // ── Artist Focus: top 3 artists by recent plays ───────────────────────────
  const topArtists = db.prepare(`
    SELECT s.artist, COUNT(lh.id) as play_count
    FROM songs s
    JOIN listening_history lh ON s.id = lh.song_id
    WHERE lh.user_id = ? AND lh.played_at > datetime('now', '-30 days')
      AND s.artist IS NOT NULL AND s.artist != 'Unknown Artist'
    GROUP BY s.artist
    ORDER BY play_count DESC
    LIMIT 3
  `).all(userId);

  for (const { artist } of topArtists) {
    const artistSongs = db.prepare(`
      SELECT s.*, COALESCE(pc.play_count, 0) as play_count
      FROM songs s
      LEFT JOIN ${pcSub} pc ON s.id = pc.song_id
      WHERE s.artist = ?
      ORDER BY COALESCE(pc.play_count, 0) DESC, RANDOM()
      LIMIT 20
    `).all(userId, artist);

    if (artistSongs.length >= 3) {
      mixes.push({
        id: `artist-${slug(artist)}`,
        name: artist,
        type: 'artist_focus',
        description: `Your favourite songs by ${artist}`,
        songs: artistSongs,
      });
    }
  }

  // ── Genre Playlists: genres with 5+ songs ────────────────────────────────
  const genres = db.prepare(`
    SELECT genre, COUNT(*) as count
    FROM songs
    WHERE genre IS NOT NULL AND genre != ''
    GROUP BY genre
    HAVING count >= 5
    ORDER BY count DESC
    LIMIT 10
  `).all();

  for (const { genre, count } of genres) {
    const genreSongs = db.prepare(`
      SELECT s.*, COALESCE(pc.play_count, 0) as play_count
      FROM songs s
      LEFT JOIN ${pcSub} pc ON s.id = pc.song_id
      WHERE s.genre = ?
      ORDER BY RANDOM()
      LIMIT 50
    `).all(userId, genre);

    mixes.push({
      id: `genre-${slug(genre)}`,
      name: genre,
      type: 'genre',
      description: `${count} ${genre} songs`,
      songs: genreSongs,
    });
  }

  return mixes;
}

module.exports = { generateMixesForUser };
