const bcrypt = require('bcryptjs');
const db = require('../config/database');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /admin/empresas  (somente admin)
// Cria a empresa e o usuário responsável (papel 'empresa') na mesma transação.
// Campos iguais aos do formulário CadastroEmpresa.jsx do front.
async function criarEmpresa(req, res) {
  const { empresa, cnpj, responsavel, email, telefone, senha } = req.body;

  if (!empresa || !cnpj || !responsavel || !email || !senha) {
    return res.status(400).json({
      erro: 'Empresa, CNPJ, responsável, e-mail e senha são obrigatórios.',
    });
  }

  const emailNormalizado = String(email).trim().toLowerCase();
  if (!EMAIL_REGEX.test(emailNormalizado)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }

  if (String(senha).length < 6) {
    return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres.' });
  }

  // Guarda o CNPJ só com dígitos (o front envia com máscara)
  const cnpjDigitos = String(cnpj).replace(/\D/g, '');
  if (cnpjDigitos.length !== 14) {
    return res.status(400).json({ erro: 'CNPJ deve ter 14 dígitos.' });
  }

  try {
    if (await db('usuarios').where({ email: emailNormalizado }).first()) {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }
    if (await db('empresas').where({ cnpj: cnpjDigitos }).first()) {
      return res.status(409).json({ erro: 'Este CNPJ já está cadastrado.' });
    }

    const senhaHash = await bcrypt.hash(String(senha), 10);

    const resultado = await db.transaction(async (trx) => {
      const [empresaId] = await trx('empresas').insert({
        nome: String(empresa).trim(),
        cnpj: cnpjDigitos,
        telefone: telefone ? String(telefone).trim() : null,
      });

      const [usuarioId] = await trx('usuarios').insert({
        nome: String(responsavel).trim(),
        email: emailNormalizado,
        senha: senhaHash,
        papel: 'empresa',
        empresa_id: empresaId,
      });

      return { empresaId, usuarioId };
    });

    return res.status(201).json({
      mensagem: 'Empresa cadastrada com sucesso.',
      empresa: {
        id: resultado.empresaId,
        nome: String(empresa).trim(),
        cnpj: cnpjDigitos,
        telefone: telefone || null,
      },
      usuario: {
        id: resultado.usuarioId,
        nome: String(responsavel).trim(),
        email: emailNormalizado,
        papel: 'empresa',
        empresa_id: resultado.empresaId,
      },
    });
  } catch (err) {
    // Corrida entre duas requisições iguais: o índice único do banco diz qual campo repetiu
    if (err.code === 'ER_DUP_ENTRY') {
      const indice = /for key '([^']+)'/.exec(err.sqlMessage || '');
      const campo = indice && indice[1].includes('cnpj') ? 'Este CNPJ' : 'Este e-mail';
      return res.status(409).json({ erro: `${campo} já está cadastrado.` });
    }
    console.error('Erro ao criar empresa:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { criarEmpresa };
