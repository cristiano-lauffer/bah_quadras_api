// =========================================================
// Regras de reserva usadas pelas rotas do jogador (/reservas) e da empresa (/empresa/reservas).
//
// Uma reserva = uma linha em solicitacoes_reserva (quadra, dia e período) + uma em reservas
// (status ATIVA/CANCELADA, valores e pagamento). As reservas feitas pelo site já nascem
// aprovadas: status_id 2 (APROVADA) na solicitação e ATIVA na reserva.
//
// Antes de gravar, tudo roda numa transação que trava a linha da quadra (FOR UPDATE):
// duas pessoas reservando a mesma quadra ao mesmo tempo são atendidas uma de cada vez.
// O trigger trg_reserva_sem_conflito continua como última barreira no banco.
// =========================================================
const db = require('../config/database');
const { lerObjeto } = require('../controllers/quadraController');
const { isoLocal, diaDaSemana, minutos } = require('../controllers/publicoController');

const STATUS_APROVADA = 2;
const STATUS_CANCELADA = 3;
const DURACAO_MAXIMA = 3; // horas seguidas
const BATERIAS_MAXIMAS = 4;
const DIAS_ANTECEDENCIA = 60;
const FORMAS_PAGAMENTO = ['Pix', 'Cartão', 'Dinheiro'];
const HORA_REGEX = /^([01]\d|2[0-3]):00(?::00)?$/;

const hhmm = (h) => String(h).slice(0, 5);
const somarHoras = (hora, n) => `${String(Number(hora.slice(0, 2)) + n).padStart(2, '0')}:00`;

class ErroReserva extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/**
 * Valida o pedido (dia, hora, duração/baterias) para a quadra. Devolve
 * { data, hora_inicio, hora_fim, horas, baterias } ou lança ErroReserva.
 */
function validarPedido(quadra, { data, hora_inicio, duracao, baterias }) {
  const dia = diaDaSemana(String(data ?? ''));
  if (dia === null) throw new ErroReserva(400, 'data deve ser uma data válida no formato AAAA-MM-DD.');
  if (!HORA_REGEX.test(String(hora_inicio ?? ''))) {
    throw new ErroReserva(400, 'hora_inicio deve ser uma hora cheia no formato HH:00.');
  }
  const inicio = hhmm(hora_inicio);

  const hoje = isoLocal(new Date());
  const limite = new Date();
  limite.setDate(limite.getDate() + DIAS_ANTECEDENCIA);
  if (data < hoje) throw new ErroReserva(400, 'Não dá para reservar um dia que já passou.');
  if (data > isoLocal(limite)) throw new ErroReserva(400, `Reservas abertas só para os próximos ${DIAS_ANTECEDENCIA} dias.`);
  if (data === hoje) {
    const agora = new Date();
    if (minutos(inicio) <= agora.getHours() * 60 + agora.getMinutes()) {
      throw new ErroReserva(400, 'Esse horário já começou. Escolha um horário mais tarde.');
    }
  }

  // Kart: as baterias cabem dentro de um horário de 1 hora
  if (quadra.cobranca === 'bateria') {
    const minutosBateria = quadra.minutos_bateria || 15;
    const maximo = Math.max(1, Math.min(BATERIAS_MAXIMAS, Math.floor(60 / minutosBateria)));
    const n = baterias === undefined ? 1 : baterias;
    if (!Number.isInteger(n) || n < 1 || n > maximo) {
      throw new ErroReserva(400, `baterias deve ser um número inteiro de 1 a ${maximo}.`);
    }
    return { data, dia, hora_inicio: inicio, hora_fim: somarHoras(inicio, 1), horas: 1, baterias: n, minutos_bateria: minutosBateria };
  }

  const horas = duracao === undefined ? 1 : duracao;
  if (!Number.isInteger(horas) || horas < 1 || horas > DURACAO_MAXIMA) {
    throw new ErroReserva(400, `duracao deve ser um número inteiro de 1 a ${DURACAO_MAXIMA} horas.`);
  }
  if (Number(inicio.slice(0, 2)) + horas > 24) throw new ErroReserva(400, 'A reserva precisa terminar até a meia-noite.');
  return { data, dia, hora_inicio: inicio, hora_fim: somarHoras(inicio, horas), horas, baterias: null, minutos_bateria: null };
}

/**
 * Confere, dentro da transação, se o período está livre: cada hora precisa estar na grade
 * ativa da quadra, sem outra reserva ATIVA e sem bloqueio. ignorarSolicitacao: ao remarcar,
 * o horário da própria reserva conta como livre.
 */
async function conferirDisponibilidade(trx, quadraId, pedido, ignorarSolicitacao = null) {
  const grade = await trx('horarios').where({ quadra_id: quadraId, dia_semana: pedido.dia, ativo: true }).select('hora_inicio');
  const abertas = new Set(grade.map((h) => hhmm(h.hora_inicio)));
  for (let i = 0; i < pedido.horas; i++) {
    const hora = somarHoras(pedido.hora_inicio, i);
    if (!abertas.has(hora)) {
      throw new ErroReserva(409, i === 0
        ? `A quadra não abre às ${hora} nesse dia.`
        : `A quadra não abre às ${hora} nesse dia: escolha uma duração menor.`);
    }
  }

  const conflito = await trx('reservas as r')
    .join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
    .where({ 's.quadra_id': quadraId, 's.data_reserva': pedido.data, 'r.status': 'ATIVA' })
    .where('s.hora_inicio', '<', `${pedido.hora_fim}:00`)
    .where('s.hora_fim', '>', `${pedido.hora_inicio}:00`)
    .modify((q) => ignorarSolicitacao && q.whereNot('s.id', ignorarSolicitacao))
    .first('s.id');
  if (conflito) throw new ErroReserva(409, 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro.');

  const inicio = `${pedido.data} ${pedido.hora_inicio}:00`;
  const fim = pedido.hora_fim === '24:00'
    ? `${isoLocal(new Date(new Date(`${pedido.data}T12:00:00`).getTime() + 86400000))} 00:00:00`
    : `${pedido.data} ${pedido.hora_fim}:00`;
  const bloqueio = await trx('bloqueios_quadra')
    .where({ quadra_id: quadraId })
    .where('data_inicio', '<', fim)
    .where('data_fim', '>', inicio)
    .first('motivo');
  if (bloqueio) throw new ErroReserva(409, 'A quadra está bloqueada nesse horário.');
}

/** Trava a quadra (FOR UPDATE) e confere se ela recebe reservas. */
async function travarQuadra(trx, quadraId) {
  const quadra = await trx('quadras as q')
    .join('empresas as e', 'e.id', 'q.empresa_id')
    .where('q.id', quadraId)
    .forUpdate()
    .first('q.*', 'e.ativo as empresa_ativa');
  if (!quadra || quadra.status === 'inativa' || !quadra.empresa_ativa) throw new ErroReserva(404, 'Quadra não encontrada.');
  if (quadra.status !== 'ativa') throw new ErroReserva(409, 'A quadra está em manutenção e não está recebendo reservas.');
  return quadra;
}

const valorDe = (precoHora, pedido) => Number(precoHora) * (pedido.baterias ?? pedido.horas);

/** Cria a reserva. dono: { usuario_id } (jogador) ou { cliente_nome } (balcão, pela empresa). */
async function criarReserva({ quadraId, pedidoBruto, forma_pagamento, origem = 'app', dono }) {
  if (forma_pagamento !== undefined && !FORMAS_PAGAMENTO.includes(forma_pagamento)) {
    throw new ErroReserva(400, `forma_pagamento deve ser: ${FORMAS_PAGAMENTO.join(', ')}.`);
  }
  return db.transaction(async (trx) => {
    const quadra = await travarQuadra(trx, quadraId);
    const pedido = validarPedido(quadra, pedidoBruto);
    await conferirDisponibilidade(trx, quadra.id, pedido);

    const [solicitacaoId] = await trx('solicitacoes_reserva').insert({
      usuario_id: dono.usuario_id ?? null,
      cliente_nome: dono.cliente_nome ?? null,
      quadra_id: quadra.id,
      status_id: STATUS_APROVADA,
      data_reserva: pedido.data,
      hora_inicio: pedido.hora_inicio,
      hora_fim: pedido.hora_fim,
    });
    const [id] = await trx('reservas').insert({
      solicitacao_id: solicitacaoId,
      status: 'ATIVA',
      preco_snapshot: quadra.valor_hora,
      valor_total: valorDe(quadra.valor_hora, pedido),
      forma_pagamento: forma_pagamento ?? 'Pix',
      origem,
      baterias: pedido.baterias,
      minutos_bateria: pedido.minutos_bateria,
    });
    return id;
  });
}

/** Troca dia/horário (e duração) de uma reserva ATIVA que ainda não começou. */
async function remarcarReserva(reservaId, pedidoBruto, podeMexer) {
  return db.transaction(async (trx) => {
    const atual = await buscarParaAlterar(trx, reservaId, podeMexer);
    const quadra = await travarQuadra(trx, atual.quadra_id);
    const pedido = validarPedido(quadra, pedidoBruto);
    await conferirDisponibilidade(trx, quadra.id, pedido, atual.solicitacao_id);

    await trx('solicitacoes_reserva').where({ id: atual.solicitacao_id }).update({
      data_reserva: pedido.data,
      hora_inicio: pedido.hora_inicio,
      hora_fim: pedido.hora_fim,
      updated_at: trx.fn.now(),
    });
    await trx('reservas').where({ id: atual.id }).update({
      preco_snapshot: quadra.valor_hora,
      valor_total: valorDe(quadra.valor_hora, pedido),
      baterias: pedido.baterias,
      minutos_bateria: pedido.minutos_bateria,
      remarcada_em: trx.fn.now(),
      data_anterior: atual.data_reserva,
      hora_anterior: atual.hora_inicio,
    });
    return atual.id;
  });
}

/** Cancela uma reserva ATIVA que ainda não começou. */
async function cancelarReserva(reservaId, podeMexer) {
  return db.transaction(async (trx) => {
    const atual = await buscarParaAlterar(trx, reservaId, podeMexer);
    await trx('reservas').where({ id: atual.id }).update({ status: 'CANCELADA', cancelada_em: trx.fn.now() });
    await trx('solicitacoes_reserva')
      .where({ id: atual.solicitacao_id })
      .update({ status_id: STATUS_CANCELADA, updated_at: trx.fn.now() });
    return atual.id;
  });
}

// podeMexer(linha) diz se quem chamou é dono da reserva (jogador) ou da quadra (empresa)
async function buscarParaAlterar(trx, reservaId, podeMexer) {
  const atual = await trx('reservas as r')
    .join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
    .join('quadras as q', 'q.id', 's.quadra_id')
    .where('r.id', reservaId)
    .forUpdate()
    .first('r.id', 'r.status', 'r.solicitacao_id', 's.usuario_id', 's.quadra_id', 's.data_reserva', 's.hora_inicio', 'q.empresa_id');
  if (!atual || !podeMexer(atual)) throw new ErroReserva(404, 'Reserva não encontrada.');
  if (atual.status !== 'ATIVA') throw new ErroReserva(409, 'Esta reserva já foi cancelada.');
  const dataTexto = atual.data_reserva instanceof Date ? isoLocal(atual.data_reserva) : String(atual.data_reserva).slice(0, 10);
  if (new Date(`${dataTexto}T${hhmm(atual.hora_inicio)}:00`) <= new Date()) {
    throw new ErroReserva(409, 'Esta reserva já começou ou terminou e não pode mais ser alterada.');
  }
  atual.data_reserva = dataTexto;
  return atual;
}

/** Consulta base das reservas, com quadra, empresa e cliente. */
function consultaReservas() {
  return db('reservas as r')
    .join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
    .join('quadras as q', 'q.id', 's.quadra_id')
    .join('tipos_quadra as t', 't.id', 'q.tipo_quadra_id')
    .join('empresas as e', 'e.id', 'q.empresa_id')
    .leftJoin('usuarios as u', 'u.id', 's.usuario_id')
    .select(
      'r.id', 'r.status', 'r.preco_snapshot', 'r.valor_total', 'r.forma_pagamento', 'r.pago', 'r.origem',
      'r.baterias', 'r.minutos_bateria', 'r.cancelada_em', 'r.remarcada_em', 'r.data_anterior', 'r.hora_anterior',
      'r.created_at',
      's.usuario_id', 's.cliente_nome', 's.data_reserva', 's.hora_inicio', 's.hora_fim', 's.observacao',
      'q.id as quadra_id', 'q.nome as quadra_nome', 'q.imagem_url as quadra_imagem', 'q.cobranca',
      't.descricao as tipo_quadra',
      'e.id as empresa_id', 'e.nome as empresa_nome', 'e.endereco as empresa_endereco', 'e.perfil as empresa_perfil',
      'u.nome as usuario_nome', 'u.telefone as usuario_telefone'
    );
}

const dataIso = (d) => (d instanceof Date ? isoLocal(d) : d ? String(d).slice(0, 10) : null);

/** Linha do banco -> JSON da API. */
function formatarReserva(r) {
  const perfil = lerObjeto(r.empresa_perfil);
  const horas = (minutos(r.hora_fim) - minutos(r.hora_inicio)) / 60;
  return {
    id: r.id,
    status: r.status,
    data: dataIso(r.data_reserva),
    hora_inicio: hhmm(r.hora_inicio),
    hora_fim: hhmm(r.hora_fim),
    duracao_horas: horas,
    baterias: r.baterias,
    minutos_bateria: r.minutos_bateria,
    preco_hora: r.preco_snapshot === null ? null : Number(r.preco_snapshot),
    valor_total: r.valor_total === null
      ? (r.preco_snapshot === null ? null : Number(r.preco_snapshot) * horas)
      : Number(r.valor_total),
    forma_pagamento: r.forma_pagamento,
    pago: Boolean(r.pago),
    origem: r.origem,
    cliente: r.usuario_nome || r.cliente_nome || 'Cliente',
    cliente_telefone: r.usuario_telefone || null,
    quadra: {
      id: r.quadra_id,
      nome: r.quadra_nome,
      tipo_quadra: r.tipo_quadra,
      imagem_url: r.quadra_imagem,
      cobranca: r.cobranca,
      empresa: {
        id: r.empresa_id,
        nome: r.empresa_nome,
        endereco: r.empresa_endereco,
        bairro: perfil.bairro || null,
        cidade: perfil.cidade || null,
      },
    },
    criada_em: r.created_at,
    cancelada_em: r.cancelada_em,
    remarcada_em: r.remarcada_em,
    anterior: r.data_anterior ? { data: dataIso(r.data_anterior), hora_inicio: hhmm(r.hora_anterior) } : null,
  };
}

/** Converte erros de reserva (e o SIGNAL do trigger) em resposta HTTP. */
function responderErro(res, err, contexto) {
  if (err instanceof ErroReserva) return res.status(err.status).json({ erro: err.message });
  if (err.sqlState === '45000') {
    return res.status(409).json({ erro: 'Esse horário acabou de ser reservado por outra pessoa. Escolha outro.' });
  }
  console.error(`Erro ao ${contexto}:`, err);
  return res.status(500).json({ erro: 'Erro interno no servidor.' });
}

module.exports = {
  FORMAS_PAGAMENTO, criarReserva, remarcarReserva, cancelarReserva, consultaReservas, formatarReserva, responderErro,
};
