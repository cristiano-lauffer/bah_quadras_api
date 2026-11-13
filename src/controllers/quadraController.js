const db = require('../config/database');

const STATUS = ['ativa', 'manutencao', 'inativa'];
const COBERTURAS = ['coberta', 'descoberta'];
const URL_REGEX = /^https?:\/\/\S+$/i;
const MAX_COMODIDADES = 30;

// mysql2 já entrega JSON como array; o fallback cobre bancos que guardam JSON como texto
function lerComodidades(valor) {
  if (valor === null || valor === undefined) return [];
  if (Array.isArray(valor)) return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return [];
  }
}

// mysql2 devolve DECIMAL como string — normaliza pro front
function formatar(q) {
  return {
    id: q.id,
    empresa_id: q.empresa_id,
    tipo_quadra_id: q.tipo_quadra_id,
    tipo_quadra: q.tipo_quadra,
    nome: q.nome,
    descricao: q.descricao,
    valor_hora: Number(q.valor_hora),
    status: q.status,
    piso: q.piso,
    cobertura: q.cobertura,
    capacidade: q.capacidade,
    comodidades: lerComodidades(q.comodidades),
    imagem_url: q.imagem_url,
    created_at: q.created_at,
    updated_at: q.updated_at,
  };
}

function valorHoraValido(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 100000000;
}

const vazio = (v) => v === null || v === '';

// Valida os campos editáveis presentes no body (exceto tipo_quadra_id, que depende do banco).
// Retorna { campos } ou { erro }.
function montarCampos(body) {
  const { nome, descricao, valor_hora, status, piso, cobertura, capacidade, comodidades, imagem_url } = body;
  const campos = {};

  if (nome !== undefined) {
    const texto = String(nome).trim();
    if (!texto) return { erro: 'Nome não pode ser vazio.' };
    if (texto.length > 100) return { erro: 'Nome deve ter no máximo 100 caracteres.' };
    campos.nome = texto;
  }
  if (descricao !== undefined) {
    const texto = vazio(descricao) ? '' : String(descricao).trim();
    if (texto.length > 500) return { erro: 'Descrição deve ter no máximo 500 caracteres.' };
    campos.descricao = texto || null;
  }
  if (valor_hora !== undefined) {
    if (!valorHoraValido(valor_hora)) return { erro: 'Valor por hora deve ser um número maior que zero.' };
    campos.valor_hora = Number(valor_hora);
  }
  if (status !== undefined) {
    if (!STATUS.includes(status)) return { erro: `status deve ser: ${STATUS.join(', ')}.` };
    campos.status = status;
  }
  if (piso !== undefined) {
    const texto = vazio(piso) ? '' : String(piso).trim();
    if (texto.length > 50) return { erro: 'Piso deve ter no máximo 50 caracteres.' };
    campos.piso = texto || null;
  }
  if (cobertura !== undefined) {
    if (!vazio(cobertura) && !COBERTURAS.includes(cobertura)) {
      return { erro: `cobertura deve ser: ${COBERTURAS.join(', ')}.` };
    }
    campos.cobertura = vazio(cobertura) ? null : cobertura;
  }
  if (capacidade !== undefined) {
    if (!vazio(capacidade) && (!Number.isInteger(capacidade) || capacidade < 1 || capacidade > 100)) {
      return { erro: 'Capacidade deve ser um número inteiro de 1 a 100.' };
    }
    campos.capacidade = vazio(capacidade) ? null : capacidade;
  }
  if (comodidades !== undefined) {
    const lista = comodidades === null ? [] : comodidades;
    const validas = Array.isArray(lista) && lista.every((c) => typeof c === 'string' && c.trim() && c.trim().length <= 50);
    if (!validas || lista.length > MAX_COMODIDADES) {
      return { erro: `Comodidades deve ser uma lista de até ${MAX_COMODIDADES} textos (máx. 50 caracteres cada).` };
    }
    campos.comodidades = JSON.stringify([...new Set(lista.map((c) => c.trim()))]);
  }
  if (imagem_url !== undefined) {
    const texto = vazio(imagem_url) ? '' : String(imagem_url).trim();
    if (texto && (!URL_REGEX.test(texto) || texto.length > 500)) {
      return { erro: 'imagem_url deve ser um endereço http(s) de até 500 caracteres. Envio de arquivo ainda não é suportado.' };
    }
    campos.imagem_url = texto || null;
  }

  return { campos };
}

function tipoExiste(id) {
  return db('tipos_quadra').where({ id }).first();
}

function consultaQuadras() {
  return db('quadras as q')
    .join('tipos_quadra as t', 't.id', 'q.tipo_quadra_id')
    .select('q.*', 't.descricao as tipo_quadra');
}

// Busca a quadra garantindo que pertence à empresa logada (ownership).
// Se for de outra empresa, trata como "não encontrada" para não vazar a existência.
function buscarDaEmpresa(id, empresaId) {
  return consultaQuadras().where({ 'q.id': id, 'q.empresa_id': empresaId }).first();
}

// POST /quadras — empresa cadastra quadra (US4)
async function criar(req, res) {
  const { nome, tipo_quadra_id, valor_hora } = req.body;

  if (!nome || !tipo_quadra_id || valor_hora === undefined) {
    return res.status(400).json({ erro: 'Nome, tipo da quadra e valor por hora são obrigatórios.' });
  }

  const { campos, erro } = montarCampos(req.body);
  if (erro) return res.status(400).json({ erro });

  try {
    if (!(await tipoExiste(tipo_quadra_id))) {
      return res.status(400).json({ erro: 'Tipo de quadra inexistente.' });
    }

    const [id] = await db('quadras').insert({
      ...campos,
      empresa_id: req.usuario.empresa_id,
      tipo_quadra_id,
    });

    const quadra = await consultaQuadras().where('q.id', id).first();
    return res.status(201).json({ mensagem: 'Quadra cadastrada com sucesso.', quadra: formatar(quadra) });
  } catch (err) {
    console.error('Erro ao criar quadra:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /quadras — lista as quadras da empresa logada (?status=ativa|manutencao|inativa filtra)
async function listar(req, res) {
  const { status } = req.query;
  if (status !== undefined && !STATUS.includes(status)) {
    return res.status(400).json({ erro: `status deve ser: ${STATUS.join(', ')}.` });
  }

  try {
    const consulta = consultaQuadras().where('q.empresa_id', req.usuario.empresa_id).orderBy('q.nome');
    if (status) consulta.where('q.status', status);

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

// PATCH /quadras/:id — edita dados, preço (US6) e status (US4)
async function atualizar(req, res) {
  const { campos, erro } = montarCampos(req.body);
  if (erro) return res.status(400).json({ erro });

  try {
    const { tipo_quadra_id } = req.body;
    if (tipo_quadra_id !== undefined) {
      if (!(await tipoExiste(tipo_quadra_id))) return res.status(400).json({ erro: 'Tipo de quadra inexistente.' });
      campos.tipo_quadra_id = tipo_quadra_id;
    }

    if (Object.keys(campos).length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo válido para atualizar.' });
    }

    const existente = await buscarDaEmpresa(req.params.id, req.usuario.empresa_id);
    if (!existente) return res.status(404).json({ erro: 'Quadra não encontrada.' });

    campos.updated_at = db.fn.now();
    await db('quadras').where({ id: existente.id }).update(campos);

    const quadra = await consultaQuadras().where('q.id', existente.id).first();
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

module.exports = { criar, listar, buscar, atualizar, listarTipos, lerComodidades };
