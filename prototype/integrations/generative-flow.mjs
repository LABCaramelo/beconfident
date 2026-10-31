import { createHash } from 'node:crypto';
import { addMessage } from '../engine.mjs';
import { advanceWhatsapp } from './whatsapp-flow.mjs';

const MAX_INPUT = 2000;
const MAX_REPLY = 3500;
const COMMANDS = new Set(['#menu', 'parar', 'pausar', 'retomar', 'traduz', 'corrige', 'minha evolucao']);

function normalized(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function flowReceiptKey(inbound) {
  return `wa_${createHash('sha256').update(JSON.stringify([inbound.chatId, inbound.id, 'flow'])).digest('hex')}`;
}

function fragment(text) {
  const parts = [];
  let rest = text;
  while (rest.length > MAX_REPLY) {
    let cut = Math.max(rest.lastIndexOf('\n', MAX_REPLY - 1), rest.lastIndexOf(' ', MAX_REPLY - 1));
    cut = cut >= MAX_REPLY / 2 ? cut + 1 : MAX_REPLY;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

function assistantText(message) {
  return typeof message.original === 'string' && typeof message.corrected === 'string'
    ? `${message.text}\n\nVocê escreveu: ${message.original}\nSugestão: ${message.corrected}`
    : message.text;
}

function historyFor(state) {
  // Profile/welcome messages may contain the learner's name. The model receives
  // only recent conversation text, never profile objects or channel identifiers.
  return state.messages
    .filter(message => ['user', 'assistant'].includes(message.role)
      && typeof message.text === 'string' && message.text.trim()
      && message.kind !== 'welcome'
      && !(message.role === 'user' && COMMANDS.has(normalized(message.text))))
    .slice(-6)
    .map(message => ({ role: message.role, text: message.text }));
}

/**
 * Prepares an uncommitted draft without network access or changes to inputState.
 * The caller must keep the draft out of the live session until generation wins
 * its lease/version check, then commit state and outbox together.
 */
export function prepareGenerativeTurn(inputState, inbound) {
  if (!inputState || inputState.channelState?.phase !== 'practice' || inputState.channelState.paused
    || !inputState.learner || inputState.assessment?.complete !== true
    || !Array.isArray(inputState.messages) || !Array.isArray(inputState.receipts)
    || !inbound || inbound.type !== 'text'
    || typeof inbound.id !== 'string' || !inbound.id.trim()
    || typeof inbound.chatId !== 'string' || !inbound.chatId.trim()
    || typeof inbound.text !== 'string' || !inbound.text.trim() || inbound.text.length > MAX_INPUT
    || COMMANDS.has(normalized(inbound.text))) return null;

  if (inputState.receipts.some(receipt => receipt.key === flowReceiptKey(inbound))) return null;

  const beforeIds = new Set(inputState.messages.map(message => message.id));
  const advanced = advanceWhatsapp(structuredClone(inputState), inbound);
  const placeholders = advanced.state.messages.filter(message => !beforeIds.has(message.id)
    && message.role === 'assistant' && message.kind === 'conversation' && message.demonstrative === true);
  if (placeholders.length !== 1) return null;

  const removedId = placeholders[0].id;
  advanced.state.messages = advanced.state.messages.filter(message => message.id !== removedId);
  const prefixReplies = advanced.state.messages
    .filter(message => message.role === 'assistant' && !beforeIds.has(message.id))
    .map(assistantText).filter(Boolean).flatMap(fragment);

  return {
    draft: advanced.state,
    input: { message: inbound.text.trim(), history: historyFor(inputState), selfLevel: inputState.learner.selfLevel },
    prefixReplies
  };
}

/** Finalizes only the prepared draft; no second mutation or flow advance occurs. */
export function finishGenerativeTurn(prepared, generated) {
  if (!prepared?.draft || !Array.isArray(prepared.draft.messages)
    || !Array.isArray(prepared.prefixReplies) || prepared.prefixReplies.some(text => typeof text !== 'string')
    || typeof generated?.reply !== 'string' || !generated.reply.trim()
    || (generated.translation !== undefined && (typeof generated.translation !== 'string' || !generated.translation.trim()))) {
    throw Object.assign(new Error('generative_flow_invalid_result'), { code: 'generative_flow_invalid_result' });
  }

  const state = structuredClone(prepared.draft);
  const reply = generated.reply.trim();
  addMessage(state, 'assistant', reply, {
    kind: 'conversation', aiGenerated: true,
    ...(generated.translation === undefined ? {} : { translation: generated.translation.trim() })
  });
  return { state, replies: [...prepared.prefixReplies, reply].filter(Boolean).flatMap(fragment) };
}
