const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'music.db');

let db;

function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL UNIQUE,
      title TEXT,
      artist TEXT,
      album TEXT,
      duration REAL,
      track INTEGER,
      year INTEGER,
      has_cover INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      title TEXT,
      status TEXT DEFAULT 'pending',
      progress REAL DEFAULT 0,
      error TEXT,
      song_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrate user_data if it was created with the old encrypted schema
  const cols = database.pragma('table_info(user_data)').map((c) => c.name);
  if (cols.includes('encrypted_blob')) {
    database.exec('DROP TABLE user_data');
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, data_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Add user_id to downloads if missing (migration)
  const dlCols = database.pragma('table_info(downloads)').map((c) => c.name);
  if (!dlCols.includes('user_id')) {
    database.exec('ALTER TABLE downloads ADD COLUMN user_id TEXT');
  }

  // Add genre to songs if missing (migration)
  const songCols = database.pragma('table_info(songs)').map((c) => c.name);
  if (!songCols.includes('genre')) {
    database.exec('ALTER TABLE songs ADD COLUMN genre TEXT');
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS featured_playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#7c3aed',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS featured_playlist_songs (
      playlist_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      PRIMARY KEY (playlist_id, song_id),
      FOREIGN KEY (playlist_id) REFERENCES featured_playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS listening_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      played_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_lh_user_date ON listening_history(user_id, played_at);
    CREATE INDEX IF NOT EXISTS idx_lh_user_song  ON listening_history(user_id, song_id);
  `);

  ensureAdmin(database);
}

function ensureAdmin(database) {
  const existing = database.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
  if (existing.c > 0) return;

  const username = process.env.ADMIN_USERNAME || 'admin';
  let password = process.env.ADMIN_PASSWORD;

  if (!password) {
    password = crypto.randomBytes(12).toString('hex');
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║    Admin account created automatically    ║');
    console.log(`║    Username : ${username.padEnd(26)}║`);
    console.log(`║    Password : ${password.padEnd(26)}║`);
    console.log('║    Save this — it will not show again     ║');
    console.log('╚══════════════════════════════════════════╝\n');
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = bcrypt.hashSync(password, 12);

  database.prepare(
    'INSERT INTO users (id, username, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)'
  ).run(uuidv4(), username, hash, salt, 'admin');
}

module.exports = { getDb, initDb };
