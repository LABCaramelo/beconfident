// This public projection never returns the credential itself.
export function tutorConfiguration(env = process.env) {
  const candidate = typeof env.OPENAI_MODEL === 'string' && env.OPENAI_MODEL.trim()
    ? env.OPENAI_MODEL.trim() : 'gpt-4o';
  const validModel = /^[A-Za-z\d_.:-]{1,100}$/.test(candidate)
    && !(typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY && candidate.includes(env.OPENAI_API_KEY));
  const model = validModel ? candidate : null;
  const configured = typeof env.OPENAI_API_KEY === 'string' && /^\S{1,4096}$/.test(env.OPENAI_API_KEY) && validModel;
  const requested = env.AI_TUTOR_ENABLED === 'true';
  return { provider: 'openai', model, configured, requested, enabled: requested && configured };
}
