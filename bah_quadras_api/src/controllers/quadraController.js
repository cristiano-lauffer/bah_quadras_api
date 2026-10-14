const db = require('../config/database');

const CAMPOS_QUADRA = ['id', 'empresa_id', 'nome', 'tipo', 'preco_hora', 'endereco', 'whatsapp', 'ativa'];
const REGEX_WHATSAPP = /^\d{10,13}$/;

function extrairDadosQuadra(body) {
  const { nome, tipo, preco_hora, endereco, whatsapp } = body;
  return {
    nome: typeof nome === 'string' ? nome.trim() : nome,
    tipo: typeof tipo === 'string' ? tipo.trim() : tipo,
    preco_hora,
    endereco: typeof endereco === 'string' ? endereco.trim() : endereco,
    whatsapp: typeof whatsapp === 'string' ? whatsapp.replace(/\D/g, '') : whatsapp,
  };
}

function validarDadosQuadra({ nome, tipo, preco_hora, endereco, whatsapp }) {
  if (!nome || !tipo || preco_hora === undefined || !endereco || !whatsapp) {
    return 'Nome, tipo, preço por hora, endereço e WhatsApp são obrigatórios.';
  }

  const preco = Number(preco_hora);
  if (!Number.isFinite(preco) || preco <= 0) {
    return 'O preço por hora deve ser um número maior que zero.';
  }

  if (!REGEX_WHATSAPP.test(whatsapp)) {
    return 'WhatsApp inválido. Informe DDD e número (apenas dígitos).';
  }

  return null;
}

async function buscarQuadraDaEmpresa(id, empresaId) {
  const quadra = await db('quadras').where({ id }).first();
  if (!quadra) return { status: 404, erro: 'Quadra não encontrada.' };
  if (quadra.empresa_id !== empresaId) {
    return { status: 403, erro: 'Esta quadra não pertence à sua empresa.' };
  }
  return { quadra };
}

// GET /quadras
async function listar(req, res) {
  try {
    const quadras = await db('quadras')
      .select(CAMPOS_QUADRA)
      .where({ empresa_id: req.usuario.id })
      .orderBy('nome');

    return res.status(200).json(quadras);
  } catch (err) {
    console.error('Erro ao listar quadras:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /quadras/:id
async function buscarPorId(req, res) {
  try {
    const { quadra, status, erro } = await buscarQuadraDaEmpresa(req.params.id, req.usuario.id);
    if (erro) return res.status(status).json({ erro });

    return res.status(200).json(quadra);
  } catch (err) {
    console.error('Erro ao buscar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// POST /quadras
async function criar(req, res) {
  const dados = extrairDadosQuadra(req.body);
  const erroValidacao = validarDadosQuadra(dados);
  if (erroValidacao) {
    return res.status(400).json({ erro: erroValidacao });
  }

  try {
    const [id] = await db('quadras').insert({
      ...dados,
      empresa_id: req.usuario.id,
      ativa: true,
    });

    const quadra = await db('quadras').select(CAMPOS_QUADRA).where({ id }).first();
    return res.status(201).json({ mensagem: 'Quadra cadastrada com sucesso.', quadra });
  } catch (err) {
    console.error('Erro ao criar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PUT /quadras/:id
async function atualizar(req, res) {
  const dados = extrairDadosQuadra(req.body);
  const erroValidacao = validarDadosQuadra(dados);
  if (erroValidacao) {
    return res.status(400).json({ erro: erroValidacao });
  }

  try {
    const { status, erro } = await buscarQuadraDaEmpresa(req.params.id, req.usuario.id);
    if (erro) return res.status(status).json({ erro });

    await db('quadras').where({ id: req.params.id }).update(dados);

    const quadra = await db('quadras').select(CAMPOS_QUADRA).where({ id: req.params.id }).first();
    return res.status(200).json({ mensagem: 'Quadra atualizada com sucesso.', quadra });
  } catch (err) {
    console.error('Erro ao atualizar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// DELETE /quadras/:id (desativação lógica)
async function desativar(req, res) {
  try {
    const { status, erro } = await buscarQuadraDaEmpresa(req.params.id, req.usuario.id);
    if (erro) return res.status(status).json({ erro });

    await db('quadras').where({ id: req.params.id }).update({ ativa: false });

    return res.status(200).json({ mensagem: 'Quadra desativada com sucesso.' });
  } catch (err) {
    console.error('Erro ao desativar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { listar, buscarPorId, criar, atualizar, desativar };
