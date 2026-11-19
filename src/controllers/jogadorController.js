// Favoritas e avaliações do jogador logado.
const db = require('../config/database');
const { consultaAvaliacoes, formatarAvaliacao } = require('./publicoController');

const ASPECTOS = ['Iluminação', 'Limpeza', 'Atendimento', 'Estrutura', 'Localização', 'Custo-benefício'];

const idValido = (v) => Number.isInteger(Number(v)) && Number(v) > 0;

// Quadra que aparece na vitrine (ativa ou em manutenção, de empresa ativa)
function quadraVisivel(id) {
  return db('quadras as q')
    .join('empresas as e', 'e.id', 'q.empresa_id')
    .where('q.id', id)
    .whereIn('q.status', ['ativa', 'manutencao'])
    .where('e.ativo', true)
    .first('q.id');
}

/* ---------------- Favoritas ---------------- */

// GET /favoritos — ids das quadras favoritas
async function listarFavoritos(req, res) {
  try {
    const linhas = await db('favoritos').where({ usuario_id: req.usuario.id }).orderBy('created_at').select('quadra_id');
    return res.json(linhas.map((l) => l.quadra_id));
  } catch (err) {
    console.error('Erro ao listar favoritos:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PUT /favoritos/:quadraId
async function adicionarFavorito(req, res) {
  if (!idValido(req.params.quadraId)) return res.status(404).json({ erro: 'Quadra não encontrada.' });
  try {
    if (!(await quadraVisivel(req.params.quadraId))) return res.status(404).json({ erro: 'Quadra não encontrada.' });
    await db('favoritos').insert({ usuario_id: req.usuario.id, quadra_id: req.params.quadraId }).onConflict().ignore();
    return listarFavoritos(req, res);
  } catch (err) {
    console.error('Erro ao favoritar:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// DELETE /favoritos/:quadraId
async function removerFavorito(req, res) {
  try {
    await db('favoritos').where({ usuario_id: req.usuario.id, quadra_id: Number(req.params.quadraId) || 0 }).del();
    return listarFavoritos(req, res);
  } catch (err) {
    console.error('Erro ao remover favorito:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

/* ---------------- Avaliações ---------------- */

// GET /avaliacoes/minhas — avaliações publicadas pelo jogador + ids que ele marcou como úteis
async function minhasAvaliacoes(req, res) {
  try {
    const [lista, uteis] = await Promise.all([
      consultaAvaliacoes().where('a.usuario_id', req.usuario.id),
      db('avaliacoes_uteis').where({ usuario_id: req.usuario.id }).select('avaliacao_id'),
    ]);
    return res.json({ avaliacoes: lista.map(formatarAvaliacao), uteis: uteis.map((u) => u.avaliacao_id) });
  } catch (err) {
    console.error('Erro ao listar avaliações do jogador:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// POST /avaliacoes — { quadra_id, nota, aspectos?, texto, autor_nome? } (sem autor_nome, vai o nome da conta)
async function publicarAvaliacao(req, res) {
  const { quadra_id, nota, aspectos = [], texto, autor_nome } = req.body;
  if (!idValido(quadra_id)) return res.status(400).json({ erro: 'quadra_id é obrigatório.' });
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return res.status(400).json({ erro: 'nota deve ser um número inteiro de 1 a 5.' });
  if (!Array.isArray(aspectos) || !aspectos.every((a) => ASPECTOS.includes(a))) {
    return res.status(400).json({ erro: `aspectos deve ser uma lista com: ${ASPECTOS.join(', ')}.` });
  }
  const textoLimpo = String(texto ?? '').trim();
  if (textoLimpo.length < 10 || textoLimpo.length > 1000) {
    return res.status(400).json({ erro: 'O comentário deve ter de 10 a 1000 caracteres.' });
  }

  const nomeInformado = autor_nome === undefined || autor_nome === null ? '' : String(autor_nome).trim();
  if (nomeInformado.length > 100) return res.status(400).json({ erro: 'O nome deve ter no máximo 100 caracteres.' });

  try {
    if (!(await quadraVisivel(quadra_id))) return res.status(404).json({ erro: 'Quadra não encontrada.' });
    const usuario = await db('usuarios').where({ id: req.usuario.id }).first('nome');
    const [id] = await db('avaliacoes').insert({
      quadra_id,
      usuario_id: req.usuario.id,
      autor_nome: nomeInformado || usuario.nome,
      nota,
      aspectos: JSON.stringify([...new Set(aspectos)]),
      texto: textoLimpo,
    });
    const criada = await consultaAvaliacoes().where('a.id', id).first();
    return res.status(201).json({ mensagem: 'Avaliação publicada.', avaliacao: formatarAvaliacao(criada) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Você já avaliou esta quadra.' });
    console.error('Erro ao publicar avaliação:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// DELETE /avaliacoes/:id — só a própria
async function apagarAvaliacao(req, res) {
  try {
    const apagadas = await db('avaliacoes').where({ id: Number(req.params.id) || 0, usuario_id: req.usuario.id }).del();
    if (!apagadas) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    return res.json({ mensagem: 'Avaliação apagada.' });
  } catch (err) {
    console.error('Erro ao apagar avaliação:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PUT e DELETE /avaliacoes/:id/util — marca/desmarca como útil (não vale na própria)
async function marcarUtil(req, res) {
  const id = Number(req.params.id) || 0;
  try {
    const avaliacao = await db('avaliacoes').where({ id }).first('usuario_id');
    if (!avaliacao) return res.status(404).json({ erro: 'Avaliação não encontrada.' });
    if (avaliacao.usuario_id === req.usuario.id) return res.status(400).json({ erro: 'Você não pode marcar a própria avaliação.' });

    if (req.method === 'PUT') {
      await db('avaliacoes_uteis').insert({ usuario_id: req.usuario.id, avaliacao_id: id }).onConflict().ignore();
    } else {
      await db('avaliacoes_uteis').where({ usuario_id: req.usuario.id, avaliacao_id: id }).del();
    }
    const atualizada = await consultaAvaliacoes().where('a.id', id).first();
    return res.json({ avaliacao: formatarAvaliacao(atualizada), marcada: req.method === 'PUT' });
  } catch (err) {
    console.error('Erro ao marcar avaliação útil:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = {
  listarFavoritos, adicionarFavorito, removerFavorito, minhasAvaliacoes, publicarAvaliacao, apagarAvaliacao, marcarUtil,
};
