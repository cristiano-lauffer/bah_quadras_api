// Painel da empresa logada: perfil, reservas recebidas e avaliações das quadras dela.
const db = require('../config/database');
const { lerObjeto, URL_REGEX } = require('./quadraController');
const { montarSessao } = require('./authController');
const { consultaAvaliacoes, formatarAvaliacao } = require('./publicoController');
const {
  criarReserva, cancelarReserva, consultaReservas, formatarReserva, responderErro,
} = require('../services/reservas');

const HORA_REGEX = /^(([01]\d|2[0-3]):00|00:00)$/;
const TEXTOS = { slogan: 120, descricao: 600, whatsapp: 20, email: 150, instagram: 60, site: 150, politicaCancelamento: 500, logo: 10 };
const LISTAS = { comodidades: 30, pagamentos: 10 };
const ENDERECO = { rua: 150, numero: 20, bairro: 100, cidade: 100, estado: 2, cep: 9 };

/* ---------------- Perfil ---------------- */

async function lerPerfil(empresaId, usuarioId) {
  const [empresa, responsavel] = await Promise.all([
    db('empresas').where({ id: empresaId }).first(),
    db('usuarios').where({ id: usuarioId }).first('nome', 'email'),
  ]);
  return {
    id: empresa.id,
    nome: empresa.nome,
    cnpj: empresa.cnpj,
    telefone: empresa.telefone,
    endereco: empresa.endereco,
    ativo: Boolean(empresa.ativo),
    created_at: empresa.created_at,
    responsavel: responsavel?.nome ?? null,
    email_login: responsavel?.email ?? null,
    perfil: lerObjeto(empresa.perfil),
  };
}

// GET /empresa/perfil
async function obterPerfil(req, res) {
  try {
    return res.json(await lerPerfil(req.usuario.empresa_id, req.usuario.id));
  } catch (err) {
    console.error('Erro ao ler perfil da empresa:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// Valida o corpo do PUT e separa o que vai para a tabela empresas, para o perfil (JSON)
// e para o responsável (usuarios.nome). Devolve { empresa, perfil, responsavel } ou { erro }.
function validarPerfil(body, perfilAtual) {
  const empresa = {};
  const perfil = { ...perfilAtual };
  let responsavel;

  if (body.nome !== undefined) {
    const nome = String(body.nome).trim();
    if (nome.length < 3 || nome.length > 200) return { erro: 'Nome da empresa deve ter de 3 a 200 caracteres.' };
    empresa.nome = nome;
  }
  if (body.cnpj !== undefined) {
    const cnpj = String(body.cnpj ?? '').replace(/\D/g, '');
    if (cnpj && cnpj.length !== 14) return { erro: 'CNPJ deve ter 14 dígitos.' };
    empresa.cnpj = cnpj || null;
  }
  if (body.telefone !== undefined) {
    const tel = String(body.telefone ?? '').replace(/\D/g, '');
    if (tel && (tel.length < 10 || tel.length > 11)) return { erro: 'Telefone deve ter DDD e 8 ou 9 dígitos.' };
    empresa.telefone = tel || null;
  }
  if (body.responsavel !== undefined) {
    responsavel = String(body.responsavel).trim();
    if (!responsavel || responsavel.length > 100) return { erro: 'Responsável deve ter de 1 a 100 caracteres.' };
  }
  for (const [campo, max] of Object.entries(TEXTOS)) {
    if (body[campo] === undefined) continue;
    const texto = body[campo] === null ? '' : String(body[campo]).trim();
    if (texto.length > max) return { erro: `${campo} deve ter no máximo ${max} caracteres.` };
    perfil[campo] = texto;
  }
  for (const [campo, max] of Object.entries(LISTAS)) {
    if (body[campo] === undefined) continue;
    const lista = body[campo] ?? [];
    if (!Array.isArray(lista) || lista.length > max || !lista.every((x) => typeof x === 'string' && x.trim() && x.length <= 60)) {
      return { erro: `${campo} deve ser uma lista de até ${max} textos.` };
    }
    perfil[campo] = [...new Set(lista.map((x) => x.trim()))];
  }
  for (const campo of ['capa']) {
    if (body[campo] === undefined) continue;
    const url = body[campo] ? String(body[campo]).trim() : '';
    if (url && (!URL_REGEX.test(url) || url.length > 500)) return { erro: `${campo} deve ser um endereço http(s).` };
    perfil[campo] = url;
  }
  if (body.fotos !== undefined) {
    const fotos = body.fotos ?? [];
    if (!Array.isArray(fotos) || fotos.length > 12 || !fotos.every((u) => typeof u === 'string' && URL_REGEX.test(u) && u.length <= 500)) {
      return { erro: 'fotos deve ser uma lista de até 12 endereços http(s).' };
    }
    perfil.fotos = fotos;
  }
  if (body.endereco !== undefined) {
    const e = body.endereco;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { erro: 'endereco deve ser { rua, numero, bairro, cidade, estado, cep }.' };
    const limpo = {};
    for (const [campo, max] of Object.entries(ENDERECO)) {
      const texto = e[campo] ? String(e[campo]).trim() : '';
      if (texto.length > max) return { erro: `endereco.${campo} deve ter no máximo ${max} caracteres.` };
      limpo[campo] = texto;
    }
    if (!limpo.rua || !limpo.cidade) return { erro: 'Informe ao menos rua e cidade.' };
    limpo.estado = limpo.estado.toUpperCase();
    perfil.endereco = limpo;
    perfil.bairro = limpo.bairro;
    perfil.cidade = limpo.estado ? `${limpo.cidade}/${limpo.estado}` : limpo.cidade;
    // Texto único no formato que a vitrine entende: "Rua, número - Bairro, Cidade/UF"
    const rua = limpo.numero ? `${limpo.rua}, ${limpo.numero}` : limpo.rua;
    empresa.endereco = `${rua} - ${limpo.bairro ? `${limpo.bairro}, ` : ''}${perfil.cidade}`;
  }
  if (body.horarios !== undefined) {
    const h = body.horarios;
    const valido = Array.isArray(h) && h.length <= 7 && h.every((x) =>
      x && Number.isInteger(x.dia) && x.dia >= 0 && x.dia <= 6 &&
      ((x.abre === '' && x.fecha === '') ||
        (HORA_REGEX.test(x.abre) && HORA_REGEX.test(x.fecha) && x.abre !== '00:00' &&
          (x.fecha === '00:00' || x.fecha > x.abre))));
    if (!valido) return { erro: 'horarios deve ter { dia, nome, abre, fecha } em horas cheias (abre "" e fecha "" = fechado).' };
    perfil.horarios = h.map(({ dia, nome, abre, fecha }) => ({ dia, nome: String(nome ?? '').slice(0, 20), abre, fecha }));
  }
  return { empresa, perfil, responsavel };
}

// PUT /empresa/perfil — campos do Editar perfil (todos opcionais)
async function salvarPerfil(req, res) {
  try {
    const atual = await db('empresas').where({ id: req.usuario.empresa_id }).first('perfil');
    const { empresa, perfil, responsavel, erro } = validarPerfil(req.body, lerObjeto(atual?.perfil));
    if (erro) return res.status(400).json({ erro });

    if (empresa.cnpj) {
      const outra = await db('empresas').where({ cnpj: empresa.cnpj }).whereNot({ id: req.usuario.empresa_id }).first('id');
      if (outra) return res.status(409).json({ erro: 'Este CNPJ já está cadastrado.' });
    }
    await db.transaction(async (trx) => {
      await trx('empresas').where({ id: req.usuario.empresa_id }).update({ ...empresa, perfil: JSON.stringify(perfil), updated_at: trx.fn.now() });
      if (responsavel) await trx('usuarios').where({ id: req.usuario.id }).update({ nome: responsavel, updated_at: trx.fn.now() });
    });
    // Token novo: o nome da empresa e o do responsável vão na sessão do front
    const usuario = await db('usuarios').where({ id: req.usuario.id }).first();
    const sessao = await montarSessao(usuario);
    return res.json({
      mensagem: 'Perfil atualizado.',
      empresa: await lerPerfil(req.usuario.empresa_id, req.usuario.id),
      token: sessao.token,
      usuario: sessao.usuario,
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Este CNPJ já está cadastrado.' });
    console.error('Erro ao salvar perfil da empresa:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

/* ---------------- Reservas recebidas ---------------- */

const daEmpresa = (req) => (linha) => linha.empresa_id === req.usuario.empresa_id;

// GET /empresa/reservas?de=AAAA-MM-DD&ate=AAAA-MM-DD (padrão: 190 dias para trás e 60 para frente,
// o bastante para o gráfico de 6 meses do painel)
async function listarReservas(req, res) {
  const data = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
  const de = data(req.query.de) ?? db.raw('CURDATE() - INTERVAL 190 DAY');
  const ate = data(req.query.ate) ?? db.raw('CURDATE() + INTERVAL 60 DAY');
  try {
    const lista = await consultaReservas()
      .where('q.empresa_id', req.usuario.empresa_id)
      .where('s.data_reserva', '>=', de)
      .where('s.data_reserva', '<=', ate)
      .orderBy([{ column: 's.data_reserva', order: 'desc' }, { column: 's.hora_inicio', order: 'asc' }]);
    return res.json(lista.map(formatarReserva));
  } catch (err) {
    return responderErro(res, err, 'listar reservas da empresa');
  }
}

// POST /empresa/reservas — reserva de balcão: { quadra_id, cliente_nome, data, hora_inicio, duracao?|baterias?, forma_pagamento? }
async function criarReservaBalcao(req, res) {
  const { quadra_id, cliente_nome, data, hora_inicio, duracao, baterias, forma_pagamento } = req.body;
  const nome = String(cliente_nome ?? '').trim();
  if (!nome || nome.length > 100) return res.status(400).json({ erro: 'Informe o nome do cliente (até 100 caracteres).' });
  try {
    const quadra = await db('quadras').where({ id: Number(quadra_id) || 0, empresa_id: req.usuario.empresa_id }).first('id');
    if (!quadra) return res.status(404).json({ erro: 'Quadra não encontrada.' });
    const id = await criarReserva({
      quadraId: quadra.id, pedidoBruto: { data, hora_inicio, duracao, baterias }, forma_pagamento, origem: 'balcao', dono: { cliente_nome: nome },
    });
    return res.status(201).json({ mensagem: 'Reserva criada.', reserva: formatarReserva(await consultaReservas().where('r.id', id).first()) });
  } catch (err) {
    return responderErro(res, err, 'criar reserva de balcão');
  }
}

// POST /empresa/reservas/:id/pagar — marca como paga (pagamento recebido no local)
async function marcarPaga(req, res) {
  try {
    const linha = await consultaReservas().where('r.id', Number(req.params.id) || 0).where('q.empresa_id', req.usuario.empresa_id).first();
    if (!linha) return res.status(404).json({ erro: 'Reserva não encontrada.' });
    if (linha.status !== 'ATIVA') return res.status(409).json({ erro: 'Reserva cancelada não pode ser marcada como paga.' });
    await db('reservas').where({ id: linha.id }).update({ pago: true });
    return res.json({ mensagem: 'Pagamento registrado.', reserva: formatarReserva({ ...linha, pago: 1 }) });
  } catch (err) {
    return responderErro(res, err, 'marcar reserva como paga');
  }
}

// POST /empresa/reservas/:id/cancelar
async function cancelar(req, res) {
  try {
    const id = await cancelarReserva(Number(req.params.id) || 0, daEmpresa(req));
    return res.json({ mensagem: 'Reserva cancelada.', reserva: formatarReserva(await consultaReservas().where('r.id', id).first()) });
  } catch (err) {
    return responderErro(res, err, 'cancelar reserva da empresa');
  }
}

/* ---------------- Avaliações ---------------- */

// GET /empresa/avaliacoes — avaliações das quadras da empresa (mais recentes primeiro)
async function listarAvaliacoes(req, res) {
  try {
    const lista = await consultaAvaliacoes()
      .join('quadras as q', 'q.id', 'a.quadra_id')
      .where('q.empresa_id', req.usuario.empresa_id);
    return res.json(lista.map(formatarAvaliacao));
  } catch (err) {
    console.error('Erro ao listar avaliações da empresa:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

async function avaliacaoDaEmpresa(req) {
  return db('avaliacoes as a')
    .join('quadras as q', 'q.id', 'a.quadra_id')
    .where({ 'a.id': Number(req.params.id) || 0, 'q.empresa_id': req.usuario.empresa_id })
    .first('a.id');
}

// PUT /empresa/avaliacoes/:id/resposta — { texto }
async function responder(req, res) {
  const texto = String(req.body.texto ?? '').trim();
  if (!texto || texto.length > 1000) return res.status(400).json({ erro: 'A resposta deve ter de 1 a 1000 caracteres.' });
  try {
    const avaliacao = await avaliacaoDaEmpresa(req);
    if (!avaliacao) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    await db('avaliacoes').where({ id: avaliacao.id }).update({ resposta: texto, resposta_em: db.fn.now() });
    const atualizada = await consultaAvaliacoes().where('a.id', avaliacao.id).first();
    return res.json({ mensagem: 'Resposta publicada.', avaliacao: formatarAvaliacao(atualizada) });
  } catch (err) {
    console.error('Erro ao responder avaliação:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// DELETE /empresa/avaliacoes/:id/resposta
async function apagarResposta(req, res) {
  try {
    const avaliacao = await avaliacaoDaEmpresa(req);
    if (!avaliacao) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    await db('avaliacoes').where({ id: avaliacao.id }).update({ resposta: null, resposta_em: null });
    return res.json({ mensagem: 'Resposta apagada.' });
  } catch (err) {
    console.error('Erro ao apagar resposta:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = {
  obterPerfil, salvarPerfil, listarReservas, criarReservaBalcao, marcarPaga, cancelar, listarAvaliacoes, responder, apagarResposta,
};
