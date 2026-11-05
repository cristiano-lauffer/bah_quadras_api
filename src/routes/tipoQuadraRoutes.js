const express = require('express');
const router = express.Router();
const { autenticar } = require('../middlewares/authMiddleware');
const { listarTipos } = require('../controllers/quadraController');

// GET /tipos-quadra
router.get('/', autenticar, listarTipos);

module.exports = router;
