import { createHash } from 'node:crypto';
import { createState, mutate, expose, QUESTIONS } from '../engine.mjs';

const MAX_INPUT = 2000;
const MAX_REPLY = 3500;
const LEVELS = new Map([
  ['1', 'beginner'], ['iniciante', 'beginner'], ['beginner', 'beginner'],
  ['2', 'intermediate'], ['intermediario', 'intermediate'], ['intermediate', 'intermediate'],
  ['3', 'advanced'], ['avancado', 'advanced'], ['advanced', 'advanced']
]);
const WELCOME = 'Olá! Este é um tutor de inglês em demonstração, com exercícios próprios e respostas limitadas por regras. Ainda não há avaliação de áudio nem tutor generativo conectado.\n\nComo você quer ser chamado? Envie seu nome.';
const GENERATIVE_WELCOME = 'Olá! Vamos praticar inglês com exercícios próprios e conversação por IA. A avaliação de áudio ainda está pendente.\n\nComo você quer ser chamado? Envie seu nome.';
const LEVEL_PROMPT = 'Como você descreve seu inglês? Esse é apenas seu autorrelato.\n1) Iniciante\n2) Intermediário\n3) Avançado\n\nResponda com o número ou o nome da opção.';

function normalized(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function operationKey(chatId, id, action) {
  return `wa_${createHash('sha256').update(JSON.stringify([chatId, id, action])).digest('hex')}`;
}

function fragment(text) {
  const parts = [];
  let rest = text;
  while (rest.length > MAX_REPLY) {
    const newline = rest.lastIndexOf('\n', MAX_REPLY - 1);
    const space = rest.lastIndexOf(' ', MAX_REPLY - 1);
    let cut = Math.max(newline, space);
    cut = cut >= MAX_REPLY / 2 ? cut + 1 : MAX_REPLY;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

function result(state, texts) {
  return { state, replies: texts.filter(Boolean).flatMap(fragment) };
}

function questionText(state) {
  const question = expose(state).assessment.question;
  if (!question) return 'A prática inicial já terminou. Envie uma frase em inglês para continuar.';
  return `Pergunta ${state.assessment.answers.length + 1}/${QUESTIONS.length}\n${question.prompt}\n${question.options.map((option, index) => `${index + 1}) ${option}`).join('\n')}\n\nResponda com o número ou com o texto exato da opção.`;
}

function resumePrompt(state) {
  switch (state.channelState.phase) {
    case 'name': return 'Envie o nome pelo qual quer ser chamado.';
    case 'level': return LEVEL_PROMPT;
    case 'assessment': return questionText(state);
    default: return 'Envie uma frase em inglês. Você também pode usar Corrige, Traduz ou Minha evolução.';
  }
}

function parseName(text) {
  const name = text
    .replace(/^(?:meu nome [ée]|me chamo|pode me chamar de|my name is|call me|i am|i'm)\s+/iu, '')
    .replace(/[.!?]+$/u, '').trim();
  return name.length >= 1 && name.length <= 60 && /^[\p{L}\p{M}][\p{L}\p{M}\s.'’-]*$/u.test(name) ? name : null;
}

function assistantReplies(state, previousIds) {
  return state.messages
    .filter(message => message.role === 'assistant' && !previousIds.has(message.id))
    .map(message => {
      if (typeof message.original === 'string' && typeof message.corrected === 'string') {
        return `${message.text}\n\nVocê escreveu: ${message.original}\nSugestão: ${message.corrected}`;
      }
      return message.text;
    });
}

/**
 * Adaptador local de conversação; não acessa rede nem mídia.
 * Usa o mesmo estado mutável do engine e acrescenta channelState.
 * Quem persiste deve salvar `result.state` após o retorno e deduplicar a outbox.
 */
export function advanceWhatsapp(inputState, inbound, { generativeEnabled = false } = {}) {
  const state = inputState ?? createState();
  const welcome = generativeEnabled === true ? GENERATIVE_WELCOME : WELCOME;
  if (!inbound || typeof inbound.id !== 'string' || !inbound.id.trim()
    || typeof inbound.chatId !== 'string' || !inbound.chatId.trim()
    || !['text', 'audio', 'unsupported'].includes(inbound.type)) {
    return result(state, ['Não consegui identificar essa mensagem. Envie novamente uma mensagem de texto.']);
  }

  const text = typeof inbound.text === 'string' ? inbound.text.trim() : '';
  const command = normalized(text);
  const isControl = ['#menu', 'parar', 'pausar', 'retomar'].includes(command) && inbound.type === 'text';

  // Enquanto pausado, somente comandos de controle recebem resposta.
  if (state.channelState?.paused && !isControl) return result(state, []);
  if (inbound.type === 'text' && (!text || inbound.text.length > MAX_INPUT)) {
    return result(state, [`Envie uma mensagem de texto com 1 a ${MAX_INPUT} caracteres.`]);
  }

  const receiptKey = operationKey(inbound.chatId, inbound.id, 'flow');
  const signature = `whatsapp-flow:${JSON.stringify({ type: inbound.type, text })}`;
  const seen = state.receipts.find(receipt => receipt.key === receiptKey);
  if (seen) {
    // Um ID reutilizado nunca deve disparar outro turno, mesmo com outro conteúdo.
    return result(state, []);
  }
  const finish = replies => {
    state.receipts.push({ key: receiptKey, signature });
    if (state.receipts.length > 1000) state.receipts.splice(0, state.receipts.length - 1000);
    return result(state, replies);
  };

  const firstMessage = !state.channelState;
  if (firstMessage) state.channelState = { phase: 'name', paused: false };

  if (isControl && (command === 'parar' || command === 'pausar')) {
    state.channelState.paused = true;
    return finish([firstMessage ? welcome : '', 'Prática pausada. Seu progresso foi preservado. Envie RETOMAR quando quiser continuar.']);
  }
  if (isControl && command === 'retomar') {
    state.channelState.paused = false;
    return finish([firstMessage ? welcome : '', 'Prática retomada. Seu progresso foi preservado.', resumePrompt(state)]);
  }
  if (isControl && command === '#menu') {
    return finish([
      firstMessage ? welcome : '',
      `Menu da demonstração\n#menu: ver este menu\nPARAR ou PAUSAR: pausar respostas\nRETOMAR: continuar\n${state.channelState.phase === 'practice' ? 'Corrige: correção da frase anterior\nTraduz: tradução disponível\nMinha evolução: progresso registrado\n' : ''}\nEstado: ${state.channelState.paused ? 'pausado' : 'ativo'}. Suas respostas foram preservadas.`,
      state.channelState.paused ? '' : resumePrompt(state)
    ]);
  }

  const mediaNotice = inbound.type === 'audio'
    ? 'O suporte a áudio está pendente nesta demonstração. Não baixei nem avaliei o áudio e ele não alterou sua pontuação. Continue por texto.'
    : inbound.type === 'unsupported'
      ? 'Esse tipo de mensagem ainda não é suportado. Continue por texto; seu progresso não foi alterado.'
      : '';
  if (firstMessage) return finish([welcome, mediaNotice]);
  if (mediaNotice) return finish([mediaNotice, resumePrompt(state)]);

  if (state.channelState.phase === 'name') {
    const name = parseName(text);
    if (!name) return result(state, ['Envie apenas o nome pelo qual quer ser chamado, com até 60 caracteres.']);
    state.channelState.name = name;
    state.channelState.phase = 'level';
    return finish([`Combinado, ${name}!`, LEVEL_PROMPT]);
  }

  if (state.channelState.phase === 'level') {
    const selfLevel = LEVELS.get(command);
    if (!selfLevel) return result(state, [LEVEL_PROMPT]);
    mutate(state, 'profile', { name: state.channelState.name, selfLevel, dailyGoal: 15 }, operationKey(inbound.chatId, inbound.id, 'profile'));
    state.channelState.phase = state.assessment.complete ? 'practice' : 'assessment';
    return finish(state.assessment.complete
      ? ['Seu perfil foi atualizado. A prática inicial já estava concluída.', resumePrompt(state)]
      : [`Vamos responder ${QUESTIONS.length} questões próprias de gramática. O resultado contará acertos apenas nestas questões; não atribui nível CEFR.`, questionText(state)]);
  }

  if (state.channelState.phase === 'assessment') {
    if (state.assessment.complete) {
      // Um estado concluído por outro canal deve continuar, sem refazer a prova.
      state.channelState.phase = 'practice';
      return finish(['Sua prática inicial já foi concluída.', resumePrompt(state)]);
    }
    const question = QUESTIONS[state.assessment.answers.length];
    const option = /^[1-3]$/.test(text)
      ? Number(text) - 1
      : question.options.findIndex(candidate => normalized(candidate) === command);
    if (option < 0 || option >= question.options.length) return result(state, ['Escolha uma das opções válidas. Nenhuma resposta foi registrada.', questionText(state)]);

    const before = new Set(state.messages.map(message => message.id));
    mutate(state, 'answer', { questionId: question.id, option }, operationKey(inbound.chatId, inbound.id, 'answer'));
    const answer = state.assessment.answers.at(-1);
    const feedback = `${answer.correct ? 'Resposta correta.' : `A opção esperada era: ${answer.answer}.`} ${answer.explanation}`;
    if (!state.assessment.complete) return finish([feedback, questionText(state)]);

    state.channelState.phase = 'practice';
    const assessment = expose(state).assessment;
    return finish([
      feedback,
      `Prática inicial concluída: ${assessment.score}/${assessment.total} acertos. Esse resultado se refere somente a estas ${assessment.total} questões; não é uma avaliação oral nem uma certificação de proficiência.`,
      ...assistantReplies(state, before)
    ]);
  }

  if (state.channelState.phase === 'practice') {
    if (command === 'traduz') {
      const lastConversation = state.messages.findLast(message => message.role === 'assistant' && message.kind === 'conversation');
      if (lastConversation?.aiGenerated === true && !lastConversation.translation) {
        return finish(['A tradução da última resposta de IA ainda não está disponível. Continue por texto; seu progresso foi preservado.']);
      }
    }
    const before = new Set(state.messages.map(message => message.id));
    mutate(state, 'message', { text }, operationKey(inbound.chatId, inbound.id, 'message'));
    return finish(assistantReplies(state, before));
  }

  return result(state, ['Não consegui reconhecer a etapa atual. Seu progresso foi preservado; tente novamente.']);
}
