const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.opus', '.aac']);

function walkDir(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
    } else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanFile(filepath) {
  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM songs WHERE filepath = ?').get(filepath);
    if (existing) return existing;

    const meta = await mm.parseFile(filepath, { duration: true, skipCovers: false });
    const { common, format } = meta;
    const hasCover = !!(common.picture && common.picture.length > 0);

    const song = {
      id: existing?.id || uuidv4(),
      filename: path.basename(filepath),
      filepath,
      title: common.title || path.basename(filepath, path.extname(filepath)),
      artist: common.artist || null,
      album: common.album || null,
      duration: format.duration || existing?.duration || 0,
      track: common.track?.no || existing?.track || 0,
      year: common.year || existing?.year || null,
      has_cover: hasCover ? 1 : 0,
      genre: (common.genre && common.genre[0]) || existing?.genre || '',
    };

    // Merge: don't overwrite known-good fields with unknowns
    if (!song.artist && existing?.artist && existing.artist !== 'Unknown Artist') {
      song.artist = existing.artist;
    }
    if (!song.album && existing?.album && existing.album !== 'Unknown Album') {
      song.album = existing.album;
    }
    song.artist = song.artist || 'Unknown Artist';
    song.album = song.album || 'Unknown Album';

    if (!existing) {
      db.prepare(`
        INSERT OR IGNORE INTO songs
          (id, filename, filepath, title, artist, album, duration, track, year, has_cover, genre)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(song.id, song.filename, song.filepath, song.title, song.artist,
             song.album, song.duration, song.track, song.year, song.has_cover, song.genre);
    } else {
      db.prepare(`
        UPDATE songs SET title=?, artist=?, album=?, duration=?, track=?, year=?, has_cover=?, genre=?
        WHERE id=?
      `).run(song.title, song.artist, song.album, song.duration,
             song.track, song.year, song.has_cover, song.genre, song.id);
    }

    return song;
  } catch (err) {
    console.error(`Error scanning ${filepath}:`, err.message);
    return null;
  }
}

async function scanMusicDir(dir) {
  const files = walkDir(dir);
  const db = getDb();

  // Only process files not already in the DB — existing songs are already indexed
  const known = new Set(
    db.prepare('SELECT filepath FROM songs').all().map(r => r.filepath)
  );
  const newFiles = files.filter(f => !known.has(f));

  const CONCURRENCY = 8;
  let count = known.size;
  for (let i = 0; i < newFiles.length; i += CONCURRENCY) {
    const batch = newFiles.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(f => scanFile(f)));
    count += results.filter(Boolean).length;
  }
  return count;
}

module.exports = { scanMusicDir, scanFile };
