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

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Music directory: ${process.env.MUSIC_DIR || '/music'}`);
});
