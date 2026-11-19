# Integração completa do Bah Quadras: onde parou

Data: 19/11/2026. **Nada foi commitado** (a seu pedido). Tudo está como alteração local na branch
`feature/integracao-completa` de cada repositório, criada a partir das branches dos bundles.

| Repositório | Branch base | O que mudou |
|---|---|---|
| bah_quadras_db | feature/integracao-api | colunas novas, tabelas `avaliacoes`, `avaliacoes_uteis`, `favoritos`, `tokens_senha`; seeds gerados a partir dos dados de demonstração (17 empresas, 23 quadras, ~1600 reservas em 6 meses, 165 avaliações); `migracoes/002_integracao_completa.sql`; reset completo regerado |
| bah_quadras_api | feature/integracao-front | reservas (criar, remarcar, cancelar, com checagem de grade, conflito, bloqueio e horário passado), favoritos, avaliações e "útil", painel da empresa (perfil, reservas, pagar, cancelar, balcão, respostas), `/me` (dados, foto, preferências, senha, excluir conta, avisos lidos), recuperação de senha, `POST /uploads`, depoimentos, ocupação das quadras |
| bah_quadras_web | feature/integracao-api | todos os serviços falam com a API; `src/data` de demonstração removido (sobrou só `data/avaliacoes.js` com as opções do formulário); envio de foto (quadra, perfil do jogador, capa e galeria da empresa) |

## Já verificado
- Banco recriado do zero sem erro (o trigger aceitou todas as reservas de seed).
- `ferramentas/teste_api.mjs`: 50 de 53 passam. As 3 falhas são expectativas do próprio teste, não bugs:
  são 23 quadras (a em manutenção aparece), o João tem 7 reservas (2 vêm dos seeds antigos)
  e a ordem das favoritas varia. Ajustar o teste.
- `vite build` e `oxlint` do front sem erros.
- O banco foi resetado no fim: está limpo para você testar.

## Falta fazer
1. **Testar no navegador** todo o fluxo (ainda não feito): Home, detalhe, agendamento (inclusive kart),
   remarcar, cancelar, avaliações, favoritas, perfil do jogador, painel da empresa (dashboard, reservas,
   financeiro, avaliações, notificações, editar perfil com fotos), recuperar senha.
2. Corrigir as 3 expectativas do `ferramentas/teste_api.mjs`.
3. Tela de **reserva de balcão** no painel da empresa (a rota `POST /empresa/reservas` existe, a tela não).
4. Atualizar READMEs e a coleção do Postman da API com as rotas novas.
5. Painel de admin no site: não existe (o admin continua só pela API). Decidir se entra.
6. Envio de e-mail de verdade na recuperação de senha (hoje o link sai no terminal da API e,
   fora de produção, no próprio site).
7. Revisar e commitar cada repositório (só quando você pedir).

## Contas (senhas de desenvolvimento)
- Empresa Arena Central: contato@arenacentral.com / empresa123
- Empresa Arena Sport (painel cheio de dados): contato@arenasport.com / empresa123 (nova)
- Jogadores: joao@arena.local e maria@arena.local / cliente123
- Admin (só API): admin@bahquadras.com / admin123

## Para voltar a rodar
1. Ligar o MySQL (PowerShell como administrador): `Start-Service MySQL80`
2. `cd bah_quadras_api` e depois `npm run dev`
3. Em outro terminal: `cd bah_quadras_web` e depois `npm run dev` → http://localhost:5173

Para recriar o banco: `bah_quadras_db/bah_quadras_reset_completo.sql` (apaga tudo).
Para regerar os seeds depois de mudar os dados de exemplo: `node ferramentas/gerar_seeds.mjs`
(precisa dos arquivos antigos de `src/data`, que agora só existem no histórico do git:
rode com `git stash` aplicado, como foi feito aqui, ou adapte o script).
