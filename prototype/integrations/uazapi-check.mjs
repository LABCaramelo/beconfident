import { UazapiClient } from './uazapi.mjs';

const { UAZAPI_BASE_URL: baseUrl, UAZAPI_INSTANCE_TOKEN: token } = process.env;
if (!baseUrl || !token) {
  console.error('Preencha UAZAPI_BASE_URL e UAZAPI_INSTANCE_TOKEN no arquivo .env.local.'); process.exitCode = 1;
} else {
  try {
    const client = new UazapiClient({ baseUrl, token });
    const result = await client.getStatus();
    const number = String(result.status?.jid?.user ?? result.instance?.owner ?? '').replace(/\D/g, '');
    console.log(JSON.stringify({ connected: result.status?.connected === true, loggedIn: result.status?.loggedIn === true, instanceName: result.instance?.name ?? null, instanceStatus: result.instance?.status ?? null, numberEnding: number.slice(-4) }, null, 2));
    const hooks = await client.getWebhooks();
    if (!Array.isArray(hooks)) throw new Error('unexpected_webhook_shape');
    console.log(JSON.stringify({ webhooks: hooks.map(h => { let destinationOrigin = 'invalid_url'; try { destinationOrigin = new URL(h.url).origin; } catch {} return { id: h.id, enabled: h.enabled, destinationOrigin, events: h.events, excludeMessages: h.excludeMessages }; }) }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.code ?? 'check_failed', status: error.status ?? null })); process.exitCode = 1;
  }
}
