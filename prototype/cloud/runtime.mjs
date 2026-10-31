import { QueueClient } from '@vercel/queue';
import { BlobCasStore } from './blob-store.mjs';
import { CloudBridge, initialCloudState } from './bridge.mjs';
import { integrationConfig, UazapiClient } from '../integrations/uazapi.mjs';
import { makeWebHandler } from './web.mjs';
import { advanceWhatsapp } from '../integrations/whatsapp-flow.mjs';
import { createOpenAITutor } from './openai-tutor.mjs';
import { tutorConfiguration } from './tutor-config.mjs';

export const TOPIC = 'confident-whatsapp-inbound';
export const queue = new QueueClient({ region: 'gru1' });
let runtime;
export function getRuntime() {
  if (runtime) return runtime;
  const config = integrationConfig();
  const ai = tutorConfiguration();
  if (ai.requested && !ai.configured) throw new Error('openai_configuration_missing');
  if (!config.configured || (process.env.SESSION_HASH_SECRET?.length ?? 0) < 32 || (process.env.ADMIN_API_SECRET?.length ?? 0) < 32) throw new Error('cloud_configuration_missing');
  const store = new BlobCasStore({ initial: initialCloudState });
  const publish = payload => queue.send(TOPIC, payload, { retentionSeconds: 86400 });
  const bridge = new CloudBridge({ store, config, sessionSecret: process.env.SESSION_HASH_SECRET,
    client: new UazapiClient(config), publish,
    generator: ai.enabled ? createOpenAITutor({ apiKey: process.env.OPENAI_API_KEY, model: ai.model }) : null,
    advance: (state, input) => advanceWhatsapp(state, input, { generativeEnabled: ai.enabled }) });
  runtime = { config, ai, store, bridge, publish, web: makeWebHandler({ store, sessionSecret: process.env.SESSION_HASH_SECRET }) };
  return runtime;
}
