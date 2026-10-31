import { sanitizeTutorText, prepareTutorPrompt, extractTutorUsage } from './gateway-tutor.mjs';

const BASE_URL = 'https://api.openai.com/v1';
const EMPTY_USAGE = () => ({ inputTokens: null, outputTokens: null, totalTokens: null });
const failure = code => Object.assign(new Error(code), { code });

function statusOf(error) {
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    const value = current.statusCode ?? current.status;
    if (Number.isInteger(value) && value >= 400 && value <= 599) return value;
  }
  return null;
}

function isInsufficientQuota(error) {
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    const candidates = [current, current.data, current.response];
    if (typeof current.responseBody === 'string' && current.responseBody.length <= 16384) {
      try { candidates.push(JSON.parse(current.responseBody)); } catch {}
    }
    if (candidates.some(value => value?.error?.code === 'insufficient_quota'
      || value?.error?.type === 'insufficient_quota' || value?.code === 'insufficient_quota'
      || value?.type === 'insufficient_quota')) return true;
  }
  return false;
}

function codeOf(error) {
  if (error?.code === 'openai_timeout' || ['AbortError', 'TimeoutError'].includes(error?.name)) return 'openai_timeout';
  if (isInsufficientQuota(error)) return 'openai_insufficient_quota';
  const status = statusOf(error);
  if (status === 401) return 'openai_unauthorized';
  if (status === 403) return 'openai_forbidden';
  if (status === 404) return 'openai_model_unavailable';
  if (status === 429) return 'openai_rate_limited';
  if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'openai_provider_unavailable') return 'openai_provider_unavailable';
  if (error?.code === 'aigateway_invalid_input') return 'openai_invalid_input';
  if (['openai_invalid_input', 'openai_invalid_response', 'openai_official_endpoint_required'].includes(error?.code)) return error.code;
  return 'openai_unavailable';
}

async function deadline(operation, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const expires = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(failure('openai_timeout')); }, timeoutMs);
  });
  try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), expires]); }
  finally { clearTimeout(timer); }
}

function officialFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'https://api.openai.com' || url.pathname !== '/v1/chat/completions'
    || url.username || url.password || url.search || url.hash) throw failure('openai_official_endpoint_required');
  return fetch(input, { ...init, redirect: 'error' });
}

/** Direct OpenAI Chat Completions. No Gateway authentication or credit lookup is used. */
export function createOpenAITutor({ apiKey, model = 'gpt-4o', sdk, providerFactory, timeoutMs = 15000 } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 4096 || /\s/.test(apiKey)
    || typeof model !== 'string' || !/^[a-z\d_.:-]{1,100}$/i.test(model) || model.includes(apiKey)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || providerFactory !== undefined && typeof providerFactory !== 'function') throw failure('openai_invalid_configuration');
  let loading;
  const load = () => loading ??= Promise.all([
    sdk ? Promise.resolve(sdk) : import('ai'),
    providerFactory ? Promise.resolve(providerFactory) : import('@ai-sdk/openai').then(module => module.createOpenAI)
  ]).then(([lib, createProvider]) => {
    if (typeof lib?.generateText !== 'function' || typeof createProvider !== 'function') throw failure('openai_provider_unavailable');
    const provider = createProvider({ apiKey, baseURL: BASE_URL, fetch: officialFetch });
    if (typeof provider?.chat !== 'function') throw failure('openai_provider_unavailable');
    const languageModel = provider.chat(model);
    // A string would accidentally use AI SDK's default Gateway provider.
    if (!languageModel || typeof languageModel !== 'object') throw failure('openai_provider_unavailable');
    return { generateText: lib.generateText, languageModel };
  });
  const options = (languageModel, signal) => ({ model: languageModel, maxRetries: 0,
    timeout: { totalMs: timeoutMs }, abortSignal: signal,
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    include: { requestBody: false, requestMessages: false, responseBody: false } });
  const generate = async (input, maxOutputTokens) => deadline(async signal => {
    const { generateText, languageModel } = await load();
    return generateText({ ...options(languageModel, signal), ...input, maxOutputTokens });
  }, timeoutMs);

  return {
    async probe() {
      try {
        const result = await generate({ prompt: 'Reply exactly OK' }, 8);
        const healthy = typeof result?.text === 'string' && result.text.trim() === 'OK';
        return { healthy, model, usage: extractTutorUsage(result), code: healthy ? 'openai_probe_ok' : 'openai_unexpected_probe_response' };
      } catch (error) { return { healthy: false, model, usage: EMPTY_USAGE(), code: codeOf(error), status: statusOf(error) }; }
    },
    async generate(input = {}) {
      try {
        const prompt = prepareTutorPrompt({ message: input?.message, history: input?.history,
          selfLevel: input?.selfLevel, correction: input?.correction });
        // Defense in depth if a caller accidentally pastes the configured key into conversation text.
        const withoutKey = text => text.split(apiKey).join('[credential removed]');
        const result = await generate({ instructions: withoutKey(prompt.instructions),
          messages: prompt.messages.map(item => ({ role: item.role, content: withoutKey(item.content) })) }, 400);
        if (typeof result?.text !== 'string' || !result.text.trim()) throw failure('openai_invalid_response');
        const reply = sanitizeTutorText(withoutKey(result.text), 3000);
        if (!reply) throw failure('openai_invalid_response');
        const id = result.finalStep?.response?.id ?? result.response?.id;
        return { ok: true, reply, model, usage: extractTutorUsage(result),
          generationId: typeof id === 'string' && !id.includes(apiKey) && /^[A-Za-z\d:_-]{1,200}$/.test(id) ? id : null,
          code: 'openai_generated' };
      } catch (error) { return { ok: false, reply: null, model, usage: EMPTY_USAGE(), generationId: null, code: codeOf(error), status: statusOf(error) }; }
    }
  };
}
