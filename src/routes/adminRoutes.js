const express = require('express');
const router = express.Router();
const { autenticar, exigirPapel } = require('../middlewares/authMiddleware');
const { criarEmpresa } = require('../controllers/empresaController');

// Tudo em /admin exige token válido com papel 'admin'
router.use(autenticar, exigirPapel('admin'));

// POST /admin/empresas — admin cria conta de empresa (US3)
router.post('/empresas', criarEmpresa);

module.exports = router;
