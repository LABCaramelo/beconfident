import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createState, expose, mutate } from './engine.mjs';
import { integrationConfig, UazapiClient } from './integrations/uazapi.mjs';
import { UazapiBridge } from './integrations/uazapi-bridge.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataRoot = path.join(root, '.data');
const publicRoot = path.join(root, 'public');
const locks = new Map();
const port = Number(process.env.PORT || 4173);
await mkdir(dataRoot, { recursive: true });
const uazapiConfig = integrationConfig();
const uazapi = new UazapiBridge({ directory: path.join(dataRoot, 'uazapi'), config: uazapiConfig, client: uazapiConfig.configured ? new UazapiClient(uazapiConfig) : null });
await uazapi.ready;
const resumeUazapi = () => { void uazapi.drain().catch(() => console.error('Uazapi: falha de processamento local; verificar inbox.')); };
setImmediate(resumeUazapi);
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
function session(req, res) {
  const current = /(?:^|;\s*)confident_session=([a-f\d-]{36})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
  if (current) return current;
  const id = randomUUID();
  res.setHeader('Set-Cookie', `confident_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`);
  return id;
}
async function load(id) {
  try { return JSON.parse(await readFile(path.join(dataRoot, `${id}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return createState(); throw error; }
}
async function save(id, state) {
  const target = path.join(dataRoot, `${id}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state, null, 2));
  await rename(temporary, target);
}
async function body(req, maximum = 16384) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maximum) { const e = new Error('Mensagem muito grande.'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const e = new Error('Conteúdo JSON inválido.'); e.status = 400; throw e; }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, mode: 'demonstration' });
    if (url.pathname === '/hooks/uazapi' || url.pathname.startsWith('/hooks/uazapi/')) {
      if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
      const payload = await body(req, 262144);
      const received = await uazapi.accept(payload, req.headers['x-webhook-secret'] ?? url.searchParams.get('key'));
      json(res, received.status, received.body);
      // ACK somente após persistir a inbox, processamento depois da resposta.
      if (received.status === 200 && !received.body.ignored) setImmediate(resumeUazapi);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(res, 403, { error: 'Origem não permitida.' });
      if (url.pathname === '/api/integrations/uazapi' && req.method === 'GET') return json(res, 200, uazapi.publicStatus());
      const id = session(req, res);
      const previous = locks.get(id) ?? Promise.resolve();
      const operation = previous.catch(() => {}).then(async () => {
        const state = await load(id);
        if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, expose(state));
        if (req.method !== 'POST' || url.pathname !== '/api/action') return json(res, 404, { error: 'Rota não encontrada.' });
        const payload = await body(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) return json(res, 400, { error: 'Operação inválida.' });
        mutate(state, payload.action, payload.data, req.headers['idempotency-key']);
        await save(id, state);
        return json(res, 200, expose(state));
      });
      locks.set(id, operation);
      try { await operation; } finally { if (locks.get(id) === operation) locks.delete(id); }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/icon.svg': ['icon.svg', 'image/svg+xml'] };
    const entry = files[url.pathname];
    if (!entry) { res.writeHead(404); return res.end('Não encontrado'); }
    const bytes = await readFile(path.join(publicRoot, entry[0]));
    res.writeHead(200, { 'Content-Type': entry[1] }); res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    if (!res.headersSent) json(res, error.status ?? 500, { error: error.status ? error.message : 'Não foi possível concluir. Tente novamente.' });
    else res.end();
    if (!error.status) console.error('Falha interna:', error.code ?? error.name);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Confident Lab: http://127.0.0.1:${port} · demonstração local`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { server.close(); await uazapi.close(); process.exit(0); });
