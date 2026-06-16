/**
 * Seed default music collections.
 *
 * Run inside the backend container:
 *   docker compose exec backend node src/seeds/seed-collections.js
 *
 * Safe to re-run — already-downloaded songs and existing collections are
 * skipped automatically.
 */

'use strict';

const path = require('path');
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/music.db');

const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { getDb, initDb } = require('../db');
const { searchYoutube } = require('../services/ytdlp');
const { scanFile } = require('../services/scanner');
const collections = require('./collections.json');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';
const DELAY_MS = 3000; // pause between downloads — be polite to YouTube

// ── helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(depth, ...args) {
  process.stdout.write('  '.repeat(depth) + args.join(' ') + '\n');
}

function progressBar(pct) {
  const w = 24;
  const filled = Math.round((pct / 100) * w);
  const bar = '█'.repeat(filled) + '░'.repeat(w - filled);
  process.stdout.write(`\r    [${bar}] ${Math.round(pct).toString().padStart(3)}%`);
}

// Custom download that handles the "already downloaded" case by capturing filepath
function downloadSongDirect(videoId, outputDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      `https://www.youtube.com/watch?v=${videoId}`,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--embed-metadata',
      '--embed-thumbnail',
      '--parse-metadata', 'title:%(artist)s - %(title)s',
      '--no-playlist',
      '--newline',
      '-o', `${outputDir}/%(uploader)s - %(title)s.%(ext)s`,
    ]);

    let lastFile = '';
    let errorOut = '';

    proc.stdout.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        const pct = line.match(/\[download\]\s+([\d.]+)%/);
        if (pct) progressBar(parseFloat(pct[1]));

        const dest = line.match(/\[(?:ExtractAudio|download)\] Destination: (.+)/);
        if (dest) lastFile = dest[1].trim();

        // Already downloaded — capture path from the message
        const already = line.match(/\[download\] (.+?) has already been downloaded/);
        if (already) {
          let fp = already[1].trim();
          // yt-dlp reports the original filename; after -x it's .mp3
          fp = fp.replace(/\.[^/.]+$/, '.mp3');
          lastFile = fp;
          progressBar(100);
        }
      }
    });

    proc.stderr.on('data', (c) => { errorOut += c.toString(); });

    proc.on('close', (code) => {
      process.stdout.write('\n');
      if (code !== 0 && !lastFile) reject(new Error(errorOut.slice(0, 300)));
      else resolve(lastFile);
    });

    proc.on('error', reject);
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────

function getOrCreateCollection(db, name, description, color) {
  const existing = db.prepare('SELECT * FROM featured_playlists WHERE name = ?').get(name);
  if (existing) return { ...existing, isNew: false };

  const id = uuidv4();
  db.prepare(
    'INSERT INTO featured_playlists (id, name, description, color) VALUES (?, ?, ?, ?)'
  ).run(id, name, description, color);
  return { id, name, description, color, song_count: 0, isNew: true };
}

function songAlreadyInCollection(db, playlistId, songId) {
  return !!db.prepare(
    'SELECT 1 FROM featured_playlist_songs WHERE playlist_id = ? AND song_id = ?'
  ).get(playlistId, songId);
}

function addToCollection(db, playlistId, songId) {
  if (songAlreadyInCollection(db, playlistId, songId)) return false;
  const { maxPos } = db.prepare(
    'SELECT COALESCE(MAX(position), -1) as maxPos FROM featured_playlist_songs WHERE playlist_id = ?'
  ).get(playlistId);
  db.prepare(
    'INSERT OR IGNORE INTO featured_playlist_songs (playlist_id, song_id, position) VALUES (?, ?, ?)'
  ).run(playlistId, songId, maxPos + 1);
  return true;
}

function findSongByVideoId(db, videoId) {
  // Check downloads table for a completed download with this video ID
  const dl = db.prepare(
    "SELECT song_id FROM downloads WHERE video_id = ? AND status = 'done' AND song_id IS NOT NULL"
  ).get(videoId);
  return dl?.song_id || null;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function processSong(db, query, playlistId, songIndex, total) {
  log(1, `[${songIndex + 1}/${total}] ${query}`);

  // Step 1: search YouTube
  let videoId, videoTitle;
  try {
    const results = await searchYoutube(query, 1);
    if (!results.length) { log(2, '✗ no results'); return false; }
    videoId = results[0].id;
    videoTitle = results[0].title;
    log(2, `→ "${videoTitle}" (${videoId})`);
  } catch (err) {
    log(2, `✗ search error: ${err.message}`);
    return false;
  }

  // Step 2: check if already downloaded
  let songId = findSongByVideoId(db, videoId);
  if (songId) {
    const added = addToCollection(db, playlistId, songId);
    log(2, added ? '✓ already in library → added to collection' : '✓ already in collection');
    return true;
  }

  // Step 3: download
  log(2, 'downloading...');
  let filepath;
  try {
    filepath = await downloadSongDirect(videoId, MUSIC_DIR);
  } catch (err) {
    log(2, `✗ download failed: ${err.message.slice(0, 120)}`);
    return false;
  }

  if (!filepath) {
    log(2, '✗ no output file');
    return false;
  }

  // Step 4: scan and register
  const song = await scanFile(filepath).catch(() => null);
  if (!song) {
    log(2, '✗ scan failed');
    return false;
  }

  // Record in downloads table so re-runs can skip it
  db.prepare(
    "INSERT OR IGNORE INTO downloads (id, video_id, title, status, progress, song_id) VALUES (?, ?, ?, 'done', 100, ?)"
  ).run(uuidv4(), videoId, videoTitle, song.id);

  addToCollection(db, playlistId, song.id);
  log(2, `✓ saved: ${song.title}`);
  return true;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║     Quarc Music — Seeding Default Collections    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  initDb();
  const db = getDb();

  let totalOk = 0;
  let totalSkip = 0;
  let totalFail = 0;

  for (const col of collections.collections) {
    console.log(`\n▶  ${col.name}  (${col.songs.length} songs)`);

    const playlist = getOrCreateCollection(db, col.name, col.description, col.color);
    log(1, playlist.isNew ? 'created collection' : 'collection exists');

    // Count how many songs are already in this collection
    const { existing } = db.prepare(
      'SELECT COUNT(*) as existing FROM featured_playlist_songs WHERE playlist_id = ?'
    ).get(playlist.id);

    log(1, `${existing}/${col.songs.length} songs already present`);

    for (let i = 0; i < col.songs.length; i++) {
      const { query } = col.songs[i];

      // Quick check: is this already in the collection via downloads table?
      // (rough dedup before searching — if song count already matches, skip)
      const ok = await processSong(db, query, playlist.id, i, col.songs.length);
      if (ok) totalOk++;
      else totalFail++;

      // Delay between requests to avoid rate limiting
      if (i < col.songs.length - 1) await sleep(DELAY_MS);
    }

    const { final } = db.prepare(
      'SELECT COUNT(*) as final FROM featured_playlist_songs WHERE playlist_id = ?'
    ).get(playlist.id);
    log(1, `collection now has ${final} songs`);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  Done!  ✓ ${String(totalOk).padEnd(4)} downloaded   ✗ ${String(totalFail).padEnd(4)} failed          ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
