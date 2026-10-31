import { getRuntime } from '../cloud/runtime.mjs';
import { body, json } from '../cloud/http.mjs';
import { secretEqual } from '../integrations/uazapi.mjs';
export default async function webhook(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const { bridge, config } = getRuntime();
    const url = new URL(req.url, 'https://localhost');
    const secret = req.headers['x-webhook-secret'] ?? url.searchParams.get('key');
    if (!secretEqual(secret, config.secret)) return json(res, 401, { error: 'unauthorized' });
    const result = await bridge.accept(await body(req), secret);
    return json(res, result.status ?? 200, result);
  } catch (error) {
    return json(res, error.status === 413 ? 413 : error.status === 415 ? 415 : error.status === 400 || error instanceof SyntaxError ? 400 : 503,
      { error: 'webhook_not_accepted' });
  }
}
