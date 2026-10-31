import { UazapiClient } from './uazapi.mjs';

// A operação padrão só apresenta o plano. --apply-add é uma ação explícita do operador.
async function main() {
  const env = process.env;
  if (!env.UAZAPI_BASE_URL || !env.UAZAPI_INSTANCE_TOKEN || !env.UAZAPI_PUBLIC_WEBHOOK_URL || (env.UAZAPI_WEBHOOK_SECRET?.length ?? 0) < 32) throw new Error('missing_configuration');
  const destination = new URL(env.UAZAPI_PUBLIC_WEBHOOK_URL);
  if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash || ['localhost', '127.0.0.1', '::1'].includes(destination.hostname)) throw new Error('public_https_url_required');
  destination.searchParams.set('key', env.UAZAPI_WEBHOOK_SECRET);
  const client = new UazapiClient({ baseUrl: env.UAZAPI_BASE_URL, token: env.UAZAPI_INSTANCE_TOKEN });
  const current = await client.getWebhooks();
  if (!Array.isArray(current)) throw new Error('unexpected_webhook_shape');
  const samePath = current.filter(h => { try { const u = new URL(h.url); return u.origin === destination.origin && u.pathname === destination.pathname; } catch { return false; } });
  const proposed = { action: 'add', enabled: true, url: destination.href, events: ['messages'], excludeMessages: ['wasSentByApi', 'fromMeYes', 'isGroupYes'], addUrlEvents: false, addUrlTypesMessages: false };
  console.log(JSON.stringify({ operation: 'add', destination: destination.origin + destination.pathname, existingWebhooks: current.length, matchingDestinations: samePath.length, events: proposed.events, excludeMessages: proposed.excludeMessages, willReplaceExisting: false }, null, 2));
  if (samePath.length) { console.log('Já existe destino com esse caminho. Nenhuma alteração aplicada; compare a configuração antes de atualizar.'); return; }
  if (!process.argv.includes('--apply-add')) { console.log('Plano de leitura. Nenhum webhook foi alterado.'); return; }
  const result = await client.addWebhook(proposed);
  console.log(JSON.stringify({ applied: true, returnedWebhookCount: Array.isArray(result) ? result.length : null }));
}
main().catch(error => { console.error(JSON.stringify({ error: error.code ?? (/^[a-z_]+$/.test(error.message) ? error.message : 'configuration_failed'), status: error.status ?? null })); process.exitCode = 1; });
