// Inspeção Estrutural — servidor de referência para a TI
// Node.js 22.13 ou mais novo. Sem dependências externas: http, sqlite e crypto do próprio Node.
// Uso:  node server.mjs                          (sobe o servidor)
//       node server.mjs admin <matricula>        (torna a matrícula administradora e ativa)
//       node server.mjs senha <matricula> <nova> (define uma nova senha)
// Variáveis: PORT, HOST, DB_FILE, ORIGINS, STATIC_DIR, SESSION_DAYS, TRUST_PROXY — veja LEIA-ME.md
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = process.env.DB_FILE || 'inspecao.db';
const ORIGINS = (process.env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const STATIC = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : '';
const SESSION_MS = (+process.env.SESSION_DAYS || 90) * 864e5;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const MAX_BODY = 12 * 1024 * 1024;
const VERSION = '1.0';

const db = new DatabaseSync(DB_FILE);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(uid TEXT PRIMARY KEY, mat TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')),
  status TEXT NOT NULL CHECK(status IN ('pendente','ativo','inativo')), salt TEXT NOT NULL, hash TEXT NOT NULL, criado INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(th TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS docs(id TEXT PRIMARY KEY, kind TEXT NOT NULL, j TEXT NOT NULL, updated INTEGER NOT NULL, del INTEGER NOT NULL, by TEXT, byNome TEXT, seq INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS docs_seq ON docs(seq);
CREATE TABLE IF NOT EXISTS fotos(id TEXT PRIMARY KEY, data TEXT NOT NULL, w INTEGER, h INTEGER, by TEXT, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS config(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pedidos(mat TEXT PRIMARY KEY, nome TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, ts INTEGER NOT NULL);`);
let SEQ = db.prepare('SELECT COALESCE(MAX(seq),0) AS m FROM docs').get().m;

class HttpErr extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; this.msg = msg || ''; } }
const E = (s, c, m) => { throw new HttpErr(s, c, m); };
const tx = f => { db.exec('BEGIN IMMEDIATE'); try { const r = f(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
const normMat = m => String(m || '').trim().toLowerCase().replace(/\s+/g, '');
const okMat = m => /^[a-z0-9._-]{2,40}$/.test(m);
const okId = s => typeof s === 'string' && /^[\w-]{3,40}$/.test(s);
const okImg = d => typeof d === 'string' && d.length < 1_500_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(d);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? no(e) : ok(k.toString('base64'))));
const pub = u => u && { uid: u.uid, mat: u.mat, nome: u.nome, role: u.role, status: u.status };
const DUMMY_SALT = crypto.randomBytes(16).toString('base64');

// ---------- limite de tentativas de login ----------
const tries = new Map();
function tooMany(key, max) { const t = tries.get(key); return t && t.until > Date.now() && t.n >= max; }
function failed(key) { const now = Date.now(), t = tries.get(key); if (!t || t.until < now) tries.set(key, { n: 1, until: now + 15 * 60e3 }); else t.n++; }
setInterval(() => { const now = Date.now(); for (const [k, t] of tries) if (t.until < now) tries.delete(k); db.prepare('DELETE FROM sessions WHERE exp < ?').run(now); }, 10 * 60e3).unref();

// ---------- sessões ----------
function newSession(uid) { const t = crypto.randomBytes(32).toString('base64url'); db.prepare('INSERT INTO sessions(th,uid,exp) VALUES(?,?,?)').run(sha(t), uid, Date.now() + SESSION_MS); return t; }
function auth(req, need) {
  const h = req.headers.authorization || '', t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) E(401, 'auth');
  const s = db.prepare('SELECT s.th, s.exp, u.* FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.th = ?').get(sha(t));
  if (!s || s.exp < Date.now()) E(401, 'auth');
  if (s.exp - Date.now() < SESSION_MS / 2) db.prepare('UPDATE sessions SET exp = ? WHERE th = ?').run(Date.now() + SESSION_MS, s.th);
  if (need && s.status !== 'ativo') E(403, 'denied', 'acesso não liberado');
  if (need === 'admin' && s.role !== 'admin') E(403, 'denied', 'só administradores');
  return s;
}
const activeAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='ativo'").get().n;

// ---------- avisos ao vivo (Server-Sent Events): o app busca as mudanças assim que recebe o aviso ----------
const subs = new Set();
function openEvents(req, res) {
  const s = auth(req, true);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': ok\n\n');
  const sub = { res, uid: s.uid }; subs.add(sub);
  const hb = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(hb); subs.delete(sub); });
}
function notify(event) {
  const st = db.prepare('SELECT status FROM users WHERE uid = ?');
  for (const sub of subs) {
    const u = st.get(sub.uid);
    if (!u || u.status !== 'ativo') { subs.delete(sub); sub.res.end(); continue; }
    if (event) sub.res.write(`event: ${event}\ndata: ${SEQ}\n\n`);
  }
}

// ---------- HTTP ----------
function send(res, status, body) {
  const b = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(b);
}
function cors(req, res) {
  const o = req.headers.origin;
  if (o && (ORIGINS.includes('*') || ORIGINS.includes(o))) {
    res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
function body(req) {
  return new Promise((ok, no) => {
    let n = 0; const parts = [];
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { no(new HttpErr(413, 'too-big')); req.destroy(); } else parts.push(c); });
    req.on('end', () => { try { const s = Buffer.concat(parts).toString('utf8'); ok(s ? JSON.parse(s) : {}); } catch (e) { no(new HttpErr(400, 'bad-json')); } });
    req.on('error', no);
  });
}
const ip = req => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';

const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

on('GET', '/api/ping', () => ({ ok: true, app: 'inspecao-estrutural', v: VERSION }));

on('POST', '/api/register', async (req) => {
  const b = await body(req), mat = normMat(b.mat), nome = String(b.nome || '').trim().replace(/\s+/g, ' '), senha = String(b.senha || '');
  if (!okMat(mat)) E(400, 'bad-mat', 'matrícula inválida');
  if (nome.length < 3 || nome.length > 80) E(400, 'bad-nome', 'nome inválido');
  if (senha.length < 6 || senha.length > 200) E(400, 'weak', 'senha fraca');
  if (tooMany('reg:' + ip(req), 20)) E(429, 'many');
  failed('reg:' + ip(req));
  const salt = crypto.randomBytes(16).toString('base64'), hash = await scrypt(senha, salt), uid = crypto.randomUUID();
  const u = tx(() => {
    if (db.prepare('SELECT 1 FROM users WHERE mat = ?').get(mat)) E(409, 'exists');
    const first = !db.prepare("SELECT 1 FROM users WHERE role='admin'").get();
    const u = { uid, mat, nome, role: first ? 'admin' : 'user', status: first ? 'ativo' : 'pendente' };
    db.prepare('INSERT INTO users(uid,mat,nome,role,status,salt,hash,criado) VALUES(?,?,?,?,?,?,?,?)').run(uid, mat, nome, u.role, u.status, salt, hash, Date.now());
    return u;
  });
  return { token: newSession(uid), user: u };
});

on('POST', '/api/login', async (req) => {
  const b = await body(req), mat = normMat(b.mat), senha = String(b.senha || ''), k1 = 'mat:' + mat + '|' + ip(req), k2 = 'ip:' + ip(req);
  if (tooMany(k1, 8) || tooMany(k2, 60)) E(429, 'many');
  const u = okMat(mat) ? db.prepare('SELECT * FROM users WHERE mat = ?').get(mat) : null;
  const h = await scrypt(senha, u ? u.salt : DUMMY_SALT);
  if (!u || !crypto.timingSafeEqual(Buffer.from(h, 'base64'), Buffer.from(u.hash, 'base64'))) { failed(k1); failed(k2); E(401, 'cred'); }
  tries.delete(k1);
  return { token: newSession(u.uid), user: pub(u) };
});

on('POST', '/api/senha', async (req) => {
  const b = await body(req), mat = normMat(b.mat), nome = String(b.nome || '').trim().replace(/\s+/g, ' '), senha = String(b.senha || '');
  if (!okMat(mat)) E(400, 'bad-mat', 'matrícula inválida');
  if (nome.length < 3 || nome.length > 80) E(400, 'bad-nome', 'nome inválido');
  if (senha.length < 6 || senha.length > 200) E(400, 'weak', 'senha fraca');
  if (tooMany('pw:' + ip(req), 10)) E(429, 'many');
  failed('pw:' + ip(req));
  const salt = crypto.randomBytes(16).toString('base64'), hash = await scrypt(senha, salt);
  if (db.prepare('SELECT 1 FROM users WHERE mat = ?').get(mat))
    db.prepare('INSERT INTO pedidos(mat,nome,salt,hash,ts) VALUES(?,?,?,?,?) ON CONFLICT(mat) DO UPDATE SET nome=excluded.nome, salt=excluded.salt, hash=excluded.hash, ts=excluded.ts').run(mat, nome, salt, hash, Date.now());
  notify();
  return { ok: true };   // mesma resposta para matrícula existente ou não
});

on('POST', '/api/logout', (req) => { const s = auth(req); db.prepare('DELETE FROM sessions WHERE th = ?').run(s.th); return { ok: true }; });
on('GET', '/api/me', (req) => ({ user: pub(auth(req)) }));

on('GET', '/api/users', (req) => {
  auth(req, 'admin');
  const rows = db.prepare('SELECT u.uid,u.mat,u.nome,u.role,u.status,p.nome AS pnome,p.ts AS pts FROM users u LEFT JOIN pedidos p ON p.mat = u.mat ORDER BY u.nome').all();
  return { users: rows.map(r => Object.assign({ uid: r.uid, mat: r.mat, nome: r.nome, role: r.role, status: r.status }, r.pts ? { pedido: { nome: r.pnome, ts: r.pts } } : {})) };
});

on('PATCH', '/api/users/:uid', async (req, p) => {
  const me = auth(req, 'admin'), b = await body(req), uid = decodeURIComponent(p.uid);
  const u = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid); if (!u) E(404, 'notfound');
  if (b.aprovarSenha || b.recusarSenha) {
    const q = db.prepare('SELECT * FROM pedidos WHERE mat = ?').get(u.mat); if (!q) E(404, 'notfound');
    tx(() => {
      if (b.aprovarSenha) { db.prepare('UPDATE users SET salt=?, hash=? WHERE uid=?').run(q.salt, q.hash, uid); db.prepare('DELETE FROM sessions WHERE uid = ?').run(uid); }
      db.prepare('DELETE FROM pedidos WHERE mat = ?').run(u.mat);
    });
    return { user: pub(db.prepare('SELECT * FROM users WHERE uid = ?').get(uid)) };
  }
  if (uid === me.uid && (b.status !== undefined || b.role !== undefined)) E(403, 'self');
  const status = b.status !== undefined ? String(b.status) : u.status, role = b.role !== undefined ? String(b.role) : u.role;
  if (!['pendente', 'ativo', 'inativo'].includes(status) || !['admin', 'user'].includes(role)) E(400, 'bad-value');
  if (u.role === 'admin' && u.status === 'ativo' && (role !== 'admin' || status !== 'ativo') && activeAdmins() < 2) E(409, 'last');
  const nome = b.nome !== undefined ? String(b.nome).trim().replace(/\s+/g, ' ') : u.nome; if (nome.length < 3 || nome.length > 80) E(400, 'bad-nome');
  let salt = u.salt, hash = u.hash;
  if (b.senha !== undefined) { const s = String(b.senha); if (s.length < 6 || s.length > 200) E(400, 'weak'); salt = crypto.randomBytes(16).toString('base64'); hash = await scrypt(s, salt); }
  tx(() => {
    db.prepare('UPDATE users SET status=?, role=?, nome=?, salt=?, hash=? WHERE uid=?').run(status, role, nome, salt, hash, uid);
    if (b.senha !== undefined) db.prepare('DELETE FROM sessions WHERE uid = ?').run(uid);
  });
  notify();   // quem foi desativado perde o canal ao vivo na hora
  return { user: pub(db.prepare('SELECT * FROM users WHERE uid = ?').get(uid)) };
});

on('DELETE', '/api/users/:uid', (req, p) => {
  const me = auth(req, 'admin'), uid = decodeURIComponent(p.uid);
  if (uid === me.uid) E(403, 'self');
  const u = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid); if (!u) E(404, 'notfound');
  if (u.role === 'admin' && u.status === 'ativo' && activeAdmins() < 2) E(409, 'last');
  tx(() => { db.prepare('DELETE FROM users WHERE uid = ?').run(uid); db.prepare('DELETE FROM pedidos WHERE mat = ?').run(u.mat); });
  notify();
  return { ok: true };
});

on('GET', '/api/docs', (req, p, url) => {
  auth(req, true);
  const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
  const rows = db.prepare('SELECT id,kind,j,updated,del,byNome,seq FROM docs WHERE seq > ? ORDER BY seq LIMIT 500').all(since);
  return { docs: rows.map(r => ({ id: r.id, kind: r.kind, j: r.j, updated: r.updated, del: !!r.del, byNome: r.byNome || '' })), cursor: rows.length ? rows[rows.length - 1].seq : since, more: rows.length === 500 };
});

on('POST', '/api/docs', async (req) => {
  const me = auth(req, true), b = await body(req), list = Array.isArray(b.docs) ? b.docs : null;
  if (!list || list.length > 200) E(400, 'bad-docs');
  for (const d of list) {
    if (!okId(d.id)) E(400, 'bad-id');
    if (!d.del && (!['insp', 'anom'].includes(d.kind) || typeof d.j !== 'string' || d.j.length > 1_000_000)) E(d.j && d.j.length > 1_000_000 ? 413 : 400, d.j && d.j.length > 1_000_000 ? 'too-big' : 'bad-doc');
  }
  const up = db.prepare(`INSERT INTO docs(id,kind,j,updated,del,by,byNome,seq) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, j=excluded.j, updated=excluded.updated, del=excluded.del, by=excluded.by, byNome=excluded.byNome, seq=excluded.seq
    WHERE excluded.updated >= docs.updated`);
  tx(() => { for (const d of list) up.run(d.id, d.del ? (d.kind || '') : d.kind, d.del ? '' : d.j, Math.max(0, +d.updated || Date.now()), d.del ? 1 : 0, me.uid, me.nome, ++SEQ); });
  notify('docs');
  return { ok: true, cursor: SEQ };
});

on('GET', '/api/fotos/:id', (req, p) => {
  auth(req, true); const id = decodeURIComponent(p.id); if (!okId(id)) E(400, 'bad-id');
  const f = db.prepare('SELECT data,w,h FROM fotos WHERE id = ?').get(id); if (!f) E(404, 'notfound');
  return f;
});
on('PUT', '/api/fotos/:id', async (req, p) => {
  const me = auth(req, true), id = decodeURIComponent(p.id), b = await body(req);
  if (!okId(id)) E(400, 'bad-id'); if (!okImg(b.data)) E(b.data && b.data.length >= 1_500_000 ? 413 : 400, b.data && b.data.length >= 1_500_000 ? 'too-big' : 'bad-image');
  db.prepare('INSERT INTO fotos(id,data,w,h,by,ts) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, w=excluded.w, h=excluded.h, by=excluded.by, ts=excluded.ts')
    .run(id, b.data, Math.max(0, +b.w || 0), Math.max(0, +b.h || 0), me.uid, Date.now());
  return { ok: true };
});
on('DELETE', '/api/fotos/:id', (req, p) => { auth(req, true); const id = decodeURIComponent(p.id); if (!okId(id)) E(400, 'bad-id'); db.prepare('DELETE FROM fotos WHERE id = ?').run(id); return { ok: true }; });

on('GET', '/api/modelo/info', (req) => { auth(req, true); const r = db.prepare("SELECT v FROM config WHERE k='modeloInfo'").get(); if (!r) E(404, 'notfound'); return JSON.parse(r.v); });
on('GET', '/api/modelo', (req) => { auth(req, true); const r = db.prepare("SELECT v FROM config WHERE k='modelo'").get(); if (!r) E(404, 'notfound'); return JSON.parse(r.v); });
on('PUT', '/api/modelo', async (req) => {
  auth(req, 'admin'); const b = await body(req);
  if (!b || typeof b.name !== 'string' || !b.parts || typeof b.parts !== 'object' || typeof b.ver !== 'string') E(400, 'bad-modelo');
  const v = JSON.stringify({ name: b.name, rev: String(b.rev || ''), ver: b.ver, em: +b.em || Date.now(), parts: b.parts });
  if (v.length > 8_000_000) E(413, 'too-big');
  tx(() => {
    db.prepare("INSERT INTO config(k,v) VALUES('modelo',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(v);
    db.prepare("INSERT INTO config(k,v) VALUES('modeloInfo',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(JSON.stringify({ ver: b.ver, name: b.name, em: +b.em || Date.now() }));
  });
  notify('modelo');
  return { ok: true };
});

// ---------- arquivos do app (opcional: STATIC_DIR) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  if (!STATIC || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const f = path.resolve(STATIC, '.' + rel);
  if (!f.startsWith(STATIC + path.sep) || path.basename(f).startsWith('.') || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') res.end(); else fs.createReadStream(f).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && url.pathname === '/api/eventos') { openEvents(req, res); return; }
      for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(url.pathname); if (m) { send(res, 200, await r.fn(req, m.groups || {}, url)); return; } }
      E(404, 'notfound');
    }
    if (serveStatic(req, res, url)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Não encontrado');
  } catch (e) {
    if (e instanceof HttpErr) send(res, e.status, { code: e.code, msg: e.msg });
    else { console.error(new Date().toISOString(), e); send(res, 500, { code: 'server' }); }
  }
});

// ---------- linha de comando ----------
const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'admin') {
  const r = db.prepare("UPDATE users SET role='admin', status='ativo' WHERE mat = ?").run(normMat(a1));
  console.log(r.changes ? `Matrícula ${normMat(a1)} agora é administradora e está ativa.` : 'Matrícula não encontrada.'); process.exit(r.changes ? 0 : 1);
} else if (cmd === 'senha') {
  if (!a2 || a2.length < 6) { console.log('Informe a nova senha (mínimo 6 caracteres).'); process.exit(1); }
  const salt = crypto.randomBytes(16).toString('base64'), hash = await scrypt(a2, salt);
  const u = db.prepare('SELECT uid FROM users WHERE mat = ?').get(normMat(a1));
  if (!u) { console.log('Matrícula não encontrada.'); process.exit(1); }
  tx(() => { db.prepare('UPDATE users SET salt=?, hash=? WHERE uid=?').run(salt, hash, u.uid); db.prepare('DELETE FROM sessions WHERE uid=?').run(u.uid); db.prepare('DELETE FROM pedidos WHERE mat = ?').run(normMat(a1)); });
  console.log('Senha alterada.'); process.exit(0);
} else {
  server.listen(PORT, HOST, () => console.log(`Inspeção Estrutural — servidor na porta ${PORT}${STATIC ? ' (servindo o app de ' + STATIC + ')' : ''}. Banco: ${path.resolve(DB_FILE)}`));
}
