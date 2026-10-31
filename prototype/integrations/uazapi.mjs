import { timingSafeEqual } from 'node:crypto';

export function secretEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function normalizeChat(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^\d{5,30}@lid$/.test(v)) return v;
  if (/^\d{10,15}@s\.whatsapp\.net$/.test(v)) return v;
  if (!/^[+\d\s()-]+$/.test(v)) return null;
  const digits = v.replace(/\D/g, '');
  return /^\d{10,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
}
export function integrationConfig(env = process.env) {
  let baseUrl = null;
  try {
    const u = new URL(env.UAZAPI_BASE_URL);
    if (u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash) baseUrl = u.href.replace(/\/$/, '');
  } catch {}
  const token = env.UAZAPI_INSTANCE_TOKEN?.trim() ?? '';
  const secret = env.UAZAPI_WEBHOOK_SECRET?.trim() ?? '';
  const owner = normalizeChat(env.UAZAPI_OWNER_NUMBER ?? '')?.replace('@s.whatsapp.net', '') ?? '';
  const allowed = new Set((env.UAZAPI_ALLOWED_CHATS ?? '').split(',').map(normalizeChat).filter(Boolean));
  const missing = [];
  if (!baseUrl) missing.push('UAZAPI_BASE_URL');
  if (!token || /[\r\n]/.test(token)) missing.push('UAZAPI_INSTANCE_TOKEN');
  if (!/^\d{10,15}$/.test(owner)) missing.push('UAZAPI_OWNER_NUMBER');
  if (secret.length < 32) missing.push('UAZAPI_WEBHOOK_SECRET');
  if (!allowed.size) missing.push('UAZAPI_ALLOWED_CHATS');
  return { baseUrl, token, secret, owner, allowed, missing, configured: missing.length === 0, sendEnabled: env.UAZAPI_SEND_ENABLED === 'true' };
}
export class UazapiError extends Error {
  constructor(code, status = null, uncertain = false) { super(code); this.name = 'UazapiError'; this.code = code; this.status = status; this.uncertain = uncertain; }
}
export class UazapiClient {
  constructor({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15000 }) {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new UazapiError('invalid_base_url');
    if (!token || /[\r\n]/.test(token)) throw new UazapiError('missing_instance_token');
    this.baseUrl = u.href.replace(/\/$/, ''); this.token = token; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async request(method, endpoint, payload, sending = false) {
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + endpoint, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs),
        headers: { token: this.token, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {})
      });
    } catch { throw new UazapiError('transport_failure', null, sending); }
    // Nunca repassar corpo de erro do prestador: pode conter dados de mensagem ou credenciais.
    if (!response.ok) throw new UazapiError('provider_rejected', response.status, sending && response.status >= 500);
    let result;
    try { result = await response.json(); } catch { throw new UazapiError('invalid_provider_response', response.status, sending); }
    return result;
  }
  getStatus() { return this.request('GET', '/instance/status'); }
  async getWebhooks() {
    const value = await this.request('GET', '/webhook');
    if (Array.isArray(value) && value.every(item => item && typeof item === 'object' && !Array.isArray(item))) return value;
    // This server returns null when no webhook exists; the public schema uses [].
    // Accept only that observed empty case, never an unknown/error envelope.
    if (value === null) return [];
    throw new UazapiError('unexpected_webhook_shape', 200);
  }
  addWebhook(payload) { return this.request('POST', '/webhook', { ...payload, action: 'add' }); }
  async sendText({ chatId, text, trackId, replyId }) {
    const target = normalizeChat(chatId);
    if (!target || typeof text !== 'string' || !text.trim() || text.length > 8000) throw new UazapiError('invalid_outgoing_message');
    const data = await this.request('POST', '/send/text', {
      number: target, text, track_source: 'confident-lab', track_id: trackId,
      ...(replyId ? { replyid: replyId } : {}), async: false, linkPreview: false
    }, true);
    // Contrato: a Message é retornada na raiz. track_id NÃO é chave idempotente do prestador.
    const providerId = typeof data?.messageid === 'string' ? data.messageid : typeof data?.id === 'string' ? data.id : null;
    if (!providerId) throw new UazapiError('missing_provider_message_id', 200, true);
    return { providerId };
  }
}
export function normalizeInbound(payload, config) {
  if (!payload || typeof payload !== 'object' || !secretEqual(payload.token, config.token)) return { rejected: 'unauthorized', status: 401 };
  if (String(payload.owner ?? '') !== config.owner) return { rejected: 'wrong_instance', status: 403 };
  if (payload.EventType !== 'messages') return { ignored: 'other_event' };
  const m = payload.message;
  if (!m || typeof m !== 'object') return { rejected: 'invalid_message', status: 400 };
  // Ausência de fromMe não comprova que é uma mensagem recebida.
  if (m.fromMe !== false || m.wasSentByApi === true || m.isGroup === true) return { ignored: 'own_or_group_message' };
  const chatId = normalizeChat(m.chatid);
  if (!chatId) return { ignored: 'unsupported_chat' };
  if (!config.allowed.has(chatId)) return { ignored: 'not_in_test_allowlist' };
  const id = typeof m.messageid === 'string' && m.messageid ? m.messageid : typeof m.id === 'string' && m.id ? m.id : null;
  if (!id || id.length > 400) return { rejected: 'missing_message_id', status: 400 };
  const kind = String(m.messageType ?? '').toLowerCase();
  const type = ['conversation', 'text', 'extendedtextmessage', 'extendedtext'].includes(kind) ? 'text' : /audio|ptt|voice/.test(kind) ? 'audio' : 'unsupported';
  const text = typeof m.text === 'string' ? m.text : '';
  return { message: { id, chatId, text: text.slice(0, 10000), name: typeof m.senderName === 'string' ? m.senderName.slice(0, 100) : '', type } };
}
