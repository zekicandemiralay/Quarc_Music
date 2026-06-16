'use strict';

const path = require('path');
process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/music.db');

const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { getDb, initDb } = require('../db');
const { searchYoutube } = require('../services/ytdlp');
const { scanFile } = require('../services/scanner');
const { songs } = require('./popular-songs.json');

const MUSIC_DIR = process.env.MUSIC_DIR || '/music';
const DELAY_MS = 3000;

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

        const already = line.match(/\[download\] (.+?) has already been downloaded/);
        if (already) {
          let fp = already[1].trim();
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

function findSongByVideoId(db, videoId) {
  const dl = db.prepare(
    "SELECT song_id FROM downloads WHERE video_id = ? AND status = 'done' AND song_id IS NOT NULL"
  ).get(videoId);
  return dl?.song_id || null;
}

async function processSong(db, query, index, total) {
  log(0, `[${index + 1}/${total}] ${query}`);

  let videoId, videoTitle;
  try {
    const results = await searchYoutube(query, 1);
    if (!results.length) { log(1, '✗ no results'); return false; }
    videoId = results[0].id;
    videoTitle = results[0].title;
    log(1, `→ "${videoTitle}" (${videoId})`);
  } catch (err) {
    log(1, `✗ search error: ${err.message}`);
    return false;
  }

  const existingSongId = findSongByVideoId(db, videoId);
  if (existingSongId) {
    log(1, '✓ already in library — skipped');
    return true;
  }

  log(1, 'downloading...');
  let filepath;
  try {
    filepath = await downloadSongDirect(videoId, MUSIC_DIR);
  } catch (err) {
    log(1, `✗ download failed: ${err.message.slice(0, 120)}`);
    return false;
  }

  if (!filepath) { log(1, '✗ no output file'); return false; }

  const song = await scanFile(filepath).catch(() => null);
  if (!song) { log(1, '✗ scan failed'); return false; }

  db.prepare(
    "INSERT OR IGNORE INTO downloads (id, video_id, title, status, progress, song_id) VALUES (?, ?, ?, 'done', 100, ?)"
  ).run(uuidv4(), videoId, videoTitle, song.id);

  log(1, `✓ saved: ${song.title}`);
  return true;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║     Quarc Music — Downloading Popular Songs      ║');
  console.log(`║     ${String(songs.length + ' songs, no collections').padEnd(44)}║`);
  console.log('╚══════════════════════════════════════════════════╝\n');

  initDb();
  const db = getDb();

  let ok = 0, skip = 0, fail = 0;

  for (let i = 0; i < songs.length; i++) {
    const result = await processSong(db, songs[i].query, i, songs.length);
    if (result) ok++; else fail++;
    if (i < songs.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║  Done!  ✓ ${String(ok).padEnd(4)} downloaded   ✗ ${String(fail).padEnd(4)} failed          ║`);
  console.log('╚══════════════════════════════════════════════════╝\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
