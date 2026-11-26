# API do app Inspeção Estrutural — especificação para a TI

O app (site estático: `index.html`, `config.js`, `firebase.js`, `sw.js`…) funciona com dois tipos de banco:

- **Firebase** (Google): configuração atual.
- **Servidor da empresa**: qualquer servidor que implemente esta API. O arquivo `server.mjs` desta pasta é uma implementação de referência completa, já testada com o app.

Para o app usar o servidor da empresa, troque o `config.js` do site:

```js
window.INSP_CONFIG = { backend: 'api', api: { url: 'https://inspecao.suaempresa.com.br/api' } };
```

Se o app for servido pelo mesmo servidor (variável `STATIC_DIR`), basta `url: '/api'`.

## Regras gerais

- Tudo em JSON (`Content-Type: application/json`), UTF-8, sob o caminho `/api`.
- Autenticação: `Authorization: Bearer <token>`. O token vem de `/register` ou `/login`.
- Erros: status HTTP + corpo `{"code": "...", "msg": "..."}`. Códigos que o app entende:

| HTTP | code | Quando |
|---|---|---|
| 400 | `bad-...` | dado inválido |
| 401 | `auth` | sem token, token inválido ou vencido (o app volta para a tela de login) |
| 401 | `cred` | matrícula ou senha incorretas |
| 403 | `denied` | usuário pendente/desativado, ou ação só de administrador |
| 403 | `self` | administrador tentando mudar o próprio acesso |
| 404 | `notfound` | não encontrado |
| 409 | `exists` | matrícula já cadastrada |
| 409 | `last` | a ação deixaria o app sem administrador ativo |
| 413 | `too-big` | registro grande demais |
| 429 | `many` | muitas tentativas de login |

- CORS: se o app estiver em outro domínio (ex.: GitHub Pages), o servidor deve responder ao `OPTIONS` e liberar a origem do app, com os cabeçalhos `Authorization` e `Content-Type`.
- HTTPS é obrigatório em produção (o app instalado e a câmera só funcionam em https).

## Usuários e sessão

Usuário (formato público): `{ "uid", "mat", "nome", "role": "admin"|"user", "status": "pendente"|"ativo"|"inativo" }`

- A matrícula é normalizada: sem espaços, minúsculas, só `a-z 0-9 . _ -`, de 2 a 40 caracteres.
- Senha: de 6 a 200 caracteres. Guardar só o hash (a referência usa scrypt com sal aleatório).
- O **primeiro** cadastro do servidor vira `admin` e `ativo`. Os seguintes ficam `pendente` até um administrador liberar.
- Só usuários `ativo` acessam inspeções, fotos e modelo. Pendentes e desativados recebem `403 denied`, mas podem chamar `/me`.

| Método e caminho | Quem | Corpo | Resposta |
|---|---|---|---|
| `POST /api/register` | qualquer um | `{mat, nome, senha}` | `{token, user}` |
| `POST /api/login` | qualquer um | `{mat, senha}` | `{token, user}` (também para pendentes) |
| `POST /api/logout` | logado | — | `{ok:true}` |
| `GET /api/me` | logado | — | `{user}` |
| `GET /api/users` | admin | — | `{users:[user…]}` |
| `PATCH /api/users/:uid` | admin | qualquer um de `{status, role, nome, senha}` | `{user}`. Trocar a senha encerra as sessões da pessoa |
| `DELETE /api/users/:uid` | admin | — | `{ok:true}` |
| `POST /api/senha` | qualquer um | `{mat, nome, senha}` | `{ok:true}` (mesma resposta se a matrícula não existir). Guarda um **pedido de senha nova**; a senha atual continua valendo |
| `PATCH /api/users/:uid` | admin | `{aprovarSenha: true}` ou `{recusarSenha: true}` | `{user}`. Aprovar troca a senha pela pedida e encerra as sessões da pessoa |

Em `GET /api/users`, quem tem pedido de senha nova vem com `pedido: {nome, ts}`.

## Inspeções e itens (sincronização)

Cada inspeção e cada item é um documento `{id, kind, j, updated, del}`:

- `id`: texto de 3 a 40 caracteres (`A-Z a-z 0-9 _ -`), criado pelo app.
- `kind`: `"insp"` (inspeção) ou `"anom"` (item). Vazio quando `del` é verdadeiro.
- `j`: o documento completo, como texto JSON (até 1 MB). O servidor não precisa entender o conteúdo.
- `updated`: data da alteração no aparelho (milissegundos). **Regra: só gravar se `updated` for maior ou igual ao que já está no banco** (a alteração mais recente vence).
- `del: true`: exclusão. Guarde o registro como “apagado” (não remova a linha), para que os outros aparelhos fiquem sabendo.

O servidor numera cada gravação com um contador crescente (`seq`). O app pede só o que mudou desde o último número que recebeu.

| Método e caminho | Quem | Corpo / parâmetros | Resposta |
|---|---|---|---|
| `GET /api/docs?since=N` | ativo | `since`: último `cursor` recebido (0 na primeira vez) | `{docs:[{id,kind,j,updated,del,byNome}], cursor, more}`. Até 500 por página, em ordem de `seq`; `more:true` se houver mais |
| `POST /api/docs` | ativo | `{docs:[{id,kind,j,updated,del}…]}` (até 200) | `{ok:true}`. Grava tudo numa transação; guarda quem gravou (`by`, `byNome`) |

### Avisos ao vivo

`GET /api/eventos` (ativo) mantém a resposta aberta no formato *Server-Sent Events* (`Content-Type: text/event-stream`). A cada gravação de inspeções, o servidor envia `event: docs` (e `event: modelo` quando o administrador troca o modelo), e o app busca as mudanças na hora com `GET /api/docs`. A cada 25 segundos vai um comentário `: ping` para o proxy não fechar a conexão. Quem é desativado perde o canal na hora.

Se o canal ao vivo não estiver disponível (por exemplo, um proxy que corta respostas longas), o app volta a consultar `GET /api/docs` a cada 30 segundos, e também ao voltar a conexão e ao reabrir o app. No proxy reverso, desative o *buffering* dessa rota (nginx: `proxy_buffering off;`) e use um tempo limite de leitura maior que 60 segundos.

## Fotos

As fotos são JPEG em *data URL* base64 (`data:image/jpeg;base64,...`), até ~1,5 MB cada (na prática o app manda até ~240 KB, 1280 px).

| Método e caminho | Quem | Corpo | Resposta |
|---|---|---|---|
| `GET /api/fotos/:id` | ativo | — | `{data, w, h}` ou `404` |
| `PUT /api/fotos/:id` | ativo | `{data, w, h}` | `{ok:true}` |
| `DELETE /api/fotos/:id` | ativo | — | `{ok:true}` |

O app só baixa as fotos quando precisa (planilha, backup, baixar fotos). As miniaturas vão dentro dos próprios itens.

## Modelo do relatório

O modelo .xlsx é guardado pelo administrador e baixado automaticamente pelos usuários ativos. O app manda o modelo já desmontado: `{name, rev, ver, em, parts}`, em que `parts` é um objeto `{caminho_no_xlsx: texto}` (partes binárias, se houver, vão como `{b64: "..."}`). Tamanho típico: 430 KB.

| Método e caminho | Quem | Corpo | Resposta |
|---|---|---|---|
| `GET /api/modelo/info` | ativo | — | `{ver, name, em}` ou `404` se ainda não houver modelo |
| `GET /api/modelo` | ativo | — | o modelo completo, como foi enviado |
| `PUT /api/modelo` | admin | o modelo completo | `{ok:true}` |

## Dados guardados (referência)

Tabelas SQLite do `server.mjs`: `users` (matrícula, nome, papel, status, sal e hash da senha), `sessions` (hash do token, validade de 90 dias renovada no uso), `docs` (inspeções e itens com `seq`), `fotos`, `config` (modelo). Faça backup do arquivo do banco (`DB_FILE`) junto com os arquivos `-wal` e `-shm`, ou use `sqlite3 inspecao.db ".backup copia.db"`.
