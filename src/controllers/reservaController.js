const {
  criarReserva, remarcarReserva, cancelarReserva, consultaReservas, formatarReserva, responderErro,
} = require('../services/reservas');

const doJogador = (req) => (linha) => linha.usuario_id === req.usuario.id;

async function buscar(id) {
  const linha = await consultaReservas().where('r.id', id).first();
  return formatarReserva(linha);
}

// GET /reservas — reservas do jogador logado (mais recentes primeiro)
async function listar(req, res) {
  try {
    const lista = await consultaReservas()
      .where('s.usuario_id', req.usuario.id)
      .orderBy([{ column: 's.data_reserva', order: 'desc' }, { column: 's.hora_inicio', order: 'desc' }]);
    return res.json(lista.map(formatarReserva));
  } catch (err) {
    return responderErro(res, err, 'listar reservas');
  }
}

// POST /reservas — { quadra_id, data, hora_inicio, duracao? | baterias?, forma_pagamento? }
async function criar(req, res) {
  const { quadra_id, data, hora_inicio, duracao, baterias, forma_pagamento } = req.body;
  if (!Number.isInteger(quadra_id) || quadra_id <= 0) {
    return res.status(400).json({ erro: 'quadra_id é obrigatório.' });
  }
  try {
    const id = await criarReserva({
      quadraId: quadra_id,
      pedidoBruto: { data, hora_inicio, duracao, baterias },
      forma_pagamento,
      dono: { usuario_id: req.usuario.id },
    });
    return res.status(201).json({ mensagem: 'Reserva confirmada.', reserva: await buscar(id) });
  } catch (err) {
    return responderErro(res, err, 'criar reserva');
  }
}

// PATCH /reservas/:id — remarca: { data, hora_inicio, duracao? | baterias? }
async function remarcar(req, res) {
  const { data, hora_inicio, duracao, baterias } = req.body;
  try {
    const id = await remarcarReserva(Number(req.params.id), { data, hora_inicio, duracao, baterias }, doJogador(req), { exigirPrazo: true });
    return res.json({ mensagem: 'Reserva remarcada.', reserva: await buscar(id) });
  } catch (err) {
    return responderErro(res, err, 'remarcar reserva');
  }
}

// POST /reservas/:id/cancelar
async function cancelar(req, res) {
  try {
    const id = await cancelarReserva(Number(req.params.id), doJogador(req), { por: 'jogador', exigirPrazo: true });
    const reserva = await buscar(id);
    const mensagem = reserva.reembolso === 'pendente'
      ? 'Reserva cancelada. Como ela já estava paga, a empresa vai devolver o valor: combine pelo WhatsApp.'
      : 'Reserva cancelada.';
    return res.json({ mensagem, reserva });
  } catch (err) {
    return responderErro(res, err, 'cancelar reserva');
  }
}

module.exports = { listar, criar, remarcar, cancelar };
