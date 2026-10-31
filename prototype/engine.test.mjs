import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, expose, mutate, QUESTIONS } from './engine.mjs';
const profile = state => mutate(state, 'profile', { name: 'Alex Demo', selfLevel: 'intermediate', dailyGoal: 10 }, 'profile-0001');
test('avaliação usa respostas reais, omite gabarito antes e não inventa score oral', () => {
  const s = createState(); profile(s);
  assert.equal('answer' in expose(s).assessment.question, false);
  for (const q of QUESTIONS) mutate(s, 'answer', { questionId: q.id, option: q.answer }, `answer-${q.id}`);
  const view = expose(s);
  assert.equal(view.assessment.score, 3); assert.equal(view.assessment.complete, true);
  assert.equal(view.capabilities.audioAssessment, false);
  assert.equal('cefr' in view.assessment, false);
});
test('repetição idempotente não cria turnos nem eventos duplicados; conflito é rejeitado', () => {
  const s = createState(); profile(s);
  const payload = { text: 'Yesterday I go to the park.' };
  mutate(s, 'message', payload, 'message-0001');
  const count = s.messages.length;
  mutate(s, 'message', payload, 'message-0001');
  assert.equal(s.messages.length, count); assert.equal(expose(s).progress.turns, 1);
  assert.throws(() => mutate(s, 'message', { text: 'outro' }, 'message-0001'), /dados diferentes/);
});
test('comando de menu durante avaliação preserva respostas e não pontua prática', () => {
  const s = createState(); profile(s);
  mutate(s, 'answer', { questionId: QUESTIONS[0].id, option: 0 }, 'answer-first');
  mutate(s, 'message', { text: '#menu' }, 'message-menu');
  assert.equal(s.assessment.answers.length, 1); assert.equal(expose(s).progress.turns, 0);
  assert.equal(s.messages.at(-1).kind, 'menu');
});
test('erro cria revisão rastreável; tentativa incorreta não conclui; retry não duplica progresso', () => {
  const s = createState(); profile(s);
  mutate(s, 'message', { text: 'I has a dog.' }, 'message-0002');
  const r = s.reviews[0]; assert.equal(r.corrected, 'I have a dog.');
  mutate(s, 'review', { id: r.id, answer: 'wrong' }, 'review-wrong'); assert.equal(r.completed, false);
  mutate(s, 'review', { id: r.id, answer: 'I have a dog.' }, 'review-right');
  mutate(s, 'review', { id: r.id, answer: 'I have a dog.' }, 'review-right');
  assert.equal(r.attempts, 2); assert.equal(expose(s).progress.reviewsCompleted, 1);
});
test('opções fora de sequência e perfis inválidos são rejeitados sem avanço', () => {
  const s = createState(); profile(s);
  assert.throws(() => mutate(s, 'answer', { questionId: 'duration', option: 2 }, 'bad-question'), /pergunta mudou/);
  assert.equal(s.assessment.answers.length, 0);
  assert.throws(() => mutate(s, 'profile', { name: '', selfLevel: 'other', dailyGoal: 5 }, 'bad-profile'), /caracteres/);
});
