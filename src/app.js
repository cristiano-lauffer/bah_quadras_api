const express = require('express');
const cors = require('cors');
const app = express();

// Libera o front: Vite em modo dev (5173) e "npm run preview" (4173), se CORS_ORIGIN não disser outra coisa
const origens = process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:4173';
app.use(cors({ origin: origens.split(',').map((o) => o.trim()) }));

// Permite receber JSON no body das requisições
app.use(express.json());

// Rotas
const authRoutes = require('./routes/authRoutes');
app.use('/auth', authRoutes);
app.use('/admin', require('./routes/adminRoutes'));
app.use('/quadras', require('./routes/quadraRoutes'));
app.use('/tipos-quadra', require('./routes/tipoQuadraRoutes'));
app.use('/publico', require('./routes/publicoRoutes'));

// Rota de health check — útil para saber se a API está no ar
app.get('/', (req, res) => {
  res.json({ mensagem: 'API BahQuadras funfando' });
});

// Middleware de erro genérico (captura erros não tratados)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.' });
  }
  console.error('Erro não tratado:', err);
  res.status(500).json({ erro: 'Erro interno no servidor.' });
});

module.exports = app;
