const db = require('../config/database');
const { lerComodidades, lerObjeto, fotosDaQuadra } = require('./quadraController');

const DATA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MINUTOS_NO_DIA = 24 * 60;

const doisDigitos = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;

// "18:30:00" -> 1110
function minutos(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  return h * 60 + m;
}

// Posição de um DATETIME dentro do dia consultado, limitada a 0..1440
function minutosNoDia(dataHora, inicioDoDia) {
  const diferenca = (new Date(dataHora) - inicioDoDia) / 60000;
  return Math.min(Math.max(diferenca, 0), MINUTOS_NO_DIA);
}

// 0 = domingo ... 6 = sábado; null se a data não existir (ex.: 2026-02-31)
function diaDaSemana(iso) {
  if (!DATA_REGEX.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00`);
  return isoLocal(d) === iso ? d.getDay() : null;
}

// Quadras visíveis ao público com os horários livres de uma data.
// Quadras ativas ou em manutenção de empresas ativas; em manutenção sempre sem horários livres.
// Livre = slot ativo da grade semanal, sem reserva ATIVA, sem bloqueio e que ainda não começou.
// "quadraId" restringe a uma quadra só (usado no detalhe).
async function quadrasComHorariosLivres(data, dia, quadraId) {
  const consulta = db('quadras as q')
    .join('tipos_quadra as t', 't.id', 'q.tipo_quadra_id')
    .join('empresas as e', 'e.id', 'q.empresa_id')
    .whereIn('q.status', ['ativa', 'manutencao'])
    .where('e.ativo', true)
    .select(
      'q.id', 'q.nome', 'q.descricao', 'q.valor_hora', 'q.tipo_quadra_id', 'q.status',
      'q.piso', 'q.cobertura', 'q.capacidade', 'q.comodidades', 'q.imagem_url',
      'q.imagens', 'q.destaque', 'q.cobranca', 'q.minutos_bateria', 'q.mapa',
      't.descricao as tipo_quadra',
      'e.id as empresa_id', 'e.nome as empresa_nome', 'e.endereco as empresa_endereco',
      'e.telefone as empresa_telefone', 'e.perfil as empresa_perfil'
    )
    .orderBy('q.nome');
  if (quadraId !== undefined) consulta.where('q.id', quadraId);

  const quadras = await consulta;
  if (!quadras.length) return [];

  const hoje = isoLocal(new Date());
  const idsAtivas = quadras.filter((q) => q.status === 'ativa').map((q) => q.id);
  const inicioDoDia = new Date(`${data}T00:00:00`);
  const fimDoDia = new Date(inicioDoDia.getTime() + MINUTOS_NO_DIA * 60000);

  const [horarios, reservas, bloqueios, notas] = await Promise.all([
    db('horarios')
      .whereIn('quadra_id', idsAtivas)
      .where({ dia_semana: dia, ativo: true })
      .orderBy('hora_inicio'),
    db('reservas as r')
      .join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
      .whereIn('s.quadra_id', idsAtivas)
      .where({ 'r.status': 'ATIVA', 's.data_reserva': data })
      .select('s.quadra_id', 's.hora_inicio', 's.hora_fim'),
    db('bloqueios_quadra')
      .whereIn('quadra_id', idsAtivas)
      .where('data_inicio', '<', fimDoDia)
      .where('data_fim', '>', inicioDoDia)
      .select('quadra_id', 'data_inicio', 'data_fim'),
    db('avaliacoes')
      .whereIn('quadra_id', quadras.map((q) => q.id))
      .groupBy('quadra_id')
      .select('quadra_id')
      .avg({ media: 'nota' })
      .count({ total: '*' }),
  ]);
  const notaPorQuadra = new Map(notas.map((n) => [n.quadra_id, n]));

  const ocupados = new Map();
  const ocupar = (id, inicio, fim) => {
    if (!ocupados.has(id)) ocupados.set(id, []);
    ocupados.get(id).push([inicio, fim]);
  };
  reservas.forEach((r) => ocupar(r.quadra_id, minutos(r.hora_inicio), minutos(r.hora_fim)));
  bloqueios.forEach((b) =>
    ocupar(b.quadra_id, minutosNoDia(b.data_inicio, inicioDoDia), minutosNoDia(b.data_fim, inicioDoDia))
  );

  // Em dias passados nada está livre; hoje, só o que ainda não começou
  const agora = new Date();
  const limite = data < hoje ? MINUTOS_NO_DIA : data === hoje ? agora.getHours() * 60 + agora.getMinutes() : -1;

  const livres = new Map();
  for (const h of horarios) {
    const inicio = minutos(h.hora_inicio);
    const fim = minutos(h.hora_fim);
    if (inicio <= limite) continue;
    const conflito = (ocupados.get(h.quadra_id) || []).some(([ocupadoInicio, ocupadoFim]) => inicio < ocupadoFim && fim > ocupadoInicio);
    if (conflito) continue;
    if (!livres.has(h.quadra_id)) livres.set(h.quadra_id, []);
    livres.get(h.quadra_id).push({
      hora_inicio: String(h.hora_inicio).slice(0, 5),
      hora_fim: String(h.hora_fim).slice(0, 5),
    });
  }

  return quadras.map((q) => {
    const nota = notaPorQuadra.get(q.id);
    return {
      id: q.id,
      nome: q.nome,
      descricao: q.descricao,
      valor_hora: Number(q.valor_hora),
      tipo_quadra_id: q.tipo_quadra_id,
      tipo_quadra: q.tipo_quadra,
      status: q.status,
      piso: q.piso,
      cobertura: q.cobertura,
      capacidade: q.capacidade,
      comodidades: lerComodidades(q.comodidades),
      imagem_url: q.imagem_url,
      imagens: fotosDaQuadra(q),
      destaque: Boolean(q.destaque),
      cobranca: q.cobranca,
      minutos_bateria: q.minutos_bateria,
      mapa: q.mapa,
      avaliacao: nota ? Number(nota.media) : null,
      quantidade_avaliacoes: nota ? Number(nota.total) : 0,
      empresa: resumoEmpresa(q),
      horarios_livres: livres.get(q.id) || [],
    };
  });
}

// Dados da empresa que a vitrine mostra (o perfil completo fica em /empresa/perfil)
function resumoEmpresa(q) {
  const perfil = lerObjeto(q.empresa_perfil);
  return {
    id: q.empresa_id,
    nome: q.empresa_nome,
    endereco: q.empresa_endereco,
    bairro: perfil.bairro || null,
    cidade: perfil.cidade || null,
    telefone: perfil.telefone || q.empresa_telefone || null,
    whatsapp: perfil.whatsapp || null,
    politica_cancelamento: perfil.politicaCancelamento || null,
  };
}

// ?data=AAAA-MM-DD (padrão: hoje). Devolve { data, dia } ou { erro }.
function lerData(query) {
  const data = query.data === undefined ? isoLocal(new Date()) : String(query.data);
  const dia = diaDaSemana(data);
  return dia === null ? { erro: 'data deve ser uma data válida no formato AAAA-MM-DD.' } : { data, dia };
}

// GET /publico/quadras?data=AAAA-MM-DD — vitrine com os horários livres do dia
async function listarQuadras(req, res) {
  const { data, dia, erro } = lerData(req.query);
  if (erro) return res.status(400).json({ erro });

  try {
    return res.json(await quadrasComHorariosLivres(data, dia));
  } catch (err) {
    console.error('Erro ao listar quadras públicas:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /publico/quadras/:id?data=AAAA-MM-DD — uma quadra da vitrine, com a grade semanal.
// A tela de agendamento usa a grade para montar os próximos dias sem uma chamada por dia.
async function buscarQuadra(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ erro: 'Quadra não encontrada.' });

  const { data, dia, erro } = lerData(req.query);
  if (erro) return res.status(400).json({ erro });

  try {
    const [quadra] = await quadrasComHorariosLivres(data, dia, id);
    if (!quadra) return res.status(404).json({ erro: 'Quadra não encontrada.' });

    // Em manutenção a quadra aparece, mas sem nada para reservar
    const grade = quadra.status === 'ativa'
      ? await db('horarios')
          .where({ quadra_id: id, ativo: true })
          .orderBy(['dia_semana', 'hora_inicio'])
          .select('dia_semana', 'hora_inicio', 'hora_fim')
      : [];

    return res.json({
      ...quadra,
      grade: grade.map((h) => ({
        dia_semana: h.dia_semana,
        hora_inicio: String(h.hora_inicio).slice(0, 5),
        hora_fim: String(h.hora_fim).slice(0, 5),
      })),
    });
  } catch (err) {
    console.error('Erro ao buscar quadra pública:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /publico/quadras/:id/avaliacoes — avaliações da quadra, com a resposta da empresa
async function listarAvaliacoes(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ erro: 'Quadra não encontrada.' });

  try {
    const quadra = await db('quadras').where({ id }).whereNot({ status: 'inativa' }).first();
    if (!quadra) return res.status(404).json({ erro: 'Quadra não encontrada.' });

    const lista = await consultaAvaliacoes().where('a.quadra_id', id);
    return res.json(lista.map(formatarAvaliacao));
  } catch (err) {
    console.error('Erro ao listar avaliações:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /publico/depoimentos — as avaliações 5 estrelas mais úteis (prova social da Home)
async function listarDepoimentos(req, res) {
  try {
    const lista = await consultaAvaliacoes()
      .join('quadras as q', 'q.id', 'a.quadra_id')
      .join('empresas as e', 'e.id', 'q.empresa_id')
      .where({ 'a.nota': 5, 'q.status': 'ativa', 'e.ativo': true })
      .clearOrder()
      .orderByRaw('a.util + votos desc, a.created_at desc')
      .limit(3);
    return res.json(lista.map(formatarAvaliacao));
  } catch (err) {
    console.error('Erro ao listar depoimentos:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// Avaliações com os votos de "útil" somados (base do seed + votos dos jogadores)
function consultaAvaliacoes() {
  return db('avaliacoes as a')
    .orderBy('a.created_at', 'desc')
    .select('a.*', db.raw('(select count(*) from avaliacoes_uteis u where u.avaliacao_id = a.id) as votos'));
}

// Avaliação do banco -> JSON da API (usado também pelas rotas do jogador e da empresa)
function formatarAvaliacao(a) {
  return {
    id: a.id,
    quadra_id: a.quadra_id,
    usuario_id: a.usuario_id,
    autor_nome: a.autor_nome,
    nota: a.nota,
    aspectos: lerComodidades(a.aspectos),
    texto: a.texto,
    util: Number(a.util) + Number(a.votos || 0),
    resposta: a.resposta,
    resposta_em: a.resposta_em,
    created_at: a.created_at,
  };
}

module.exports = {
  listarQuadras, buscarQuadra, listarAvaliacoes, listarDepoimentos, consultaAvaliacoes, formatarAvaliacao, isoLocal, diaDaSemana, minutos,
};
