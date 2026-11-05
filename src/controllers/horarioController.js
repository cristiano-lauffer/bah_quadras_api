const db = require('../config/database');

// Aceita HH:MM ou HH:MM:SS (e 24:00 para "até a meia-noite")
const HORA_REGEX = /^(?:([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?|(24):00(?::00)?)$/;
const MAX_LOTE = 200;

function normalizarHora(valor) {
  const m = HORA_REGEX.exec(String(valor === undefined || valor === null ? '' : valor).trim());
  if (!m) return null;
  if (m[4]) return '24:00:00';
  return `${m[1]}:${m[2]}:${m[3] || '00'}`;
}

// Hora vinda do MySQL (HH:MM:SS) -> HH:MM para o front
function formatar(h) {
  return {
    id: h.id,
    quadra_id: h.quadra_id,
    dia_semana: h.dia_semana,
    hora_inicio: String(h.hora_inicio).slice(0, 5),
    hora_fim: String(h.hora_fim).slice(0, 5),
    ativo: Boolean(h.ativo),
  };
}

// Valida um slot. Retorna { slot } ou { erro }.
// dia_semana: 0 = domingo ... 6 = sábado (igual ao Date.getDay() do JavaScript)
function validarSlot(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return { erro: 'Horário inválido.' };
  if (!Number.isInteger(s.dia_semana) || s.dia_semana < 0 || s.dia_semana > 6) {
    return { erro: 'dia_semana deve ser um inteiro de 0 (domingo) a 6 (sábado).' };
  }
  const hora_inicio = normalizarHora(s.hora_inicio);
  const hora_fim = normalizarHora(s.hora_fim);
  if (!hora_inicio || !hora_fim) return { erro: 'hora_inicio e hora_fim devem estar no formato HH:MM.' };
  if (hora_inicio === '24:00:00' || hora_fim <= hora_inicio) {
    return { erro: 'hora_fim deve ser maior que hora_inicio.' };
  }
  if (s.ativo !== undefined && typeof s.ativo !== 'boolean') {
    return { erro: 'O campo "ativo" deve ser true ou false.' };
  }
  return {
    slot: { dia_semana: s.dia_semana, hora_inicio, hora_fim, ativo: s.ativo === undefined ? true : s.ativo },
  };
}

// Mesmo dia e períodos que se cruzam (encostar não conta: 18-19 e 19-20 são válidos)
function sobrepoe(a, b) {
  return a.dia_semana === b.dia_semana && a.hora_inicio < b.hora_fim && a.hora_fim > b.hora_inicio;
}

function descrever(s) {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return `${dias[s.dia_semana]} ${String(s.hora_inicio).slice(0, 5)}-${String(s.hora_fim).slice(0, 5)}`;
}

// Ownership: a quadra precisa ser da empresa logada (senão 404, sem vazar existência)
function buscarQuadraDaEmpresa(quadraId, empresaId, conexao = db) {
  return conexao('quadras').where({ id: quadraId, empresa_id: empresaId }).first();
}

// GET /quadras/:id/horarios — grade completa (inclui slots bloqueados)
async function listar(req, res) {
  try {
    const quadra = await buscarQuadraDaEmpresa(req.params.id, req.usuario.empresa_id);
    if (!quadra) return res.status(404).json({ erro: 'Quadra não encontrada.' });

    const consulta = db('horarios').where({ quadra_id: quadra.id }).orderBy(['dia_semana', 'hora_inicio']);

    if (req.query.dia_semana !== undefined) {
      const dia = Number(req.query.dia_semana);
      if (!Number.isInteger(dia) || dia < 0 || dia > 6) {
        return res.status(400).json({ erro: 'dia_semana deve ser um inteiro de 0 a 6.' });
      }
      consulta.where({ dia_semana: dia });
    }
    if (req.query.ativo === 'true') consulta.where({ ativo: true });
    if (req.query.ativo === 'false') consulta.where({ ativo: false });

    const horarios = await consulta;
    return res.json(horarios.map(formatar));
  } catch (err) {
    console.error('Erro ao listar horários:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// POST /quadras/:id/horarios — cria um slot ({dia_semana, hora_inicio, hora_fim})
// ou vários de uma vez ({ horarios: [ ... ] }). Tudo ou nada: se um falhar, nenhum é criado.
async function criar(req, res) {
  const lista = Array.isArray(req.body.horarios) ? req.body.horarios : [req.body];
  if (lista.length === 0 || lista.length > MAX_LOTE) {
    return res.status(400).json({ erro: `Envie de 1 a ${MAX_LOTE} horários.` });
  }

  const novos = [];
  for (let i = 0; i < lista.length; i++) {
    const { slot, erro } = validarSlot(lista[i]);
    if (erro) return res.status(400).json({ erro: lista.length > 1 ? `Horário #${i + 1}: ${erro}` : erro });
    novos.push(slot);
  }

  // Sobreposição dentro do próprio lote
  for (let i = 0; i < novos.length; i++) {
    for (let j = i + 1; j < novos.length; j++) {
      if (sobrepoe(novos[i], novos[j])) {
        return res.status(409).json({
          erro: `Horários #${i + 1} e #${j + 1} se sobrepõem (${descrever(novos[i])} / ${descrever(novos[j])}).`,
        });
      }
    }
  }

  try {
    const resultado = await db.transaction(async (trx) => {
      // Trava a linha da quadra: duas requisições simultâneas na mesma quadra são serializadas,
      // então a checagem de sobreposição abaixo não corre risco de corrida.
      const quadra = await trx('quadras')
        .where({ id: req.params.id, empresa_id: req.usuario.empresa_id })
        .forUpdate()
        .first();
      if (!quadra) return { naoEncontrada: true };

      const existentes = await trx('horarios').where({ quadra_id: quadra.id });
      for (const novo of novos) {
        const conflito = existentes.find((e) => sobrepoe(novo, e));
        if (conflito) return { conflito: `${descrever(novo)} sobrepõe o horário já cadastrado ${descrever(conflito)}.` };
      }

      const [primeiroId] = await trx('horarios').insert(
        novos.map((n) => ({ quadra_id: quadra.id, ...n }))
      );
      const criados = await trx('horarios').where({ quadra_id: quadra.id }).where('id', '>=', primeiroId).orderBy('id');
      return { criados };
    });

    if (resultado.naoEncontrada) return res.status(404).json({ erro: 'Quadra não encontrada.' });
    if (resultado.conflito) return res.status(409).json({ erro: resultado.conflito });

    return res.status(201).json({
      mensagem: resultado.criados.length === 1 ? 'Horário criado com sucesso.' : 'Horários criados com sucesso.',
      horarios: resultado.criados.map(formatar),
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um horário com esse início.' });
    console.error('Erro ao criar horários:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PATCH /quadras/:id/horarios/:horarioId — habilita/bloqueia (ativo) ou ajusta o período
async function atualizar(req, res) {
  const { ativo, dia_semana, hora_inicio, hora_fim } = req.body;
  if ([ativo, dia_semana, hora_inicio, hora_fim].every((v) => v === undefined)) {
    return res.status(400).json({ erro: 'Nenhum campo válido para atualizar.' });
  }

  try {
    const resultado = await db.transaction(async (trx) => {
      const quadra = await trx('quadras')
        .where({ id: req.params.id, empresa_id: req.usuario.empresa_id })
        .forUpdate()
        .first();
      if (!quadra) return { naoEncontrada: true };

      const atual = await trx('horarios').where({ id: req.params.horarioId, quadra_id: quadra.id }).first();
      if (!atual) return { naoEncontrada: true };

      const { slot, erro } = validarSlot({
        dia_semana: dia_semana === undefined ? atual.dia_semana : dia_semana,
        hora_inicio: hora_inicio === undefined ? String(atual.hora_inicio) : hora_inicio,
        hora_fim: hora_fim === undefined ? String(atual.hora_fim) : hora_fim,
        ativo: ativo === undefined ? Boolean(atual.ativo) : ativo,
      });
      if (erro) return { invalido: erro };

      const outros = await trx('horarios').where({ quadra_id: quadra.id }).whereNot({ id: atual.id });
      const conflito = outros.find((o) => sobrepoe(slot, o));
      if (conflito) return { conflito: `${descrever(slot)} sobrepõe o horário já cadastrado ${descrever(conflito)}.` };

      await trx('horarios').where({ id: atual.id }).update({ ...slot, updated_at: trx.fn.now() });
      return { horario: await trx('horarios').where({ id: atual.id }).first() };
    });

    if (resultado.naoEncontrada) return res.status(404).json({ erro: 'Horário não encontrado.' });
    if (resultado.invalido) return res.status(400).json({ erro: resultado.invalido });
    if (resultado.conflito) return res.status(409).json({ erro: resultado.conflito });

    return res.json({ mensagem: 'Horário atualizado com sucesso.', horario: formatar(resultado.horario) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um horário com esse início.' });
    console.error('Erro ao atualizar horário:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// DELETE /quadras/:id/horarios/:horarioId
// Seguro para reservas existentes: elas guardam data/hora próprias em solicitacoes_reserva.
async function excluir(req, res) {
  try {
    const quadra = await buscarQuadraDaEmpresa(req.params.id, req.usuario.empresa_id);
    if (!quadra) return res.status(404).json({ erro: 'Horário não encontrado.' });

    const removidos = await db('horarios').where({ id: req.params.horarioId, quadra_id: quadra.id }).del();
    if (!removidos) return res.status(404).json({ erro: 'Horário não encontrado.' });

    return res.json({ mensagem: 'Horário removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao remover horário:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { listar, criar, atualizar, excluir };
