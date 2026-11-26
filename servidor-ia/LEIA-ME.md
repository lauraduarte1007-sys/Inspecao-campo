# Servidor da IA — cópia de teste "Inspeção IA"

A cópia com IA (https://lauraduarte1007-sys.github.io/Inspecao-campo/ia/) manda as fotos de um item para o **Claude**, que sugere elemento, material, manifestação, causa, origem e uma descrição. O inspetor confere antes de salvar.

A chave da API do Claude **não pode ficar no app**: qualquer pessoa que abrisse o site conseguiria copiá-la. Por isso ela fica num servidor pequeno, o `worker.js` desta pasta, publicado no **Cloudflare Workers** (plano gratuito). O servidor:

- só atende quem está com login **ativo** na cópia com IA (confere o login do Firebase e o cadastro em `ia_users`);
- só aceita pedidos vindos do site do app;
- limita a 40 pedidos a cada 10 minutos por pessoa;
- não guarda as fotos: repassa para o Claude e devolve a sugestão.

## 1. Chave da API do Claude

1. Entre em **platform.claude.com** (Claude Console) e crie a conta da empresa.
2. Em **Billing**, adicione créditos. O uso da API é cobrado por consumo.
3. Em **API Keys**, crie uma chave (por exemplo, `inspecao-ia`) e copie. Ela só aparece uma vez.
4. Guarde a chave só no Cloudflare (passo 2). Não mande a chave por chat, e-mail ou código.

## 2. Publicar o servidor no Cloudflare

1. Crie uma conta gratuita em **dash.cloudflare.com**.
2. Abra **Workers e Pages** → **Criar** → **Criar Worker** (modelo "Hello World"). Nome: `inspecao-ia`. Toque em **Implantar**.
3. Toque em **Editar código**, apague tudo, cole o conteúdo do arquivo `worker.js` e toque em **Implantar**.
4. Em **Configurações → Variáveis e segredos**, adicione:
   - Tipo **Segredo**, nome `ANTHROPIC_API_KEY`, valor: a chave do passo 1.
   - Salve e implante de novo, se o painel pedir.
5. Abra o endereço do Worker no navegador (algo como `https://inspecao-ia.<sua-conta>.workers.dev`). Deve aparecer `{"ok":true,"app":"inspecao-ia","chave":true}`.
6. Coloque esse endereço em `ia/config.js`, no campo `ia: { url: '...' }`, ou mande para quem mantém o app.

Variáveis opcionais (mesma tela, tipo **Texto**):

| Nome | Padrão | Para quê |
|---|---|---|
| `MODEL` | `claude-sonnet-5-5` | Modelo do Claude. `claude-haiku-5-5` é bem mais barato e mais rápido, com descrições mais simples. |
| `ALLOWED_ORIGIN` | `https://lauraduarte1007-sys.github.io` | Site que pode usar o servidor (separe vários por vírgula). |
| `FIREBASE_PROJECT_ID` | `inspecao-campo` | Projeto Firebase do login. |
| `USERS_COLLECTION` | `ia_users` | Coleção dos cadastros da cópia com IA. |

## Custo estimado

Cada item manda até 4 fotos de 1280 px. Com o Claude Sonnet 5.5, isso dá cerca de 8 mil tokens de entrada e algumas centenas de saída por item, ou seja, por volta de **US$ 0,02 por item** (preço de tabela: US$ 2 por milhão de tokens de entrada e US$ 10 por milhão de saída). Preços atualizados: https://platform.claude.com/docs/en/about-claude/pricing

## Levar para a TI depois

O mesmo código pode virar uma rota do servidor da empresa (`servidor-ti`): ele só precisa da chave da API e do mesmo controle de login.
