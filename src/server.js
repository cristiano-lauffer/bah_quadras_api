require('dotenv').config();
const app = require('./app');
const db = require('./config/database');

const PORT = process.env.PORT || 3000;

// Testa a conexão com o banco antes de subir o servidor
db.raw('SELECT 1')
  .then(() => {
    console.log('DB conectado');
    app.listen(PORT, () => {
      console.log(`API rodando em http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erro ao conectar com o banco:', err.message);
    process.exit(1);
  });
