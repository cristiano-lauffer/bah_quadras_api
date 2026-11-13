# bah_quadras_api

API REST do Bah Quadras (Node.js + Express + Knex + MySQL).

## Rodando

Os repositórios ficam lado a lado (`bah_quadras_api`, `bah_quadras_db`, `bah_quadras_web`).

1. Crie o banco com o script do repo `bah_quadras_db`: `mysql -u root -p < ../bah_quadras_db/bah_quadras_reset_completo.sql` (o usuário de aplicação e os grants ficam em `02_users` e `03_grants` daquele repo)
2. `cp .env.example .env` e ajuste. `JWT_SECRET` precisa ser longo e secreto. A API não sobe se faltar `DB_HOST`, `DB_USER`, `DB_NAME` ou `JWT_SECRET`
3. `npm install`
4. `npm run dev`

Teste manual: importe `postman/bah_quadras.postman_collection.json` no Postman e rode as pastas em ordem.

## Endpoints

| Método | Rota | Quem | O que faz |
|---|---|---|---|
| POST | `/auth/register` | público | Cadastro de cliente (US1) |
| POST | `/auth/login` | público | Login de qualquer papel; JWT traz `papel` e `empresa_id` (US1/US2) |
| POST | `/admin/empresas` | admin | Cria empresa + responsável numa transação (US3) |
| GET | `/publico/quadras` | público | Quadras com os horários livres do dia (`?data=AAAA-MM-DD`, padrão hoje) |
| GET | `/tipos-quadra` | logado | Tipos para os selects |
| POST | `/quadras` | empresa | Cadastra quadra (US4) |
| GET | `/quadras` | empresa | Lista as da própria empresa (`?status=ativa\|manutencao\|inativa`) |
| GET | `/quadras/:id` | empresa | Detalhe |
| PATCH | `/quadras/:id` | empresa | Edita dados, `valor_hora` (US6) e `status` (US4) |
| GET | `/quadras/:id/horarios` | empresa | Grade semanal (`?dia_semana=0..6`, `?ativo=true\|false`) (US5) |
| PUT | `/quadras/:id/horarios` | empresa | Troca a grade inteira: `{ "horarios": [ ... ] }` (lista vazia limpa a grade) |
| POST | `/quadras/:id/horarios` | empresa | Cria 1 slot ou vários: `{ "horarios": [ ... ] }` (tudo ou nada) |
| PATCH | `/quadras/:id/horarios/:horarioId` | empresa | Habilita/bloqueia (`ativo`) ou ajusta o período |
| DELETE | `/quadras/:id/horarios/:horarioId` | empresa | Remove o slot |

Regras gerais:
- Uma empresa nunca enxerga nem altera dados de outra (responde 404).
- Erros sempre vêm como `{ "erro": "mensagem" }`. JSON malformado no corpo responde 400.
- E-mails são gravados em minúsculas. CNPJ e telefone são gravados só com dígitos.
- Empresas não se cadastram pelo site: o admin cria a conta (`POST /admin/empresas`) e o responsável entra pelo login normal.

## Contratos

### Auth

`POST /auth/register`: `{ nome, email, senha, telefone? }`. Senha com no mínimo 6 caracteres; telefone com DDD (10 ou 11 dígitos, a máscara é aceita).

`POST /auth/login`: `{ email, senha }` responde:

```json
{
  "mensagem": "Login realizado com sucesso.",
  "token": "...",
  "usuario": {
    "id": 4, "nome": "Carlos", "email": "contato@arena.com", "telefone": null,
    "papel": "empresa", "empresa_id": 1,
    "empresa": { "id": 1, "nome": "Arena Central" }
  }
}
```

`empresa` vem `null` para cliente e admin.

### Admin

`POST /admin/empresas`: `{ empresa, cnpj, responsavel, email, telefone?, senha }`.

### Quadras (empresa)

Campos aceitos em `POST` e `PATCH` (no `POST`, `nome`, `tipo_quadra_id` e `valor_hora` são obrigatórios):

| Campo | Tipo | Regra |
|---|---|---|
| `nome` | texto | até 100 caracteres |
| `tipo_quadra_id` | número | id de `/tipos-quadra` |
| `valor_hora` | número | maior que zero |
| `descricao` | texto ou `null` | até 500 caracteres |
| `status` | texto | `ativa` (padrão), `manutencao` ou `inativa` |
| `piso` | texto ou `null` | até 50 caracteres |
| `cobertura` | texto ou `null` | `coberta` ou `descoberta` |
| `capacidade` | inteiro ou `null` | 1 a 100 |
| `comodidades` | lista de textos | até 30 itens, 50 caracteres cada |
| `imagem_url` | texto ou `null` | endereço `http(s)` de até 500 caracteres (envio de arquivo ainda não é suportado) |

A quadra volta com todos esses campos, mais `id`, `empresa_id`, `tipo_quadra` (nome do tipo, ex.: `"Futebol Society"`), `created_at` e `updated_at`.

### Horários (empresa)

Slot: `{ dia_semana, hora_inicio, hora_fim, ativo? }`. `dia_semana`: 0 = domingo ... 6 = sábado. Horários em `HH:MM` (aceita `24:00` como fim). Slots da mesma quadra e dia não podem se sobrepor (encostar, como 18-19 e 19-20, é permitido).

O `PUT` é o jeito recomendado para telas que editam a grade inteira: ele apaga a grade atual e grava a nova numa única transação.

### Listagem pública

`GET /publico/quadras?data=2026-11-12` responde:

```json
[
  {
    "id": 1,
    "nome": "Society 1",
    "descricao": null,
    "valor_hora": 120,
    "tipo_quadra_id": 1,
    "tipo_quadra": "Futebol Society",
    "status": "ativa",
    "piso": "Grama sintética",
    "cobertura": "descoberta",
    "capacidade": 14,
    "comodidades": ["Vestiário", "Iluminação"],
    "imagem_url": "https://...",
    "empresa": { "id": 1, "nome": "Arena Central", "endereco": "..." },
    "horarios_livres": [{ "hora_inicio": "18:00", "hora_fim": "19:00" }]
  }
]
```

- Entram quadras `ativa` e `manutencao` de empresas ativas; as em manutenção vêm sempre com `horarios_livres` vazio.
- Um horário é livre quando é um slot ativo da grade daquele dia da semana, não conflita com reserva `ATIVA` nem com `bloqueios_quadra`, e ainda não começou (datas passadas voltam sem horários livres).
- Solicitações ainda aguardando aprovação não ocupam o horário.
