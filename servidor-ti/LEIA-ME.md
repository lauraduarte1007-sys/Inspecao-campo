# Servidor de referência — app Inspeção Estrutural

Servidor completo para a empresa hospedar os usuários, as inspeções, as fotos e o modelo do relatório, no lugar do Firebase. Um arquivo, sem dependências externas.

## Requisitos

- Node.js **22.13 ou mais novo** (usa o SQLite embutido do Node).
- HTTPS na frente (proxy reverso: IIS, nginx, Apache, Azure App Service…). O app instalado no celular e a câmera exigem https.

## Subir

```bash
# o app e a API no mesmo endereço (recomendado):
STATIC_DIR=/caminho/para/o/site DB_FILE=/dados/inspecao.db PORT=8080 node server.mjs
```

- `STATIC_DIR`: pasta com os arquivos do site (`index.html`, `config.js`, `firebase.js`, `sw.js`, ícones…). Opcional.
- `DB_FILE`: arquivo do banco SQLite (padrão `inspecao.db`).
- `PORT` / `HOST`: porta e interface (padrão `8080` / `0.0.0.0`).
- `ORIGINS`: origens liberadas por CORS quando o site fica em outro domínio, separadas por vírgula. Ex.: `ORIGINS=https://lauraduarte1007-sys.github.io`.
- `TRUST_PROXY=1`: use quando houver proxy reverso, para o limite de tentativas de login ver o IP real.
- `SESSION_DAYS`: validade da sessão (padrão 90 dias, renovada a cada uso).

Depois, troque o `config.js` do site para:

```js
window.INSP_CONFIG = { backend: 'api', api: { url: '/api' } };   // ou a URL completa da API
```

## Administração

- O primeiro cadastro feito no app vira administrador. Os próximos ficam pendentes até um administrador liberar (no app: **Usuários**).
- Pelo terminal do servidor:
  - `node server.mjs admin <matricula>`: torna a matrícula administradora e ativa.
  - `node server.mjs senha <matricula> <nova-senha>`: define uma nova senha.
- No servidor da empresa, o administrador também pode definir uma nova senha pelo app (**Usuários → Nova senha**).

## Segurança

- Senhas com hash scrypt e sal aleatório; tokens de sessão guardados só como hash SHA-256.
- Limite de tentativas de login por matrícula e por IP.
- Só usuários ativos leem e gravam dados; ações de usuários e do modelo são só de administradores.
- Corpo de requisição limitado a 12 MB.

## Migrar do Firebase

Peça a um administrador para fazer **Backup completo (com fotos)** no app atual e **Restaurar backup** depois de apontar o app para este servidor. O modelo do relatório é enviado de novo em **Usuários → Enviar modelo**.

A especificação completa da API está em `API.md`.
