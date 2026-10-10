const jwt = require('jsonwebtoken');
const { getDb } = require('../db');

const SECRET = () => process.env.JWT_SECRET || 'insecure-default-change-in-production';
const SECURE_COOKIE = process.env.SECURE_COOKIE === 'true';

// Keep this block identical to Quarc Notes' copy (backend/src/middleware/
// auth.js there) and to any future Quarc app's — see that file's comment
// for why it's a deliberate copy-paste rather than a shared import.
//
// A fixed expiry — even a generous one — always eventually runs out, and it
// runs out identically for everyone the day they happen to not be using the
// app. That's what "it asked again today" was: quarc-auth hands out a token
// good for SESSION_LIFETIME_DAYS from the moment of login, nothing extends
// it, and the clock doesn't care whether you were an active user the whole
// time.
//
// The fix is a SLIDING session: every authenticated request that makes it
// this far has a token quarc-auth already judged valid, so this re-issues a
// fresh one with a full new window — silently, no frontend change needed, on
// Web/Android/Desktop alike since all three just carry the cookie on every
// request. From then on the session effectively never expires AS LONG AS the
// device is used at least once before the old token would have run out. Only
// someone who genuinely stops opening the app for the full window sees a
// login screen again — which is the only boundary that can exist without
// sessions becoming literally eternal (and unrevocable: there's still no
// server-side kill switch, see routes/auth.js in quarc-auth).
//
// Deliberately re-derives its own lifetime from the token being renewed
// (exp - iat) rather than a second hardcoded number in this app: whatever
// quarc-auth is configured to issue is what gets renewed to, so changing
// SESSION_LIFETIME_DAYS in ONE place (quarc-auth's .env) is enough — no
// value to keep in sync across Music, Notes, or any future app.
//
// Renews once a token is past the HALFWAY point of its life, not on every
// request — a token just issued doesn't need renewing, and renewing only
// past the midpoint means at most one extra write per session per roughly
// half the lifetime (with the 365-day default, at most one Set-Cookie every
// ~180 days of continued use), not one on every single API call.
//
// Clamped to 400 days regardless of what SESSION_LIFETIME_DAYS is set to:
// Chrome, Edge, and every Chromium WebView (the Android app, Tauri's
// WebView2 on Windows) cap a cookie's Max-Age at 400 days and silently
// truncate anything past that, so renewing to a longer value than the
// browser will actually keep is not a real extension.
const MAX_COOKIE_DAYS = 400;

function renewIfStale(req, res, user) {
  if (!user.iat || !user.exp) return; // not a token this logic can reason about
  const now = Math.floor(Date.now() / 1000);
  const lifetime = user.exp - user.iat;
  const elapsed = now - user.iat;
  if (lifetime <= 0 || elapsed < lifetime / 2) return;

  const freshLifetimeSecs = Math.min(lifetime, MAX_COOKIE_DAYS * 86400);
  const { iat, exp, ...claims } = user;
  const token = jwt.sign(claims, SECRET(), { expiresIn: freshLifetimeSecs });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: SECURE_COOKIE ? 'none' : 'lax',
    secure: SECURE_COOKIE,
    maxAge: freshLifetimeSecs * 1000,
  });
}

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
    renewIfStale(req, res, req.user);
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

module.exports = { requireAuth, requireAdmin, ensureLocalUser };
