const express = require('express');
const router = express.Router();
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const { downloadBySearch } = require('../services/ytdlp');
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
  return { playlistName: playlistNameFromFilename(filename), tracks };
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

async function runImport(userId, playlists) {
  const job = importJobs.get(userId);
  const db = getDb();
  const total = playlists.reduce((s, p) => s + p.tracks.length, 0);
  job.total = total;
  job.done = 0;
  job.errors = [];

  // Create all playlists up front
  const playlistIds = {};
  {
    const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(userId, 'playlists');
    const userPlaylists = row ? JSON.parse(row.data_json) : [];
    for (const pl of playlists) {
      let existing = userPlaylists.find(p => p.name === pl.playlistName);
      if (!existing) {
        existing = { id: uuidv4(), name: pl.playlistName, songs: [] };
        userPlaylists.push(existing);
      }
      playlistIds[pl.playlistName] = existing.id;
    }
    db.prepare(`
      INSERT INTO user_data (user_id, data_key, data_json, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, data_key)
      DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `).run(userId, 'playlists', JSON.stringify(userPlaylists));
  }

  for (const playlist of playlists) {
    job.currentPlaylist = playlist.playlistName;
    const playlistId = playlistIds[playlist.playlistName];

    for (const track of playlist.tracks) {
      const query = track.artist ? `${track.artist} - ${track.name}` : track.name;
      job.currentTrack = query;

      try {
        const filepath = await downloadBySearch(query, MUSIC_DIR(), () => {});
        if (filepath) {
          const song = await scanFile(filepath);
          if (song) {
            const row = db.prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?').get(userId, 'playlists');
            const userPlaylists = row ? JSON.parse(row.data_json) : [];
            const pl = userPlaylists.find(p => p.id === playlistId);
            if (pl && !pl.songs.includes(song.id)) {
              pl.songs.push(song.id);
              db.prepare(`
                INSERT INTO user_data (user_id, data_key, data_json, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(user_id, data_key)
                DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
              `).run(userId, 'playlists', JSON.stringify(userPlaylists));
            }
          }
        }
      } catch (err) {
        job.errors.push({ track: query, error: err.message });
      }

      job.done++;
      await new Promise(r => setTimeout(r, 500));
    }
  }

  job.status = 'done';
  job.currentTrack = null;
  job.currentPlaylist = null;
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

router.get('/status', (req, res) => {
  const job = importJobs.get(req.user.id);
  res.json(job || null);
});

router.delete('/status', (req, res) => {
  importJobs.delete(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
