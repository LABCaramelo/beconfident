import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { makeWebHandler } from './web.mjs';

const secret = 'local-test-secret-for-web-sessions-123456789';
const timestamp = 1793286000000;
function memoryStore() {
  let root = { webSessions: {}, sessions: {}, inbox: {} };
  return {
    read: async () => ({ value: structuredClone(root), etag: 'test' }),
    transact: async fn => {
      const outcome = fn(structuredClone(root));
      root = structuredClone(outcome.value);
      return outcome.result;
    },
    snapshot: () => structuredClone(root)
  };
}
async function invoke(handler, { method = 'GET', url = '/api/state', cookie, body, origin = 'http://example.test', headers = {}, streamed = false } = {}) {
  const req = Readable.from(streamed ? [typeof body === 'string' ? body : JSON.stringify(body)] : []);
  req.method = method; req.url = url;
  req.headers = { host: 'example.test', ...(cookie ? { cookie } : {}), ...(method === 'POST' ? { origin, 'content-type': 'application/json', 'idempotency-key': 'operation-12345' } : {}), ...headers };
  if (body !== undefined && !streamed) req.body = body;
  const res = {
    statusCode: 200, headers: {}, headersSent: false,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; this.headersSent = true; }
  };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
}
const cookieOf = response => response.headers['set-cookie']?.split(';')[0];
const profile = { action: 'profile', data: { name: 'Alex', selfLevel: 'beginner', dailyGoal: 10 } };

test('web sessions use signed secure cookies and persist only HMAC keys', async () => {
  const store = memoryStore();
  const handler = makeWebHandler({ store, sessionSecret: secret, now: () => timestamp });
  const first = await invoke(handler, { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(first.status, 200);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.match(first.headers['set-cookie'], /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/);
  assert.equal(first.body.learner, null);
  const cookie = cookieOf(first);
  assert.match(cookie, /^cl_session=[a-f\d]{32}\.\d{13}\.[A-Za-z\d_-]{43}$/);
  const id = cookie.split('=')[1].split('.')[0];
  const snapshot = store.snapshot();
  assert.equal(Object.keys(snapshot.webSessions).length, 1);
  assert.match(Object.keys(snapshot.webSessions)[0], /^[a-f\d]{64}$/);
  assert.equal(JSON.stringify(snapshot).includes(id), false);
});

test('reloads preserve learner and retried operations do not duplicate practice', async () => {
  const store = memoryStore(); const handler = makeWebHandler({ store, sessionSecret: secret, now: () => timestamp });
  const cookie = cookieOf(await invoke(handler));
  assert.equal((await invoke(handler, { method: 'POST', url: '/api/action', cookie, body: profile })).status, 200);
  const operation = { method: 'POST', url: '/api/action', cookie, body: { action: 'message', data: { text: 'I enjoy music.' } }, headers: { 'idempotency-key': 'practice-12345' } };
  const first = await invoke(handler, operation);
  const duplicate = await invoke(handler, operation);
  assert.equal(first.body.progress.turns, 1);
  assert.deepEqual(duplicate.body, first.body);
  const reload = await invoke(handler, { cookie });
  assert.equal(reload.body.learner.name, 'Alex');
  assert.equal(reload.body.progress.turns, 1);
  assert.equal(reload.body.lessons.length, 3);
  assert.equal(reload.headers['set-cookie'], undefined);
  const conflict = await invoke(handler, { ...operation, body: { action: 'message', data: { text: 'Different.' } } });
  assert.equal(conflict.status, 409);
});

test('tampered cookie creates an independent session without altering the original', async () => {
  const store = memoryStore(); const handler = makeWebHandler({ store, sessionSecret: secret, now: () => timestamp });
  const cookie = cookieOf(await invoke(handler));
  await invoke(handler, { method: 'POST', url: '/api/action', cookie, body: profile });
  const forged = cookie.replace(/cl_session=./, 'cl_session=f');
  // Guarantee a different ID even if the random original begins with f.
  const tampered = forged === cookie ? cookie.replace(/cl_session=./, 'cl_session=e') : forged;
  const result = await invoke(handler, { cookie: tampered });
  assert.equal(result.status, 200);
  assert.equal(result.body.learner, null);
  assert.ok(cookieOf(result));
  assert.equal((await invoke(handler, { cookie })).body.learner.name, 'Alex');
  assert.equal(Object.keys(store.snapshot().webSessions).length, 2);
});

test('foreign or absent origins cannot mutate state; method and media type are enforced', async () => {
  const store = memoryStore(); const handler = makeWebHandler({ store, sessionSecret: secret, now: () => timestamp });
  const options = { method: 'POST', url: '/api/action', body: profile };
  assert.equal((await invoke(handler, { ...options, origin: 'https://attacker.test' })).status, 403);
  assert.equal((await invoke(handler, { ...options, origin: '' })).status, 403);
  assert.equal((await invoke(handler, { ...options, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await invoke(handler, { ...options, headers: { 'idempotency-key': '' } })).status, 400);
  assert.equal((await invoke(handler, { method: 'GET', url: '/api/action' })).status, 405);
  assert.equal(Object.keys(store.snapshot().webSessions).length, 0);
});

test('streamed and already-parsed body limits reject excessive requests before creating state', async () => {
  const store = memoryStore(); const handler = makeWebHandler({ store, sessionSecret: secret, now: () => timestamp });
  const base = { method: 'POST', url: '/api/action' };
  assert.equal((await invoke(handler, { ...base, body: { action: 'message', data: { text: 'á'.repeat(9000) } } })).status, 413);
  assert.equal((await invoke(handler, { ...base, body: 'x'.repeat(17000), streamed: true })).status, 413);
  assert.equal((await invoke(handler, { ...base, body: '{', streamed: true })).status, 400);
  assert.equal((await invoke(handler, { ...base, body: profile, streamed: true })).status, 200);
});

test('failed durable transactions return safe errors and no cookie or success acknowledgement', async () => {
  const store = { read: async () => { throw new Error('private provider error'); }, transact: async () => { throw new Error('private provider error'); } };
  const handler = makeWebHandler({ store, sessionSecret: secret, now: () => timestamp });
  const result = await invoke(handler);
  assert.equal(result.status, 500);
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(JSON.stringify(result).includes('private provider error'), false);
});

test('expired sessions are removed and anonymous session capacity fails closed', async () => {
  const store = memoryStore(); let time = timestamp;
  const handler = makeWebHandler({ store, sessionSecret: secret, now: () => time });
  const cookie = cookieOf(await invoke(handler));
  await invoke(handler, { method: 'POST', url: '/api/action', cookie, body: profile });
  for (let i = 1; i < 100; i++) assert.equal((await invoke(handler)).status, 200);
  assert.equal((await invoke(handler)).status, 503);
  assert.equal((await invoke(handler, { cookie })).body.learner.name, 'Alex');
  time += 30 * 24 * 60 * 60 * 1000;
  const expired = await invoke(handler, { cookie });
  assert.equal(expired.status, 200);
  assert.equal(expired.body.learner, null);
  assert.notEqual(cookieOf(expired), cookie);
  assert.equal(Object.keys(store.snapshot().webSessions).length, 1);
});
