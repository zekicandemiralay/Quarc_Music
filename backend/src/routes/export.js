const express = require('express');
const router = express.Router();
const AdmZip = require('adm-zip');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');

router.use(requireAuth);

function csvField(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function songsToCsv(songs) {
  const header = ['Title', 'Artist', 'Album', 'Genre', 'Year', 'Track', 'Duration (mm:ss)', 'Duration (s)'].join(',');
  const rows = songs.map(s => {
    const total = Math.round(s.duration || 0);
    const mmss = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    return [
      csvField(s.title), csvField(s.artist), csvField(s.album), csvField(s.genre),
      s.year || '', s.track || '', csvField(mmss), total,
    ].join(',');
  });
  return [header, ...rows].join('\r\n');
}

function safeFilename(name) {
  return (name || '').replace(/[^\w\- ]/g, '').trim() || 'playlist';
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
  const map = new Map(db.prepare('SELECT id, title, artist, album, genre, year, track, duration FROM songs').all().map(s => [s.id, s]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

function getLikedSongIds(db, userId) {
  const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(userId, 'liked_songs');
  const ids = row ? JSON.parse(row.data_json) : [];
  return [...ids].reverse(); // newest-first, matching the Liked Songs UI order
}

function getPlaylist(db, userId, playlistId) {
  const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(userId, 'playlists');
  const playlists = row ? JSON.parse(row.data_json) : [];
  return playlists.find(p => p.id === playlistId) || null;
}

router.get('/liked-songs', (req, res) => {
  const db = getDb();
  const songs = getSongsByIds(db, getLikedSongIds(db, req.user.id));
  sendCsv(res, 'Liked Songs.csv', songsToCsv(songs));
});

router.get('/playlist/:id', (req, res) => {
  const db = getDb();
  const playlist = getPlaylist(db, req.user.id, req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' });

  const songs = getSongsByIds(db, playlist.songs);
  sendCsv(res, `${safeFilename(playlist.name)}.csv`, songsToCsv(songs));
});

// Bulk export: one CSV per selected list, bundled into a single ZIP — mirrors
// Exportify's "export everything" behaviour. Body: { items: [{type:'liked'} |
// {type:'playlist', id}, ...] }
router.post('/bulk', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'No lists selected' });

  const db = getDb();
  const zip = new AdmZip();
  const usedNames = new Set();

  function addEntry(baseName, songs) {
    let name = `${safeFilename(baseName)}.csv`;
    let n = 2;
    while (usedNames.has(name)) { name = `${safeFilename(baseName)} (${n++}).csv`; }
    usedNames.add(name);
    zip.addFile(name, Buffer.from('﻿' + songsToCsv(songs), 'utf8'));
  }

  for (const item of items) {
    if (item?.type === 'liked') {
      addEntry('Liked Songs', getSongsByIds(db, getLikedSongIds(db, req.user.id)));
    } else if (item?.type === 'playlist' && item.id) {
      const playlist = getPlaylist(db, req.user.id, item.id);
      if (playlist) addEntry(playlist.name, getSongsByIds(db, playlist.songs));
    }
  }

  if (zip.getEntries().length === 0) return res.status(404).json({ error: 'None of the selected lists were found' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="Quarc Music Export.zip"');
  res.send(zip.toBuffer());
});

module.exports = router;
