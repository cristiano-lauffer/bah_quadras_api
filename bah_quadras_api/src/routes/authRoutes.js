const express = require('express');
const router = express.Router();
const { register, login } = require('../controllers/authController');

// POST /auth/register — cadastro de cliente
router.post('/register', register);

// POST /auth/login — login para qualquer papel
router.post('/login', login);

module.exports = router;
