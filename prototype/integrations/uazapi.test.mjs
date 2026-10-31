import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { integrationConfig, normalizeInbound, UazapiClient, UazapiError } from './uazapi.mjs';
import { UazapiBridge } from './uazapi-bridge.mjs';

function config(extra = {}) { return integrationConfig({ UAZAPI_BASE_URL: 'https://fixture.uazapi.example', UAZAPI_INSTANCE_TOKEN: 'fixture-instance-token', UAZAPI_OWNER_NUMBER: '5511000000000', UAZAPI_WEBHOOK_SECRET: 's'.repeat(48), UAZAPI_ALLOWED_CHATS: '5511999999999', UAZAPI_SEND_ENABLED: 'true', ...extra }); }
function payload(extra = {}) { return { EventType: 'messages', owner: '5511000000000', token: 'fixture-instance-token', BaseUrl: 'https://untrusted.example', message: { messageid: 'external-message-1', chatid: '5511999999999@s.whatsapp.net', fromMe: false, isGroup: false, messageType: 'Conversation', text: 'Olá', ...extra } }; }
async function bridgeFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'confident-uazapi-'));
  const calls = [];
  const bridge = new UazapiBridge({ directory, config: options.config ?? config(), client: options.client ?? { sendText: async x => { calls.push(x); return { providerId: `sent-${calls.length}` }; } }, advance: options.advance ?? ((state, incoming) => ({ state, replies: [`Resposta para ${incoming.text}`] })) });
  await bridge.ready;
  t.after(async () => { await bridge.close(); await rm(directory, { recursive: true, force: true }); });
  return { bridge, directory, calls };
}
test('cliente envia só token de instância, não segue redirect e extrai ID da raiz', async () => {
  let seen;
  const client = new UazapiClient({ baseUrl: 'https://fixture.uazapi.example', token: 'instance-fixture', fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ id: 'opaque-id', messageid: 'wa-id', response: { status: 'sent' } }) }; } });
  const result = await client.sendText({ chatId: '5511999999999', text: 'Teste de contrato', trackId: 'tracking-only' });
  assert.equal(result.providerId, 'wa-id'); assert.equal(seen.init.headers.token, 'instance-fixture');
  assert.equal(seen.init.headers.admintoken, undefined); assert.equal(seen.init.redirect, 'error');
  assert.equal(JSON.parse(seen.init.body).number, '5511999999999@s.whatsapp.net');
});
test('webhooks aceitam array e ausência legada vazia, mas rejeitam envelopes desconhecidos', async () => {
  const values = [[], null, [{ id: 'hook-fixture', enabled: true, url: 'https://fixture.example/hook' }], { error: 'provider_error' }, {}];
  const client = new UazapiClient({ baseUrl: 'https://fixture.uazapi.example', token: 'fixture',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => values.shift() }) });
  assert.deepEqual(await client.getWebhooks(), []);
  assert.deepEqual(await client.getWebhooks(), []);
  assert.equal((await client.getWebhooks())[0].id, 'hook-fixture');
  await assert.rejects(client.getWebhooks(), error => error.code === 'unexpected_webhook_shape');
  await assert.rejects(client.getWebhooks(), error => error.code === 'unexpected_webhook_shape');
});

test('erros do prestador não vazam corpo sensível e timeout de envio é incerto', async () => {
  const bad = new UazapiClient({ baseUrl: 'https://fixture.uazapi.example', token: 'fixture', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ token: 'do-not-expose' }) }) });
  await assert.rejects(bad.getStatus(), e => e.message === 'provider_rejected' && !e.uncertain && !JSON.stringify(e).includes('do-not-expose'));
  const timeout = new UazapiClient({ baseUrl: 'https://fixture.uazapi.example', token: 'fixture', fetchImpl: async () => { throw new Error('private transport details'); } });
  await assert.rejects(timeout.sendText({ chatId: '5511999999999', text: 'test' }), e => e.uncertain === true && !e.message.includes('private'));
});
test('normalização rejeita instância errada, mensagens próprias, grupos e contatos fora da lista', () => {
  const c = config();
  assert.equal(normalizeInbound({ ...payload(), token: 'wrong' }, c).status, 401);
  assert.equal(normalizeInbound({ ...payload(), owner: 'other' }, c).status, 403);
  for (const changes of [{ fromMe: true }, { fromMe: undefined }, { wasSentByApi: true }, { isGroup: true }, { chatid: '120000000@g.us' }, { chatid: '5511888888888@s.whatsapp.net' }]) assert.ok(normalizeInbound(payload(changes), c).ignored);
  assert.equal(normalizeInbound(payload({ messageType: 'AudioMessage', text: '' }), c).message.type, 'audio');
});
test('ACK autentica, persiste sem token e duplicatas concorrentes geram um único envio', async t => {
  const { bridge, directory, calls } = await bridgeFixture(t);
  assert.equal((await bridge.accept(payload(), 'wrong')).status, 401);
  const results = await Promise.all([bridge.accept(payload(), 's'.repeat(48)), bridge.accept(payload(), 's'.repeat(48))]);
  assert.equal(results.filter(r => r.body.duplicate).length, 1);
  const persistedBeforeSend = await readFile(path.join(directory, 'bridge.json'), 'utf8');
  assert.equal(persistedBeforeSend.includes('fixture-instance-token'), false);
  assert.equal(persistedBeforeSend.includes('untrusted.example'), false);
  assert.equal(calls.length, 0);
  await bridge.drain(); await bridge.accept(payload(), 's'.repeat(48)); await bridge.drain();
  assert.equal(calls.length, 1); assert.equal(bridge.publicStatus().queue.completed, 1);
});
test('envio desabilitado produz rascunho e nunca chama prestador', async t => {
  const { bridge, calls } = await bridgeFixture(t, { config: config({ UAZAPI_SEND_ENABLED: 'false' }) });
  await bridge.accept(payload(), 's'.repeat(48)); await bridge.drain();
  assert.equal(calls.length, 0); assert.equal(bridge.publicStatus().queue.draft, 1);
});
test('falha ao persistir não transforma nova tentativa em ACK de duplicata não durável', async t => {
  const { bridge } = await bridgeFixture(t);
  const persist = bridge.persist.bind(bridge);
  bridge.persist = async () => { throw new Error('disk_unavailable'); };
  await assert.rejects(bridge.accept(payload(), 's'.repeat(48)), /disk_unavailable/);
  assert.equal(Object.keys(bridge.db.inbox).length, 0);
  bridge.persist = persist;
  const retry = await bridge.accept(payload(), 's'.repeat(48));
  assert.equal(retry.status, 200); assert.equal(retry.body.duplicate, undefined);
});
test('envio incerto não é repetido por replay nem por nova drenagem', async t => {
  let attempts = 0;
  const { bridge } = await bridgeFixture(t, { client: { sendText: async () => { attempts++; throw new UazapiError('transport_failure', null, true); } } });
  await bridge.accept(payload(), 's'.repeat(48)); await bridge.drain();
  await bridge.accept(payload(), 's'.repeat(48)); await bridge.drain();
  assert.equal(attempts, 1); assert.equal(bridge.publicStatus().queue.uncertain, 1);
});
test('reinício não repete um envio que estava em andamento', async t => {
  const { bridge, directory } = await bridgeFixture(t, { config: config({ UAZAPI_SEND_ENABLED: 'false' }) });
  await bridge.accept(payload(), 's'.repeat(48)); await bridge.drain();
  const file = path.join(directory, 'bridge.json'); const db = JSON.parse(await readFile(file, 'utf8'));
  const entry = Object.values(db.inbox)[0]; entry.status = 'prepared'; entry.outgoing[0].state = 'sending';
  await writeFile(file, JSON.stringify(db));
  let attempts = 0;
  const recovered = new UazapiBridge({ directory, config: config(), client: { sendText: async () => { attempts++; return { providerId: 'bad-retry' }; } } });
  t.after(() => recovered.close()); await recovered.ready; await recovered.drain();
  assert.equal(attempts, 0); assert.equal(recovered.publicStatus().queue.uncertain, 1);
});
test('falha de fluxo não trava o próximo evento nem grava estado parcialmente alterado', async t => {
  const { bridge, calls } = await bridgeFixture(t, { advance: (state, incoming) => { if (incoming.id === 'bad') { state.learner = { name: 'should-not-persist' }; throw new Error('private'); } return { state, replies: ['Tudo certo'] }; } });
  await bridge.accept(payload({ messageid: 'bad' }), 's'.repeat(48));
  await bridge.accept(payload({ messageid: 'good' }), 's'.repeat(48)); await bridge.drain();
  assert.equal(calls.length, 1); assert.equal(bridge.publicStatus().queue.failed, 1); assert.equal(bridge.publicStatus().queue.completed, 1);
  assert.equal(Object.values(bridge.db.sessions)[0].learner, null);
});
