import { createOpenAITutor } from '../cloud/openai-tutor.mjs';
import { tutorConfiguration } from '../cloud/tutor-config.mjs';

const config = tutorConfiguration();
if (!config.configured) {
  console.log(JSON.stringify({ healthy: false, provider: 'openai', code: 'openai_configuration_missing' }));
  process.exitCode = 1;
} else {
  try {
    // Fixed, eight-token probe. No WhatsApp conversation or learner data is sent.
    const result = await createOpenAITutor({ apiKey: process.env.OPENAI_API_KEY, model: config.model }).probe();
    console.log(JSON.stringify({ provider: 'openai', ...result }));
    if (!result.healthy) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ healthy: false, provider: 'openai', code: 'openai_configuration_invalid' }));
    process.exitCode = 1;
  }
}
