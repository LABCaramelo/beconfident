import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAITutor } from './openai-tutor.mjs';

const key = 'offline-test-key-NOT-A-REAL-API-KEY';
function injected(generateText) {
  const captured = { factory: [], models: [] };
  const languageModel = { specificationVersion: 'v4', provider: 'openai.chat', modelId: 'gpt-4o' };
  return { captured, languageModel, sdk: { generateText }, providerFactory: input => {
    captured.factory.push(input);
    return { chat: model => { captured.models.push(model); return languageModel; } };
  } };
}

test('probe uses the explicit OpenAI model object and only passes the API key to the provider constructor', async () => {
  let request;
  const mock = injected(async options => { request = options; return { text: 'OK\n', usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 } }; });
  const tutor = createOpenAITutor({ apiKey: key, ...mock });
  assert.equal(mock.captured.factory.length, 0, 'constructor is lazy');
  assert.equal(tutor.checkCredits, undefined);
  const result = await tutor.probe();
  assert.deepEqual(result, { healthy: true, model: 'gpt-4o', usage: { inputTokens: 5, outputTokens: 1, totalTokens: 6 }, code: 'openai_probe_ok' });
  assert.equal(request.model, mock.languageModel);
  assert.deepEqual(mock.captured.models, ['gpt-4o']);
  assert.equal(mock.captured.factory[0].apiKey, key);
  assert.equal(mock.captured.factory[0].baseURL, 'https://api.openai.com/v1');
  assert.equal(request.prompt, 'Reply exactly OK');
  assert.equal(request.maxOutputTokens, 8);
  assert.equal(request.maxRetries, 0);
  assert.deepEqual(request.timeout, { totalMs: 15000 });
  assert.deepEqual(request.telemetry, { isEnabled: false, recordInputs: false, recordOutputs: false });
  assert.equal(request.reasoning, undefined, 'GPT-4o does not receive reasoning-model settings');
  assert.equal(JSON.stringify(request).includes(key), false);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('configured transport refuses non-OpenAI destinations and redirects before making a network request', async () => {
  const mock = injected(async () => ({ text: 'OK' }));
  await createOpenAITutor({ apiKey: key, ...mock }).probe();
  const transport = mock.captured.factory[0].fetch;
  for (const target of ['https://evil.example/v1/chat/completions', 'https://api.openai.com/v1/models', 'https://api.openai.com/v1/chat/completions?key=private', 'https://user:pass@api.openai.com/v1/chat/completions']) {
    assert.throws(() => transport(target), { code: 'openai_official_endpoint_required' });
  }
  const previous = globalThis.fetch;
  let seen;
  globalThis.fetch = async (input, init) => { seen = { input, init }; return new Response('{}'); };
  try {
    await transport('https://api.openai.com/v1/chat/completions', { method: 'POST', redirect: 'follow' });
    assert.equal(seen.init.redirect, 'error');
  } finally { globalThis.fetch = previous; }
});

test('generation shares bounded projection and sanitation, omitting account/transport fields and key', async () => {
  let request;
  const mock = injected(async options => { request = options; return { text: 'Try: I went home. What did you do next?', usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 }, response: { id: 'chatcmpl_offline123', body: key } }; });
  const tutor = createOpenAITutor({ apiKey: key, ...mock });
  const result = await tutor.generate({ message: `Yesterday I go. ${key} +55 31 9214-2870 mail@example.com https://private.example`,
    history: [{ role: 'system', content: 'NEVER_FORWARD' }, ...Array.from({ length: 12 }, () => ({ role: 'user', content: 'old practice '.repeat(150) }))],
    selfLevel: 'beginner', correction: true, name: 'NEVER_FORWARD', phone: 'NEVER_FORWARD', env: { OPENAI_API_KEY: key }, token: key });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'gpt-4o');
  assert.equal(result.generationId, 'chatcmpl_offline123');
  assert.equal(request.maxOutputTokens, 400);
  const sent = JSON.stringify(request);
  for (const forbidden of [key, 'NEVER_FORWARD', 'mail@example.com', 'private.example', '9214-2870']) assert.equal(sent.includes(forbidden), false);
  assert.ok(request.messages.length <= 7);
  assert.ok(request.messages.slice(0, -1).reduce((n, message) => n + message.content.length, 0) <= 4000);
  assert.match(request.instructions, /not a verified proficiency/);
  assert.match(request.instructions, /Focus on a useful correction/);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test('bad input has no provider call and returned text is bounded and key-filtered', async () => {
  let calls = 0;
  const mock = injected(async () => { calls++; return { text: `${key} ` + 'Useful reply. '.repeat(500), response: { id: key } }; });
  const tutor = createOpenAITutor({ apiKey: key, ...mock });
  assert.equal((await tutor.generate({ message: '' })).code, 'openai_invalid_input');
  assert.equal(mock.captured.factory.length, 0);
  const result = await tutor.generate({ message: 'Hello.' });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  assert.ok(result.reply.length <= 3000);
  assert.equal(result.reply.includes(key), false);
  assert.equal(result.generationId, null);
});

test('quota, auth and capacity errors expose safe fixed codes and HTTP status only', async () => {
  const cases = [
    [{ statusCode: 429, data: { error: { type: 'insufficient_quota' } } }, 'openai_insufficient_quota'],
    [{ statusCode: 429, cause: { responseBody: JSON.stringify({ error: { code: 'insufficient_quota', message: key } }) } }, 'openai_insufficient_quota'],
    [{ statusCode: 429 }, 'openai_rate_limited'], [{ statusCode: 401 }, 'openai_unauthorized'],
    [{ statusCode: 403 }, 'openai_forbidden'], [{ statusCode: 404 }, 'openai_model_unavailable'], [{ statusCode: 503 }, 'openai_unavailable']
  ];
  for (const [details, code] of cases) {
    let calls = 0;
    const mock = injected(async () => { calls++; throw Object.assign(new Error(`PRIVATE ${key} https://private.example`), details); });
    const result = await createOpenAITutor({ apiKey: key, ...mock }).generate({ message: 'Hello.' });
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.equal(result.status, details.statusCode);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
    assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test('timeouts abort signals without retries; provider cannot fall back to a Gateway model string', async () => {
  let signal; let calls = 0;
  const mock = injected(options => { signal = options.abortSignal; calls++; return new Promise(() => {}); });
  const result = await createOpenAITutor({ apiKey: key, timeoutMs: 10, ...mock }).probe();
  assert.equal(result.code, 'openai_timeout');
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  const invalid = createOpenAITutor({ apiKey: key, sdk: { generateText() { throw new Error('must not run'); } }, providerFactory: () => ({ chat: () => 'openai/gpt-4o' }) });
  assert.equal((await invalid.probe()).code, 'openai_provider_unavailable');
});

test('unexpected probe or malformed generation responses are not exposed as successful replies', async () => {
  const mock = injected(async () => ({ text: `PRIVATE ${key}` }));
  const result = await createOpenAITutor({ apiKey: key, ...mock }).probe();
  assert.equal(result.healthy, false);
  assert.equal(result.code, 'openai_unexpected_probe_response');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  const empty = injected(async () => ({ text: '' }));
  assert.equal((await createOpenAITutor({ apiKey: key, ...empty }).generate({ message: 'Hello.' })).code, 'openai_invalid_response');
});

test('installed AI SDK and OpenAI provider produce the official Chat Completions HTTP contract offline', async () => {
  const originalFetch = globalThis.fetch;
  const priorBaseURL = process.env.OPENAI_BASE_URL;
  const requests = [];
  process.env.OPENAI_BASE_URL = 'https://must-not-be-used.example/v1';
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(init.body), redirect: init.redirect, headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ id: 'chatcmpl_offline', object: 'chat.completion', created: 1793318400,
      model: 'gpt-4o', choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 } }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await createOpenAITutor({ apiKey: key }).probe();
    assert.equal(result.healthy, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(requests[0].redirect, 'error');
    assert.equal(requests[0].headers.get('authorization'), `Bearer ${key}`);
    assert.equal(requests[0].body.model, 'gpt-4o');
    assert.equal(requests[0].body.max_tokens, 8);
    assert.deepEqual(requests[0].body.messages, [{ role: 'user', content: 'Reply exactly OK' }]);
    assert.equal(JSON.stringify(requests[0].body).includes(key), false);
    assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 1, totalTokens: 8 });
  } finally {
    globalThis.fetch = originalFetch;
    if (priorBaseURL === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = priorBaseURL;
  }
});

test('installed provider quota error is safely mapped without an automatic second HTTP attempt', async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: `PRIVATE ${key}`, type: 'insufficient_quota', code: 'insufficient_quota', param: null } }),
      { status: 429, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await createOpenAITutor({ apiKey: key }).probe();
    assert.equal(result.healthy, false);
    assert.equal(result.code, 'openai_insufficient_quota');
    assert.equal(result.status, 429);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(result).includes(key), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  } finally { globalThis.fetch = originalFetch; }
});
