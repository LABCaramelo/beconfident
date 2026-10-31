import test from 'node:test';
import assert from 'node:assert/strict';
import { addMessage, createState, QUESTIONS } from '../engine.mjs';
import { advanceWhatsapp } from './whatsapp-flow.mjs';
import { prepareGenerativeTurn, finishGenerativeTurn } from './generative-flow.mjs';

function practiceState() {
  let state = createState();
  let number = 0;
  for (const text of ['oi', 'Alex', '2', ...QUESTIONS.map(question => String(question.answer + 1))]) {
    state = advanceWhatsapp(state, { id: `setup-${++number}`, chatId: 'test-chat', type: 'text', text }).state;
  }
  return state;
}

function inbound(text = 'I enjoy visiting museums.', extra = {}) {
  return { id: 'generative-turn', chatId: 'test-chat', type: 'text', text, ...extra };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}

const practiceCount = state => state.events.filter(event => event.type === 'practice').length;

test('preparação preserva correção conhecida e histórico; conclusão registra somente uma resposta de IA', () => {
  const state = practiceState();
  advanceWhatsapp(state, inbound('I enjoy reading.', { id: 'previous-turn' }));
  const previousConversation = state.messages.findLast(message => message.kind === 'conversation');
  const original = structuredClone(state);
  freeze(state);
  const turn = freeze(inbound('Yesterday I go to the park.'));

  const prepared = prepareGenerativeTurn(state, turn);
  assert.ok(prepared);
  assert.equal(typeof prepared.then, 'undefined');
  assert.deepEqual(state, original);
  assert.notEqual(prepared.draft, state);
  assert.deepEqual(prepared.draft.messages.find(message => message.id === previousConversation.id), previousConversation);
  assert.equal(prepared.draft.messages.filter(message => message.kind === 'conversation').length,
    original.messages.filter(message => message.kind === 'conversation').length);
  assert.equal(prepared.draft.messages.filter(message => message.role === 'user').length,
    original.messages.filter(message => message.role === 'user').length + 1);
  assert.equal(practiceCount(prepared.draft), practiceCount(original) + 1);
  assert.equal(prepared.draft.reviews.length, original.reviews.length + 1);
  const feedback = prepared.draft.messages.at(-1);
  assert.equal(feedback.kind, 'feedback');
  assert.equal(feedback.original, turn.text);
  assert.equal(feedback.corrected, 'Yesterday I went to the park.');
  assert.match(prepared.prefixReplies.join(''), /Você escreveu: Yesterday I go to the park\./);
  assert.match(prepared.prefixReplies.join(''), /Sugestão: Yesterday I went to the park\./);

  const draftBeforeFinish = structuredClone(prepared.draft);
  freeze(prepared);
  const completed = finishGenerativeTurn(prepared, {
    reply: 'What did you enjoy most about the park?',
    translation: 'Do que você mais gostou no parque?'
  });
  assert.deepEqual(state, original);
  assert.deepEqual(prepared.draft, draftBeforeFinish);
  assert.deepEqual(completed.state.events, prepared.draft.events);
  assert.deepEqual(completed.state.reviews, prepared.draft.reviews);
  assert.deepEqual(completed.state.receipts, prepared.draft.receipts);
  assert.equal(practiceCount(completed.state), practiceCount(original) + 1);
  assert.equal(completed.state.messages.length, prepared.draft.messages.length + 1);
  const answer = completed.state.messages.at(-1);
  assert.equal(answer.role, 'assistant');
  assert.equal(answer.kind, 'conversation');
  assert.equal(answer.aiGenerated, true);
  assert.equal(answer.demonstrative, undefined);
  assert.equal(answer.translation, 'Do que você mais gostou no parque?');
  assert.deepEqual(completed.replies, [...prepared.prefixReplies, answer.text]);
  assert.doesNotMatch(completed.replies.join(''), /Tell me about something you did yesterday\./);
});

test('texto sem regra conhecida não cria revisão pelo conteúdo produzido pela IA', () => {
  const prepared = prepareGenerativeTurn(practiceState(), inbound());
  assert.deepEqual(prepared.prefixReplies, []);
  assert.equal(prepared.draft.reviews.length, 0);
  const completed = finishGenerativeTurn(prepared, { reply: 'He go to a museum. What do you think?' });
  assert.equal(completed.state.reviews.length, 0);
  assert.equal(practiceCount(completed.state), 1);
  const correction = advanceWhatsapp(completed.state, inbound('Corrige', { id: 'correction-command' }));
  assert.match(correction.replies.join(''), /Não encontrei um dos padrões cobertos/);
  assert.equal(correction.state.reviews.length, 0);
  assert.equal(practiceCount(correction.state), 1);
});

test('somente texto válido na prática ativa é elegível; comandos não passam pela geração', () => {
  const state = freeze(practiceState());
  const cases = [
    ['estado ausente', null, inbound()],
    ['onboarding', createState(), inbound()],
    ['avaliação', { ...state, channelState: { phase: 'assessment', paused: false } }, inbound()],
    ['pausado', { ...state, channelState: { phase: 'practice', paused: true } }, inbound()],
    ['mensagem ausente', state, undefined],
    ['áudio com texto', state, inbound('I like music.', { type: 'audio' })],
    ['outro tipo', state, inbound('', { type: 'unsupported' })],
    ['texto ausente', state, { ...inbound(), text: undefined }],
    ['texto vazio', state, inbound('  ')],
    ['texto inválido', state, inbound(42)],
    ['texto longo', state, inbound('x'.repeat(2001))],
    ['ID ausente', state, inbound('hello', { id: '' })],
    ['chat ausente', state, inbound('hello', { chatId: '' })],
    ...[' #MeNu ', 'PARAR', 'pausar', 'RETOMAR', 'Traduz', 'CORRIGE', 'Minha evolução']
      .map(command => [command, state, inbound(command)])
  ];
  const before = structuredClone(state);
  for (const [name, candidate, message] of cases) {
    assert.equal(prepareGenerativeTurn(candidate, message), null, name);
  }
  assert.deepEqual(state, before);
  assert.ok(prepareGenerativeTurn(state, inbound('x'.repeat(2000))));
});

test('recibo da preparação impede reentrega inclusive com texto trocado', () => {
  const prepared = prepareGenerativeTurn(practiceState(), inbound());
  const committed = finishGenerativeTurn(prepared, { reply: 'Which museum would you visit next?' }).state;
  const before = structuredClone(committed);
  assert.equal(prepareGenerativeTurn(committed, inbound()), null);
  assert.equal(prepareGenerativeTurn(committed, inbound('A different message with the same ID.')), null);
  assert.deepEqual(committed, before);
  assert.equal(practiceCount(committed), 1);
});

test('entrada do modelo projeta só seis textos anteriores, nível autorrelatado e mensagem atual', () => {
  const state = practiceState();
  state.messages = [];
  for (let index = 1; index <= 8; index++) {
    addMessage(state, index % 2 ? 'user' : 'assistant', `Conversation ${index}`, {
      kind: 'conversation', chatId: 'private-chat', phone: 'private-phone', token: 'private-token'
    });
  }
  addMessage(state, 'assistant', 'Welcome, Alex!', { kind: 'welcome' });
  addMessage(state, 'user', 'Minha evolução');
  addMessage(state, 'system', 'private system instruction');
  addMessage(state, 'assistant', ' ');
  const prepared = prepareGenerativeTurn(state, inbound('  Tell me about travel.  ', { name: 'Private contact name' }));
  assert.deepEqual(prepared.input, {
    message: 'Tell me about travel.',
    history: Array.from({ length: 6 }, (_, index) => ({
      role: (index + 3) % 2 ? 'user' : 'assistant', text: `Conversation ${index + 3}`
    })),
    selfLevel: 'intermediate'
  });
  assert.doesNotMatch(JSON.stringify(prepared.input), /Alex|private|Private|test-chat|generative-turn/);
  prepared.input.history[0].text = 'changed projection';
  assert.equal(state.messages[2].text, 'Conversation 3');
});

test('fragmentação preserva todo o texto e pares Unicode dentro do limite do WhatsApp', () => {
  const prepared = prepareGenerativeTurn(practiceState(), inbound(`Yesterday I go ${'a'.repeat(1970)}`));
  const reply = `${'b'.repeat(3499)}😀${'c'.repeat(4000)}`;
  const completed = finishGenerativeTurn(prepared, { reply });
  assert.ok(completed.replies.length >= 4);
  assert.ok(completed.replies.every(part => part.length <= 3500));
  assert.equal(completed.replies.join(''), prepared.prefixReplies.join('') + reply);
  for (const part of completed.replies) {
    assert.doesNotMatch(part, /^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
  }
  assert.equal(completed.state.messages.at(-1).text, reply);
});

test('resultado inválido é rejeitado sem alterar o rascunho', () => {
  const prepared = freeze(prepareGenerativeTurn(practiceState(), inbound()));
  const before = structuredClone(prepared);
  for (const result of [undefined, {}, { reply: '' }, { reply: 1 }, { reply: 'hello', translation: null }]) {
    assert.throws(() => finishGenerativeTurn(prepared, result), { code: 'generative_flow_invalid_result' });
  }
  assert.deepEqual(prepared, before);
});

test('Traduz usa tradução da IA atual e nunca reutiliza uma tradução antiga quando ela falta', () => {
  const state = practiceState();
  advanceWhatsapp(state, inbound('I like coffee.', { id: 'demo-with-translation' }));
  const oldTranslation = state.messages.at(-1).translation;
  const prepared = prepareGenerativeTurn(state, inbound());
  const noTranslation = finishGenerativeTurn(prepared, { reply: 'Which museum inspires you?' }).state;
  const before = structuredClone(noTranslation);
  const unavailable = advanceWhatsapp(noTranslation, inbound('Traduz', { id: 'translation-missing' }));
  assert.match(unavailable.replies.join(''), /tradução da última resposta de IA ainda não está disponível/);
  assert.ok(!unavailable.replies.join('').includes(oldTranslation));
  assert.deepEqual(unavailable.state.messages, before.messages);
  assert.deepEqual(unavailable.state.events, before.events);
  assert.deepEqual(unavailable.state.reviews, before.reviews);

  const withTranslation = finishGenerativeTurn(prepared, {
    reply: 'Which museum inspires you?', translation: 'Qual museu inspira você?'
  }).state;
  const translated = advanceWhatsapp(withTranslation, inbound('Traduz', { id: 'translation-present' }));
  assert.deepEqual(translated.replies, ['Qual museu inspira você?']);
  assert.equal(practiceCount(translated.state), practiceCount(before));
});
