import { randomUUID } from 'node:crypto';

export const QUESTIONS = [
  { id: 'past', prompt: 'Last weekend, we ___ a new museum.', options: ['visited', 'visit', 'visiting'], answer: 0, explanation: 'Uma ação concluída no passado pede o passado simples: visited.' },
  { id: 'comparison', prompt: 'This book is ___ than the last one.', options: ['interesting', 'more interesting', 'most interesting'], answer: 1, explanation: 'Para comparar dois elementos, usamos more interesting than.' },
  { id: 'duration', prompt: 'I have lived here ___ three years.', options: ['since', 'during', 'for'], answer: 2, explanation: 'For apresenta uma duração. Since apresenta o início de um período.' }
];
export const LESSONS = [
  { id: 'introductions', title: 'Uma boa apresentação', category: 'Dia a dia', minutes: 4, description: 'Conte quem você é e faça uma pergunta de volta.', phrase: 'I work as a designer. What do you do?', question: 'Apresente-se em inglês e pergunte sobre a outra pessoa.', hint: 'My name is… I work as… What about you?' },
  { id: 'past', title: 'Histórias de ontem', category: 'Gramática em contexto', minutes: 5, description: 'Conte uma experiência usando o passado simples.', phrase: 'Yesterday, I visited a friend and we cooked dinner.', question: 'Conte em inglês uma coisa que você fez ontem.', hint: 'Yesterday, I went / visited / watched…' },
  { id: 'travel', title: 'Um café em outra cidade', category: 'Viagem', minutes: 4, description: 'Faça um pedido com clareza e gentileza.', phrase: 'Could I have a coffee, please?', question: 'Peça uma bebida e pergunte o preço em inglês.', hint: 'Could I have…? How much is it?' }
];

export function addMessage(state, role, text, extra = {}) {
  const message = { id: randomUUID(), role, text, createdAt: new Date().toISOString(), ...extra };
  state.messages.push(message);
  if (state.messages.length > 250) state.messages.splice(0, state.messages.length - 250);
  return message;
}
export function createState() {
  return { version: 1, learner: null, assessment: { answers: [], complete: false }, messages: [], reviews: [], events: [], completedLessons: [], receipts: [] };
}
export function expose(state) {
  const a = state.assessment;
  const days = [...new Set(state.events.map(e => e.day))].sort().reverse();
  const today = dayKey();
  let streak = 0;
  let cursor = new Date(`${today}T12:00:00Z`);
  if (!days.includes(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.includes(cursor.toISOString().slice(0, 10))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return {
    mode: 'demonstration',
    capabilities: { generativeTutor: false, audioAssessment: false, realtimeCalls: false, whatsappConnected: false },
    learner: state.learner,
    assessment: {
      complete: a.complete, answered: a.answers.length, total: QUESTIONS.length,
      score: a.complete ? a.answers.filter(x => x.correct).length : null,
      question: !a.complete && state.learner ? publicQuestion(QUESTIONS[a.answers.length]) : null,
      answers: a.answers
    },
    messages: state.messages,
    reviews: state.reviews,
    lessons: LESSONS.map(({ id, title, category, minutes, description, phrase, question, hint }) => ({ id, title, category, minutes, description, phrase, question, hint, complete: state.completedLessons.includes(id) })),
    progress: { practiceDays: days.length, streak, turns: state.events.filter(e => e.type === 'practice').length, reviewsCompleted: state.events.filter(e => e.type === 'review_correct').length, lessonsCompleted: state.completedLessons.length, todayTurns: state.events.filter(e => e.type === 'practice' && e.day === today).length },
    integration: 'Os canais externos ainda não estão conectados.'
  };
}
function publicQuestion(q) { return q ? { id: q.id, prompt: q.prompt, options: q.options } : null; }
function dayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function event(state, type, source) {
  if (!state.events.some(e => e.type === type && e.source === source)) state.events.push({ type, source, day: dayKey(), at: new Date().toISOString() });
}
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function requireLearner(state) { if (!state.learner) fail('Complete seu perfil primeiro.', 409); }
function requireText(value, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Escreva entre 1 e ${max} caracteres.`);
  return value.trim();
}
export function mutate(state, action, data, key) {
  if (typeof key !== 'string' || !/^[\w-]{8,100}$/.test(key)) fail('Identificador de operação inválido.');
  const signature = JSON.stringify({ action, data });
  const receipt = state.receipts.find(x => x.key === key);
  if (receipt) { if (receipt.signature !== signature) fail('Operação repetida com dados diferentes.', 409); return; }
  if (action === 'profile') {
    const name = requireText(data.name, 60);
    if (!['beginner', 'intermediate', 'advanced'].includes(data.selfLevel)) fail('Escolha um nível.');
    if (![5, 10, 15, 20].includes(data.dailyGoal)) fail('Escolha uma meta válida.');
    state.learner = { name, selfLevel: data.selfLevel, dailyGoal: data.dailyGoal, createdAt: state.learner?.createdAt ?? new Date().toISOString() };
    if (!state.messages.length) addMessage(state, 'assistant', `Hi, ${name}! Vamos praticar sem pressa. Comece com três perguntas curtas de gramática. Depois, escolha um assunto para conversar.`, { kind: 'welcome' });
  } else if (action === 'answer') {
    requireLearner(state);
    const q = QUESTIONS[state.assessment.answers.length];
    if (!q || state.assessment.complete) fail('Essa atividade já foi concluída.', 409);
    if (data.questionId !== q.id) fail('A pergunta mudou. Atualize a página.', 409);
    if (!Number.isInteger(data.option) || data.option < 0 || data.option >= q.options.length) fail('Escolha uma das respostas.');
    const correct = data.option === q.answer;
    state.assessment.answers.push({ questionId: q.id, selected: data.option, correct, explanation: q.explanation, answer: q.options[q.answer] });
    event(state, 'assessment', q.id);
    state.assessment.complete = state.assessment.answers.length === QUESTIONS.length;
    if (!correct) addReview(state, { original: q.prompt.replace('___', q.options[data.option]), corrected: q.prompt.replace('___', q.options[q.answer]), explanation: q.explanation, category: 'Gramática' });
    if (state.assessment.complete) addMessage(state, 'assistant', 'Sua prática inicial está concluída! Esse resultado mede apenas estas três questões. Vamos conversar: what do you like to do in your free time?', { kind: 'welcome' });
  } else if (action === 'message') {
    requireLearner(state);
    const text = requireText(data.text);
    const user = addMessage(state, 'user', text);
    const command = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    // Comandos são roteados antes da prática e não recebem pontuação.
    if (command === '#menu') {
      addMessage(state, 'assistant', 'Escolha uma opção para continuar. Sua prática e suas respostas foram preservadas.', { kind: 'menu', actions: ['conversation', 'lessons', 'reviews', 'progress'] });
    } else if (command === 'traduz') {
      const target = [...state.messages.slice(0, -1)].reverse().find(m => m.role === 'assistant' && m.translation);
      addMessage(state, 'assistant', target?.translation ?? 'Escolha um dos assuntos de conversa para ver uma pergunta com tradução disponível.', { kind: 'translation', targetId: target?.id });
    } else if (command === 'corrige') {
      const target = [...state.messages.slice(0, -1)].reverse().find(m => m.role === 'user' && !['#menu', 'traduz', 'corrige', 'minha evolucao'].includes(m.text.toLowerCase()));
      const feedback = target && correction(target.text);
      addMessage(state, 'assistant', feedback ? feedback.explanation : 'Não encontrei um dos padrões cobertos nesta demonstração. Isso não confirma que a frase inteira está correta.', { kind: 'feedback', ...(feedback ?? {}), targetId: target?.id });
    } else if (command === 'minha evolucao') {
      const p = expose(state).progress;
      addMessage(state, 'assistant', `Você registrou ${p.turns} turnos de prática e concluiu ${p.lessonsCompleted} atividades. Continue na tela Evolução para acompanhar seu histórico.`, { kind: 'progress' });
    } else {
      event(state, 'practice', user.id);
      const feedback = correction(text);
      if (feedback) {
        addReview(state, feedback);
        addMessage(state, 'assistant', feedback.explanation, { kind: 'feedback', ...feedback, targetId: user.id });
      }
      const prompts = [
        ['What do you like to do in your free time?', 'O que você gosta de fazer no seu tempo livre?'],
        ['Tell me about something you did yesterday.', 'Conte uma coisa que você fez ontem.'],
        ['What would you like to do on your next trip?', 'O que você gostaria de fazer na sua próxima viagem?'],
        ['What is one thing you want to learn this year?', 'Qual é uma coisa que você quer aprender neste ano?']
      ];
      const number = state.events.filter(e => e.type === 'practice').length;
      const topicIndex = /travel|trip|viag/i.test(text) ? 2 : /yesterday|ontem/i.test(text) ? 1 : number % prompts.length;
      const [question, translation] = prompts[topicIndex];
      addMessage(state, 'assistant', question, { kind: 'conversation', translation, demonstrative: true });
    }
  } else if (action === 'review') {
    requireLearner(state);
    const item = state.reviews.find(x => x.id === data.id);
    if (!item) fail('Revisão não encontrada.', 404);
    const attempt = requireText(data.answer, 2000);
    const clean = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const correct = clean(attempt) === clean(item.corrected);
    item.attempts++;
    item.lastCorrect = correct;
    if (correct) { item.completed = true; event(state, 'review_correct', item.id); }
  } else if (action === 'lesson') {
    requireLearner(state);
    const lesson = LESSONS.find(x => x.id === data.id);
    if (!lesson) fail('Atividade não encontrada.', 404);
    const response = requireText(data.answer);
    const user = addMessage(state, 'user', response, { lessonId: lesson.id });
    event(state, 'practice', user.id);
    if (!state.completedLessons.includes(lesson.id)) state.completedLessons.push(lesson.id);
    addMessage(state, 'assistant', 'Prática registrada! Compare a construção da sua frase com o exemplo e tente usá-la na próxima conversa.', { kind: 'lesson', lessonId: lesson.id });
    const feedback = correction(response);
    if (feedback) { addReview(state, feedback); addMessage(state, 'assistant', feedback.explanation, { kind: 'feedback', ...feedback }); }
  } else if (action === 'reset') {
    Object.assign(state, createState());
  } else fail('Ação desconhecida.', 404);
  state.receipts.push({ key, signature });
  if (state.receipts.length > 1000) state.receipts.splice(0, state.receipts.length - 1000);
}
function correction(text) {
  const rules = [
    { pattern: /\bYesterday I go\b/i, replace: 'Yesterday I went', explanation: 'Yesterday indica uma ação concluída no passado. O passado de go é went.' },
    { pattern: /\bI has\b/i, replace: 'I have', explanation: 'Com I, usamos have. Has acompanha he, she e it.' },
    { pattern: /\bShe like\b/i, replace: 'She likes', explanation: 'No presente simples, o verbo normalmente recebe -s com she.' },
    { pattern: /\bHe go\b/i, replace: 'He goes', explanation: 'No presente simples, go passa a goes com he.' }
  ];
  const rule = rules.find(r => r.pattern.test(text));
  return rule ? { original: text, corrected: text.replace(rule.pattern, rule.replace), explanation: rule.explanation, category: 'Gramática' } : null;
}
function addReview(state, feedback) {
  if (!state.reviews.some(r => r.original.toLowerCase() === feedback.original.toLowerCase())) state.reviews.push({ id: randomUUID(), ...feedback, createdAt: new Date().toISOString(), attempts: 0, completed: false });
}
