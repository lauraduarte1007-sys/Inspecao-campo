/* Cópia de teste do app com IA (Claude). Dados separados do app principal: coleções ia_ no mesmo Firebase,
   banco local próprio no aparelho e login próprio. */
window.INSP_CONFIG = {
  titulo: 'Inspeção IA',
  aviso: 'Versão de teste com IA. Os dados ficam separados do app principal.',
  db: 'inspEstrIA',
  chave: 'inspEstrIA',
  backend: 'firebase',
  firebase: {
    apiKey: 'AIzaSyCA2dL3ulds4MkM3LO28y3XruLN0AeVV0s',
    authDomain: 'inspecao-campo.firebaseapp.com',
    projectId: 'inspecao-campo',
    storageBucket: 'inspecao-campo.firebasestorage.app',
    messagingSenderId: '1087829727736',
    appId: '1:1087829727736:web:f9847832eb8d0c99f99e0d',
    prefixo: 'ia_',
    app: 'ia'
  },
  ia: { url: '' }   // endereço do servidor da IA (Cloudflare Worker), por exemplo 'https://inspecao-ia.seu-nome.workers.dev'
};
