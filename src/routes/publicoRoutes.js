const express = require('express');
const router = express.Router();
const { listarQuadras, buscarQuadra } = require('../controllers/publicoController');

// Rotas sem login (vitrine para os jogadores)
router.get('/quadras', listarQuadras);
router.get('/quadras/:id', buscarQuadra);

module.exports = router;
