const $ = selector => document.querySelector(selector);
const main = $('#main');
let state;
let current = 'today';
let activeLesson = null;
let busy = false;
let feedback = null;
let toastTimer;
const icons = {
  today:'<path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  conversation:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-8.5A8.5 8.5 0 1 1 21 11.5Z"/><path d="M7 10h9M7 14h6"/>',
  lessons:'<path d="M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3Z"/><path d="M12 6v15M6 8h3M15 8h3"/>',
  reviews:'<path d="M3 10a9 9 0 1 1 1.8 8M3 4v6h6"/><path d="M12 7v6l4 2"/>',
  progress:'<path d="M4 20V10m8 10V4m8 16v-7M2 21h20"/>'
};
const navs = [['today','Hoje'],['conversation','Conversar'],['lessons','Aprender'],['reviews','Revisar'],['progress','Evolução']];
const svg = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[key]}</svg>`;
function h(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(message) { $('#toast').textContent=message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500); }
async function action(name, data) {
  if (busy) return false;
  busy=true;
  document.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=true);
  const key=crypto.randomUUID();
  try {
    let response;
    const options={method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({action:name,data})};
    try { response=await fetch('/api/action',options); } catch { response=await fetch('/api/action',options); }
    const result=await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar.');
    state=result; render(); return true;
  } catch(error) { toast(error.message || 'Não foi possível conectar. Tente novamente.'); return false; }
  finally { busy=false; document.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=false); }
}
function navigate(next) { if (!navs.some(n=>n[0]===next)) return; current=next; activeLesson=null; render(); main.focus({preventScroll:true}); }
function render() {
  $('#navigation').innerHTML=navs.map(([id,label])=>`<button class="nav-button ${current===id?'active':''}" data-view="${id}" ${current===id?'aria-current="page"':''}>${svg(id)}<span>${label}</span>${id==='reviews'&&state.reviews.some(r=>!r.completed)?`<span class="nav-count">${state.reviews.filter(r=>!r.completed).length}</span>`:''}</button>`).join('');
  $('#profile-name').textContent=state.learner?.name ?? 'Seu perfil'; $('#avatar').textContent=(state.learner?.name ?? 'A').slice(0,1).toUpperCase();
  if (!state.learner) { main.innerHTML='<div class="layout-empty"><h1>Seu espaço de prática está pronto.</h1><p>Crie seu perfil para começar.</p><button class="button primary" data-edit-profile>Montar meu perfil ↗</button></div>'; if(!$('#profile-dialog').open) openProfile(); return; }
  const renders={today:today,conversation:conversation,lessons:lessons,reviews:reviews,progress:progress};
  main.innerHTML=renders[current]();
  // Percentuais visuais representam contagens do protótipo, nunca proficiência oral.
  document.querySelectorAll('[data-goal-angle]').forEach(el=>el.style.setProperty('--angle',`${Number(el.dataset.goalAngle)}deg`));
  document.querySelectorAll('[data-progress-fill]').forEach(el=>el.style.setProperty('--fill',`${Number(el.dataset.progressFill)}%`));
  if(current==='conversation'){ const el=$('.messages'); el.scrollTop=el.scrollHeight; }
}
function head(eyebrow,title,description,extra='') { return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${extra}</div>`; }
function today() {
  const p=state.progress;
  const goal=3;
  return `${head('UM POUCO A CADA DIA',`Let’s go, ${h(state.learner.name)}.`,`Toda conversa é uma oportunidade de ir um pouco além.`,`<span class="date-chip">${h(new Intl.DateTimeFormat('pt-BR',{day:'numeric',month:'long',timeZone:'America/Sao_Paulo'}).format(new Date()))}</span>`)}
  <div class="dashboard-grid"><div class="dashboard-main"><section class="hero"><div class="hero-copy"><div class="eyebrow">PRÁTICA DO DIA</div><h2>Sua próxima conversa<br>começa aqui.</h2><p>Reserve um momento para falar sobre o que faz parte da sua vida.</p><button class="button" data-view="conversation">Vamos conversar <span>↗</span></button></div><div class="voice-orb" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div></section>
  <div class="stats-row"><div class="stat-card"><strong>${p.streak} <span>${p.streak===1?"dia":"dias"}</span></strong><span>de constância</span></div><div class="stat-card"><strong>${p.turns}</strong><span>turnos de prática</span></div><div class="stat-card"><strong>${p.reviewsCompleted}</strong><span>revisões concluídas</span></div></div>
  <div class="section-title"><h2>Um caminho para hoje</h2><button class="text-button" data-view="lessons">Ver atividades ↗</button></div><div class="activity-list">
    <button class="activity-row" data-scroll-assessment><span class="activity-icon">◎</span><span class="activity-copy"><h3>${state.assessment.complete?'Prática inicial concluída':'Descubra seu ponto de partida'}</h3><p>3 perguntas de gramática · ${state.assessment.answered}/3 respondidas</p></span>${state.assessment.complete?'<span class="mini-pill">Concluída</span>':'<span class="arrow">↗</span>'}</button>
    <button class="activity-row" data-lesson="past"><span class="activity-icon">↶</span><span class="activity-copy"><h3>Histórias de ontem</h3><p>Conte uma experiência usando o passado</p></span><span class="arrow">↗</span></button>
    <button class="activity-row" data-view="reviews"><span class="activity-icon">✧</span><span class="activity-copy"><h3>Transforme ajustes em repertório</h3><p>${state.reviews.filter(r=>!r.completed).length} ${state.reviews.filter(r=>!r.completed).length===1?"revisão esperando":"revisões esperando"} por você</p></span><span class="arrow">↗</span></button></div>
    ${assessment()}
  </div><aside class="dashboard-side"><section class="goal-card"><div><div class="small-label">SEU RITMO</div><h3>Um passo por vez.</h3></div><div class="goal-circle" data-goal-angle="${Math.min(360,p.todayTurns/goal*360)}"><div><strong>${p.todayTurns}<span> / ${goal}</span></strong><small>turnos hoje</small></div></div><p>Meta de tempo escolhida: ${state.learner.dailyGoal} min/dia.<br>Tempo ativo ainda não é medido.</p></section><section class="insight-card"><div class="quote">“</div><p>You don’t have to be perfect to be understood.</p><small>PRATIQUE COM CURIOSIDADE.</small></section></aside></div>`;
}
function assessment() {
  const a=state.assessment;
  if(a.complete)return `<section id="assessment" class="card assessment"><div class="eyebrow">PONTO DE PARTIDA</div><h2>Primeiro passo, concluído.</h2><div class="result-score">${a.score} de ${a.total} acertos</div><p>Este é o resultado das questões objetivas. Três respostas não são suficientes para determinar seu nível geral, compreensão ou pronúncia.</p><button class="button primary" data-view="conversation">Continuar praticando ↗</button></section>`;
  const q=a.question;
  return `<section id="assessment" class="card assessment"><div class="assessment-top"><div><div class="eyebrow">SEU PONTO DE PARTIDA</div><h2>Vamos começar com o básico.</h2></div><span class="mini-pill">${a.answered+1} / ${a.total}</span></div><p>Escolha a opção que completa a frase. Você pode pausar e voltar depois.</p><div class="question">${h(q.prompt)}</div><div class="options">${q.options.map((o,i)=>`<button class="option" data-answer="${i}" data-question="${h(q.id)}">${h(o)}</button>`).join('')}</div>${feedback?`<div class="feedback-strip ${feedback.correct?'':'wrong'}">${feedback.correct?'Boa!':'Vamos ajustar.'} ${h(feedback.explanation)}</div>`:''}</section>`;
}
function conversation() {
  return `${head('PRÁTICA DE CONVERSAÇÃO','Uma pergunta abre caminhos.','Escolha um assunto e experimente construir uma resposta em inglês.')}
  <div class="chat-layout"><section class="chat-card" aria-label="Conversa demonstrativa"><div class="chat-head"><div class="tutor-avatar" aria-hidden="true">≋</div><div><h2>Mentor de prática</h2><p>Respostas demonstrativas · texto</p></div></div><div class="messages" role="log" aria-label="Mensagens">${state.messages.map(message).join('')}</div><div class="chat-actions"><button class="chip" data-command="#menu">Menu</button><button class="chip" data-command="Traduz">Traduzir pergunta</button><button class="chip" data-command="Corrige">Rever minha frase</button><button class="chip" data-view="reviews">Minhas revisões ↗</button></div><form id="chat-form" class="chat-form"><label class="sr-only" for="message">Sua mensagem em inglês</label><textarea id="message" name="message" rows="1" maxlength="2000" placeholder="Escreva sua mensagem em inglês…" required></textarea><button class="send-button" type="submit" aria-label="Enviar mensagem">↑</button></form></section><aside class="conversation-tips"><div class="card"><div class="eyebrow">ESCOLHA UM ASSUNTO</div><h3>Do seu mundo<br>para o inglês.</h3><button class="topic-button" data-topic="I want to talk about travel.">Viagens e descobertas <span>↗</span></button><button class="topic-button" data-topic="Yesterday I go to the park.">O que eu fiz ontem <span>↗</span></button><button class="topic-button" data-topic="I enjoy music and movies.">Música e cinema <span>↗</span></button><p class="speech-note">O ícone de áudio lê a mensagem com a voz do seu navegador.</p></div><div class="info-box">Este mentor usa um conjunto pequeno de perguntas e correções. Uma frase sem feedback ainda pode precisar de ajustes.</div></aside></div>`;
}
function message(m) {
  const time=new Intl.DateTimeFormat('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(m.createdAt));
  if(m.kind==='feedback'&&m.corrected)return `<article class="message"><div class="correction-card"><h3>Um ajuste para lembrar</h3><del>${h(m.original)}</del><ins>${h(m.corrected)}</ins><p>${h(m.explanation)}</p></div><span class="message-meta">${time} · salvo para revisar</span></article>`;
  return `<article class="message ${m.role==='user'?'user':''}"><div class="message-bubble">${h(m.text)}</div>${m.kind==='menu'?`<div class="options">${[['conversation','Conversar'],['lessons','Aprender'],['reviews','Revisar'],['progress','Evolução']].map(([v,l])=>`<button class="chip" data-view="${v}">${l}</button>`).join('')}</div>`:''}<div class="message-meta">${time}${m.role==='assistant'&&m.kind==='conversation'?`<button class="listen-button" data-listen="${h(m.id)}" aria-label="Ouvir pergunta em inglês">◖ Ouvir</button>`:''}</div></article>`;
}
function lessons() {
  if(activeLesson){const l=state.lessons.find(l=>l.id===activeLesson);return `${head('APRENDER NA PRÁTICA',h(l.title),h(l.description),'<button class="button quiet" data-view="lessons">← Atividades</button>')}<section class="card lesson-detail"><span class="lesson-category">${h(l.category)} · ${l.minutes} min</span><h2>Primeiro, um exemplo.</h2><div class="phrase-example">${h(l.phrase)}</div><form id="lesson-form" class="practice-form" data-lesson-id="${h(l.id)}"><label for="lesson-answer">${h(l.question)}</label><textarea id="lesson-answer" name="answer" rows="3" maxlength="2000" required placeholder="Tente com as suas palavras…"></textarea><p>Uma ajuda: ${h(l.hint)}</p><button type="submit" class="button primary">Registrar minha prática ↗</button></form><p class="muted-note">Concluir registra participação. A demonstração não certifica o domínio da habilidade.</p></section>`;}
  return `${head('REPERTÓRIO PARA A VIDA REAL','Pequenas práticas. Novas possibilidades.','Experimente uma construção e leve para a sua próxima conversa.')}<div class="lesson-grid">${state.lessons.map((l,i)=>`<article class="card lesson-card"><div class="lesson-visual" aria-hidden="true">${['✦','↶','☕'][i]}</div><span class="lesson-category">${h(l.category)} · ${l.minutes} min</span><h2>${h(l.title)}</h2><p>${h(l.description)}</p><button class="button ${l.complete?'outline':'primary'}" data-lesson="${h(l.id)}">${l.complete?'Praticar de novo':'Começar atividade'} ↗</button></article>`).join('')}</div>`;
}
function reviews() {
  const pending=state.reviews.filter(r=>!r.completed);
  return `${head('DO AJUSTE AO HÁBITO','Seu repertório fica mais forte.','Reescreva a frase para fixar a construção. Compare com o exemplo depois.')} ${!pending.length?`<section class="empty-state"><div class="empty-icon">✧</div><h2>Tudo em dia por aqui.</h2><p>Os ajustes identificados durante a conversa e as perguntas iniciais aparecem nesta área.</p><button class="button primary" data-view="conversation">Voltar à conversa ↗</button></section>`:pending.map(r=>`<article class="card review-card"><span class="lesson-category">${h(r.category)}</span><h2>Como você diria essa frase?</h2><p class="original">${h(r.original)}</p><form class="review-form" data-review-id="${h(r.id)}"><label for="review-${h(r.id)}" class="sr-only">Sua versão da frase</label><input id="review-${h(r.id)}" name="answer" required maxlength="2000" placeholder="Reescreva a frase em inglês" autocomplete="off"><button type="submit" class="button primary">Conferir resposta</button></form>${r.attempts?`<div class="review-result">Uma forma de dizer: <strong>${h(r.corrected)}</strong><br>${h(r.explanation)}</div>`:''}</article>`).join('')}<p class="muted-note">${state.reviews.filter(r=>r.completed).length} ${state.reviews.filter(r=>r.completed).length===1?"revisão concluída":"revisões concluídas"}. A conferência usa a frase de referência desta demonstração; outras construções corretas podem não ser reconhecidas.</p>`;
}
function progress() {
  const p=state.progress;
  return `${head('CONSTRUINDO CONSTÂNCIA','Cada tentativa deixa uma marca.','Seu histórico reflete o que você praticou neste protótipo.')}<div class="progress-grid">${[[p.streak,p.streak===1?'dia de sequência':'dias de sequência'],[p.turns,p.turns===1?'turno de prática':'turnos de prática'],[p.lessonsCompleted,p.lessonsCompleted===1?'atividade registrada':'atividades registradas'],[p.reviewsCompleted,p.reviewsCompleted===1?'revisão concluída':'revisões concluídas']].map(([n,l])=>`<div class="stat-card"><strong>${n}</strong><span>${l}</span></div>`).join('')}</div><div class="progress-note"><section class="card"><div class="eyebrow">SEU PONTO DE PARTIDA</div><h2>${state.assessment.complete?'Prática inicial concluída':'Um primeiro passo para conhecer seu ritmo.'}</h2><div class="progress-bar" data-progress-fill="${state.assessment.answered/3*100}"><span></span></div><p>${state.assessment.complete?`Você acertou <strong>${state.assessment.score} de 3</strong> questões de gramática. Esse resultado não determina seu nível geral de inglês.`:`${state.assessment.answered} de 3 perguntas respondidas. Suas respostas estão salvas para continuar quando quiser.`}</p><button class="button outline" data-scroll-assessment>${state.assessment.complete?'Ver resultado':'Continuar perguntas'} ↗</button></section><section class="card"><div class="eyebrow">O QUE AINDA FALTA MEDIR</div><h2>Proficiência precisa de evidências.</h2><p>Naturalidade, vocabulário, compreensão e pronúncia exigem avaliação própria. Esta demonstração não atribui percentuais a essas habilidades.</p><p>Você praticou em <strong>${p.practiceDays} ${p.practiceDays===1?"dia":"dias"}</strong>. Sua meta de tempo é ${state.learner.dailyGoal} minutos por dia; a medição de tempo ativo ainda não está disponível.</p></section></div>`;
}
function openProfile(){const l=state?.learner;$('#name').value=l?.name??'';$('#selfLevel').value=l?.selfLevel??'beginner';$('#dailyGoal').value=String(l?.dailyGoal??10);$('#profile-close').hidden=!l;$('#profile-dialog').showModal();}
$('#profile-button').addEventListener('click',openProfile);
$('#profile-close').addEventListener('click',()=>$('#profile-dialog').close());
$('#profile-dialog').addEventListener('cancel',e=>{if(!state?.learner)e.preventDefault();});
$('#profile-form').addEventListener('submit',async e=>{e.preventDefault();const values=new FormData(e.target);if(await action('profile',{name:values.get('name'),selfLevel:values.get('selfLevel'),dailyGoal:Number(values.get('dailyGoal'))})){$('#profile-dialog').close();toast('Seu perfil foi salvo. Vamos praticar!');}});
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.view)return navigate(b.dataset.view);
  if(b.hasAttribute('data-edit-profile'))return openProfile();
  if(b.hasAttribute('data-scroll-assessment')){current='today';render();$('#assessment')?.scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(b.dataset.lesson){current='lessons';activeLesson=b.dataset.lesson;render();return;}
  if(b.dataset.answer!==undefined){const id=b.dataset.question;const ok=await action('answer',{questionId:id,option:Number(b.dataset.answer)});if(ok){feedback=state.assessment.answers.find(a=>a.questionId===id);render();toast(feedback.correct?'Boa resposta!':feedback.explanation);}return;}
  if(b.dataset.command){await action('message',{text:b.dataset.command});return;}
  if(b.dataset.topic){await action('message',{text:b.dataset.topic});return;}
  if(b.dataset.listen){if(!('speechSynthesis'in window))return toast('Este navegador não oferece leitura de texto.');const text=state.messages.find(m=>m.id===b.dataset.listen)?.text;if(text){speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='en-US';utterance.rate=.88;speechSynthesis.speak(utterance);}return;}
});
main.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.target;const values=new FormData(form);
  if(form.id==='chat-form'){if(await action('message',{text:values.get('message')}))$('#message')?.focus();}
  else if(form.id==='lesson-form'){if(await action('lesson',{id:form.dataset.lessonId,answer:values.get('answer')})){toast('Prática registrada. Veja seu histórico em Conversar.');activeLesson=null;render();}}
  else if(form.classList.contains('review-form')){const id=form.dataset.reviewId;if(await action('review',{id,answer:values.get('answer')})){const r=state.reviews.find(r=>r.id===id);toast(r.completed?'Boa! Construção revisada.':'Compare com a frase de referência e tente mais uma vez.');}}
});
main.addEventListener('keydown',e=>{if(e.target.id==='message'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();e.target.form.requestSubmit();}});
try { const response=await fetch('/api/state'); if(!response.ok)throw new Error(); state=await response.json();render(); }
catch{main.innerHTML='<div class="empty-state"><h1>Não foi possível abrir seu espaço.</h1><p>Não foi possível conectar ao serviço. Aguarde um momento e atualize a página.</p><button class="button primary" id="retry">Tentar novamente</button></div>';$('#retry').addEventListener('click',()=>location.reload());}
