import { getRuntime } from '../cloud/runtime.mjs';
import { secretEqual } from '../integrations/uazapi.mjs';
import { body, json } from '../cloud/http.mjs';
export default async function admin(req, res) {
  const credential = req.headers.authorization?.replace(/^Bearer /, '');
  if (!secretEqual(credential, process.env.ADMIN_API_SECRET)) return json(res, 401, { error: 'unauthorized' });
  try {
    const { bridge, store, publish, config, ai } = getRuntime();
    if (req.method === 'GET') {
      const { value } = await store.read();
      const events = Object.values(value.inbox);
      return json(res, 200, { configured: true, sendEnabled: config.sendEnabled, ai,
        workerActive: Boolean(value.worker && value.worker.leaseUntil > Date.now()),
        lastWorkerRunAt: value.lastWorkerRunAt ?? null,
        statuses: events.reduce((a, e) => { a[e.status] = (a[e.status] ?? 0) + 1; return a; }, {}),
        outbox: events.flatMap(e => e.outbox ?? []).map(o => ({ status: o.status, acceptedByProvider: Boolean(o.providerId) })) });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
    const input = await body(req, 4096);
    if (input.action === 'openai-probe') {
      const { createOpenAITutor } = await import('../cloud/openai-tutor.mjs');
      const tutor = createOpenAITutor({ apiKey: process.env.OPENAI_API_KEY, model: ai.model });
      return json(res, 200, { mode: 'fixed_prompt_probe', provider: 'openai', ...await tutor.probe() });
    }
    if (input.action === 'ai-check') {
      const { createGatewayTutor } = await import('../cloud/gateway-tutor.mjs');
      const tutor = createGatewayTutor({ model: process.env.AI_GATEWAY_MODEL });
      return json(res, 200, { mode: 'credits_check_only', ...await tutor.checkCredits() });
    }
    if (input.action === 'ai-probe') {
      const { createGatewayTutor } = await import('../cloud/gateway-tutor.mjs');
      const tutor = createGatewayTutor({ model: process.env.AI_GATEWAY_MODEL });
      return json(res, 200, { mode: 'fixed_prompt_probe', ...await tutor.probe() });
    }
    if (input.action === 'recover') { await publish({ wake: true }); return json(res, 202, { queued: true }); }
    if (input.action === 'send-test') {
      // Text is fixed in bridge; the API cannot send arbitrary campaigns.
      const result = await bridge.queueTest(input.chatId);
      return json(res, result.status ?? 202, result);
    }
    return json(res, 400, { error: 'unknown_action' });
  } catch { return json(res, 503, { error: 'operation_incomplete' }); }
}
