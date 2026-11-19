const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');
const { esqueciSenha, redefinirSenha } = require('../controllers/contaController');

// POST /auth/register — cadastro de cliente
router.post('/register', register);

// POST /auth/login — login para qualquer papel
router.post('/login', login);

// Recuperação de senha (o link sai no console da API enquanto não há envio de e-mail)
router.post('/esqueci-senha', esqueciSenha);
router.post('/redefinir-senha', redefinirSenha);

module.exports = router;
