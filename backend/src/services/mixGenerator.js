const crypto = require('crypto');
const { getDb } = require('../db');

function slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/, '');
}

// ── Rediscovery tuning ──────────────────────────────────────────────────────
const REDISCOVERY_SIZE = 30;      // songs in the mix
const REDISCOVERY_MIN_DAYS = 15;  // not played for at least this long to qualify

// How strongly a song is favoured, by how long since it was last played.
// Only matters when more than REDISCOVERY_SIZE songs qualify (otherwise they
// all go in): longer gone = more likely to be picked.
//   15–30 days → 1, 30–60 days → 2, 60+ days → 3
function rediscoveryWeight(daysAgo) {
  if (daysAgo >= 60) return 3;
  if (daysAgo >= 30) return 2;
  return 1;
}

// Deterministic uniform number in (0, 1) from a string — so "random" choices
// are the same on every request for the same seed.
function hash01(str) {
  const h = crypto.createHash('sha1').update(str).digest();
  return (h.readUInt32BE(0) + 1) / 4294967297;
}

// A true rediscovery: songs this user has listened to before, whose last play
// was REDISCOVERY_MIN_DAYS or more ago. (A brand-new account has no history,
// so it gets no Rediscovery mix at all — rather than random library songs it
// has never heard, which isn't "re-"discovering anything.)
//
// Stable for a whole day, then renews: the pick is a weighted random sample
// seeded by (user, today's date), and "how long ago" is measured as of the
// START of today (whole calendar days) and ignores today's own plays — so
// listening to a song from the mix doesn't drop it out of the pool and
// reshuffle the rest mid-day.
// Weighted sampling without replacement is Efraimidis–Spirakis: give each
// song key = u^(1/weight) with a seeded u, then take the largest keys.
function pickRediscoverySongs(db, userId) {
  const day = db.prepare(`SELECT date('now') AS day`).get().day; // UTC, same clock as played_at

  const candidates = db.prepare(`
    SELECT lh.song_id AS id,
           julianday(date('now')) - julianday(date(MAX(lh.played_at))) AS days_ago
    FROM listening_history lh
    JOIN songs s ON s.id = lh.song_id
    WHERE lh.user_id = ? AND lh.played_at < datetime('now', 'start of day')
    GROUP BY lh.song_id
    HAVING days_ago >= ?
  `).all(userId, REDISCOVERY_MIN_DAYS);

  const ids = candidates
    .map((c) => ({
      id: c.id,
      key: Math.pow(hash01(`${userId}:${day}:${c.id}`), 1 / rediscoveryWeight(c.days_ago)),
    }))
    .sort((a, b) => b.key - a.key)
    .slice(0, REDISCOVERY_SIZE)
    .map((c) => c.id);

  if (ids.length === 0) return [];

  const rows = db.prepare(`
    SELECT s.*,
           (SELECT COUNT(*) FROM listening_history WHERE user_id = ? AND song_id = s.id) AS play_count
    FROM songs s
    WHERE s.id IN (${ids.map(() => '?').join(',')})
  `).all(userId, ...ids);

  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
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

  // ── Rediscovery: songs YOU played before, but not lately ─────────────────
  const rediscoverySongs = pickRediscoverySongs(db, userId);

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
