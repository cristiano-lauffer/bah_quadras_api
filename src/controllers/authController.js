const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizarEmail = (email) => String(email).trim().toLowerCase();

// POST /auth/register
// Cadastro de cliente (papel fixo: 'cliente')
async function register(req, res) {
  const { nome, email, senha, telefone } = req.body;

  if (!nome || !String(nome).trim() || !email || !senha) {
    return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios.' });
  }

  const emailNormalizado = normalizarEmail(email);
  if (!EMAIL_REGEX.test(emailNormalizado)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }

  if (String(senha).length < 6) {
    return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres.' });
  }

  // Opcional; gravado só com dígitos (DDD + número), como o CNPJ
  const telefoneDigitos = telefone ? String(telefone).replace(/\D/g, '') : null;
  if (telefoneDigitos !== null && (telefoneDigitos.length < 10 || telefoneDigitos.length > 11)) {
    return res.status(400).json({ erro: 'Telefone deve ter DDD e 8 ou 9 dígitos.' });
  }

  try {
    const existente = await db('usuarios').where({ email: emailNormalizado }).first();
    if (existente) {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }

    const senhaHash = await bcrypt.hash(String(senha), 10);
    const nomeLimpo = String(nome).trim();

    const [id] = await db('usuarios').insert({
      nome: nomeLimpo,
      email: emailNormalizado,
      telefone: telefoneDigitos,
      senha: senhaHash,
      papel: 'cliente',
    });

    return res.status(201).json({
      mensagem: 'Cadastro realizado com sucesso.',
      usuario: { id, nome: nomeLimpo, email: emailNormalizado, telefone: telefoneDigitos, papel: 'cliente' },
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }
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
    const usuario = await db('usuarios').where({ email: normalizarEmail(email) }).first();
    if (!usuario) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const senhaCorreta = await bcrypt.compare(String(senha), usuario.senha);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    // O painel da empresa mostra o nome dela logo após o login
    const empresa = usuario.empresa_id
      ? await db('empresas').where({ id: usuario.empresa_id }).select('id', 'nome').first()
      : null;

    const token = jwt.sign(
      {
        id:    usuario.id,
        nome:  usuario.nome,
        email: usuario.email,
        papel: usuario.papel,
        empresa_id: usuario.empresa_id || null,
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
        telefone: usuario.telefone || null,
        papel: usuario.papel,
        empresa_id: usuario.empresa_id || null,
        empresa: empresa || null,
      },
    });
  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { register, login };
