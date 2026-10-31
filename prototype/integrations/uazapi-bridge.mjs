import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createState } from '../engine.mjs';
import { advanceWhatsapp } from './whatsapp-flow.mjs';
import { normalizeInbound, secretEqual } from './uazapi.mjs';

export class UazapiBridge {
  constructor({ directory, config, client, advance = advanceWhatsapp }) {
    this.directory = directory; this.config = config; this.client = client; this.advance = advance;
    this.file = path.join(directory, 'bridge.json'); this.db = { version: 1, sessions: {}, inbox: {} };
    this.chain = Promise.resolve(); this.running = null; this.closed = false;
    this.ready = this.initialize();
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try { this.db = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    let changed = false;
    for (const e of Object.values(this.db.inbox)) {
      for (const out of e.outgoing ?? []) if (out.state === 'sending') { out.state = 'uncertain'; e.status = 'uncertain'; changed = true; }
    }
    if (changed) await this.persist();
  }
  async persist() {
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.db, null, 2)); await rename(tmp, this.file);
  }
  async locked(fn) {
    const operation = this.chain.catch(() => {}).then(async () => { await this.ready; return fn(); });
    this.chain = operation; return operation;
  }
  publicStatus() {
    const entries = Object.values(this.db.inbox);
    const counts = {};
    for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
    return { provider: 'uazapi', configured: this.config.configured, mode: !this.config.configured ? 'disabled' : this.config.sendEnabled ? 'live' : 'dry-run', missing: this.config.missing, allowedContacts: this.config.allowed.size, queue: counts };
  }
  async accept(payload, suppliedSecret) {
    if (!this.config.configured) return { status: 503, body: { error: 'integration_not_configured' } };
    if (!secretEqual(suppliedSecret, this.config.secret)) return { status: 401, body: { error: 'unauthorized' } };
    const normalized = normalizeInbound(payload, this.config);
    if (normalized.rejected) return { status: normalized.status, body: { error: normalized.rejected } };
    if (normalized.ignored) return { status: 200, body: { accepted: true, ignored: normalized.ignored } };
    const message = normalized.message;
    const key = createHash('sha256').update(`${this.config.owner}\0${message.id}`).digest('hex');
    const result = await this.locked(async () => {
      if (this.db.inbox[key]) return { status: 200, body: { accepted: true, duplicate: true } };
      const pending = Object.values(this.db.inbox).filter(e => ['queued', 'prepared'].includes(e.status)).length;
      if (pending >= 500) return { status: 503, body: { error: 'queue_full' } };
      // Somente a projeção normalizada é persistida: sem token, BaseUrl ou corpo bruto.
      this.db.inbox[key] = { key, message, status: 'queued', receivedAt: new Date().toISOString(), outgoing: [] };
      try { await this.persist(); }
      catch (error) { delete this.db.inbox[key]; throw error; }
      return { status: 200, body: { accepted: true } };
    });
    return result;
  }
  drain() {
    if (this.running) return this.running;
    this.running = this.work().finally(() => { this.running = null; });
    return this.running;
  }
  async work() {
    await this.ready;
    if (!this.config.configured || this.closed) return;
    for (;;) {
      if (this.closed) return;
      const entry = await this.locked(async () => {
        const e = Object.values(this.db.inbox).find(x => ['queued', 'prepared'].includes(x.status));
        if (!e) return null;
        if (e.status === 'queued') {
          const contactKey = createHmac('sha256', this.config.secret).update(e.message.chatId).digest('hex');
          const state = structuredClone(this.db.sessions[contactKey] ?? createState());
          try {
            const advanced = await this.advance(state, e.message);
            if (!advanced?.state || !Array.isArray(advanced.replies) || advanced.replies.some(t => typeof t !== 'string' || !t.trim() || t.length > 8000)) throw new Error('invalid_flow_result');
            this.db.sessions[contactKey] = advanced.state;
            e.outgoing = advanced.replies.map((text, index) => ({ key: `${e.key}-${index}`, text, state: 'pending' }));
            e.status = 'prepared';
          } catch {
            e.status = 'failed'; e.error = { code: 'flow_failure' };
          }
          await this.persist();
        }
        if (!this.config.sendEnabled && e.status === 'prepared') { e.status = 'draft'; await this.persist(); }
        return e;
      });
      if (!entry) return;
      if (entry.status !== 'prepared') continue;
      let failed = false;
      for (const out of entry.outgoing) {
        if (out.state === 'sent') continue;
        if (out.state !== 'pending') { failed = true; break; }
        await this.locked(async () => { out.state = 'sending'; out.startedAt = new Date().toISOString(); await this.persist(); });
        try {
          const result = await this.client.sendText({ chatId: entry.message.chatId, text: out.text, trackId: out.key, replyId: entry.message.id });
          await this.locked(async () => { out.state = 'sent'; out.providerId = result.providerId; out.sentAt = new Date().toISOString(); await this.persist(); });
        } catch (error) {
          await this.locked(async () => {
            out.state = error.uncertain ? 'uncertain' : 'failed';
            out.error = { code: typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'send_failure', status: error.status ?? null };
            entry.status = out.state; await this.persist();
          });
          failed = true; break;
        }
      }
      if (!failed) await this.locked(async () => { entry.status = 'completed'; entry.completedAt = new Date().toISOString(); await this.persist(); });
    }
  }
  async close() { this.closed = true; await this.running; await this.chain; }
}
