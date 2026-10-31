import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobCasStore } from './blob-store.mjs';

class BlobError extends Error {}
class BlobPreconditionFailedError extends BlobError {}
class BlobAccessError extends BlobError {}

function mockSdk(initial) {
  let body = initial === undefined ? null : JSON.stringify(initial);
  let version = body === null ? 0 : 1;
  const gets = [];
  const puts = [];
  const sdk = {
    BlobError, BlobPreconditionFailedError, BlobAccessError, gets, puts,
    get value() { return body === null ? undefined : JSON.parse(body); },
    replace(value) { body = JSON.stringify(value); version++; },
    async get(pathname, options) {
      gets.push({ pathname, options });
      if (body === null) return null;
      // Capture bytes AND ETag before any async consumer can change the object.
      const capturedBody = body;
      const etag = `"v${version}"`;
      return { statusCode: 200, stream: new Response(capturedBody).body,
        blob: { etag, size: Buffer.byteLength(capturedBody) } };
    },
    async put(pathname, nextBody, options) {
      puts.push({ pathname, body: nextBody, options });
      if (!options.allowOverwrite && body !== null) throw new BlobError('Vercel Blob: This blob already exists. Use allowOverwrite: true.');
      if (options.ifMatch && options.ifMatch !== `"v${version}"`) throw new BlobPreconditionFailedError('ETag mismatch');
      body = nextBody;
      version++;
      return { pathname, etag: `"v${version}"` };
    }
  };
  return sdk;
}

const increment = value => {
  value.counter++;
  return { value, result: value.counter };
};

test('missing reads use a fresh initial factory and create private fixed-path state', async () => {
  const shared = { counter: 0, nested: { untouched: true } };
  const sdk = mockSdk();
  const store = new BlobCasStore({ sdk, initial: () => shared });
  const first = await store.read();
  assert.equal(first.etag, null);
  first.value.nested.untouched = false;
  assert.deepEqual(await store.read(), { value: shared, etag: null });
  assert.equal(await store.transact(increment), 1);
  assert.equal(shared.counter, 0);
  assert.equal(sdk.value.counter, 1);
  assert.deepEqual(sdk.puts[0].options, {
    access: 'private', addRandomSuffix: false, contentType: 'application/json',
    cacheControlMaxAge: 60, allowOverwrite: false
  });
  for (const call of sdk.gets) assert.deepEqual(call.options, {
    access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' }
  });
});

test('read obtains body and ETag from one get; later reads never use a stale snapshot', async () => {
  const sdk = mockSdk({ counter: 3 });
  const store = new BlobCasStore({ sdk });
  assert.deepEqual(await store.read(), { value: { counter: 3 }, etag: '"v1"' });
  sdk.replace({ counter: 8 });
  assert.deepEqual(await store.read(), { value: { counter: 8 }, etag: '"v2"' });
  assert.equal(await store.transact(increment), 9);
  assert.equal(sdk.puts.at(-1).options.ifMatch, '"v2"');
  assert.equal(sdk.puts.at(-1).options.allowOverwrite, true);
  assert.equal(sdk.gets.length, 3);
});

test('independent concurrent stores preserve every update through CAS retries', async () => {
  const sdk = mockSdk({ counter: 0 });
  const stores = Array.from({ length: 12 }, () => new BlobCasStore({ sdk, maxAttempts: 30 }));
  const results = await Promise.all(stores.map(store => store.transact(increment)));
  assert.equal(sdk.value.counter, 12);
  assert.deepEqual(results.sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 1));
  assert.ok(sdk.puts.length > 12, 'the test actually exercised overlapping snapshots');
  assert.ok(sdk.puts.every(call => call.options.ifMatch && call.options.allowOverwrite));
});

test('concurrent create plain BlobError re-reads the winner instead of overwriting it', async () => {
  const sdk = mockSdk();
  const put = sdk.put;
  let first = true;
  sdk.put = async (...args) => {
    if (first) { first = false; sdk.replace({ counter: 40 }); }
    return put(...args);
  };
  const seen = [];
  const store = new BlobCasStore({ sdk, initial: () => ({ counter: 0 }) });
  const result = await store.transact(value => { seen.push(value.counter); return increment(value); });
  assert.deepEqual(seen, [0, 40]);
  assert.equal(result, 41);
  assert.equal(sdk.value.counter, 41);
  assert.equal(sdk.puts[0].options.allowOverwrite, false);
  assert.equal(sdk.puts[1].options.ifMatch, '"v1"');
});

test('ETag conflict recomputes callback and returns only the committed result', async () => {
  const sdk = mockSdk({ counter: 2 });
  const put = sdk.put;
  let first = true;
  sdk.put = async (...args) => {
    if (first) { first = false; sdk.replace({ counter: 90 }); }
    return put(...args);
  };
  const inputs = [];
  const store = new BlobCasStore({ sdk });
  const result = await store.transact(value => { inputs.push(value.counter); return increment(value); });
  assert.deepEqual(inputs, [2, 90]);
  assert.equal(result, 91);
  assert.equal(sdk.value.counter, 91);
});

test('genuine read/write failures propagate once and are never treated as conflicts', async () => {
  for (const error of [new BlobAccessError('denied'), new TypeError('network unavailable'), new BlobError('bad content type')]) {
    const sdk = mockSdk();
    let attempts = 0;
    sdk.put = async () => { attempts++; throw error; };
    const store = new BlobCasStore({ sdk, initial: () => ({ counter: 0 }) });
    await assert.rejects(store.transact(increment), actual => actual === error);
    assert.equal(attempts, 1);
  }
  const error = new BlobError('This blob already exists');
  const sdk = mockSdk({ counter: 0 });
  sdk.put = async () => { throw error; };
  await assert.rejects(new BlobCasStore({ sdk }).transact(increment), actual => actual === error);
  assert.equal(sdk.gets.length, 1, 'already-exists is retryable only while creating');
  sdk.get = async () => { throw error; };
  await assert.rejects(new BlobCasStore({ sdk }).read(), actual => actual === error);
});

test('conflict attempts are bounded and asynchronous/invalid mutators cannot write', async () => {
  const sdk = mockSdk({ counter: 0 });
  let writes = 0;
  sdk.put = async () => { writes++; throw new BlobPreconditionFailedError('conflict'); };
  const store = new BlobCasStore({ sdk, maxAttempts: 3 });
  await assert.rejects(store.transact(increment), { code: 'blob_cas_exhausted' });
  assert.equal(writes, 3);
  assert.equal(sdk.value.counter, 0);
  let asyncCalled = false;
  await assert.rejects(store.transact(async () => { asyncCalled = true; }), { code: 'blob_mutator_must_be_sync' });
  assert.equal(asyncCalled, false);
  await assert.rejects(store.transact(() => Promise.resolve({ value: {} })), { code: 'blob_mutator_must_be_sync' });
  await assert.rejects(store.transact(() => ({ result: 'missing value' })), { code: 'blob_mutator_invalid' });
  assert.equal(writes, 3);
});

test('byte limits, corrupt JSON and unexpected read shapes fail safely before writes', async () => {
  const sdk = mockSdk({ counter: 0 });
  const store = new BlobCasStore({ sdk, maxBytes: 32 });
  await assert.rejects(store.transact(() => ({ value: { text: '🙂'.repeat(10) } })), { code: 'blob_state_too_large' });
  await assert.rejects(store.transact(() => ({ value: { data: new Map([['counter', 2]]) } })), { code: 'blob_state_not_json' });
  const circular = {}; circular.self = circular;
  await assert.rejects(store.transact(() => ({ value: circular })), { code: 'blob_state_not_json' });
  assert.equal(sdk.puts.length, 0);
  sdk.get = async () => ({ statusCode: 200, blob: { etag: '"v1"', size: 1000 }, stream: new Response('{}').body });
  await assert.rejects(store.read(), { code: 'blob_state_too_large' });
  sdk.get = async () => ({ statusCode: 200, blob: { etag: '"v1"', size: null }, stream: new Response('x'.repeat(33)).body });
  await assert.rejects(store.read(), { code: 'blob_state_too_large' });
  sdk.get = async () => ({ statusCode: 200, blob: { etag: '"v1"' }, stream: new Response('not json').body });
  await assert.rejects(store.read(), { code: 'blob_state_not_json' });
  sdk.get = async () => ({ statusCode: 304, blob: { etag: '"v1"' }, stream: null });
  await assert.rejects(store.read(), { code: 'blob_read_invalid' });
  assert.equal(sdk.puts.length, 0);
});

test('compressed weak ETag fails closed even if identity encoding is ignored', async () => {
  const sdk = mockSdk({ counter: 1 });
  let cancelled = 0;
  sdk.get = async (_pathname, options) => {
    assert.deepEqual(options, {
      access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' }
    });
    return { statusCode: 200, blob: { etag: 'W/"same-object-hash"', size: 13 },
      stream: new ReadableStream({ cancel() { cancelled++; } }) };
  };
  const store = new BlobCasStore({ sdk });
  let mutations = 0;
  await assert.rejects(store.transact(value => { mutations++; return increment(value); }), {
    code: 'blob_strong_etag_required'
  });
  assert.equal(mutations, 0);
  assert.equal(sdk.puts.length, 0, 'never strip W/ and attempt an invalid CAS');
  assert.equal(cancelled, 1);
});
