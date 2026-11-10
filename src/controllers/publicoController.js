const db = require('../config/database');
const { lerComodidades } = require('./quadraController');

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

// GET /publico/quadras?data=AAAA-MM-DD (padrão: hoje)
// Quadras ativas ou em manutenção de empresas ativas, com os horários livres do dia:
// slots ativos da grade semanal, sem reserva ATIVA, sem bloqueio e que ainda não começaram.
// Quadra em manutenção aparece, mas sempre sem horários livres.
async function listarQuadras(req, res) {
  const hoje = isoLocal(new Date());
  const data = req.query.data === undefined ? hoje : String(req.query.data);
  const dia = diaDaSemana(data);
  if (dia === null) {
    return res.status(400).json({ erro: 'data deve ser uma data válida no formato AAAA-MM-DD.' });
  }

  try {
    const quadras = await db('quadras as q')
      .join('tipos_quadra as t', 't.id', 'q.tipo_quadra_id')
      .join('empresas as e', 'e.id', 'q.empresa_id')
      .whereIn('q.status', ['ativa', 'manutencao'])
      .where('e.ativo', true)
      .select(
        'q.id', 'q.nome', 'q.descricao', 'q.valor_hora', 'q.tipo_quadra_id', 'q.status',
        'q.piso', 'q.cobertura', 'q.capacidade', 'q.comodidades', 'q.imagem_url',
        't.descricao as tipo_quadra',
        'e.id as empresa_id', 'e.nome as empresa_nome', 'e.endereco as empresa_endereco'
      )
      .orderBy('q.nome');

    if (!quadras.length) return res.json([]);

    const idsAtivas = quadras.filter((q) => q.status === 'ativa').map((q) => q.id);
    const inicioDoDia = new Date(`${data}T00:00:00`);
    const fimDoDia = new Date(inicioDoDia.getTime() + MINUTOS_NO_DIA * 60000);

    const [horarios, reservas, bloqueios] = await Promise.all([
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
    ]);

    const ocupados = new Map();
    const ocupar = (quadraId, inicio, fim) => {
      if (!ocupados.has(quadraId)) ocupados.set(quadraId, []);
      ocupados.get(quadraId).push([inicio, fim]);
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

    return res.json(
      quadras.map((q) => ({
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
        empresa: { id: q.empresa_id, nome: q.empresa_nome, endereco: q.empresa_endereco },
        horarios_livres: livres.get(q.id) || [],
      }))
    );
  } catch (err) {
    console.error('Erro ao listar quadras públicas:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { listarQuadras };
