const express = require('express');
const router = express.Router();
const { listarQuadras } = require('../controllers/publicoController');

// Rotas sem login (vitrine para os jogadores)
router.get('/quadras', listarQuadras);

module.exports = router;
