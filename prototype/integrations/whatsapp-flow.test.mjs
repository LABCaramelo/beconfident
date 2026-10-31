import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, QUESTIONS } from '../engine.mjs';
import { advanceWhatsapp } from './whatsapp-flow.mjs';

function session() {
  let state = createState();
  let counter = 0;
  return {
    get state() { return state; },
    send(text, type = 'text', extra = {}) {
      const inbound = { id: `message-${++counter}`, chatId: 'test-chat', text, type, ...extra };
      const answer = advanceWhatsapp(state, inbound);
      state = answer.state;
      return answer;
    }
  };
}

function assessmentSession() {
  const flow = session();
  flow.send('Quero praticar inglês');
  flow.send('Pode me chamar de Alex.');
  flow.send('2');
  return flow;
}

function practiceSession() {
  const flow = assessmentSession();
  for (const question of QUESTIONS) flow.send(String(question.answer + 1));
  return flow;
}

test('primeira mensagem identifica demonstração e não vira nome; perfil vem após nome e nível', () => {
  const flow = session();
  const first = flow.send('Quero ficar fluente!', 'text', { name: 'Nome do contato' });
  assert.match(first.replies.join('\n'), /demonstração/);
  assert.match(first.replies.join('\n'), /seu nome/i);
  assert.equal(flow.state.learner, null);
  assert.equal(flow.state.channelState.phase, 'name');
  assert.equal(flow.state.channelState.name, undefined);
  flow.send('Pode me chamar de Alex.');
  assert.equal(flow.state.channelState.name, 'Alex');
  assert.equal(flow.state.channelState.phase, 'level');
  assert.equal(flow.state.learner, null);
  const level = flow.send('Intermediário');
  assert.equal(flow.state.learner.name, 'Alex');
  assert.equal(flow.state.learner.selfLevel, 'intermediate');
  assert.equal(flow.state.channelState.phase, 'assessment');
  assert.match(level.replies.join('\n'), /Pergunta 1\/3/);
});

test('boas-vindas por IA dependem de habilitação explícita sem prometer avaliação oral', () => {
  for (const text of ['oi', '#menu', 'PARAR', 'RETOMAR']) {
    const message = { id: `welcome-${text}`, chatId: 'test-chat', type: 'text', text };
    const answer = advanceWhatsapp(createState(), message, { generativeEnabled: true });
    assert.match(answer.replies[0], /conversação por IA/);
    assert.match(answer.replies[0], /avaliação de áudio ainda está pendente/);
    assert.doesNotMatch(answer.replies[0], /tutor generativo conectado|CEFR/);
    assert.equal(answer.state.channelState.phase, 'name');
    assert.equal(answer.state.learner, null);
  }
  const disabled = advanceWhatsapp(createState(), {
    id: 'welcome-disabled', chatId: 'test-chat', type: 'text', text: 'oi'
  }, { generativeEnabled: false });
  assert.match(disabled.replies[0], /demonstração/);
});

test('três questões próprias aceitam número ou opção exata e contam acertos sem inventar proficiência', () => {
  const flow = assessmentSession();
  flow.send(QUESTIONS[0].options[QUESTIONS[0].answer].toUpperCase());
  flow.send(String(QUESTIONS[1].answer + 1));
  const final = flow.send(QUESTIONS[2].options[QUESTIONS[2].answer]);
  assert.equal(flow.state.assessment.answers.length, 3);
  assert.equal(flow.state.assessment.complete, true);
  assert.equal(flow.state.channelState.phase, 'practice');
  assert.match(final.replies.join('\n'), /3\/3 acertos/);
  assert.match(final.replies.join('\n'), /somente a estas 3 questões/);
  assert.match(final.replies.join('\n'), /what do you like/i);
  assert.doesNotMatch(final.replies.join('\n'), /nível (?:A1|A2|B1|B2|C1|C2)/i);
  assert.equal(flow.state.events.filter(event => event.type === 'practice').length, 0);
});

test('nome inválido, nível inválido, opção inválida e texto longo não alteram estado', () => {
  const flow = session();
  flow.send('oi');
  let snapshot = structuredClone(flow.state);
  assert.ok(flow.send('https://example.com').replies.length);
  assert.deepEqual(flow.state, snapshot);
  flow.send('Alex');
  snapshot = structuredClone(flow.state);
  assert.ok(flow.send('nível 99').replies.length);
  assert.deepEqual(flow.state, snapshot);
  flow.send('2');
  snapshot = structuredClone(flow.state);
  assert.match(flow.send('nenhuma').replies.join('\n'), /Nenhuma resposta/);
  assert.deepEqual(flow.state, snapshot);
  assert.match(flow.send('x'.repeat(2001)).replies.join('\n'), /2000 caracteres/);
  assert.deepEqual(flow.state, snapshot);
  const fresh = createState();
  const empty = advanceWhatsapp(fresh, { id: 'empty', chatId: 'test-chat', type: 'text', text: ' ' });
  assert.deepEqual(empty.state, createState());
});

test('menu e pausa são roteados antes da avaliação; retomar preserva a questão', () => {
  const flow = assessmentSession();
  flow.send('1');
  const answers = structuredClone(flow.state.assessment.answers);
  const events = structuredClone(flow.state.events);
  const menu = flow.send('#menu');
  assert.match(menu.replies.join('\n'), /Pergunta 2\/3/);
  flow.send('PARAR');
  assert.equal(flow.state.channelState.paused, true);
  assert.deepEqual(flow.send('2').replies, []);
  assert.deepEqual(flow.send('', 'audio').replies, []);
  assert.deepEqual(flow.state.assessment.answers, answers);
  assert.deepEqual(flow.state.events, events);
  const resumed = flow.send('RETOMAR');
  assert.equal(flow.state.channelState.paused, false);
  assert.match(resumed.replies.join('\n'), /retomada/);
  assert.match(resumed.replies.join('\n'), /Pergunta 2\/3/);
  flow.send('PAUSAR');
  assert.equal(flow.state.channelState.paused, true);
});

test('áudio e tipo não suportado não pontuam nem avançam avaliação ou prática', () => {
  const flow = assessmentSession();
  const answers = structuredClone(flow.state.assessment.answers);
  const events = structuredClone(flow.state.events);
  const audio = flow.send('', 'audio');
  assert.match(audio.replies.join('\n'), /suporte a áudio está pendente/i);
  assert.deepEqual(flow.state.assessment.answers, answers);
  assert.deepEqual(flow.state.events, events);
  assert.equal(flow.state.channelState.phase, 'assessment');
  flow.send('PARAR', 'audio');
  assert.equal(flow.state.channelState.paused, false);
  flow.send('', 'unsupported');
  assert.deepEqual(flow.state.assessment.answers, answers);
  assert.deepEqual(flow.state.events, events);
  const practicing = practiceSession();
  const previous = structuredClone(practicing.state.events);
  practicing.send('', 'audio');
  assert.deepEqual(practicing.state.events, previous);
});

test('reentrega de ID não repete transição ou resposta, mesmo com conteúdo diferente', () => {
  const flow = assessmentSession();
  const first = flow.send('1', 'text', { id: 'repeat-id' });
  assert.ok(first.replies.length);
  const snapshot = structuredClone(flow.state);
  assert.deepEqual(flow.send('1', 'text', { id: 'repeat-id' }).replies, []);
  assert.deepEqual(flow.send('2', 'text', { id: 'repeat-id' }).replies, []);
  assert.deepEqual(flow.state, snapshot);
});

test('prática formata somente respostas novas e correção inclui original e corrigido', () => {
  const flow = practiceSession();
  const answer = flow.send('Yesterday I go to the park.');
  const joined = answer.replies.join('\n');
  assert.match(joined, /Você escreveu: Yesterday I go to the park\./);
  assert.match(joined, /Sugestão: Yesterday I went to the park\./);
  assert.doesNotMatch(joined, /Sua prática inicial está concluída/);
  assert.equal(flow.state.events.filter(event => event.type === 'practice').length, 1);
  assert.equal(flow.state.reviews.length, 1);
  flow.send('Corrige');
  assert.equal(flow.state.events.filter(event => event.type === 'practice').length, 1);
  flow.send('#menu');
  assert.equal(flow.state.events.filter(event => event.type === 'practice').length, 1);
});

test('respostas grandes são fragmentadas sem truncar original/correção nem quebrar limite', () => {
  const flow = practiceSession();
  const text = `Yesterday I go ${'a'.repeat(1970)}`;
  const answer = flow.send(text);
  assert.ok(answer.replies.length > 2);
  assert.ok(answer.replies.every(reply => reply.length <= 3500));
  const joined = answer.replies.join('');
  assert.ok(joined.includes(`Você escreveu: ${text}`));
  assert.ok(joined.includes(`Sugestão: ${text.replace('Yesterday I go', 'Yesterday I went')}`));
});
