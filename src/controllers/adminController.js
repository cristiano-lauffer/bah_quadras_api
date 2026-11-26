// Painel do admin: empresas parceiras e números gerais do sistema.
// O cadastro (POST /admin/empresas) continua em empresaController.criarEmpresa.
const crypto = require('crypto');
const db = require('../config/database');
const { lerObjeto } = require('./quadraController');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MINUTOS_LINK_SENHA = 24 * 60; // link gerado pelo admin vale 24 horas

function consultaEmpresas() {
  return db('empresas as e')
    .leftJoin('usuarios as u', function ligar() {
      this.on('u.empresa_id', 'e.id').andOn('u.papel', db.raw('?', ['empresa']));
    })
    .select(
      'e.id', 'e.nome', 'e.cnpj', 'e.telefone', 'e.endereco', 'e.ativo', 'e.perfil', 'e.created_at',
      'u.id as responsavel_id', 'u.nome as responsavel_nome', 'u.email as responsavel_email',
      db.raw("(select count(*) from quadras q where q.empresa_id = e.id and q.status <> 'inativa') as quadras"),
      db.raw(`(select count(*) from reservas r join solicitacoes_reserva s on s.id = r.solicitacao_id
               join quadras q on q.id = s.quadra_id
               where q.empresa_id = e.id and r.status = 'ATIVA'
               and s.data_reserva >= CURDATE() - INTERVAL 30 DAY and s.data_reserva < CURDATE()) as reservas_30_dias`)
    );
}

function formatar(e) {
  const perfil = lerObjeto(e.perfil);
  return {
    id: e.id,
    nome: e.nome,
    cnpj: e.cnpj,
    telefone: e.telefone,
    endereco: e.endereco,
    cidade: perfil.cidade || null,
    ativo: Boolean(e.ativo),
    created_at: e.created_at,
    responsavel: e.responsavel_id ? { id: e.responsavel_id, nome: e.responsavel_nome, email: e.responsavel_email } : null,
    quadras: Number(e.quadras),
    reservas_30_dias: Number(e.reservas_30_dias),
  };
}

// GET /admin/empresas
async function listarEmpresas(req, res) {
  try {
    const lista = await consultaEmpresas().orderBy('e.nome');
    return res.json(lista.map(formatar));
  } catch (err) {
    console.error('Erro ao listar empresas:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /admin/empresas/:id
async function buscarEmpresa(req, res) {
  try {
    const empresa = await consultaEmpresas().where('e.id', Number(req.params.id) || 0).first();
    if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    return res.json(formatar(empresa));
  } catch (err) {
    console.error('Erro ao buscar empresa:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// PATCH /admin/empresas/:id — { nome?, cnpj?, telefone?, endereco?, ativo?, responsavel_nome?, responsavel_email? }
// Desativada, a empresa some do site e o responsável não consegue entrar.
async function atualizarEmpresa(req, res) {
  const { nome, cnpj, telefone, endereco, ativo, responsavel_nome, responsavel_email } = req.body;
  const empresa = {};
  const usuario = {};

  if (nome !== undefined) {
    const texto = String(nome).trim();
    if (texto.length < 3 || texto.length > 200) return res.status(400).json({ erro: 'Nome deve ter de 3 a 200 caracteres.' });
    empresa.nome = texto;
  }
  if (cnpj !== undefined) {
    const digitos = String(cnpj ?? '').replace(/\D/g, '');
    if (digitos && digitos.length !== 14) return res.status(400).json({ erro: 'CNPJ deve ter 14 dígitos.' });
    empresa.cnpj = digitos || null;
  }
  if (telefone !== undefined) {
    const digitos = String(telefone ?? '').replace(/\D/g, '');
    if (digitos && (digitos.length < 10 || digitos.length > 11)) return res.status(400).json({ erro: 'Telefone deve ter DDD e 8 ou 9 dígitos.' });
    empresa.telefone = digitos || null;
  }
  if (endereco !== undefined) {
    const texto = endereco ? String(endereco).trim() : '';
    if (texto.length > 500) return res.status(400).json({ erro: 'Endereço deve ter no máximo 500 caracteres.' });
    empresa.endereco = texto || null;
  }
  if (ativo !== undefined) {
    if (typeof ativo !== 'boolean') return res.status(400).json({ erro: 'ativo deve ser true ou false.' });
    empresa.ativo = ativo;
  }
  if (responsavel_nome !== undefined) {
    const texto = String(responsavel_nome).trim();
    if (!texto || texto.length > 100) return res.status(400).json({ erro: 'Nome do responsável deve ter de 1 a 100 caracteres.' });
    usuario.nome = texto;
  }
  if (responsavel_email !== undefined) {
    const texto = String(responsavel_email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(texto)) return res.status(400).json({ erro: 'E-mail do responsável inválido.' });
    usuario.email = texto;
  }
  if (!Object.keys(empresa).length && !Object.keys(usuario).length) {
    return res.status(400).json({ erro: 'Nenhum campo válido para atualizar.' });
  }

  try {
    const atual = await consultaEmpresas().where('e.id', Number(req.params.id) || 0).first();
    if (!atual) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    if (empresa.cnpj && (await db('empresas').where({ cnpj: empresa.cnpj }).whereNot({ id: atual.id }).first('id'))) {
      return res.status(409).json({ erro: 'Este CNPJ já está cadastrado.' });
    }
    if (usuario.email && (await db('usuarios').where({ email: usuario.email }).whereNot({ id: atual.responsavel_id ?? 0 }).first('id'))) {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }
    if (Object.keys(usuario).length && !atual.responsavel_id) {
      return res.status(409).json({ erro: 'Esta empresa não tem responsável cadastrado.' });
    }
    await db.transaction(async (trx) => {
      if (Object.keys(empresa).length) await trx('empresas').where({ id: atual.id }).update({ ...empresa, updated_at: trx.fn.now() });
      if (Object.keys(usuario).length) await trx('usuarios').where({ id: atual.responsavel_id }).update({ ...usuario, updated_at: trx.fn.now() });
    });
    const atualizada = await consultaEmpresas().where('e.id', atual.id).first();
    return res.json({ mensagem: 'Empresa atualizada.', empresa: formatar(atualizada) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'CNPJ ou e-mail já cadastrado.' });
    console.error('Erro ao atualizar empresa:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// POST /admin/empresas/:id/redefinir-senha — gera um link (24 h) para o responsável criar uma senha nova.
// O admin repassa o link (ainda não há envio de e-mail).
async function redefinirSenha(req, res) {
  try {
    const empresa = await consultaEmpresas().where('e.id', Number(req.params.id) || 0).first();
    if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });
    if (!empresa.responsavel_id) return res.status(409).json({ erro: 'Esta empresa não tem responsável cadastrado.' });

    const token = crypto.randomBytes(32).toString('hex');
    await db('tokens_senha').insert({
      usuario_id: empresa.responsavel_id,
      token_hash: crypto.createHash('sha256').update(token).digest('hex'),
      expira_em: new Date(Date.now() + MINUTOS_LINK_SENHA * 60000),
    });
    const front = (process.env.FRONT_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const link = `${front}/redefinir-senha?token=${token}&email=${encodeURIComponent(empresa.responsavel_email)}`;
    return res.json({ mensagem: 'Link criado. Ele vale por 24 horas e só pode ser usado uma vez.', link, email: empresa.responsavel_email });
  } catch (err) {
    console.error('Erro ao gerar link de senha:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

// GET /admin/resumo — números gerais do sistema
async function resumo(req, res) {
  try {
    const um = (consulta) => consulta.first().then((r) => Number(Object.values(r)[0]));
    const [empresas, empresasAtivas, quadras, jogadores, reservasFuturas, reservas30, faturamento30] = await Promise.all([
      um(db('empresas').count({ n: '*' })),
      um(db('empresas').where({ ativo: true }).count({ n: '*' })),
      um(db('quadras').whereNot({ status: 'inativa' }).count({ n: '*' })),
      um(db('usuarios').where({ papel: 'cliente' }).count({ n: '*' })),
      um(db('reservas as r').join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
        .where('r.status', 'ATIVA').where('s.data_reserva', '>=', db.raw('CURDATE()')).count({ n: '*' })),
      um(db('reservas as r').join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
        .where('r.status', 'ATIVA').where('s.data_reserva', '>=', db.raw('CURDATE() - INTERVAL 30 DAY'))
        .where('s.data_reserva', '<', db.raw('CURDATE()')).count({ n: '*' })),
      um(db('reservas as r').join('solicitacoes_reserva as s', 's.id', 'r.solicitacao_id')
        .where('r.status', 'ATIVA').where('s.data_reserva', '>=', db.raw('CURDATE() - INTERVAL 30 DAY'))
        .where('s.data_reserva', '<', db.raw('CURDATE()')).sum({ n: 'r.valor_total' })),
    ]);
    return res.json({
      empresas, empresas_ativas: empresasAtivas, quadras, jogadores,
      reservas_futuras: reservasFuturas, reservas_30_dias: reservas30, movimento_30_dias: faturamento30 || 0,
    });
  } catch (err) {
    console.error('Erro no resumo do admin:', err);
    return res.status(500).json({ erro: 'Erro interno no servidor.' });
  }
}

module.exports = { listarEmpresas, buscarEmpresa, atualizarEmpresa, redefinirSenha, resumo };
