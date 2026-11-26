/* Inspeção Estrutural — funciona sem internet.
   O app abre na hora a partir do aparelho e se atualiza sozinho em segundo plano quando há conexão. */
const V = 'inspecao-campo-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const font = u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (u.origin !== location.origin && !font) return;
  if (u.pathname.endsWith('/modelo-rev1.json')) return;   // o modelo nunca fica neste cache
  e.respondWith(caches.open(V).then(async c => {
    const key = r.mode === 'navigate' ? './index.html' : r;
    const hit = await c.match(key, { ignoreSearch: true });
    const net = fetch(r).then(res => {
      if (res && (res.ok || res.type === 'opaque')) c.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Sem conexão', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
