const express = require('express');
const router = express.Router();
const { autenticar, exigirPapel, exigirEmpresaVinculada } = require('../middlewares/authMiddleware');
const { criar, listar, buscar, atualizar } = require('../controllers/quadraController');
const horarios = require('../controllers/horarioController');

// Gestão de quadras: só empresa vinculada, e só as próprias quadras
router.use(autenticar, exigirPapel('empresa'), exigirEmpresaVinculada);

router.post('/', criar);          // US4 — cadastrar
router.get('/', listar);          // US4 — listar as da empresa
router.get('/:id', buscar);
router.patch('/:id', atualizar);  // US4 editar/desativar + US6 preço

// Grade semanal de horários da quadra (US5)
router.get('/:id/horarios', horarios.listar);
router.post('/:id/horarios', horarios.criar);
router.patch('/:id/horarios/:horarioId', horarios.atualizar);
router.delete('/:id/horarios/:horarioId', horarios.excluir);

module.exports = router;
