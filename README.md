# bah_quadras_api

API REST do Bah Quadras (Node.js + Express + Knex + MySQL).

## Rodando

1. Crie o banco (veja o README da raiz): `mysql -u root -p < ../db/bah_quadras_reset_completo.sql`
2. `cp .env.example .env` e ajuste (`JWT_SECRET` longo e secreto)
3. `npm install`
4. `npm run dev`

Teste manual: importe `postman/bah_quadras.postman_collection.json` no Postman e rode as pastas em ordem.

## Endpoints

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| POST | `/auth/register` | público | Cadastro de cliente (US1) |
| POST | `/auth/login` | público | Login de qualquer papel; JWT traz `papel` e `empresa_id` (US1/US2) |
| POST | `/admin/empresas` | admin | Cria empresa + responsável numa transação (US3) |
| GET | `/tipos-quadra` | logado | Tipos para os selects |
| POST | `/quadras` | empresa | Cadastra quadra (US4) |
| GET | `/quadras` | empresa | Lista as da própria empresa (`?ativa=true\|false`) |
| GET | `/quadras/:id` | empresa | Detalhe |
| PATCH | `/quadras/:id` | empresa | Edita nome, descrição, tipo, `valor_hora` (US6) e `ativa` (US4) |
| GET | `/quadras/:id/horarios` | empresa | Grade semanal (`?dia_semana=0..6`, `?ativo=true\|false`) (US5) |
| POST | `/quadras/:id/horarios` | empresa | Cria 1 slot ou vários: `{ "horarios": [ ... ] }` (tudo ou nada) |
| PATCH | `/quadras/:id/horarios/:horarioId` | empresa | Habilita/bloqueia (`ativo`) ou ajusta o período |
| DELETE | `/quadras/:id/horarios/:horarioId` | empresa | Remove o slot |

Regras: uma empresa nunca enxerga nem altera dados de outra (responde 404). Slots da mesma quadra e dia não podem se sobrepor (encostar, como 18-19 e 19-20, é permitido). `dia_semana`: 0 = domingo ... 6 = sábado. Horários em `HH:MM` (aceita `24:00` como fim).

Corpo de `POST /admin/empresas` (igual ao formulário do front): `{ empresa, cnpj, responsavel, email, telefone?, senha }`. O CNPJ é gravado só com dígitos.
