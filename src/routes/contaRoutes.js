const express = require('express');
const { autenticar, exigirPapel, exigirEmpresaVinculada } = require('../middlewares/authMiddleware');
const conta = require('../controllers/contaController');
const reservas = require('../controllers/reservaController');
const jogador = require('../controllers/jogadorController');
const empresa = require('../controllers/painelEmpresaController');
const upload = require('../controllers/uploadController');

// /me — conta de quem está logado (qualquer papel)
const me = express.Router();
me.use(autenticar);
me.get('/', conta.obter);
me.patch('/', conta.atualizar);
me.delete('/', conta.excluir);
me.put('/senha', conta.trocarSenha);
me.get('/notificacoes-lidas', conta.lidas);
me.post('/notificacoes-lidas', conta.marcarLidas);

// Rotas do jogador (papel 'cliente'). Montadas na raiz: o login é exigido rota a rota,
// para não barrar as outras rotas da API.
const jogadorRotas = express.Router();
const soJogador = [autenticar, exigirPapel('cliente')];
jogadorRotas.get('/reservas', soJogador, reservas.listar);
jogadorRotas.post('/reservas', soJogador, reservas.criar);
jogadorRotas.patch('/reservas/:id', soJogador, reservas.remarcar);
jogadorRotas.post('/reservas/:id/cancelar', soJogador, reservas.cancelar);
jogadorRotas.get('/favoritos', soJogador, jogador.listarFavoritos);
jogadorRotas.put('/favoritos/:quadraId', soJogador, jogador.adicionarFavorito);
jogadorRotas.delete('/favoritos/:quadraId', soJogador, jogador.removerFavorito);
jogadorRotas.get('/avaliacoes/minhas', soJogador, jogador.minhasAvaliacoes);
jogadorRotas.post('/avaliacoes', soJogador, jogador.publicarAvaliacao);
jogadorRotas.delete('/avaliacoes/:id', soJogador, jogador.apagarAvaliacao);
jogadorRotas.put('/avaliacoes/:id/util', soJogador, jogador.marcarUtil);
jogadorRotas.delete('/avaliacoes/:id/util', soJogador, jogador.marcarUtil);

// /empresa — painel da empresa logada (só os próprios dados)
const empresaRotas = express.Router();
empresaRotas.use(autenticar, exigirPapel('empresa'), exigirEmpresaVinculada);
empresaRotas.get('/perfil', empresa.obterPerfil);
empresaRotas.put('/perfil', empresa.salvarPerfil);
empresaRotas.get('/reservas', empresa.listarReservas);
empresaRotas.post('/reservas', empresa.criarReservaBalcao);
empresaRotas.post('/reservas/:id/pagar', empresa.marcarPaga);
empresaRotas.post('/reservas/:id/cancelar', empresa.cancelar);
empresaRotas.get('/avaliacoes', empresa.listarAvaliacoes);
empresaRotas.put('/avaliacoes/:id/resposta', empresa.responder);
empresaRotas.delete('/avaliacoes/:id/resposta', empresa.apagarResposta);

// /uploads — envio de foto (jogador ou empresa logados)
const uploads = express.Router();
uploads.post('/', autenticar, exigirPapel('empresa', 'cliente'), upload.enviar);

module.exports = { me, jogadorRotas, empresaRotas, uploads };
