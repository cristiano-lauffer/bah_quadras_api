const express = require('express');
const app = express();

// Permite receber JSON no body das requisições
app.use(express.json());

// Rotas
const authRoutes = require('./routes/authRoutes');
app.use('/auth', authRoutes);

const quadraRoutes = require('./routes/quadraRoutes');
app.use('/quadras', quadraRoutes);

// Rota de health check — útil para saber se a API está no ar
app.get('/', (req, res) => {
  res.json({ mensagem: 'API BahQuadras funfando' });
});

// Middleware de erro genérico (captura erros não tratados)
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});

module.exports = app;
