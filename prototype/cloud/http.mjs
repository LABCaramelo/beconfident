export function json(res, status, value) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.statusCode = status;
  res.end(JSON.stringify(value));
}

export async function body(req, maxBytes = 256 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw Object.assign(new Error('json_required'), { status: 415 });
  if (Number(req.headers['content-length']) > maxBytes) throw Object.assign(new Error('body_too_large'), { status: 413 });
  let value = req.body;
  if (value !== undefined) {
    if (Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value)) > maxBytes) throw Object.assign(new Error('body_too_large'), { status: 413 });
    return typeof value === 'string' ? JSON.parse(value) : value;
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > maxBytes) throw Object.assign(new Error('body_too_large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
