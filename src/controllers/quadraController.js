const db = require('../config/database');

// mysql2 devolve DECIMAL como string e BOOLEAN como 0/1 — normaliza pro front
function formatar(q) {
  return {
    id: q.id,
    empresa_id: q.empresa_id,
    tipo_quadra_id: q.tipo_quadra_id,
    nome: q.nome,
    descricao: q.descricao,
    valor_hora: Number(q.valor_hora),
    ativa: Boolean(q.ativa),
    created_at: q.created_at,
    updated_at: q.updated_at,
  };
}

function valorHoraValido(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000000;
}

// Busca a quadra garantindo que pertence à empresa logada (ownership).
// Se for de outra empresa, trata como "não encontrada" para não vazar a existência.
function buscarDaEmpresa(id, empresaId) {
  return db('quadras').where({ id, empresa_id: empresaId }).first();
}

// POST /quadras — empresa cadastra quadra (US4)
async function criar(req, res) {
  const { nome, descricao, tipo_quadra_id, valor_hora } = req.body;

  if (!nome || !tipo_quadra_id || valor_hora === undefined) {
    return res.status(400).json({ erro: 'Nome, tipo da quadra e valor por hora são obrigatórios.' });
  }
  if (!valorHoraValido(valor_hora)) {
    return res.status(400).json({ erro: 'Valor por hora deve ser um número maior que zero.' });
  }

  try {
    const tipo = await db('tipos_quadra').where({ id: tipo_quadra_id }).first();
    if (!tipo) {
      return res.status(400).json({ erro: 'Tipo de quadra inexistente.' });
    }

    const [id] = await db('quadras').insert({
      empresa_id: req.usuario.empresa_id,
      tipo_quadra_id,
      nome: String(nome).trim(),
      descricao: descricao ? String(descricao).trim() : null,
      valor_hora: Number(valor_hora),
    });

    const quadra = await db('quadras').where({ id }).first();
    return res.status(201).json({ mensagem: 'Quadra cadastrada com sucesso.', quadra: formatar(quadra) });
  } catch (err) {
    console.error('Erro ao criar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /quadras — lista as quadras da empresa logada (?ativa=true|false filtra)
async function listar(req, res) {
  try {
    const consulta = db('quadras').where({ empresa_id: req.usuario.empresa_id }).orderBy('nome');
    if (req.query.ativa === 'true') consulta.where({ ativa: true });
    if (req.query.ativa === 'false') consulta.where({ ativa: false });

    const quadras = await consulta;
    return res.json(quadras.map(formatar));
  } catch (err) {
    console.error('Erro ao listar quadras:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /quadras/:id
async function buscar(req, res) {
  try {
    const quadra = await buscarDaEmpresa(req.params.id, req.usuario.empresa_id);
    if (!quadra) return res.status(404).json({ erro: 'Quadra não encontrada.' });
    return res.json(formatar(quadra));
  } catch (err) {
    console.error('Erro ao buscar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PATCH /quadras/:id — edita dados, preço (US6) e ativa/desativa (US4)
// Reservas já feitas mantêm o preço da época via reservas.preco_snapshot
// (gravado na criação da reserva), então alterar valor_hora aqui é seguro.
async function atualizar(req, res) {
  const { nome, descricao, tipo_quadra_id, valor_hora, ativa } = req.body;
  const campos = {};

  if (nome !== undefined) {
    if (!String(nome).trim()) return res.status(400).json({ erro: 'Nome não pode ser vazio.' });
    campos.nome = String(nome).trim();
  }
  if (descricao !== undefined) {
    campos.descricao = descricao ? String(descricao).trim() : null;
  }
  if (valor_hora !== undefined) {
    if (!valorHoraValido(valor_hora)) {
      return res.status(400).json({ erro: 'Valor por hora deve ser um número maior que zero.' });
    }
    campos.valor_hora = Number(valor_hora);
  }
  if (ativa !== undefined) {
    if (typeof ativa !== 'boolean') {
      return res.status(400).json({ erro: 'O campo "ativa" deve ser true ou false.' });
    }
    campos.ativa = ativa;
  }

  try {
    if (tipo_quadra_id !== undefined) {
      const tipo = await db('tipos_quadra').where({ id: tipo_quadra_id }).first();
      if (!tipo) return res.status(400).json({ erro: 'Tipo de quadra inexistente.' });
      campos.tipo_quadra_id = tipo_quadra_id;
    }

    if (Object.keys(campos).length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo válido para atualizar.' });
    }

    const existente = await buscarDaEmpresa(req.params.id, req.usuario.empresa_id);
    if (!existente) return res.status(404).json({ erro: 'Quadra não encontrada.' });

    campos.updated_at = db.fn.now();
    await db('quadras').where({ id: existente.id }).update(campos);

    const quadra = await db('quadras').where({ id: existente.id }).first();
    return res.json({ mensagem: 'Quadra atualizada com sucesso.', quadra: formatar(quadra) });
  } catch (err) {
    console.error('Erro ao atualizar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /tipos-quadra — alimenta o select dos formulários (qualquer usuário logado)
async function listarTipos(req, res) {
  try {
    const tipos = await db('tipos_quadra').select('id', 'descricao').orderBy('descricao');
    return res.json(tipos);
  } catch (err) {
    console.error('Erro ao listar tipos:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { criar, listar, buscar, atualizar, listarTipos };
