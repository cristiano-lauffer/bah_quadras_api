# Integração completa do Bah Quadras: onde parou

Atualizado em 26/11/2026. Branch
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

## Regras de negócio (26/11/2026)
- Pagamento combinado com a empresa pelo WhatsApp (botão "Falar com a empresa" na confirmação). A reserva fica "Aguardando pagamento" até a empresa clicar em "Marcar pago"; aí vira "Confirmada".
- Cancelamento/remarcação pelo jogador só com mais de 24h (CANCELAMENTO_HORAS no .env da API). Dentro do prazo: WhatsApp da empresa, que cancela pelo painel.
- Reserva paga e cancelada fica com reembolso "pendente" até a empresa confirmar quanto devolveu ("Marcar reembolsado" pede o valor; o que ela reteve entra no financeiro).
- Empresa: botão "Novo horário" em Reservas (reserva presencial ou bloqueio de horário).
- Admin (/admin): números gerais, empresas (cadastrar, editar, ativar/desativar, link de senha). Empresa desativada some do site e não entra.
- Banco existente: rodar migracoes/003_cancelamento_reembolso.sql.

## Falta fazer
1. Testar no navegador o resto: avaliações, favoritas, Meus dados com foto, trocar/recuperar senha, notificações, editar perfil da empresa com fotos, cadastro de quadra com foto, kart.
2. Envio de e-mail de verdade (recuperação de senha e links do admin).
3. Corrigir as 3 expectativas antigas de ferramentas/teste_api.mjs.
4. Atualizar READMEs e a coleção do Postman da API com as rotas novas.
5. Abrir os PRs para a main quando quiser.
6. Ideia futura: liberar automaticamente o horário de reservas não pagas depois de um prazo (ex.: 2 horas).

## Contas (senhas de desenvolvimento)
- Empresa Arena Central: contato@arenacentral.com / empresa123
- Empresa Arena Sport (painel cheio de dados): contato@arenasport.com / empresa123 (nova)
- Jogadores: joao@arena.local e maria@arena.local / cliente123
- Admin (painel em /admin): admin@bahquadras.com / admin123

## Para voltar a rodar
1. Ligar o MySQL (PowerShell como administrador): `Start-Service MySQL80`
2. `cd bah_quadras_api` e depois `npm run dev`
3. Em outro terminal: `cd bah_quadras_web` e depois `npm run dev` → http://localhost:5173

Para recriar o banco: `bah_quadras_db/bah_quadras_reset_completo.sql` (apaga tudo).
Para regerar os seeds depois de mudar os dados de exemplo: `node ferramentas/gerar_seeds.mjs`
(precisa dos arquivos antigos de `src/data`, que agora só existem no histórico do git:
rode com `git stash` aplicado, como foi feito aqui, ou adapte o script).
