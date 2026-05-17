const express = require('express');
const router = express.Router();
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { downloadBySearch, downloadAudio } = require('../services/ytdlp');
const { scanFile } = require('../services/scanner');
const { getDb } = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const MUSIC_DIR = () => process.env.MUSIC_DIR || '/music';

// In-memory job status per user
const importJobs = new Map();

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  function parseRow(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        fields.push(field); field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  }

  const headers = parseRow(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = parseRow(line);
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]));
  });
}

function playlistNameFromFilename(filename) {
  return path.basename(filename, path.extname(filename)).trim() || 'Imported Playlist';
}

function isLikedSongsName(name) {
  const n = name.toLowerCase().replace(/[_\-]/g, ' ').trim();
  return n === 'liked songs' || n === 'liked videos' || n === 'liked from radio';
}

function firstArtist(raw) {
  // Exportify separates multiple artists with ";" — use only the first
  return (raw || '').split(';')[0].trim();
}

function csvToPlaylist(filename, buffer) {
  const rows = parseCsv(buffer.toString('utf8'));
  const tracks = rows
    .map(r => ({
      name: r['Track Name'] || r['Name'] || '',
      artist: firstArtist(r['Artist Name(s)'] || r['Artist'] || ''),
    }))
    .filter(t => t.name);
  const playlistName = playlistNameFromFilename(filename);
  return { playlistName, isLiked: isLikedSongsName(playlistName), tracks };
}

// Accepts: one ZIP, one CSV, or multiple CSVs
function parseUploadedFiles(files) {
  const playlists = [];
  for (const file of files) {
    const name = file.originalname;
    if (name.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(file.buffer);
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory && entry.name.toLowerCase().endsWith('.csv')) {
          playlists.push(csvToPlaylist(entry.name, entry.getData()));
        }
      }
    } else if (name.toLowerCase().endsWith('.csv')) {
      playlists.push(csvToPlaylist(name, file.buffer));
    }
  }
  return playlists.filter(p => p.tracks.length > 0);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Download timed out after 5 minutes')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const UPSERT_SQL = `
  INSERT INTO user_data (user_id, data_key, data_json, updated_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(user_id, data_key)
  DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
`;

async function runImport(userId, playlists) {
  const job = importJobs.get(userId);
  const db = getDb();
  const total = playlists.reduce((s, p) => s + p.tracks.length, 0);
  job.total = total;
  job.done = 0;
  job.errors = [];
  job.control = 'running'; // 'running' | 'paused' | 'cancel_requested'

  // Create regular playlists up front (liked songs go to a separate store)
  const playlistIds = {};
  {
    const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(userId, 'playlists');
    const userPlaylists = row ? JSON.parse(row.data_json) : [];
    for (const pl of playlists) {
      if (pl.isLiked) continue;
      let existing = userPlaylists.find(p => p.name === pl.playlistName);
      if (!existing) {
        existing = { id: uuidv4(), name: pl.playlistName, songs: [] };
        userPlaylists.push(existing);
      }
      playlistIds[pl.playlistName] = existing.id;
    }
    db.prepare(UPSERT_SQL).run(userId, 'playlists', JSON.stringify(userPlaylists));
  }

  outer: for (const playlist of playlists) {
    job.currentPlaylist = playlist.playlistName;
    const playlistId = playlistIds[playlist.playlistName];

    for (const track of playlist.tracks) {
      // Pause: wait until resumed or cancelled
      if (job.control === 'paused') {
        job.status = 'paused';
        job.currentTrack = null;
        while (job.control === 'paused') {
          await new Promise(r => setTimeout(r, 300));
        }
        if (job.control === 'cancel_requested') break outer;
        job.status = 'running';
      }
      if (job.control === 'cancel_requested') break outer;

      const label = track.videoId
        ? track.name
        : (track.artist ? `${track.artist} - ${track.name}` : track.name);
      job.currentTrack = label;

      try {
        let filepath;
        if (track.videoId) {
          filepath = await withTimeout(downloadAudio(track.videoId, MUSIC_DIR(), () => {}), 5 * 60 * 1000);
        } else {
          const query = track.artist ? `${track.artist} - ${track.name}` : track.name;
          filepath = await withTimeout(downloadBySearch(query, MUSIC_DIR(), () => {}), 5 * 60 * 1000);
        }
        if (filepath) {
          const song = await scanFile(filepath);
          if (song) {
            if (playlist.isLiked) {
              // Add to liked songs store
              const likedRow = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(userId, 'liked_songs');
              const liked = likedRow ? JSON.parse(likedRow.data_json) : [];
              if (!liked.includes(song.id)) {
                liked.push(song.id);
                db.prepare(UPSERT_SQL).run(userId, 'liked_songs', JSON.stringify(liked));
              }
            } else {
              // Add to playlist
              const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(userId, 'playlists');
              const userPlaylists = row ? JSON.parse(row.data_json) : [];
              const pl = userPlaylists.find(p => p.id === playlistId);
              if (pl && !pl.songs.includes(song.id)) {
                pl.songs.push(song.id);
                db.prepare(UPSERT_SQL).run(userId, 'playlists', JSON.stringify(userPlaylists));
              }
            }
          }
        }
      } catch (err) {
        job.errors.push({ track: label, error: err.message });
      }

      job.done++;

      // 3s delay between tracks — checks every 200ms so pause/cancel responds quickly
      const delayEnd = Date.now() + 3000;
      while (Date.now() < delayEnd && job.control === 'running') {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  }

  job.status = job.control === 'cancel_requested' ? 'cancelled' : 'done';
  job.currentTrack = null;
  job.currentPlaylist = null;
  job.control = 'idle';
}

// Parse a single Google Takeout playlist JSON buffer
function takeoutJsonToPlaylist(entryName, buffer) {
  try {
    const data = JSON.parse(buffer.toString('utf8'));
    if (!data.playlistItems || !Array.isArray(data.playlistItems)) return null;
    const name = data.snippet?.title || playlistNameFromFilename(entryName);
    const tracks = data.playlistItems
      .filter(item => item.contentDetails?.videoId)
      .map(item => ({
        name: item.snippet?.title || item.contentDetails.videoId,
        videoId: item.contentDetails.videoId,
      }));
    return tracks.length > 0 ? { playlistName: name, isLiked: isLikedSongsName(name), tracks } : null;
  } catch {
    return null;
  }
}

// Accepts: a Google Takeout ZIP, or individual playlist JSON files
function parseYouTubeTakeout(files) {
  const playlists = [];
  for (const file of files) {
    const name = file.originalname;
    if (name.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(file.buffer);
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory && entry.name.toLowerCase().endsWith('.json')) {
          const pl = takeoutJsonToPlaylist(entry.name, entry.getData());
          if (pl) playlists.push(pl);
        }
      }
    } else if (name.toLowerCase().endsWith('.json')) {
      const pl = takeoutJsonToPlaylist(name, file.buffer);
      if (pl) playlists.push(pl);
    }
  }
  return playlists;
}

router.use(requireAuth);

router.post('/spotify', upload.array('files', 50), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const invalid = files.find(f => !f.originalname.toLowerCase().match(/\.(zip|csv)$/));
  if (invalid) return res.status(400).json({ error: 'Only .zip and .csv files are accepted' });

  const existing = importJobs.get(req.user.id);
  if (existing && existing.status === 'running') {
    return res.status(409).json({ error: 'An import is already running' });
  }

  let playlists;
  try {
    playlists = parseUploadedFiles(files);
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse files: ${err.message}` });
  }

  // Exportify exports Liked Songs newest-first; our liked store is oldest-first
  // (the UI reverses for display). Flip tracks so the oldest ends up at index 0.
  for (const pl of playlists) {
    if (pl.isLiked) pl.tracks.reverse();
  }

  if (!playlists.length) {
    return res.status(400).json({ error: 'No tracks found in the uploaded files' });
  }

  const job = {
    status: 'running',
    done: 0,
    total: 0,
    currentTrack: null,
    currentPlaylist: null,
    playlists: playlists.map(p => p.playlistName),
    errors: [],
  };
  importJobs.set(req.user.id, job);

  runImport(req.user.id, playlists).catch(err => {
    const j = importJobs.get(req.user.id);
    if (j) { j.status = 'error'; j.errorMessage = err.message; }
  });

  res.json({
    ok: true,
    playlists: playlists.map(p => ({ name: p.playlistName, tracks: p.tracks.length })),
  });
});

router.post('/youtube', upload.array('files', 50), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const invalid = files.find(f => !f.originalname.toLowerCase().match(/\.(zip|json)$/));
  if (invalid) return res.status(400).json({ error: 'Only .zip and .json files are accepted' });

  const existing = importJobs.get(req.user.id);
  if (existing && existing.status === 'running') {
    return res.status(409).json({ error: 'An import is already running' });
  }

  let playlists;
  try {
    playlists = parseYouTubeTakeout(files);
  } catch (err) {
    return res.status(400).json({ error: `Failed to parse files: ${err.message}` });
  }

  if (!playlists.length) {
    return res.status(400).json({ error: 'No tracks found — make sure this is a Google Takeout YouTube export' });
  }

  const job = {
    status: 'running',
    done: 0,
    total: 0,
    currentTrack: null,
    currentPlaylist: null,
    playlists: playlists.map(p => p.playlistName),
    errors: [],
  };
  importJobs.set(req.user.id, job);

  runImport(req.user.id, playlists).catch(err => {
    const j = importJobs.get(req.user.id);
    if (j) { j.status = 'error'; j.errorMessage = err.message; }
  });

  res.json({
    ok: true,
    playlists: playlists.map(p => ({ name: p.playlistName, tracks: p.tracks.length })),
  });
});

router.post('/pause', (req, res) => {
  const job = importJobs.get(req.user.id);
  if (!job || job.status !== 'running') return res.status(400).json({ error: 'No running import' });
  job.control = 'paused';
  res.json({ ok: true });
});

router.post('/resume', (req, res) => {
  const job = importJobs.get(req.user.id);
  if (!job || job.status !== 'paused') return res.status(400).json({ error: 'Import is not paused' });
  job.control = 'running';
  job.status = 'running';
  res.json({ ok: true });
});

router.post('/cancel', (req, res) => {
  const job = importJobs.get(req.user.id);
  if (!job || (job.status !== 'running' && job.status !== 'paused')) {
    return res.status(400).json({ error: 'No active import to cancel' });
  }
  job.control = 'cancel_requested';
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  const job = importJobs.get(req.user.id);
  res.json(job || null);
});

router.delete('/status', (req, res) => {
  importJobs.delete(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
