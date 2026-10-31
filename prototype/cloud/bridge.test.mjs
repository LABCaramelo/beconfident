import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobCasStore } from './blob-store.mjs';
import { CloudBridge, initialCloudState } from './bridge.mjs';
import { integrationConfig, UazapiError } from '../integrations/uazapi.mjs';
import { createState, expose } from '../engine.mjs';
import { advanceWhatsapp } from '../integrations/whatsapp-flow.mjs';

class BlobError extends Error {}
class BlobPreconditionFailedError extends BlobError {}
function memorySdk() {
  let data = null; let version = 0;
  return {
    BlobError, BlobPreconditionFailedError,
    async get() {
      if (data === null) return null;
      const body = data; const etag = `"${version}"`;
      return { statusCode: 200, stream: new Response(body).body, blob: { etag, size: Buffer.byteLength(body) } };
    },
    async put(_path, body, options) {
      if (!options.allowOverwrite && data !== null) throw new BlobError('This blob already exists');
      if (options.ifMatch && options.ifMatch !== `"${version}"`) throw new BlobPreconditionFailedError('conflict');
      data = body; version++; return { etag: `"${version}"` };
    }
  };
}
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function harness({ enabled = true, send, publish, generator = null } = {}) {
  const config = integrationConfig({
    UAZAPI_BASE_URL: 'https://uazapi.example.invalid', UAZAPI_INSTANCE_TOKEN: 'synthetic-instance-token',
    UAZAPI_OWNER_NUMBER: '5511999999999', UAZAPI_ALLOWED_CHATS: '5511888888888',
    UAZAPI_WEBHOOK_SECRET: 's'.repeat(32), UAZAPI_SEND_ENABLED: String(enabled)
  });
  const store = new BlobCasStore({ sdk: memorySdk(), initial: initialCloudState, maxAttempts: 40 });
  const clock = { value: 1_700_000_000_000 };
  const sent = []; const wakes = [];
  const options = { store, config, generator, sessionSecret: 'stable-session-key-'.repeat(3), now: () => clock.value, leaseMs: 120_000,
    client: { async sendText(message) { sent.push(message); return send ? send(message, sent.length) : { providerId: `provider-${sent.length}` }; } },
    publish: async payload => { wakes.push(payload); if (publish) return publish(payload, wakes.length); } };
  const bridge = new CloudBridge(options);
  const input = (id = 'in-1', text = 'Olá') => ({ EventType: 'messages', owner: config.owner, token: config.token,
    BaseUrl: 'https://not-persisted.example.invalid', message: { messageid: id, chatid: '5511888888888@s.whatsapp.net',
      senderName: 'Teste', fromMe: false, isGroup: false, messageType: 'Conversation', text } });
  return { bridge, options, store, config, clock, sent, wakes, input, secret: config.secret };
}

async function practiceSession(h) {
  const chatId = '5511888888888@s.whatsapp.net';
  let state = createState();
  for (const [index, text] of ['Olá', 'Alex', '2', '1', '2', '3'].entries()) {
    state = advanceWhatsapp(state, { id: `setup-${index}`, chatId, text, type: 'text' }).state;
  }
  assert.equal(state.channelState.phase, 'practice');
  await h.store.transact(value => {
    value.sessions[h.bridge.sessionKey(chatId)] = state;
    return { value, result: null };
  });
  return structuredClone(state);
}

const GENERATED = { ok: true, reply: 'That sounds interesting. What happened next?',
  translation: 'Isso parece interessante. O que aconteceu depois?', model: 'gpt-4o',
  usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 }, generationId: 'gen-synthetic', code: 'openai_generated' };

test('accept validates origins, ignores disallowed traffic and enforces bounded inbox', async () => {
  const h = harness();
  assert.equal((await h.bridge.accept(h.input(), 'wrong')).status, 401);
  assert.equal((await h.bridge.accept({ ...h.input(), token: 'wrong' }, h.secret)).status, 401);
  assert.equal((await h.bridge.accept({ ...h.input(), owner: '5500000000000' }, h.secret)).status, 403);
  const own = h.input(); own.message.fromMe = true;
  assert.ok((await h.bridge.accept(own, h.secret)).ignored);
  const group = h.input(); group.message.isGroup = true;
  assert.ok((await h.bridge.accept(group, h.secret)).ignored);
  assert.equal(h.wakes.length, 0);
  assert.equal(Object.keys((await h.store.read()).value.inbox).length, 0);
  await h.store.transact(value => {
    for (let index = 0; index < 2000; index++) value.inbox[`old-${index}`] = { status: 'completed', outbox: [] };
    return { value, result: null };
  });
  assert.deepEqual(await h.bridge.accept(h.input(), h.secret), { status: 503, error: 'inbox_full' });
  assert.equal(h.wakes.length, 0);
});

test('concurrent duplicate accept persists once, sequences once and repairs wakes without raw secrets', async () => {
  const h = harness();
  const results = await Promise.all([h.bridge.accept(h.input(), h.secret), h.bridge.accept(h.input(), h.secret)]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(results.filter(result => result.duplicate).length, 1);
  const state = (await h.store.read()).value;
  assert.equal(Object.keys(state.inbox).length, 1);
  assert.equal(state.nextSeq, 2);
  const entry = Object.values(state.inbox)[0];
  assert.equal(entry.seq, 1);
  assert.equal(entry.status, 'queued');
  assert.match(entry.sessionKey, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(state).includes(h.config.token), false);
  assert.equal(JSON.stringify(state).includes('not-persisted.example'), false);
  assert.deepEqual(h.wakes, [{ wake: true }, { wake: true }]);
  assert.equal(h.sent.length, 0);
});

test('failed publish does not acknowledge; pending duplicate republishes the durable input', async () => {
  const h = harness({ publish: (_payload, count) => { if (count === 1) throw new Error('unavailable'); } });
  assert.deepEqual(await h.bridge.accept(h.input(), h.secret), { status: 503, error: 'queue_publish_failed' });
  assert.equal(Object.keys((await h.store.read()).value.inbox).length, 1);
  const retry = await h.bridge.accept(h.input(), h.secret);
  assert.equal(retry.status, 200);
  assert.equal(retry.duplicate, true);
  assert.equal(h.wakes.length, 2);
  await h.bridge.drain();
  assert.equal(h.sent.length, 1);
  const before = h.wakes.length;
  await h.bridge.accept(h.input(), h.secret);
  assert.equal(h.wakes.length, before, 'terminal duplicates do not restart delivery');
});

test('concurrent drains use one distributed lease and commit outbox before sending', async () => {
  const started = gate(); const release = gate();
  let h;
  h = harness({ send: async () => {
    const state = (await h.store.read()).value;
    const entry = Object.values(state.inbox)[0];
    assert.equal(entry.outbox[0].status, 'sending');
    assert.ok(entry.outbox[0].attemptId);
    assert.ok(state.sessions[entry.sessionKey]);
    started.resolve(); await release.promise; return { providerId: 'sent-once' };
  } });
  await h.bridge.accept(h.input(), h.secret);
  const first = h.bridge.drain(); await started.promise;
  const secondBridge = new CloudBridge(h.options);
  assert.deepEqual(await secondBridge.drain(), { pending: true, busy: true, processed: 0 });
  release.resolve();
  assert.equal((await first).pending, false);
  const state = (await h.store.read()).value;
  assert.equal(h.sent.length, 1);
  assert.equal(state.worker, null);
  const entry = Object.values(state.inbox)[0];
  assert.equal(entry.status, 'completed');
  assert.equal(entry.outbox[0].providerId, 'sent-once');
});

test('drain preserves sequence/web state, stops after ten events and resumes leftovers', async () => {
  const h = harness();
  await h.store.transact(value => { value.webSessions.existing = { keep: true }; return { value, result: null }; });
  const texts = ['Olá', 'Alex', '2', '1', '2', '3', 'I has a question', 'Traduz', '#menu', 'PAUSAR', 'hello', 'RETOMAR'];
  for (let index = 0; index < texts.length; index++) await h.bridge.accept(h.input(`ordered-${index}`, texts[index]), h.secret);
  const first = await h.bridge.drain();
  assert.equal(first.processed, 10);
  assert.equal(first.pending, true);
  let state = (await h.store.read()).value;
  const entries = Object.values(state.inbox).sort((a, b) => a.seq - b.seq);
  assert.ok(entries.slice(0, 10).every(entry => entry.status === 'completed'));
  assert.ok(entries.slice(10).every(entry => entry.status === 'queued'));
  assert.equal((await h.bridge.drain()).pending, false);
  state = (await h.store.read()).value;
  assert.deepEqual(state.webSessions, { existing: { keep: true } });
  const byKey = new Map(Object.values(state.inbox).flatMap(entry => entry.outbox.map(out => [out.key, entry.seq])));
  const sequence = h.sent.map(message => byKey.get(message.trackId));
  assert.deepEqual(sequence, [...sequence].sort((a, b) => a - b));
});

test('ambiguous timeout and provider 5xx remain uncertain and are never resent automatically', async () => {
  for (const failure of [new UazapiError('transport_failure', null, true), new UazapiError('provider_rejected', 503, false)]) {
    const h = harness({ send: async () => { throw failure; } });
    await h.bridge.accept(h.input(), h.secret);
    assert.equal((await h.bridge.drain()).pending, false);
    const entry = Object.values((await h.store.read()).value.inbox)[0];
    assert.equal(entry.status, 'uncertain');
    assert.equal(entry.outbox[0].status, 'uncertain');
    await h.bridge.drain(); await h.bridge.accept(h.input(), h.secret);
    assert.equal(h.sent.length, 1);
    assert.equal(h.wakes.length, 1);
  }
});

test('expired lease recovers sending as uncertain and fences the old worker/result/release', async () => {
  const firstStarted = gate(); const firstRelease = gate();
  const secondStarted = gate(); const secondRelease = gate();
  const h = harness({ send: async (_message, count) => {
    if (count === 1) { firstStarted.resolve(); await firstRelease.promise; }
    if (count === 2) { secondStarted.resolve(); await secondRelease.promise; }
    return { providerId: `delivery-${count}` };
  } });
  await h.bridge.accept(h.input('first', 'Olá'), h.secret);
  const oldDrain = h.bridge.drain(); await firstStarted.promise;
  const oldActor = (await h.store.read()).value.worker.actor;
  await h.bridge.accept(h.input('second', 'Alex'), h.secret);
  h.clock.value += 120_001;
  const newDrain = new CloudBridge(h.options).drain(); await secondStarted.promise;
  const newActor = (await h.store.read()).value.worker.actor;
  assert.notEqual(oldActor, newActor);
  firstRelease.resolve();
  const oldResult = await oldDrain;
  assert.equal(oldResult.fenced, true);
  let state = (await h.store.read()).value;
  assert.equal(state.worker.actor, newActor, 'old finally cannot release the new worker');
  const firstEntry = Object.values(state.inbox).find(entry => entry.seq === 1);
  assert.equal(firstEntry.status, 'uncertain');
  assert.equal(firstEntry.outbox[0].providerId, undefined);
  secondRelease.resolve();
  assert.equal((await newDrain).pending, false);
  state = (await h.store.read()).value;
  assert.equal(state.worker, null);
  assert.equal(h.sent.filter(message => message.trackId === firstEntry.outbox[0].key).length, 1);
});

test('manual test is allowlisted/idempotent; dry-run drafts stay terminal after enabling sends', async () => {
  const h = harness({ enabled: false });
  assert.equal((await h.bridge.queueTest('5511888888888')).status, 503);
  await h.bridge.accept(h.input(), h.secret);
  await h.bridge.drain();
  let state = (await h.store.read()).value;
  const draftKey = Object.keys(state.inbox)[0];
  assert.equal(state.inbox[draftKey].status, 'draft');
  assert.equal(state.inbox[draftKey].outbox[0].status, 'draft');
  h.config.sendEnabled = true;
  const wakesBefore = h.wakes.length;
  await h.bridge.accept(h.input(), h.secret); await h.bridge.drain();
  assert.equal(h.wakes.length, wakesBefore);
  assert.equal(h.sent.length, 0);
  assert.equal((await h.bridge.queueTest('5511777777777')).status, 403);
  const manual = await h.bridge.queueTest('5511888888888');
  assert.equal(manual.status, 202);
  assert.equal(manual.chatId, '5511888888888@s.whatsapp.net');
  assert.equal((await h.bridge.queueTest(manual.chatId)).duplicate, true);
  await h.bridge.drain();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].text, 'Teste de integração do tutor Confident Lab.');
  assert.equal(h.sent[0].replyId, undefined);
  await h.bridge.queueTest(manual.chatId); await h.bridge.drain();
  assert.equal(h.sent.length, 1);
  state = (await h.store.read()).value;
  assert.equal(state.inbox[draftKey].status, 'draft');
});

test('revoked allowlist blocks prepared outbox at claim and dedupe cannot change its recipient', async () => {
  const h = harness();
  await h.bridge.queueTest('5511888888888');
  const actor = 'scope-revocation-fixture';
  assert.equal(await h.bridge.acquire(actor), true);
  const prepared = await h.bridge.prepareNext(actor);
  assert.equal(prepared.terminal, false);
  h.config.allowed = new Set(['5511777777777@s.whatsapp.net']);
  assert.equal((await h.bridge.claimSend(actor, prepared.key, 'unissued-attempt')).terminal, true);
  await h.bridge.release(actor);
  assert.equal((await h.bridge.drain()).pending, false);
  let state = (await h.store.read()).value;
  assert.equal(state.inbox[prepared.key].status, 'blocked');
  assert.equal(state.inbox[prepared.key].outbox[0].status, 'blocked');
  assert.equal(state.inbox[prepared.key].error.code, 'entry_scope_invalid');
  assert.equal(h.sent.length, 0);

  const collision = harness();
  await collision.bridge.accept(collision.input('same-provider-id'), collision.secret);
  collision.config.allowed = new Set(['5511777777777@s.whatsapp.net']);
  const differentContact = collision.input('same-provider-id');
  differentContact.message.chatid = '5511777777777@s.whatsapp.net';
  assert.deepEqual(await collision.bridge.accept(differentContact, collision.secret), {
    status: 409, error: 'message_identity_conflict'
  });
  assert.equal(collision.wakes.length, 1);
  await collision.bridge.drain();
  state = (await collision.store.read()).value;
  assert.equal(Object.values(state.inbox)[0].status, 'blocked');
  assert.equal(Object.values(state.inbox)[0].chatId, '5511888888888@s.whatsapp.net');
  assert.equal(collision.sent.length, 0);
});

test('changed server or missing legacy instance binding blocks old pending entries without network', async () => {
  for (const change of ['server', 'legacy']) {
    const h = harness();
    await h.bridge.queueTest('5511888888888');
    const before = (await h.store.read()).value;
    const key = Object.keys(before.inbox)[0];
    assert.match(before.inbox[key].instanceKey, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(before).includes(h.config.token), false);
    if (change === 'server') h.config.baseUrl = 'https://another-instance.example.invalid';
    else await h.store.transact(value => { delete value.inbox[key].instanceKey; return { value, result: null }; });
    assert.equal((await new CloudBridge(h.options).drain()).pending, false);
    const after = (await h.store.read()).value;
    assert.equal(after.inbox[key].status, 'blocked');
    assert.equal(after.inbox[key].outbox[0].status, 'blocked');
    assert.equal(after.inbox[key].error.code, 'entry_scope_invalid');
    assert.deepEqual(after.sessions, {});
    assert.equal(h.sent.length, 0);
  }
});

test('concurrent generative drains call the model once outside CAS and commit reply, reviews and outbox atomically', async () => {
  const started = gate(); const release = gate(); let calls = 0; let h; let before;
  h = harness({ generator: { async generate(input) {
    calls++;
    assert.equal(input.message, 'I has a question');
    const state = (await h.store.read()).value;
    const entry = Object.values(state.inbox)[0];
    assert.equal(entry.status, 'generating');
    assert.equal(entry.generation.status, 'generating');
    assert.ok(entry.generation.attemptId);
    assert.deepEqual(state.sessions[entry.sessionKey], before, 'draft is not learner progress');
    assert.deepEqual(entry.outbox, []);
    started.resolve(); await release.promise;
    return GENERATED;
  } }, send: async message => {
    const state = (await h.store.read()).value;
    const entry = Object.values(state.inbox)[0];
    const session = state.sessions[entry.sessionKey];
    assert.equal(entry.generation.status, 'completed');
    assert.equal(entry.generation.prepared, undefined);
    assert.equal(entry.generation.baseSessionHash, undefined);
    assert.equal(expose(session).progress.turns, 1);
    assert.equal(session.messages.filter(m => m.role === 'user' && m.text === 'I has a question').length, 1);
    assert.equal(session.messages.filter(m => m.aiGenerated).length, 1);
    assert.equal(session.reviews.filter(review => review.original === 'I has a question').length, 1);
    assert.ok(entry.outbox.some(out => out.text.includes(GENERATED.reply)));
    return { providerId: `atomic-${message.trackId}` };
  } });
  before = await practiceSession(h);
  await h.bridge.accept(h.input('generated-1', 'I has a question'), h.secret);
  const first = h.bridge.drain(); await started.promise;
  assert.equal((await new CloudBridge(h.options).drain()).busy, true);
  assert.equal((await h.bridge.accept(h.input('generated-1', 'I has a question'), h.secret)).duplicate, true);
  release.resolve();
  assert.equal((await first).pending, false);
  const state = (await h.store.read()).value;
  const entry = Object.values(state.inbox)[0];
  assert.equal(calls, 1);
  assert.equal(entry.status, 'completed');
  assert.deepEqual(entry.generation.usage, GENERATED.usage);
  assert.equal(entry.generation.model, GENERATED.model);
  assert.equal(entry.generation.generationId, GENERATED.generationId);
  assert.ok(h.sent.some(message => message.text.includes('I have a question')));
  await h.bridge.accept(h.input('generated-1', 'I has a question'), h.secret); await h.bridge.drain();
  assert.equal(calls, 1);
});

test('failed or invalid generation sends one honest notice without committing practice or regenerating', async () => {
  for (const result of [{ ok: false, model: 'gpt-4o', code: 'openai_rate_limited', status: 429 },
    { ok: false, code: 'openai_timeout' }, { ...GENERATED, reply: '' }, null]) {
    let calls = 0;
    const h = harness({ generator: { async generate() { calls++; return result; } } });
    const before = await practiceSession(h);
    await h.bridge.accept(h.input('failed-generation', 'Yesterday I go to work'), h.secret);
    assert.equal((await h.bridge.drain()).pending, false);
    let state = (await h.store.read()).value;
    const entry = Object.values(state.inbox)[0];
    assert.deepEqual(state.sessions[entry.sessionKey], before);
    assert.equal(entry.status, 'completed');
    assert.ok(['failed', 'uncertain'].includes(entry.generation.status));
    assert.equal(entry.generation.prepared, undefined);
    assert.equal(entry.outbox.length, 1);
    assert.match(h.sent[0].text, /^Não consegui responder agora\./);
    assert.match(h.sent[0].text, /progresso foi preservado/);
    await h.bridge.accept(h.input('failed-generation', 'Yesterday I go to work'), h.secret); await h.bridge.drain();
    state = (await h.store.read()).value;
    assert.deepEqual(state.sessions[entry.sessionKey], before);
    assert.equal(calls, 1);
    assert.equal(h.sent.length, 1);
  }
});

test('lost generation commit is recovered as uncertain with one fallback and no second model call', async () => {
  for (const committed of [false, true]) {
    let calls = 0;
    const h = harness({ generator: { async generate() { calls++; return GENERATED; } } });
    const before = await practiceSession(h);
    await h.bridge.accept(h.input('commit-generation', 'I enjoy cooking'), h.secret);
    const transact = h.store.transact.bind(h.store); let failed = false;
    h.store.transact = mutator => transact(value => {
      const changed = mutator(value);
      const completed = Object.values(changed.value.inbox).find(entry => entry.generation?.status === 'completed');
      if (!failed && completed) {
        failed = true;
        if (!committed) throw new Error('simulated_write_failure');
      }
      return changed;
    }).then(result => {
      if (committed && failed && !h.lostCommitResponse) {
        h.lostCommitResponse = true; throw new Error('simulated_lost_commit_response');
      }
      return result;
    });
    await assert.rejects(h.bridge.drain(), /simulated_/);
    h.store.transact = transact;
    assert.equal(calls, 1);
    assert.equal((await new CloudBridge(h.options).drain()).pending, false);
    const state = (await h.store.read()).value;
    const entry = Object.values(state.inbox)[0];
    assert.equal(calls, 1);
    assert.equal(entry.generation.prepared, undefined);
    if (committed) {
      assert.equal(entry.generation.status, 'completed');
      assert.equal(expose(state.sessions[entry.sessionKey]).progress.turns, 1);
      assert.equal(h.sent[0].text, GENERATED.reply);
    } else {
      assert.equal(entry.generation.status, 'uncertain');
      assert.equal(entry.generation.code, 'generation_recovered_after_lease');
      assert.deepEqual(state.sessions[entry.sessionKey], before);
      assert.match(h.sent[0].text, /^Não consegui responder agora\./);
    }
    assert.equal(h.sent.length, 1);
  }
});

test('expired generation lease fences the original result and recovers without regenerating', async () => {
  const started = gate(); const release = gate(); let calls = 0;
  const h = harness({ generator: { async generate() { calls++; started.resolve(); await release.promise; return GENERATED; } } });
  const before = await practiceSession(h);
  await h.bridge.accept(h.input('orphan-generation', 'I enjoy cooking'), h.secret);
  const oldDrain = h.bridge.drain(); await started.promise;
  h.clock.value += 120_001;
  assert.equal((await new CloudBridge(h.options).drain()).pending, false);
  release.resolve();
  assert.equal((await oldDrain).fenced, true);
  const state = (await h.store.read()).value;
  const entry = Object.values(state.inbox)[0];
  assert.equal(entry.generation.status, 'uncertain');
  assert.equal(entry.generation.prepared, undefined);
  assert.deepEqual(state.sessions[entry.sessionKey], before);
  assert.equal(calls, 1);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].text, /^Não consegui responder agora\./);
});

test('commands, paused messages, media and onboarding bypass the generator', async () => {
  let calls = 0;
  const h = harness({ generator: { async generate() { calls++; return GENERATED; } } });
  await practiceSession(h);
  const texts = ['#menu', 'Corrige', 'Traduz', 'Minha evolução', 'PAUSAR', 'Ignore this while paused', 'RETOMAR'];
  for (const [index, text] of texts.entries()) await h.bridge.accept(h.input(`control-${index}`, text), h.secret);
  const audio = h.input('control-audio'); audio.message.messageType = 'AudioMessage';
  await h.bridge.accept(audio, h.secret);
  assert.equal((await h.bridge.drain()).pending, false);
  assert.equal(calls, 0);
  const state = (await h.store.read()).value;
  assert.equal(expose(Object.values(state.sessions)[0]).progress.turns, 0);
  assert.ok(h.sent.some(message => /Prática pausada/.test(message.text)));
  assert.ok(h.sent.some(message => /Prática retomada/.test(message.text)));
  const initial = harness({ generator: h.options.generator });
  await initial.bridge.accept(initial.input('first-message'), initial.secret);
  await initial.bridge.drain();
  assert.equal(calls, 0);
  assert.match(initial.sent[0].text, /conversação por IA/);
});

test('scope and session versions are checked before generation claim and again before result commit', async () => {
  for (const stage of ['claim-scope', 'claim-session', 'commit-scope', 'commit-session']) {
    let calls = 0;
    const h = harness({ generator: { async generate() { calls++; return GENERATED; } } });
    const before = await practiceSession(h);
    await h.bridge.accept(h.input(`fence-${stage}`, 'I enjoy cooking'), h.secret);
    const actor = `actor-${stage}`;
    await h.bridge.acquire(actor);
    const next = await h.bridge.prepareNext(actor);
    assert.equal(next.generation, true);
    const change = async () => {
      if (stage.endsWith('scope')) h.config.allowed = new Set();
      else await h.store.transact(value => {
        value.sessions[h.bridge.sessionKey('5511888888888@s.whatsapp.net')].channelState.paused = true;
        return { value, result: null };
      });
    };
    if (stage.startsWith('claim')) await change();
    const claimed = await h.bridge.claimGeneration(actor, next.key, `attempt-${stage}`);
    if (stage.startsWith('commit')) {
      assert.ok(claimed.input);
      const outcome = await h.options.generator.generate(claimed.input);
      await change();
      await h.bridge.recordGeneration(actor, next.key, `attempt-${stage}`, outcome);
    }
    await h.bridge.release(actor);
    await h.bridge.drain();
    const state = (await h.store.read()).value;
    const entry = state.inbox[next.key];
    assert.equal(entry.generation.prepared, undefined);
    assert.equal(expose(state.sessions[entry.sessionKey]).progress.turns, expose(before).progress.turns);
    assert.equal(calls, stage.startsWith('commit') ? 1 : 0);
    if (stage.endsWith('scope')) {
      assert.equal(h.sent.length, 0);
      assert.equal(entry.status, 'blocked');
    }
    else {
      assert.equal(state.sessions[entry.sessionKey].channelState.paused, true);
      assert.equal(entry.generation.code, 'generation_session_changed');
      assert.equal(h.sent.length, 1);
    }
  }
});

test('a worker defers starting another generation after 25 seconds and leaves a durable job for the next drain', async () => {
  let calls = 0; let h;
  h = harness({ generator: { async generate() { calls++; h.clock.value += 26_000; return GENERATED; } } });
  await practiceSession(h);
  await h.bridge.accept(h.input('time-first', 'I enjoy cooking'), h.secret);
  await h.bridge.accept(h.input('time-second', 'I also like hiking'), h.secret);
  assert.equal((await h.bridge.drain()).pending, true);
  let state = (await h.store.read()).value;
  const second = Object.values(state.inbox).find(entry => entry.seq === 2);
  assert.equal(second.status, 'needs_generation');
  assert.equal(second.generation.status, 'pending');
  assert.equal(calls, 1);
  assert.equal((await new CloudBridge(h.options).drain()).pending, false);
  state = (await h.store.read()).value;
  assert.equal(calls, 2);
  assert.equal(expose(state.sessions[second.sessionKey]).progress.turns, 2);
});
