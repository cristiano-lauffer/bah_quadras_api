// Conta do usuário logado (/me) e recuperação de senha (/auth/esqueci-senha, /auth/redefinir-senha).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { lerComodidades, lerObjeto, URL_REGEX } = require('./quadraController');
const { montarSessao } = require('./authController');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREFERENCIAS = ['lembrete', 'confirmacao', 'novidades'];
const PREFERENCIAS_PADRAO = { lembrete: true, confirmacao: true, novidades: false };
const MINUTOS_LINK_SENHA = 30;
const MAX_LIDAS = 500;

function formatarConta(u) {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    telefone: u.telefone,
    papel: u.papel,
    empresa_id: u.empresa_id,
    cidade: u.cidade,
    esportes: lerComodidades(u.esportes),
    preferencias: { ...PREFERENCIAS_PADRAO, ...lerObjeto(u.preferencias) },
    foto_url: u.foto_url,
    created_at: u.created_at,
  };
}

// GET /me
async function obter(req, res) {
  try {
    const usuario = await db('usuarios').where({ id: req.usuario.id }).first();
    if (!usuario) return res.status(404).json({ erro: 'Conta não encontrada.' });
    return res.json(formatarConta(usuario));
  } catch (err) {
    console.error('Erro ao ler conta:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PATCH /me — { nome?, email?, telefone?, cidade?, esportes?, preferencias?, foto_url? }
// Devolve a conta e um token novo (o token leva nome e e-mail).
async function atualizar(req, res) {
  const { nome, email, telefone, cidade, esportes, preferencias, foto_url } = req.body;
  const campos = {};

  if (nome !== undefined) {
    const texto = String(nome).trim();
    if (!texto || texto.length > 100) return res.status(400).json({ erro: 'Nome deve ter de 1 a 100 caracteres.' });
    campos.nome = texto;
  }
  if (email !== undefined) {
    const texto = String(email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(texto) || texto.length > 150) return res.status(400).json({ erro: 'E-mail inválido.' });
    campos.email = texto;
  }
  if (telefone !== undefined) {
    const digitos = telefone ? String(telefone).replace(/\D/g, '') : '';
    if (digitos && (digitos.length < 10 || digitos.length > 11)) {
      return res.status(400).json({ erro: 'Telefone deve ter DDD e 8 ou 9 dígitos.' });
    }
    campos.telefone = digitos || null;
  }
  if (cidade !== undefined) {
    const texto = cidade ? String(cidade).trim() : '';
    if (texto.length > 100) return res.status(400).json({ erro: 'Cidade deve ter no máximo 100 caracteres.' });
    campos.cidade = texto || null;
  }
  if (esportes !== undefined) {
    const lista = esportes ?? [];
    if (!Array.isArray(lista) || lista.length > 20 || !lista.every((e) => typeof e === 'string' && e.trim() && e.length <= 50)) {
      return res.status(400).json({ erro: 'esportes deve ser uma lista de até 20 textos.' });
    }
    campos.esportes = JSON.stringify([...new Set(lista.map((e) => e.trim()))]);
  }
  if (preferencias !== undefined) {
    if (!preferencias || typeof preferencias !== 'object' || Array.isArray(preferencias) ||
        !Object.entries(preferencias).every(([k, v]) => PREFERENCIAS.includes(k) && typeof v === 'boolean')) {
      return res.status(400).json({ erro: `preferencias aceita só: ${PREFERENCIAS.join(', ')} (true/false).` });
    }
    campos.preferencias = JSON.stringify(preferencias);
  }
  if (foto_url !== undefined) {
    const url = foto_url ? String(foto_url).trim() : '';
    if (url && (!URL_REGEX.test(url) || url.length > 500)) return res.status(400).json({ erro: 'foto_url deve ser um endereço http(s).' });
    campos.foto_url = url || null;
  }
  if (!Object.keys(campos).length) return res.status(400).json({ erro: 'Nenhum campo válido para atualizar.' });

  try {
    if (campos.email) {
      const outro = await db('usuarios').where({ email: campos.email }).whereNot({ id: req.usuario.id }).first('id');
      if (outro) return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }
    campos.updated_at = db.fn.now();
    await db('usuarios').where({ id: req.usuario.id }).update(campos);
    const usuario = await db('usuarios').where({ id: req.usuario.id }).first();
    const sessao = await montarSessao(usuario);
    return res.json({ mensagem: 'Dados atualizados.', conta: formatarConta(usuario), token: sessao.token, usuario: sessao.usuario });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    console.error('Erro ao atualizar conta:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PUT /me/senha — { senha_atual, nova_senha }
async function trocarSenha(req, res) {
  const { senha_atual, nova_senha } = req.body;
  if (!senha_atual || !nova_senha) return res.status(400).json({ erro: 'Informe a senha atual e a nova.' });
  if (String(nova_senha).length < 6) return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres.' });

  try {
    const usuario = await db('usuarios').where({ id: req.usuario.id }).first('id', 'senha');
    if (!usuario || !(await bcrypt.compare(String(senha_atual), usuario.senha))) {
      return res.status(400).json({ erro: 'A senha atual está incorreta.' });
    }
    await db('usuarios').where({ id: usuario.id }).update({ senha: await bcrypt.hash(String(nova_senha), 10), updated_at: db.fn.now() });
    return res.json({ mensagem: 'Senha alterada.' });
  } catch (err) {
    console.error('Erro ao trocar senha:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// DELETE /me — só jogador. Cancela as reservas futuras, desliga as passadas da conta
// (a empresa continua vendo o histórico como "Conta excluída") e apaga o resto.
async function excluir(req, res) {
  if (req.usuario.papel !== 'cliente') {
    return res.status(403).json({ erro: 'Só contas de jogador podem ser excluídas pelo site.' });
  }
  try {
    await db.transaction(async (trx) => {
      const futuras = await trx('reservas as r')
        .join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
        .where({ 's.usuario_id': req.usuario.id, 'r.status': 'ATIVA' })
        .where((q) => q.where('s.data_reserva', '>', trx.raw('CURDATE()'))
          .orWhere((q2) => q2.where('s.data_reserva', trx.raw('CURDATE()')).where('s.hora_inicio', '>', trx.raw('CURTIME()'))))
        .select('r.id', 'r.solicitacao_id');
      if (futuras.length) {
        await trx('reservas').whereIn('id', futuras.map((f) => f.id)).update({ status: 'CANCELADA', cancelada_em: trx.fn.now() });
        await trx('solicitacoes_reserva').whereIn('id', futuras.map((f) => f.solicitacao_id)).update({ status_id: 3 });
      }
      await trx('solicitacoes_reserva').where({ usuario_id: req.usuario.id }).update({ usuario_id: null, cliente_nome: 'Conta excluída' });
      await trx('usuarios').where({ id: req.usuario.id }).del(); // favoritos, avaliações e tokens saem em cascata
    });
    return res.json({ mensagem: 'Conta excluída.' });
  } catch (err) {
    console.error('Erro ao excluir conta:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /me/notificacoes-lidas — ids dos avisos já lidos no site
async function lidas(req, res) {
  try {
    const usuario = await db('usuarios').where({ id: req.usuario.id }).first('notificacoes_lidas');
    return res.json(lerComodidades(usuario?.notificacoes_lidas));
  } catch (err) {
    console.error('Erro ao ler notificações lidas:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// POST /me/notificacoes-lidas — { ids: [...] } acrescenta à lista
async function marcarLidas(req, res) {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string' && i.length <= 120)) {
    return res.status(400).json({ erro: 'Envie { "ids": ["..."] }.' });
  }
  try {
    const usuario = await db('usuarios').where({ id: req.usuario.id }).first('notificacoes_lidas');
    const lista = [...new Set([...lerComodidades(usuario?.notificacoes_lidas), ...ids])].slice(-MAX_LIDAS);
    await db('usuarios').where({ id: req.usuario.id }).update({ notificacoes_lidas: JSON.stringify(lista) });
    return res.json(lista);
  } catch (err) {
    console.error('Erro ao marcar notificações:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

/* ---------------- Recuperação de senha ---------------- */

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// POST /auth/esqueci-senha — { email }
// Resposta igual exista ou não a conta (não revela quem é cadastrado).
// Ainda não há envio de e-mail: o link sai no console da API e, fora de produção,
// também na resposta (link_dev), para o front mostrar o botão "Abrir link do e-mail".
async function esqueciSenha(req, res) {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) return res.status(400).json({ erro: 'E-mail inválido.' });

  const resposta = { mensagem: 'Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha.', validade_minutos: MINUTOS_LINK_SENHA };
  try {
    const usuario = await db('usuarios').where({ email }).first('id');
    if (usuario) {
      const token = crypto.randomBytes(32).toString('hex');
      await db('tokens_senha').insert({
        usuario_id: usuario.id,
        token_hash: hashToken(token),
        expira_em: new Date(Date.now() + MINUTOS_LINK_SENHA * 60000),
      });
      const front = (process.env.FRONT_URL || 'http://localhost:5173').replace(/\/+$/, '');
      const link = `${front}/redefinir-senha?token=${token}&email=${encodeURIComponent(email)}`;
      console.log(`[recuperação de senha] link para ${email}: ${link}`);
      if (process.env.NODE_ENV !== 'production') resposta.link_dev = link;
    }
    return res.json(resposta);
  } catch (err) {
    console.error('Erro ao pedir recuperação de senha:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// POST /auth/redefinir-senha — { token, senha }
async function redefinirSenha(req, res) {
  const { token, senha } = req.body;
  if (!token || typeof token !== 'string') return res.status(400).json({ erro: 'Link inválido.' });
  if (!senha || String(senha).length < 6) return res.status(400).json({ erro: 'A senha deve ter no mínimo 6 caracteres.' });

  try {
    const ok = await db.transaction(async (trx) => {
      const registro = await trx('tokens_senha').where({ token_hash: hashToken(token) }).forUpdate().first();
      if (!registro || registro.usado_em || new Date(registro.expira_em) < new Date()) return false;
      await trx('usuarios').where({ id: registro.usuario_id }).update({ senha: await bcrypt.hash(String(senha), 10), updated_at: trx.fn.now() });
      // Usa este link e invalida os outros pedidos abertos da mesma conta
      await trx('tokens_senha').where({ usuario_id: registro.usuario_id }).whereNull('usado_em').update({ usado_em: trx.fn.now() });
      return true;
    });
    if (!ok) return res.status(400).json({ erro: 'Este link expirou ou já foi usado. Peça um novo.' });
    return res.json({ mensagem: 'Senha alterada.' });
  } catch (err) {
    console.error('Erro ao redefinir senha:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { obter, atualizar, trocarSenha, excluir, lidas, marcarLidas, esqueciSenha, redefinirSenha };
