import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createState, expose, mutate } from '../engine.mjs';

const COOKIE = 'cl_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BODY = 16 * 1024;
const MAX_SESSIONS = 100;
const ACTIONS = new Set(['profile', 'answer', 'message', 'review', 'lesson', 'reset']);

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function header(req, name) {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : '';
}

function equal(a, b) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

async function parseBody(req) {
  const contentLength = header(req, 'content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY)) {
    throw fail('Mensagem muito grande.', 413);
  }
  let text;
  // Vercel may parse JSON before passing a Node request to the function.
  if (req.body !== undefined) {
    try {
      text = typeof req.body === 'string' ? req.body
        : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    } catch { throw fail('Conteúdo JSON inválido.', 400); }
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BODY) throw fail('Mensagem muito grande.', 413);
  } else {
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BODY) throw fail('Mensagem muito grande.', 413);
      chunks.push(buffer);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  try { return JSON.parse(text); }
  catch { throw fail('Conteúdo JSON inválido.', 400); }
}

function sameOrigin(req) {
  const host = header(req, 'host');
  const origin = header(req, 'origin');
  if (!host || !origin) return false;
  try {
    const parsed = new URL(origin);
    const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
      || req.socket?.encrypted || header(req, 'x-forwarded-proto').split(',')[0].trim() === 'https';
    return parsed.origin === origin && !parsed.username && !parsed.password
      && parsed.host === host && parsed.protocol === (secure ? 'https:' : 'http:');
  } catch { return false; }
}

/** Anonymous web sessions are separate from WhatsApp identities. No cookie ID is stored. */
export function makeWebHandler({ store, sessionSecret, now = Date.now } = {}) {
  if (!store || typeof store.transact !== 'function' || typeof store.read !== 'function') throw new Error('invalid_web_store');
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) throw new Error('invalid_session_secret');
  const sign = value => createHmac('sha256', sessionSecret).update(`web-cookie:${value}`).digest('base64url');
  const keyFor = id => createHmac('sha256', sessionSecret).update(`web-session:${id}`).digest('hex');

  return async function webHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const pathname = new URL(req.url, 'http://local.invalid').pathname;
      if (!['/api/state', '/api/action'].includes(pathname)) return json(res, 404, { error: 'Rota não encontrada.' });
      const method = pathname === '/api/state' ? 'GET' : 'POST';
      if (req.method !== method) {
        res.setHeader('Allow', method);
        return json(res, 405, { error: 'Método não permitido.' });
      }
      let payload;
      if (method === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não permitida.' });
        if (!/^application\/json(?:\s*;|$)/i.test(header(req, 'content-type'))) return json(res, 415, { error: 'Envie conteúdo JSON.' });
        payload = await parseBody(req);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)
          || !ACTIONS.has(payload.action) || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
          return json(res, 400, { error: 'Operação inválida.' });
        }
        if (!/^[\w-]{8,100}$/.test(header(req, 'idempotency-key'))) return json(res, 400, { error: 'Identificador de operação inválido.' });
      }

      const timestamp = now();
      const raw = /(?:^|;\s*)cl_session=([^;]*)(?:;|$)/.exec(header(req, 'cookie'))?.[1] ?? '';
      const parts = /^([a-f\d]{32})\.(\d{13})\.([A-Za-z\d_-]{43})$/.exec(raw);
      const issuedAt = parts ? Number(parts[2]) : 0;
      const valid = parts && issuedAt <= timestamp && timestamp - issuedAt < SESSION_MS
        && equal(parts[3], sign(`${parts[1]}.${parts[2]}`));
      const id = valid ? parts[1] : randomBytes(16).toString('hex');
      const key = keyFor(id);
      const tokenBody = `${id}.${timestamp}`;
      const newCookie = valid ? null : `${tokenBody}.${sign(tokenBody)}`;
      const view = await store.transact(root => {
        root.webSessions ??= {};
        for (const [entryKey, entry] of Object.entries(root.webSessions)) {
          if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= timestamp) delete root.webSessions[entryKey];
        }
        let session = root.webSessions[key];
        if (!session) {
          if (Object.keys(root.webSessions).length >= MAX_SESSIONS) throw fail('A demonstração atingiu o limite de sessões. Tente novamente mais tarde.', 503);
          session = root.webSessions[key] = { expiresAt: (valid ? issuedAt : timestamp) + SESSION_MS, state: createState() };
        }
        if (method === 'POST') mutate(session.state, payload.action, payload.data, header(req, 'idempotency-key'));
        return { value: root, result: expose(session.state) };
      });
      // Cookie creation is committed only after the durable transaction succeeds.
      if (newCookie) {
        const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
          || req.socket?.encrypted || header(req, 'x-forwarded-proto').split(',')[0].trim() === 'https';
        res.setHeader('Set-Cookie', `${COOKIE}=${newCookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
      }
      return json(res, 200, view);
    } catch (error) {
      const code = typeof error.code === 'string' && /^[a-z_]{1,80}$/.test(error.code) ? error.code
        : typeof error.name === 'string' && /^[A-Za-z]{1,80}$/.test(error.name) ? error.name : 'internal_error';
      console.error('web_operation_failed', code);
      if (!res.headersSent) return json(res, Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500,
        { error: Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.message : 'Não foi possível concluir. Tente novamente.' });
      res.end();
    }
  };
}
