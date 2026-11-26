const express = require('express');
const router = express.Router();
const { autenticar, exigirPapel } = require('../middlewares/authMiddleware');
const { criarEmpresa } = require('../controllers/empresaController');
const admin = require('../controllers/adminController');

// Tudo em /admin exige token válido com papel 'admin'
router.use(autenticar, exigirPapel('admin'));

// POST /admin/empresas — admin cria conta de empresa (US3)
router.post('/empresas', criarEmpresa);
router.get('/empresas', admin.listarEmpresas);
router.get('/empresas/:id', admin.buscarEmpresa);
router.patch('/empresas/:id', admin.atualizarEmpresa);
router.post('/empresas/:id/redefinir-senha', admin.redefinirSenha);
router.get('/resumo', admin.resumo);

module.exports = router;
