# Inspeção Estrutural — app de campo

Preenche o relatório de inspeção estrutural no celular e no computador, com fotos tiradas pela câmera dentro do próprio app, e exporta a planilha no modelo da empresa. Os dados ficam sincronizados entre todos os usuários liberados.

**Abrir o app:** https://lauraduarte1007-sys.github.io/Inspecao-campo/

## Acesso

- Cada pessoa entra com **matrícula e senha**. Quem ainda não tem acesso toca em **Criar cadastro**.
- O cadastro fica **aguardando liberação** até um administrador liberar em **Usuários**.
- O **primeiro cadastro** do app vira administrador. Administradores liberam, desativam e promovem usuários, e enviam o modelo do relatório.

## Instalar no celular

- **iPhone (Safari):** abra o link → Compartilhar → Adicionar à Tela de Início. Use sempre o ícone “Inspeção”.
- **Android (Chrome):** abra o link → Instalar app (ou menu ⋮ → Adicionar à tela inicial).

Sem sinal, o app continua funcionando: o que for feito fica guardado no aparelho e é enviado quando a conexão voltar.

## Modelo do relatório

O arquivo .xlsx do modelo fica guardado no banco, liberado só para logins ativos. Ele **não** está neste repositório. Para trocar a versão do modelo: **Usuários → Enviar nova versão (.xlsx)**. Todos passam a usar o novo modelo automaticamente.

## Onde ficam os dados

No projeto Firebase `inspecao-campo` (Authentication + Firestore). As regras de segurança estão em [`firestore.rules`](firestore.rules): só quem tem cadastro ativo lê e grava inspeções, fotos e o modelo. Ao alterar as regras, publique o conteúdo do arquivo em *Firebase → Firestore Database → Regras → Publicar*.

## Cópia de teste com IA

Em https://lauraduarte1007-sys.github.io/Inspecao-campo/ia/ fica uma cópia do app que usa o Claude para sugerir a classificação e a descrição a partir das fotos. Ela tem login e dados próprios (coleções `ia_` no mesmo Firebase), separados do app principal. O servidor da IA está em [`servidor-ia`](servidor-ia/LEIA-ME.md).

Para usar um servidor da própria empresa no lugar do Firebase, veja a pasta [`servidor-ti`](servidor-ti/LEIA-ME.md): ela traz um servidor de referência e a especificação da API. A troca é feita só no `config.js`.

## Atualizar o app

O site é publicado a partir do branch **gh-pages** (o main guarda uma cópia). Os aparelhos baixam a nova versão sozinhos quando abrem o app com internet.
