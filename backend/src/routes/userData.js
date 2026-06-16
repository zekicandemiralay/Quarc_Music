const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/:key', (req, res) => {
  const row = getDb()
    .prepare('SELECT data_json FROM user_data WHERE user_id = ? AND data_key = ?')
    .get(req.user.id, req.params.key);
  res.json(row ? JSON.parse(row.data_json) : null);
});

router.put('/:key', (req, res) => {
  const { data } = req.body;
  if (data === undefined) return res.status(400).json({ error: 'data required' });

  getDb().prepare(`
    INSERT INTO user_data (user_id, data_key, data_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, data_key)
    DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
  `).run(req.user.id, req.params.key, JSON.stringify(data));

  res.json({ ok: true });
});

module.exports = router;
