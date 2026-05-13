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

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
  console.log(`Music directory: ${process.env.MUSIC_DIR || '/music'}`);
});
