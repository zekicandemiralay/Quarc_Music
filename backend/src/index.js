const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { initDb } = require('./db');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const musicRoutes = require('./routes/music');
const youtubeRoutes = require('./routes/youtube');
const userDataRoutes = require('./routes/userData');
const statsRoutes = require('./routes/stats');
const mixesRoutes = require('./routes/mixes');
const homeRoutes = require('./routes/home');
const featuredRoutes = require('./routes/featured');
const importRoutes = require('./routes/import');
const radioRoutes = require('./routes/radio');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3001;

// `origin: true` reflects whatever Origin the caller sends and pairs it with
// Allow-Credentials, which is the same as having no cross-origin protection
// at all: any page you visit while Tailscale is up could read your whole
// library, stats and playlists, or delete them. The server's hostname is in
// the public README, so that isn't even a secret worth relying on.
//
// It can't simply be switched off, though — the Android APK bundles its
// frontend locally and calls the server cross-origin with cookies (see
// VITE_API_URL in desktop-release.yml), so credentialed CORS is load-bearing
// for the app most people use. Hence an allowlist wide enough to cover every
// real client rather than an exact string:
//   * no Origin at all — same-origin (the web app through nginx), Tauri
//     desktop, curl, check.sh
//   * localhost on any scheme/port — Capacitor's WebView origin differs by
//     platform and version (https://localhost on Android 6, capacitor://
//     on iOS), and Vite dev runs on :5173
//   * anything on the Tailscale domain — the web app and sibling Quarc apps
//
// A rejected origin is logged with what it was, so if some client turns up
// speaking an origin not listed here, the fix is obvious rather than a
// mystery. CORS_ALLOW_ALL=1 restores the old behaviour without a code change.
const ALLOW_ALL_ORIGINS = process.env.CORS_ALLOW_ALL === '1';
const EXTRA_ORIGINS = (process.env.CORS_EXTRA_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin || ALLOW_ALL_ORIGINS) return true;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  let url;
  try { url = new URL(origin); } catch { return false; }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') return true;
  if (url.hostname.endsWith('.ts.net')) return true;
  return false;
}

app.use(cors({
  credentials: true,
  origin: (origin, cb) => {
    if (originAllowed(origin)) return cb(null, true);
    console.warn(`CORS: refused origin ${origin} — add it to CORS_EXTRA_ORIGINS in .env if this is a real client`);
    cb(null, false);
  },
}));
app.use(express.json());
app.use(cookieParser());

// Minimal request log — method, path, status, response time
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path !== '/api/health') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// Not fatal — this is a self-hosted app and refusing to boot would be worse
// than running — but it must never be quiet. With the default in place anyone
// who knows it (it's in the repo) can mint a valid admin token, and the
// symptom of that is nothing at all.
if (!process.env.JWT_SECRET) {
  console.error('WARNING: JWT_SECRET is not set — using the well-known default from the repo.');
  console.error('         Anyone can forge a login. Set JWT_SECRET in .env (and match it in quarc-auth).');
}

initDb();

// Public
app.use('/api/auth', authRoutes);
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// Protected
app.use('/api/music', musicRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/me/data', userDataRoutes);
app.use('/api/me/stats', statsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/mixes', mixesRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/featured', featuredRoutes);
app.use('/api/import', importRoutes);
app.use('/api/radio', radioRoutes);
app.use('/api/export', exportRoutes);

// Anything a route throws, or hands to next(err), lands here instead of
// Express's default HTML error page (which leaks a stack trace to the
// client). Must be declared after the routes and take four arguments —
// that arity is how Express recognises it as an error handler.
app.use((err, req, res, _next) => {
  console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
  if (res.headersSent) return; // mid-stream: nothing useful left to say
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Last line of defence. asyncRoute() covers the handlers we know are async,
// but a future one added without it would otherwise take the whole server
// down for every user over a single bad request. A logged, hung request is a
// far better failure than a dead process, so this deliberately does NOT
// exit — the loud log is what gets it noticed and fixed properly.
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION — a request likely hung. This is a bug; wrap the handler in asyncRoute():', reason);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Music directory: ${process.env.MUSIC_DIR || '/music'}`);
});
