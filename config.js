/* Configuração do app Inspeção Estrutural.
   backend: 'firebase' (Google Firebase), 'api' (servidor da TI) ou 'local' (sem login; dados só no aparelho).
   A configuração do Firebase abaixo não é senha: ela só identifica o projeto. Quem protege os dados
   são o login e as regras de segurança (firestore.rules). */
window.INSP_CONFIG = {
  backend: 'firebase',
  firebase: {
    apiKey: 'AIzaSyCA2dL3ulds4MkM3LO28y3XruLN0AeVV0s',
    authDomain: 'inspecao-campo.firebaseapp.com',
    projectId: 'inspecao-campo',
    storageBucket: 'inspecao-campo.firebasestorage.app',
    messagingSenderId: '1087829727736',
    appId: '1:1087829727736:web:f9847832eb8d0c99f99e0d'
  },
  api: { url: '' }   // servidor da TI, por exemplo 'https://inspecao.suaempresa.com.br/api' (com backend: 'api')
};
