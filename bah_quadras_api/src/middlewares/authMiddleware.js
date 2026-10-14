const jwt = require('jsonwebtoken');

// Verifica se o token JWT é válido
function autenticar(req, res, next) {
  const authHeader = req.headers['authorization'];

  // O token vem no formato: "Bearer <token>"
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Token não fornecido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const dados = jwt.verify(token, process.env.JWT_SECRET);
    req.usuario = dados; // disponibiliza os dados do usuário logado na requisição
    next();
  } catch (err) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

// Verifica se o usuário tem o papel correto
// Uso: exigirPapel('admin') ou exigirPapel('empresa')
function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!papeis.includes(req.usuario.papel)) {
      return res.status(403).json({ erro: 'Acesso negado.' });
    }
    next();
  };
}

module.exports = { autenticar, exigirPapel };
