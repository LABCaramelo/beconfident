const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function serialize(value, maxBytes) {
  let body;
  try {
    body = JSON.stringify(value, function (_key, item) {
      if (['bigint', 'function', 'symbol'].includes(typeof item)
        || (typeof item === 'number' && !Number.isFinite(item))
        || (item === undefined && Array.isArray(this))) throw failure('blob_state_not_json');
      if (item && typeof item === 'object' && !Array.isArray(item)
        && Object.getPrototypeOf(item) !== Object.prototype
        && Object.getPrototypeOf(item) !== null) throw failure('blob_state_not_json');
      // Optional undefined object fields follow ordinary JSON semantics, as in the engine.
      return item;
    });
  } catch {
    throw failure('blob_state_not_json');
  }
  if (typeof body !== 'string') throw failure('blob_state_not_json');
  if (Buffer.byteLength(body, 'utf8') > maxBytes) throw failure('blob_state_too_large');
  return body;
}

async function streamBody(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw failure('blob_read_invalid');
      length += value.byteLength;
      if (length > maxBytes) {
        try { await reader.cancel(); } catch { /* preserve the size failure */ }
        throw failure('blob_state_too_large');
      }
      chunks.push(value);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
    } catch {
      throw failure('blob_state_not_json');
    }
  } finally {
    reader.releaseLock();
  }
}

function expectedConflict(error, sdk, creating) {
  if (typeof sdk.BlobPreconditionFailedError === 'function'
    && error instanceof sdk.BlobPreconditionFailedError) return true;

  // The official SDK has no BlobAlreadyExistsError: bad_request maps to BlobError.
  // Recognize only an explicit existing-file response during create-if-absent.
  // Access/rate-limit/network errors and generic failures must propagate unchanged.
  return creating
    && typeof sdk.BlobError === 'function'
    && error instanceof sdk.BlobError
    && error.constructor === sdk.BlobError
    && /\b(?:blob|file) already exists\b/i.test(error.message);
}

/**
 * A private JSON aggregate with optimistic concurrency, not a worker or queue.
 *
 * SDK contract: get() supplies the stream and blob.etag in ONE response;
 * useCache:false reads the latest version. Identity encoding avoids a weak ETag
 * for a compressed delivery representation; weak validators are never used for
 * CAS or stripped to manufacture a strong validator. put() overwrites with
 * ifMatch, or creates with allowOverwrite:false and addRandomSuffix:false.
 * https://vercel.com/docs/vercel-blob/using-blob-sdk
 * Error classes: https://github.com/vercel/storage/blob/main/packages/blob/src/api.ts
 *
 * transact(callback) may rerun callback. It MUST be synchronous and side-effect
 * free: mutate only the provided value, and never send messages inside it.
 * No state snapshot or in-process lock is used as a source of truth.
 */
export class BlobCasStore {
  constructor({ sdk, pathname = 'confident/state-v1.json', maxAttempts = 8,
    initial = () => ({}), maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (typeof pathname !== 'string' || !pathname || pathname.length > 950
      || pathname.startsWith('/') || pathname.endsWith('/') || pathname.includes('//')
      || pathname.split('/').some(part => part === '..' || part === '.')
      || /[?#\\\u0000-\u001f]/.test(pathname)) throw failure('blob_pathname_invalid');
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 50) throw failure('blob_attempts_invalid');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw failure('blob_size_limit_invalid');
    if (typeof initial !== 'function') throw failure('blob_initial_invalid');
    this.pathname = pathname;
    this.maxAttempts = maxAttempts;
    this.maxBytes = maxBytes;
    this.initial = initial;
    this.sdk = sdk;
  }

  async getSdk() {
    // Lazy import permits offline tests with an injected SDK, without installing it.
    // Caching the SDK module is safe; the aggregate itself is NEVER cached here.
    const sdk = this.sdk ?? await import('@vercel/blob');
    if (typeof sdk.get !== 'function' || typeof sdk.put !== 'function') throw failure('blob_sdk_invalid');
    return sdk;
  }

  async read() {
    return this.readWithSdk(await this.getSdk());
  }

  async readWithSdk(sdk) {
    const response = await sdk.get(this.pathname, {
      access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' }
    });
    if (response === null) {
      const initial = this.initial();
      if (initial && typeof initial.then === 'function') throw failure('blob_initial_invalid');
      // Never expose a shared factory object to an uncommitted mutator.
      return { value: JSON.parse(serialize(initial, this.maxBytes)), etag: null };
    }
    if (response?.statusCode !== 200 || !response.stream
      || typeof response.stream.getReader !== 'function'
      || typeof response.blob?.etag !== 'string' || !response.blob.etag) throw failure('blob_read_invalid');

    if (/^\s*W\//i.test(response.blob.etag)) {
      try { await response.stream.cancel(); } catch { /* preserve the validator failure */ }
      throw failure('blob_strong_etag_required');
    }

    const size = response.blob.size;
    if (size !== undefined && size !== null && (!Number.isSafeInteger(size) || size < 0)) throw failure('blob_read_invalid');
    if (size > this.maxBytes) {
      try { await response.stream.cancel(); } catch { /* preserve the size failure */ }
      throw failure('blob_state_too_large');
    }
    const body = await streamBody(response.stream, this.maxBytes);
    let value;
    try { value = JSON.parse(body); }
    catch { throw failure('blob_state_not_json'); }
    return { value, etag: response.blob.etag };
  }

  async transact(mutatorSync) {
    if (typeof mutatorSync !== 'function' || mutatorSync.constructor?.name === 'AsyncFunction') {
      throw failure('blob_mutator_must_be_sync');
    }
    const sdk = await this.getSdk();
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const { value, etag } = await this.readWithSdk(sdk);
      const next = mutatorSync(value);
      if (next && typeof next.then === 'function') throw failure('blob_mutator_must_be_sync');
      if (!next || typeof next !== 'object' || !Object.hasOwn(next, 'value')) throw failure('blob_mutator_invalid');
      const body = serialize(next.value, this.maxBytes);
      try {
        await sdk.put(this.pathname, body, {
          access: 'private', addRandomSuffix: false, contentType: 'application/json',
          cacheControlMaxAge: 60,
          allowOverwrite: etag !== null,
          ...(etag !== null ? { ifMatch: etag } : {})
        });
        return next.result;
      } catch (error) {
        if (!expectedConflict(error, sdk, etag === null)) throw error;
      }
      // A conflict always re-reads BOTH the current body and its ETag, then reruns
      // the pure mutator. Never retry the stale serialized body with a fresh ETag.
    }
    throw failure('blob_cas_exhausted');
  }
}
