const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { generateMixesForUser } = require('../services/mixGenerator');

router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    const mixes = generateMixesForUser(req.user.id);
    res.json(mixes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
