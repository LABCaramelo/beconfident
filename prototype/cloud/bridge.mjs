import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createState } from '../engine.mjs';
import { advanceWhatsapp } from '../integrations/whatsapp-flow.mjs';
import { prepareGenerativeTurn, finishGenerativeTurn } from '../integrations/generative-flow.mjs';
import { integrationConfig, normalizeChat, normalizeInbound, secretEqual, UazapiClient } from '../integrations/uazapi.mjs';

const TEST_TEXT = 'Teste de integração do tutor Confident Lab.';
const PENDING = new Set(['queued', 'needs_generation', 'generating', 'prepared']);
const MAX_EVENTS = 2000;
const DRAIN_EVENTS = 10;
const DRAIN_MS = 40_000;
const GENERATION_START_MS = 25_000;
const GENERATION_NOTICE = 'Não consegui responder agora. Seu progresso foi preservado. Envie uma nova mensagem para tentar novamente.';

export function initialCloudState() {
  return { version: 1, nextSeq: 1, inbox: {}, sessions: {}, webSessions: {}, worker: null };
}

function stateOf(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.nextSeq) || value.nextSeq < 1
    || !value.inbox || !value.sessions || !value.webSessions
    || [value.inbox, value.sessions, value.webSessions].some(part => typeof part !== 'object' || Array.isArray(part))) {
    const error = new Error('cloud_state_invalid'); error.code = 'cloud_state_invalid'; throw error;
  }
  return value;
}
function digest(owner, source) { return createHash('sha256').update(`${owner}\0${source}`).digest('hex'); }
function owns(state, actor, now) { return state.worker?.actor === actor && state.worker.leaseUntil > now; }
function timestamp(now) { return new Date(now).toISOString(); }
function pending(state) { return Object.values(state.inbox).some(entry => PENDING.has(entry.status)); }
function sessionHash(session) { return createHash('sha256').update(JSON.stringify(session ?? null)).digest('hex'); }
function validFlow(result) {
  return result?.state && typeof result.then !== 'function' && Array.isArray(result.replies)
    && result.replies.every(text => typeof text === 'string' && text.trim() && text.length <= 8000);
}
function generationMetadata(result = {}) {
  result = result && typeof result === 'object' ? result : {};
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    model: typeof result.model === 'string' && /^[A-Za-z\d_/.:-]{1,150}$/.test(result.model) ? result.model : null,
    usage: { inputTokens: count(result.usage?.inputTokens), outputTokens: count(result.usage?.outputTokens), totalTokens: count(result.usage?.totalTokens) },
    generationId: typeof result.generationId === 'string' && /^[A-Za-z\d:_-]{1,200}$/.test(result.generationId) ? result.generationId : null,
    code: typeof result.code === 'string' && /^[a-z\d_]{1,80}$/.test(result.code) ? result.code : 'generation_unavailable',
    httpStatus: Number.isInteger(result.status) && result.status >= 100 && result.status <= 599 ? result.status : null
  };
}
function finishGenerationMetadata(generation, outcome, status, now) {
  return { status, attemptId: generation?.attemptId ?? null, actor: generation?.actor ?? null,
    startedAt: generation?.startedAt ?? null, completedAt: timestamp(now), ...generationMetadata(outcome) };
}
function generationFallback(entry, outcome, status, now) {
  entry.generation = finishGenerationMetadata(entry.generation, outcome, status, now);
  entry.outbox = [{ key: `${entry.key}-0`, text: GENERATION_NOTICE, status: 'pending' }];
  entry.status = 'prepared';
}
function safeError(error) {
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
  return {
    code: typeof error?.code === 'string' && /^[a-z_]{1,80}$/.test(error.code) ? error.code : 'send_failure',
    status,
    uncertain: error?.uncertain === true || status === null || status >= 500
  };
}

/** Shared-state bridge. Every decision is fenced by the store's distributed CAS. */
export class CloudBridge {
  constructor({ store, config = integrationConfig(), sessionSecret, client, publish,
    now = Date.now, leaseMs = 120_000, advance = advanceWhatsapp, generator = null }) {
    if (!store || typeof store.read !== 'function' || typeof store.transact !== 'function') throw new Error('cloud_store_required');
    if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) throw new Error('session_secret_required');
    if (typeof publish !== 'function' || typeof now !== 'function' || typeof advance !== 'function'
      || !Number.isSafeInteger(leaseMs) || leaseMs < 1
      || (generator !== null && typeof generator?.generate !== 'function')) throw new Error('cloud_configuration_invalid');
    this.store = store; this.config = config; this.sessionSecret = sessionSecret;
    this.client = client; this.publish = publish; this.now = now; this.leaseMs = leaseMs; this.advance = advance;
    this.generator = generator;
  }

  sessionKey(chatId) { return createHmac('sha256', this.sessionSecret).update(chatId).digest('hex'); }
  instanceKey() { return digest(this.config.baseUrl, this.config.owner); }

  entryAllowed(entry) {
    return entry.instanceKey === this.instanceKey()
      && typeof entry.chatId === 'string'
      && normalizeChat(entry.chatId) === entry.chatId
      && this.config.allowed.has(entry.chatId)
      && entry.input?.chatId === entry.chatId;
  }

  blockEntry(entry) {
    let ambiguous = false;
    if (entry.generation?.prepared) {
      const generationAmbiguous = entry.generation.status === 'generating';
      entry.generation = finishGenerationMetadata(entry.generation, { code: 'entry_scope_invalid' },
        generationAmbiguous ? 'uncertain' : 'blocked', this.now());
    }
    for (const out of entry.outbox ?? []) {
      if (out.status === 'sending') {
        out.status = 'uncertain'; out.error = { code: 'entry_scope_invalid', status: null };
      } else if (out.status === 'pending') {
        out.status = 'blocked'; out.error = { code: 'entry_scope_invalid', status: null };
      }
      if (out.status === 'uncertain') ambiguous = true;
    }
    // Only an already-started delivery makes sending ambiguous. A generation
    // may have unknown billing while its still-unsent delivery is blocked.
    entry.status = ambiguous ? 'uncertain' : 'blocked';
    entry.error = { code: 'entry_scope_invalid', status: null };
  }

  async publishAccepted(result, successStatus = 200) {
    if (result.status !== 200) return result;
    if (result.pending) {
      try { await this.publish({ wake: true }); }
      catch { return { status: 503, error: 'queue_publish_failed' }; }
    }
    return { status: successStatus, ...(successStatus === 202 ? { queued: true } : { accepted: true }),
      duplicate: result.duplicate, ...(result.chatId ? { chatId: result.chatId } : {}) };
  }

  async accept(payload, suppliedSecret) {
    if (!this.config.configured) return { status: 503, error: 'integration_not_configured' };
    if (!secretEqual(suppliedSecret, this.config.secret)) return { status: 401, error: 'unauthorized' };
    const normalized = normalizeInbound(payload, this.config);
    if (normalized.rejected) return { status: normalized.status, error: normalized.rejected };
    if (normalized.ignored) return { status: 200, ignored: normalized.ignored };
    const input = normalized.message;
    const key = digest(this.config.owner, input.id);
    const sessionKey = this.sessionKey(input.chatId);
    let result;
    try {
      result = await this.store.transact(value => {
        const state = stateOf(value);
        const existing = state.inbox[key];
        if (existing) {
          if (existing.chatId !== input.chatId) {
            return { value: state, result: { status: 409, error: 'message_identity_conflict' } };
          }
          if (PENDING.has(existing.status) && !this.entryAllowed(existing)) this.blockEntry(existing);
          return { value: state, result: { status: 200, duplicate: true, pending: PENDING.has(existing.status) } };
        }
        if (Object.keys(state.inbox).length >= MAX_EVENTS || state.nextSeq >= Number.MAX_SAFE_INTEGER) {
          return { value: state, result: { status: 503, error: 'inbox_full' } };
        }
        state.inbox[key] = { key, kind: 'message', instanceKey: this.instanceKey(), seq: state.nextSeq++, sessionKey,
          input, chatId: input.chatId, status: 'queued', outbox: [], receivedAt: timestamp(this.now()) };
        return { value: state, result: { status: 200, duplicate: false, pending: true } };
      });
    } catch { return { status: 503, error: 'shared_state_unavailable' }; }
    // A duplicate still pending republishes, repairing a prior commit/publish gap.
    return this.publishAccepted(result);
  }

  async queueTest(chatId) {
    if (!this.config.configured) return { status: 503, error: 'integration_not_configured' };
    if (!this.config.sendEnabled) return { status: 503, error: 'sending_disabled' };
    const target = normalizeChat(chatId);
    if (!target || !this.config.allowed.has(target)) return { status: 403, error: 'test_recipient_not_allowed' };
    const key = digest(this.config.owner, `manual-integration-test\0${target}`);
    let result;
    try {
      result = await this.store.transact(value => {
        const state = stateOf(value);
        const existing = state.inbox[key];
        if (existing) {
          if (PENDING.has(existing.status) && !this.entryAllowed(existing)) this.blockEntry(existing);
          return { value: state, result: { status: 200, duplicate: true,
            pending: PENDING.has(existing.status), chatId: target } };
        }
        if (Object.keys(state.inbox).length >= MAX_EVENTS || state.nextSeq >= Number.MAX_SAFE_INTEGER) {
          return { value: state, result: { status: 503, error: 'inbox_full' } };
        }
        state.inbox[key] = { key, kind: 'manual', instanceKey: this.instanceKey(), seq: state.nextSeq++, sessionKey: this.sessionKey(target),
          chatId: target, input: { id: `manual-${key}`, chatId: target, type: 'text', text: TEST_TEXT },
          status: 'prepared', outbox: [{ key: `${key}-0`, text: TEST_TEXT, status: 'pending' }],
          receivedAt: timestamp(this.now()) };
        return { value: state, result: { status: 200, duplicate: false, pending: true, chatId: target } };
      });
    } catch { return { status: 503, error: 'shared_state_unavailable' }; }
    return this.publishAccepted(result, 202);
  }

  async acquire(actor) {
    return this.store.transact(value => {
      const state = stateOf(value); const now = this.now();
      if (state.worker && state.worker.actor !== actor && state.worker.leaseUntil > now) {
        return { value: state, result: false };
      }
      if (state.worker?.actor !== actor) {
        // No active lease owns these attempts. Never replay an ambiguous send.
        for (const entry of Object.values(state.inbox)) {
          if (entry.generation?.status === 'generating') {
            if (this.entryAllowed(entry)) generationFallback(entry, { code: 'generation_recovered_after_lease' }, 'uncertain', now);
            else this.blockEntry(entry);
          }
          for (const out of entry.outbox ?? []) {
            if (out.status !== 'sending') continue;
            out.status = 'uncertain'; out.error = { code: 'send_recovered_after_lease', status: null };
            entry.status = 'uncertain';
          }
        }
      }
      state.worker = { actor, leaseUntil: now + this.leaseMs };
      return { value: state, result: true };
    });
  }

  async prepareNext(actor) {
    return this.store.transact(value => {
      const state = stateOf(value); const now = this.now();
      if (!owns(state, actor, now)) return { value: state, result: { lost: true } };
      state.worker.leaseUntil = now + this.leaseMs;
      const entry = Object.values(state.inbox).filter(item => PENDING.has(item.status))
        .sort((left, right) => left.seq - right.seq)[0];
      if (!entry) return { value: state, result: { empty: true } };
      if (!this.entryAllowed(entry)) {
        this.blockEntry(entry);
        return { value: state, result: { key: entry.key, terminal: true } };
      }
      if (entry.status === 'queued') {
        try {
          const snapshot = structuredClone(state.sessions[entry.sessionKey] ?? createState());
          // A draft is durable but is not yet visible as learner progress.
          const prepared = this.generator && this.config.sendEnabled && entry.kind === 'message'
            ? prepareGenerativeTurn(snapshot, entry.input) : null;
          if (prepared) {
            if (typeof prepared.then === 'function' || !prepared.draft || !prepared.input || !Array.isArray(prepared.prefixReplies)) throw new Error('invalid_generation_job');
            entry.generation = { status: 'pending', prepared, baseSessionHash: sessionHash(state.sessions[entry.sessionKey]) };
            entry.status = 'needs_generation';
            return { value: state, result: { key: entry.key, generation: true, terminal: false } };
          }
          const advanced = this.advance(snapshot, entry.input, { generativeEnabled: Boolean(this.generator && this.config.sendEnabled) });
          if (!validFlow(advanced)) throw new Error('invalid_flow_result');
          state.sessions[entry.sessionKey] = advanced.state;
          entry.outbox = advanced.replies.map((text, index) => ({ key: `${entry.key}-${index}`, text, status: 'pending' }));
          entry.status = 'prepared';
        } catch {
          entry.status = 'failed'; entry.error = { code: 'flow_failure' };
          return { value: state, result: { key: entry.key, terminal: true } };
        }
      }
      if (entry.status === 'needs_generation' || entry.status === 'generating') {
        return { value: state, result: { key: entry.key, generation: true, terminal: false } };
      }
      if (!this.config.sendEnabled) {
        for (const out of entry.outbox) if (out.status === 'pending') out.status = 'draft';
        entry.status = 'draft';
        return { value: state, result: { key: entry.key, terminal: true } };
      }
      if (entry.outbox.every(out => out.status === 'sent')) {
        entry.status = 'completed'; entry.completedAt = timestamp(now);
        return { value: state, result: { key: entry.key, terminal: true } };
      }
      return { value: state, result: { key: entry.key, terminal: false } };
    });
  }

  async claimGeneration(actor, key, attemptId) {
    return this.store.transact(value => {
      const state = stateOf(value); const now = this.now();
      if (!owns(state, actor, now)) return { value: state, result: { lost: true } };
      const entry = state.inbox[key];
      if (!entry || !PENDING.has(entry.status)) return { value: state, result: { terminal: true } };
      if (!this.entryAllowed(entry)) {
        this.blockEntry(entry);
        return { value: state, result: { terminal: true } };
      }
      if (entry.status === 'prepared') return { value: state, result: { ready: true } };
      const generation = entry.generation;
      if (!generation?.prepared || !['needs_generation', 'generating'].includes(entry.status)) {
        generationFallback(entry, { code: 'generation_job_invalid' }, 'failed', now);
        return { value: state, result: { ready: true } };
      }
      if (generation.baseSessionHash !== sessionHash(state.sessions[entry.sessionKey])) {
        generationFallback(entry, { code: 'generation_session_changed' }, 'failed', now);
        return { value: state, result: { ready: true } };
      }
      if (generation.status === 'generating' && !(generation.actor === actor && generation.attemptId === attemptId)) {
        generationFallback(entry, { code: 'generation_orphaned_attempt' }, 'uncertain', now);
        return { value: state, result: { ready: true } };
      }
      if (!this.generator || !this.config.sendEnabled) {
        generationFallback(entry, { code: 'generation_disabled' }, 'failed', now);
        return { value: state, result: { ready: true } };
      }
      generation.status = 'generating'; generation.attemptId = attemptId; generation.actor = actor;
      generation.startedAt = generation.startedAt ?? timestamp(now);
      entry.status = 'generating';
      state.worker.leaseUntil = now + this.leaseMs;
      return { value: state, result: { input: structuredClone(generation.prepared.input), leaseUntil: state.worker.leaseUntil } };
    });
  }

  async recordGeneration(actor, key, attemptId, outcome) {
    return this.store.transact(value => {
      const state = stateOf(value); const now = this.now();
      if (!owns(state, actor, now)) return { value: state, result: { lost: true } };
      const entry = state.inbox[key]; const generation = entry?.generation;
      if (!generation || generation.attemptId !== attemptId || generation.actor !== actor) return { value: state, result: { lost: true } };
      if (!this.entryAllowed(entry)) {
        this.blockEntry(entry);
        return { value: state, result: { terminal: true } };
      }
      if (generation.status !== 'generating') return { value: state, result: { terminal: !PENDING.has(entry.status), ready: entry.status === 'prepared' } };
      if (generation.baseSessionHash !== sessionHash(state.sessions[entry.sessionKey])) {
        generationFallback(entry, { ...outcome, code: 'generation_session_changed' }, 'failed', now);
      } else if (outcome?.ok !== true) {
        const metadata = generationMetadata(outcome);
        const uncertain = metadata.httpStatus === null || metadata.httpStatus >= 500 || /timeout/.test(metadata.code);
        generationFallback(entry, outcome, uncertain ? 'uncertain' : 'failed', now);
      } else {
        try {
          const finished = finishGenerativeTurn(generation.prepared, { reply: outcome.reply, translation: outcome.translation });
          if (!validFlow(finished)) throw new Error('invalid_generation_result');
          state.sessions[entry.sessionKey] = finished.state;
          entry.outbox = finished.replies.map((text, index) => ({ key: `${entry.key}-${index}`, text, status: 'pending' }));
          entry.generation = finishGenerationMetadata(generation, outcome, 'completed', now);
          entry.status = 'prepared';
        } catch {
          generationFallback(entry, { ...outcome, code: 'generation_invalid_result' }, 'failed', now);
        }
      }
      state.worker.leaseUntil = now + this.leaseMs;
      return { value: state, result: { ready: true } };
    });
  }

  async claimSend(actor, key, attemptId) {
    return this.store.transact(value => {
      const state = stateOf(value); const now = this.now();
      if (!owns(state, actor, now)) return { value: state, result: { lost: true } };
      const entry = state.inbox[key];
      if (!entry || !PENDING.has(entry.status)) return { value: state, result: { terminal: true } };
      if (!this.entryAllowed(entry)) {
        this.blockEntry(entry);
        return { value: state, result: { terminal: true } };
      }
      if (entry.status !== 'prepared') return { value: state, result: { terminal: true } };
      if (!this.config.sendEnabled) {
        for (const out of entry.outbox) if (out.status === 'pending') out.status = 'draft';
        entry.status = 'draft';
        return { value: state, result: { terminal: true } };
      }
      const out = entry.outbox.find(item => item.status !== 'sent');
      if (!out) {
        entry.status = 'completed'; entry.completedAt = timestamp(now);
        return { value: state, result: { terminal: true } };
      }
      // The same mutator may rerun after its successful commit response was lost.
      if (out.status === 'sending' && !(out.attemptId === attemptId && out.actor === actor)) {
        out.status = 'uncertain'; out.error = { code: 'orphaned_send_attempt', status: null };
        entry.status = 'uncertain';
        return { value: state, result: { terminal: true } };
      }
      if (!['pending', 'sending'].includes(out.status)) {
        entry.status = out.status === 'draft' ? 'draft' : out.status === 'failed' ? 'failed' : 'uncertain';
        return { value: state, result: { terminal: true } };
      }
      state.worker.leaseUntil = now + this.leaseMs;
      out.status = 'sending'; out.attemptId = attemptId; out.actor = actor;
      out.startedAt = out.startedAt ?? timestamp(now);
      return { value: state, result: { outKey: out.key, text: out.text, chatId: entry.chatId,
        replyId: entry.kind === 'message' ? entry.input.id : null, leaseUntil: state.worker.leaseUntil } };
    });
  }

  async recordSend(actor, key, outKey, attemptId, outcome) {
    return this.store.transact(value => {
      const state = stateOf(value); const now = this.now();
      if (!owns(state, actor, now)) return { value: state, result: { lost: true } };
      const entry = state.inbox[key]; const out = entry?.outbox.find(item => item.key === outKey);
      if (!out || out.attemptId !== attemptId || out.actor !== actor) return { value: state, result: { lost: true } };
      if (out.status === 'sending') {
        out.status = outcome.status;
        if (outcome.providerId) { out.providerId = outcome.providerId; out.sentAt = timestamp(now); }
        if (outcome.error) out.error = outcome.error;
      }
      if (out.status !== 'sent') entry.status = out.status === 'failed' ? 'failed' : 'uncertain';
      else if (entry.outbox.every(item => item.status === 'sent')) {
        entry.status = 'completed'; entry.completedAt = timestamp(now);
      }
      state.worker.leaseUntil = now + this.leaseMs;
      return { value: state, result: { terminal: !PENDING.has(entry.status) } };
    });
  }

  async release(actor) {
    await this.store.transact(value => {
      const state = stateOf(value);
      if (state.worker?.actor === actor) {
        state.worker = null;
        state.lastWorkerRunAt = timestamp(this.now());
      }
      return { value: state, result: undefined };
    });
  }

  async drain() {
    if (!this.config.configured) return { pending: true, error: 'integration_not_configured', processed: 0 };
    const actor = randomUUID(); const started = this.now();
    if (!await this.acquire(actor)) return { pending: true, busy: true, processed: 0 };
    let processed = 0; let fenced = false;
    const hasTime = () => this.now() - started < DRAIN_MS;
    try {
      while (processed < DRAIN_EVENTS && hasTime()) {
        const next = await this.prepareNext(actor);
        if (next.lost) { fenced = true; break; }
        if (next.empty) break;
        if (next.terminal) { processed++; continue; }
        if (next.generation) {
          // Leave enough time for the generator's 15s deadline and provider send.
          if (this.now() - started >= GENERATION_START_MS) break;
          const attemptId = randomUUID();
          const generation = await this.claimGeneration(actor, next.key, attemptId);
          if (generation.lost) { fenced = true; break; }
          if (generation.terminal) { processed++; continue; }
          if (generation.input) {
            if (this.now() >= generation.leaseUntil) { fenced = true; break; }
            let outcome;
            try { outcome = await this.generator.generate(generation.input); }
            catch { outcome = { ok: false, code: 'generation_unavailable' }; }
            const recorded = await this.recordGeneration(actor, next.key, attemptId, outcome);
            if (recorded.lost) { fenced = true; break; }
            if (recorded.terminal) { processed++; continue; }
          }
        }
        while (hasTime()) {
          const attemptId = randomUUID();
          const outgoing = await this.claimSend(actor, next.key, attemptId);
          if (outgoing.lost) { fenced = true; break; }
          if (outgoing.terminal) { processed++; break; }
          if (this.now() >= outgoing.leaseUntil) { fenced = true; break; }
          let outcome;
          try {
            const client = this.client ?? new UazapiClient({ baseUrl: this.config.baseUrl, token: this.config.token });
            const sent = await client.sendText({ chatId: outgoing.chatId, text: outgoing.text,
              trackId: outgoing.outKey, ...(outgoing.replyId ? { replyId: outgoing.replyId } : {}) });
            if (typeof sent?.providerId !== 'string' || !sent.providerId || sent.providerId.length > 1000) {
              const error = new Error('missing_provider_message_id'); error.code = 'missing_provider_message_id'; error.uncertain = true; throw error;
            }
            outcome = { status: 'sent', providerId: sent.providerId };
          } catch (error) {
            const safe = safeError(error);
            outcome = { status: safe.uncertain ? 'uncertain' : 'failed', error: { code: safe.code, status: safe.status } };
          }
          const recorded = await this.recordSend(actor, next.key, outgoing.outKey, attemptId, outcome);
          if (recorded.lost) { fenced = true; break; }
          if (recorded.terminal) { processed++; break; }
        }
        if (fenced || !hasTime()) break;
      }
      const snapshot = stateOf((await this.store.read()).value);
      return { pending: fenced || pending(snapshot), processed, ...(fenced ? { fenced: true } : {}) };
    } finally {
      await this.release(actor);
    }
  }
}
