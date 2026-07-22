const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');

router.use(requireAuth);

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function songsToCsv(songs) {
  const header = ['Title', 'Artist', 'Album', 'Duration (mm:ss)', 'Duration (s)'].join(',');
  const rows = songs.map(s => {
    const total = Math.round(s.duration || 0);
    const mmss = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    return [csvField(s.title), csvField(s.artist), csvField(s.album), csvField(mmss), total].join(',');
  });
  return [header, ...rows].join('\r\n');
}

// Leading BOM so Excel opens the UTF-8 file correctly instead of mangling accents/Turkish characters
function sendCsv(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);
}

// Looks up songs by id, preserving the input order (not DB order) — that order
// is the original import order, needed to line rows up against a source CSV.
function getSongsByIds(db, ids) {
  if (!ids.length) return [];
  const map = new Map(db.prepare('SELECT id, title, artist, album, duration FROM songs').all().map(s => [s.id, s]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

router.get('/liked-songs', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(req.user.id, 'liked_songs');
  const ids = row ? JSON.parse(row.data_json) : [];
  const songs = getSongsByIds(db, [...ids].reverse()); // newest-first, matching the Liked Songs UI order
  sendCsv(res, 'liked-songs.csv', songsToCsv(songs));
});

router.get('/playlist/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(req.user.id, 'playlists');
  const playlists = row ? JSON.parse(row.data_json) : [];
  const playlist = playlists.find(p => p.id === req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  const songs = getSongsByIds(db, playlist.songs);
  const safeName = playlist.name.replace(/[^\w\- ]/g, '').trim() || 'playlist';
  sendCsv(res, `${safeName}.csv`, songsToCsv(songs));
});

module.exports = router;
