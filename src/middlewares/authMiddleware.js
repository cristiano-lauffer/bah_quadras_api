const jwt = require('jsonwebtoken');
const db = require('../config/database');

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

// Garante que o usuário com papel 'empresa' está vinculado a uma empresa.
// Usado nas rotas em que a empresa só pode mexer nos próprios dados (ownership).
// Empresa desativada pelo admin também perde o acesso (mesmo com token ainda válido).
async function exigirEmpresaVinculada(req, res, next) {
  if (!req.usuario.empresa_id) {
    return res.status(403).json({ erro: 'Usuário não está vinculado a uma empresa.' });
  }
  try {
    const empresa = await db('empresas').where({ id: req.usuario.empresa_id }).first('ativo');
    if (!empresa || !empresa.ativo) {
      return res.status(403).json({ erro: 'Esta empresa está desativada. Fale com o Bah Quadras para reativar.' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { autenticar, exigirPapel, exigirEmpresaVinculada };
