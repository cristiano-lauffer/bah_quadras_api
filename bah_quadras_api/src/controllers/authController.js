const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

// POST /auth/register
// Cadastro de cliente (papel fixo: 'cliente')
async function register(req, res) {
  const { nome, email, senha } = req.body;

  // Validação básica dos campos
  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios.' });
  }

  if (senha.length < 6) {
    return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres.' });
  }

  try {
    // Verifica se o e-mail já está cadastrado
    const existente = await db('usuarios').where({ email }).first();
    if (existente) {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }

    // Gera o hash da senha (nunca salvar senha pura no banco)
    const senhaHash = await bcrypt.hash(senha, 10);

    // Insere o novo usuário com papel fixo de 'cliente'
    const [id] = await db('usuarios').insert({
      nome,
      email,
      senha: senhaHash,
      papel: 'cliente',
    });

    return res.status(201).json({
      mensagem: 'Cadastro realizado com sucesso.',
      usuario: { id, nome, email, papel: 'cliente' },
    });
  } catch (err) {
    console.error('Erro no register:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// POST /auth/login
// Login para qualquer papel (cliente, empresa, admin)
async function login(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });
  }

  try {
    // Busca o usuário pelo e-mail
    const usuario = await db('usuarios').where({ email }).first();
    if (!usuario) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    // Compara a senha com o hash salvo no banco
    const senhaCorreta = await bcrypt.compare(senha, usuario.senha);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    // Gera o token JWT com os dados do usuário
    const token = jwt.sign(
      {
        id:    usuario.id,
        nome:  usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.status(200).json({
      mensagem: 'Login realizado com sucesso.',
      token,
      usuario: {
        id:    usuario.id,
        nome:  usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
      },
    });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { register, login };
