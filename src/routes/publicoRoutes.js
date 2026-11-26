const express = require('express');
const router = express.Router();
const { listarQuadras, buscarQuadra, listarAvaliacoes, listarDepoimentos } = require('../controllers/publicoController');

// Rotas sem login (vitrine para os jogadores)
router.get('/quadras', listarQuadras);
router.get('/quadras/:id', buscarQuadra);
router.get('/quadras/:id/avaliacoes', listarAvaliacoes);
router.get('/depoimentos', listarDepoimentos);

module.exports = router;
