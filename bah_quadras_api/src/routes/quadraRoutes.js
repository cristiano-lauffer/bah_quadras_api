const express = require('express');
const router = express.Router();
const { autenticar, exigirPapel } = require('../middlewares/authMiddleware');
const { listar, buscarPorId, criar, atualizar, desativar } = require('../controllers/quadraController');

router.use(autenticar, exigirPapel('empresa'));

router.get('/', listar);
router.get('/:id', buscarPorId);
router.post('/', criar);
router.put('/:id', atualizar);
router.delete('/:id', desativar);

module.exports = router;
