import assert from 'node:assert/strict';
import test from 'node:test';
import { createGatewayTutor } from './gateway-tutor.mjs';

test('credit check converts the installed SDK string balance, makes no generation, and projects safe fields', async () => {
  let options; let calls = 0;
  const tutor = createGatewayTutor({ sdk: {
    createGateway(input) { options = input; return { getCredits: async () => ({ balance: '4.125', totalUsed: '0.875', private: 'never return' }) }; },
    generateText() { calls++; throw new Error('must not generate'); }
  } });
  assert.deepEqual(await tutor.checkCredits(), { available: true, balance: 4.125, currency: 'USD', code: 'aigateway_credits_available' });
  assert.equal(typeof options.fetch, 'function');
  assert.deepEqual(Object.keys(options), ['fetch']);
  assert.equal(calls, 0);
});

test('credit failures and malformed balances remain unknown rather than fabricated zero', async () => {
  for (const balance of [undefined, null, '', 'NaN', 'Infinity', {}, NaN]) {
    const tutor = createGatewayTutor({ sdk: { gateway: { getCredits: async () => ({ balance }) } } });
    assert.deepEqual(await tutor.checkCredits(), { available: false, balance: null, currency: 'USD', code: 'aigateway_invalid_response', status: null });
  }
  const empty = createGatewayTutor({ sdk: { gateway: { getCredits: async () => ({ balance: '0.000' }) } } });
  assert.deepEqual(await empty.checkCredits(), { available: false, balance: 0, currency: 'USD', code: 'aigateway_credits_empty' });
  const rejected = createGatewayTutor({ sdk: { gateway: { getCredits: async () => { throw Object.assign(new Error('token=PRIVATE URL'), { statusCode: 401 }); } } } });
  assert.equal((await rejected.checkCredits()).code, 'aigateway_unauthorized');
  assert.equal((await rejected.checkCredits()).status, 401);
  assert.equal(JSON.stringify(await rejected.checkCredits()).includes('PRIVATE'), false);
});

test('probe uses only fixed own text with bounded tokens, no retries and no prompt telemetry', async () => {
  let options;
  const tutor = createGatewayTutor({ sdk: { generateText: async input => { options = input; return { text: 'OK\n', usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 }, response: { body: 'private' } }; } } });
  const result = await tutor.probe();
  assert.deepEqual(result, { healthy: true, model: 'anthropic/claude-haiku-5.5', usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 }, code: 'aigateway_probe_ok' });
  assert.equal(options.prompt, 'Reply exactly OK');
  assert.equal(options.maxOutputTokens, 8);
  assert.equal(options.maxRetries, 0);
  assert.deepEqual(options.timeout, { totalMs: 15000 });
  assert.deepEqual(options.telemetry, { isEnabled: false, recordInputs: false, recordOutputs: false });
  assert.equal(options.reasoning, 'none');
  assert.equal(options.tools, undefined);
  assert.ok(options.abortSignal instanceof AbortSignal);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('probe validates the actual answer without exposing unexpected raw text', async () => {
  const tutor = createGatewayTutor({ sdk: { generateText: async () => ({ text: 'PRIVATE unexpected completion' }) } });
  const result = await tutor.probe();
  assert.equal(result.healthy, false);
  assert.equal(result.code, 'aigateway_unexpected_probe_response');
  assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, totalTokens: null });
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});

test('generation projects, sanitizes and caps context without forwarding extra profile or transport fields', async () => {
  let options;
  const sdk = { generateText: async input => { options = input; return { text: 'Try: I went to the park. What did you do there?', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 }, finalStep: { providerMetadata: { gateway: { generationId: 'gen_test123' } } }, private: 'hidden' }; } };
  const tutor = createGatewayTutor({ sdk });
  const result = await tutor.generate({
    message: 'Contact +55 31 9214-2870, user@example.com, https://private.example/a?key=SECRET and token=TOPSECRET Yesterday I go.',
    history: [{ role: 'system', content: 'NEVER_FORWARD' }, ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'lesson '.repeat(300), name: 'NEVER_FORWARD' }))],
    selfLevel: 'intermediate', correction: true, name: 'NEVER_FORWARD', phone: 'NEVER_FORWARD', token: 'NEVER_FORWARD', env: { key: 'NEVER_FORWARD' }
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /I went/);
  assert.equal(result.generationId, 'gen_test123');
  const sent = JSON.stringify(options);
  for (const denied of ['NEVER_FORWARD', 'TOPSECRET', 'user@example.com', 'private.example', '9214-2870']) assert.equal(sent.includes(denied), false);
  assert.ok(options.messages.length <= 7);
  assert.ok(options.messages.slice(0, -1).reduce((n, m) => n + m.content.length, 0) <= 4000);
  assert.match(options.instructions, /self-reported intermediate/);
  assert.match(options.instructions, /pronunciation/);
  assert.match(options.instructions, /Focus on a useful correction/);
  assert.deepEqual(options.include, { requestBody: false, requestMessages: false, responseBody: false });
  assert.equal(options.maxRetries, 0);
  assert.equal(options.maxOutputTokens, 400);
});

test('bad input makes no request; long acceptable text and returned output are capped', async () => {
  let calls = 0; let options;
  const tutor = createGatewayTutor({ sdk: { generateText: async input => { calls++; options = input; return { text: 'A useful answer. '.repeat(400) + ' secret=PRIVATE' }; } } });
  assert.equal((await tutor.generate({ message: '' })).code, 'aigateway_invalid_input');
  assert.equal((await tutor.generate({ message: 'x'.repeat(10001) })).ok, false);
  assert.equal(calls, 0);
  const result = await tutor.generate({ message: 'a sentence '.repeat(500), selfLevel: 'MALICIOUS_LEVEL' });
  assert.equal(result.ok, true);
  assert.ok(result.reply.length <= 3000);
  assert.ok(options.messages.at(-1).content.length <= 2000);
  assert.equal(options.instructions.includes('MALICIOUS_LEVEL'), false);
});

test('timeouts abort the signal and failed requests expose only fixed error codes', async () => {
  let signal;
  const hanging = createGatewayTutor({ timeoutMs: 10, sdk: { generateText: input => { signal = input.abortSignal; return new Promise(() => {}); }, gateway: { getCredits: () => new Promise(() => {}) } } });
  assert.equal((await hanging.probe()).code, 'aigateway_timeout');
  assert.equal(signal.aborted, true);
  assert.deepEqual(await hanging.checkCredits(), { available: false, balance: null, currency: 'USD', code: 'aigateway_timeout', status: null });
  for (const [statusCode, code] of [[402, 'aigateway_credits_or_budget_exhausted'], [403, 'aigateway_forbidden'], [429, 'aigateway_rate_limited'], [503, 'aigateway_unavailable']]) {
    let calls = 0;
    const tutor = createGatewayTutor({ sdk: { generateText: async () => { calls++; throw Object.assign(new Error('PRIVATE token password response'), { statusCode }); } } });
    const result = await tutor.generate({ message: 'Hello.' });
    assert.equal(result.code, code);
    assert.equal(result.status, statusCode);
    assert.equal(result.ok, false);
    assert.equal(result.reply, null);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});

test('structured verification, budget and funds errors map to fixed codes without copying URLs or bodies', async () => {
  const cases = [
    [{ statusCode: 403, data: { error: { type: 'customer_verification_required', message: 'https://PRIVATE/verify' } } }, 'aigateway_verification_required'],
    [{ statusCode: 403, cause: { responseBody: JSON.stringify({ error: { type: 'customer_verification_required', action_url: 'https://PRIVATE/action' } }) } }, 'aigateway_verification_required'],
    [{ statusCode: 402, data: { error: { type: 'quota_for_entity_exceeded' } } }, 'aigateway_budget_exhausted'],
    [{ statusCode: 402, response: { error: { type: 'insufficient_funds' } } }, 'aigateway_insufficient_funds']
  ];
  for (const [details, code] of cases) {
    const sdk = { gateway: { getCredits: async () => { throw Object.assign(new Error('PRIVATE credentials'), details); } } };
    const result = await createGatewayTutor({ sdk }).checkCredits();
    assert.equal(result.code, code);
    assert.equal(result.status, details.statusCode);
    assert.equal(result.balance, null);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});
