const jwt = require('jsonwebtoken');
const { getDb } = require('../db');

const SECRET = () => process.env.JWT_SECRET || 'insecure-default-change-in-production';

// Accounts live in quarc-auth's database now — nginx sends /api/auth/* there,
// and this app only ever verifies the resulting JWT. But music.db still has
// its own users table, and user_data (playlists, likes) and listening_history
// both carry a FOREIGN KEY to it with foreign_keys = ON.
//
// The rows in that table are the ones the cutover migration copied across.
// Anyone who has registered SINCE exists only in auth.db, so they can log in
// and browse perfectly well, then hit "FOREIGN KEY constraint failed" the
// moment they play a song, like one, or make a playlist — nothing of theirs
// can be saved. Nothing bridged the two databases: the only inserts into this
// table are the first-run admin, an admin creating a user by hand, and this
// app's own register route, which nginx makes unreachable.
//
// So provision the local row from the token itself. The shared id is what the
// foreign keys care about; password_hash and salt are dead weight here (auth
// happens elsewhere) but NOT NULL, hence the explicit placeholder rather than
// an empty string that might read as a usable credential.
const provisioned = new Set(); // one check per user per process, not per request

function ensureLocalUser(user) {
  if (!user?.id || provisioned.has(user.id)) return;
  try {
    getDb().prepare(
      `INSERT INTO users (id, username, password_hash, salt, role)
       VALUES (?, ?, 'managed-by-quarc-auth', 'managed-by-quarc-auth', ?)
       ON CONFLICT(id) DO NOTHING`
    ).run(user.id, user.username || `user-${user.id.slice(0, 8)}`, user.role || 'user');
    provisioned.add(user.id);
  } catch (err) {
    // username is UNIQUE here, so a different account already holding this
    // name blocks the insert — and leaving it at that would mean the user
    // still can't save anything. The name in this table is only for display
    // and admin screens (identity is the shared id), so disambiguating it is
    // harmless and gets the row created.
    try {
      getDb().prepare(
        `INSERT INTO users (id, username, password_hash, salt, role)
         VALUES (?, ?, 'managed-by-quarc-auth', 'managed-by-quarc-auth', ?)
         ON CONFLICT(id) DO NOTHING`
      ).run(user.id, `${user.username || 'user'}-${user.id.slice(0, 6)}`, user.role || 'user');
      provisioned.add(user.id);
      console.warn(`Local user row for "${user.username}" clashed with an existing name; stored as "${user.username}-${user.id.slice(0, 6)}".`);
    } catch (err2) {
      console.error(`Could not provision local user row for ${user.username || user.id}:`, err2.message, '(original:', err.message + ')');
    }
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET());
    ensureLocalUser(req.user);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
