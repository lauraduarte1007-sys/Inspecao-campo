// Inspeção Estrutural — servidor da IA (Cloudflare Worker)
// Guarda a chave da API do Claude e só atende quem tem login ATIVO no app (Firebase).
// O app manda as fotos de um item e as listas do modelo; o Claude devolve uma sugestão em JSON.
//
// Configuração no Cloudflare (Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY  (Secret, obrigatório) chave da API do Claude
//   Opcionais: MODEL (padrão claude-sonnet-5-5), FIREBASE_PROJECT_ID (padrão inspecao-campo),
//              USERS_COLLECTION (padrão ia_users), ALLOWED_ORIGIN (padrão https://lauraduarte1007-sys.github.io)

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const API_URL = 'https://api.anthropic.com/v1/messages';
let jwks = null, jwksUntil = 0;
const seen = new Map();      // uid -> {ok, until}   (cache curto do status do cadastro)
const hits = new Map();      // uid -> [timestamps]  (limite de pedidos por pessoa)

const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const txt = u => new TextDecoder().decode(u);
class Err extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }

async function googleKeys() {
  if (jwks && Date.now() < jwksUntil) return jwks;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Err(503, 'auth-indisponivel');
  const j = await r.json(), m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  jwks = j.keys || []; jwksUntil = Date.now() + (m ? +m[1] * 1000 : 3600e3);
  return jwks;
}

// confere o token de login do Firebase (assinatura do Google, projeto, validade)
async function verifyToken(token, project) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Err(401, 'auth');
  let head, pay;
  try { head = JSON.parse(txt(b64u(parts[0]))); pay = JSON.parse(txt(b64u(parts[1]))); } catch (e) { throw new Err(401, 'auth'); }
  if (head.alg !== 'RS256') throw new Err(401, 'auth');
  const jwk = (await googleKeys()).find(k => k.kid === head.kid);
  if (!jwk) throw new Err(401, 'auth');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  const now = Date.now() / 1000;
  if (!ok || pay.aud !== project || pay.iss !== 'https://securetoken.google.com/' + project || !pay.sub || !(pay.exp > now) || pay.iat > now + 300) throw new Err(401, 'auth');
  return pay.sub;
}

// confere se o cadastro está ativo, lendo o próprio cadastro com o login da pessoa (as regras do Firestore permitem)
async function isActive(token, project, col, uid) {
  const c = seen.get(uid);
  if (c && c.until > Date.now()) return c.ok;
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/${col}/${encodeURIComponent(uid)}`, { headers: { Authorization: 'Bearer ' + token } });
  let ok = false;
  if (r.ok) { const d = await r.json(); ok = !!(d.fields && d.fields.status && d.fields.status.stringValue === 'ativo'); }
  seen.set(uid, { ok, until: Date.now() + 5 * 60e3 });
  return ok;
}

function rateOk(uid) {
  const now = Date.now(), L = (hits.get(uid) || []).filter(t => now - t < 10 * 60e3);
  if (L.length >= 40) return false;
  L.push(now); hits.set(uid, L);
  return true;
}

const clean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 200);
const list = v => Array.isArray(v) ? [...new Set(v.map(clean).filter(Boolean))].slice(0, 400) : [];

function buildRequest(body, model) {
  const fotos = Array.isArray(body.fotos) ? body.fotos : [];
  if (!fotos.length) throw new Err(400, 'ia-sem-foto');
  if (fotos.length > 4) throw new Err(400, 'ia-erro');
  const imgs = fotos.map(f => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(String(f));
    if (!m || m[2].length > 4_000_000) throw new Err(400, 'ia-erro');
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  });
  const c = body.contexto || {}, L = c.listas || {};
  const elem = list(L.elemento), mat = list(L.material), causa = list(L.causa), orig = list(L.origem);
  const porMat = {}; let manif = [];
  for (const [k, v] of Object.entries(L.manifestacao || {})) { const l = list(v); porMat[clean(k) || 'geral'] = l; manif = manif.concat(l); }
  manif = [...new Set(manif)];
  const opt = l => l.length ? { type: 'string', enum: [...l, ''] } : { type: 'string' };
  const schema = {
    type: 'object',
    properties: {
      elemento: Object.assign(opt(elem), { description: 'Elemento ou sistema inspecionado' }),
      material: opt(mat),
      manifestacao: Object.assign(opt(manif), { description: 'Manifestação patológica, coerente com o material' }),
      causa: opt(causa),
      origem: opt(orig),
      descricao: { type: 'string', description: 'Descrição técnica objetiva do que se vê nas fotos, em português do Brasil, 1 a 3 frases' },
      observacoes: { type: 'string', description: 'Incertezas e o que conferir em campo; vazio se não houver' },
      confianca: { type: 'string', enum: ['alta', 'média', 'baixa'] }
    },
    required: ['elemento', 'material', 'manifestacao', 'causa', 'origem', 'descricao', 'observacoes', 'confianca'],
    additionalProperties: false
  };
  const system = 'Você é engenheiro(a) civil especialista em inspeção e patologia das estruturas (concreto armado, estruturas metálicas e alvenarias), ' +
    'ajudando a preencher um relatório de inspeção estrutural em campo. Analise as fotos de UM item e sugira a classificação. ' +
    'Use só o que é visível nas fotos e o contexto informado. Escolha os valores exclusivamente entre as opções fornecidas; ' +
    'quando não for possível identificar com segurança, use texto vazio. A manifestação deve ser coerente com o material escolhido. ' +
    'A descrição deve ser técnica e objetiva (o que se observa, extensão aproximada e características como abertura de fissuras, manchas, perda de seção, armadura exposta), ' +
    'sem inventar medidas que não dá para estimar e sem repetir a localização. Em observações, aponte incertezas e o que o inspetor deve conferir.';
  const ctx = [
    `Tipo de ativo: ${clean(c.tipo) || 'não informado'}`,
    `Já preenchido pelo inspetor — elemento: ${clean(c.elemento) || '—'}; material: ${clean(c.material) || '—'}; localização: ${clean(c.localizacao) || '—'}`,
    c.descricao ? `Anotação do inspetor: ${clean(c.descricao)}` : '',
    'Manifestações possíveis por material:',
    ...Object.entries(porMat).map(([k, v]) => `- ${k}: ${v.join('; ')}`)
  ].filter(Boolean).join('\n');
  return {
    model, max_tokens: 4000,
    system,
    messages: [{ role: 'user', content: [...imgs, { type: 'text', text: ctx + '\n\nSugira o preenchimento deste item.' }] }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema } }
  };
}

async function callClaude(env, req) {
  const send = r => fetch(API_URL, { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': env.ANTHROPIC_VERSION || '2026-10-21', 'content-type': 'application/json' }, body: JSON.stringify(r) });
  let r = await send(req);
  if (r.status === 400) {   // se esta versão da API não aceitar o nível de esforço, tenta sem ele
    const t = await r.text();
    if (/effort/i.test(t)) { const q = structuredClone(req); delete q.output_config.effort; r = await send(q); }
    else return { status: 400, text: t };
  }
  return { status: r.status, text: await r.text() };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || 'https://lauraduarte1007-sys.github.io').split(',').map(s => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600' } : {};
    const out = (status, body) => new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, cors) });
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && url.pathname === '/') return out(200, { ok: true, app: 'inspecao-ia', chave: !!env.ANTHROPIC_API_KEY });
    if (request.method !== 'POST' || url.pathname !== '/descrever') return out(404, { code: 'notfound' });
    if (!allowed.includes(origin)) return out(403, { code: 'denied' });
    try {
      if (!env.ANTHROPIC_API_KEY) throw new Err(503, 'ia-config');
      const project = env.FIREBASE_PROJECT_ID || 'inspecao-campo', col = env.USERS_COLLECTION || 'ia_users';
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const uid = await verifyToken(token, project);
      if (!(await isActive(token, project, col, uid))) throw new Err(403, 'denied');
      if (!rateOk(uid)) throw new Err(429, 'ia-limite');
      if (+(request.headers.get('content-length') || 0) > 20_000_000) throw new Err(413, 'ia-erro');
      let body; try { body = await request.json(); } catch (e) { throw new Err(400, 'ia-erro'); }
      const r = await callClaude(env, buildRequest(body, env.MODEL || 'claude-sonnet-5-5'));
      if (r.status === 401 || r.status === 403) throw new Err(503, 'ia-config');
      if (r.status === 429 || r.status === 529 || r.status >= 500) throw new Err(503, 'ia-ocupada');
      if (r.status !== 200) throw new Err(502, 'ia-erro');
      const msg = JSON.parse(r.text), block = (msg.content || []).find(b => b.type === 'text');
      if (!block) throw new Err(502, 'ia-erro');
      let sug; try { sug = JSON.parse(block.text); } catch (e) { throw new Err(502, 'ia-erro'); }
      const s = {};
      for (const k of ['elemento', 'material', 'manifestacao', 'causa', 'origem', 'confianca']) s[k] = clean(sug[k]);
      s.descricao = String(sug.descricao || '').trim().slice(0, 800);
      s.observacoes = String(sug.observacoes || '').trim().slice(0, 600);
      return out(200, { sug: s, modelo: msg.model || '', uso: msg.usage || null });
    } catch (e) {
      if (e instanceof Err) return out(e.status, { code: e.code });
      return out(500, { code: 'ia-erro' });
    }
  }
};
