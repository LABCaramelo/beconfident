import test from 'node:test';
import assert from 'node:assert/strict';
import { tutorConfiguration } from './tutor-config.mjs';

test('AI activation requires both the explicit flag and a private credential', () => {
  assert.equal(tutorConfiguration({}).enabled, false);
  assert.equal(tutorConfiguration({ AI_TUTOR_ENABLED: 'true' }).enabled, false);
  assert.equal(tutorConfiguration({ OPENAI_API_KEY: 'test-secret' }).enabled, false);
  const config = tutorConfiguration({ AI_TUTOR_ENABLED: 'true', OPENAI_API_KEY: 'test-secret' });
  assert.equal(config.enabled, true);
  assert.equal(config.model, 'gpt-4o');
  assert.equal(JSON.stringify(config).includes('test-secret'), false);
});

test('AI configuration rejects malformed models and ambiguous enable values', () => {
  assert.equal(tutorConfiguration({ AI_TUTOR_ENABLED: 'TRUE', OPENAI_API_KEY: 'test-secret' }).enabled, false);
  assert.equal(tutorConfiguration({ AI_TUTOR_ENABLED: 'true', OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'https://other.invalid' }).enabled, false);
  assert.equal(tutorConfiguration({ AI_TUTOR_ENABLED: 'true', OPENAI_API_KEY: '   ' }).enabled, false);
  assert.equal(tutorConfiguration({ AI_TUTOR_ENABLED: 'true', OPENAI_API_KEY: 'bad key' }).enabled, false);
  const mistakenModel = tutorConfiguration({ OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'test-secret' });
  assert.equal(mistakenModel.configured, false);
  assert.equal(mistakenModel.model, null);
  assert.equal(JSON.stringify(mistakenModel).includes('test-secret'), false);
});
