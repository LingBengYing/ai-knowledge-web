import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { startDevServer } from '../scripts/dev-server.mjs';
import { startExternalServer } from '../scripts/external-server.mjs';

const publicOrigin = 'https://knowledge.example.invalid';
const cookie = 'rag_session=fixture';
async function fixture(t, external, handler, settings = {}) {
  const backend = http.createServer((req, res) => {
    if (external && req.url === '/health/entry-policy') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ enabled: true, public_origin: publicOrigin, auth_mode: 'jwt' }));
    } else if (external && req.url === '/v1/config') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ auth_mode: 'jwt', capabilities: [] }));
    } else if (external && req.url === '/v1/session') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = req.headers.cookie === cookie ? 200 : 401;
      res.end(JSON.stringify({ status: res.statusCode === 200 ? 'authenticated' : 'unauthenticated' }));
    } else handler(req, res);
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => new Promise(r => { backend.close(r); backend.closeAllConnections(); }));
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
  const server = await (external ? startExternalServer({ publicOrigin, backendOrigin, port: 0, ...settings })
    : startDevServer({ backendOrigin, port: 0, ...settings }));
  t.after(() => new Promise(r => { server.close(r); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { backendOrigin, request: (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request(origin, { path, method, headers: {
      ...(external ? { Host: new URL(publicOrigin).host, Cookie: cookie } : {}),
      ...(!['GET', 'HEAD'].includes(method) ? { Origin: external ? publicOrigin : origin } : {}), ...headers,
      ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }),
    } }, res => { const chunks = []; res.on('data', x => chunks.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })); });
    req.on('error', reject); req.end(body);
  }) };
}


for (const external of [false, true]) {
  const name = external ? 'external' : 'development';
  test(`${name} video reference route preserves complete JSON beyond ordinary limit and keeps original answers bounded`, async t => {
    const seen = [];
    const { request } = await fixture(t, external, (req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      seen.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }); res.setHeader('Content-Type', 'application/json'); res.end('{}');
    }); }, { requestBytes: 32, attachmentBytes: 512 });
    const body = JSON.stringify({ question: '原问题完整尾部', mode: 'JOINT', document_ids: ['one', 'missing'], attachments: [{ filename: 'query.mp4', media_type: 'video/mp4', content_base64: 'AAEC/w==' }] });
    const headers = { 'Content-Type': 'application/json', 'X-Filename': 'must-not-forward.mp4' };
    const response = await request('/v1/video-av-query-answers', { method: 'POST', headers, body });
    assert.equal(response.status, 200); assert.match(response.headers['cache-control'], /no-store/u);
    assert.equal(seen.length, 1); assert.equal(seen[0].path, '/v1/video-av-query-answers'); assert.equal(seen[0].body, body);
    assert.equal(seen[0].headers['x-filename'], undefined); assert.equal(seen[0].headers['content-type'], 'application/json');
    assert.equal((await request('/v1/video-av-answers', { method: 'POST', headers, body })).status, 413);
    assert.equal((await request('/v1/video-av-query-answers', { method: 'POST', headers, body: 'x'.repeat(513) })).status, 413);
    assert.equal(seen.length, 1);
  });

  test(`${name} video reference route denies alternate path, method, query and untrusted headers before upstream`, async t => {
    let calls = 0; const { request } = await fixture(t, external, (_req, res) => { calls++; res.end('{}'); });
    const options = { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } };
    for (const path of ['/v1/video-av-query-answers/more', '/v1/video-av-query-answers/', '/v1/%76ideo-av-query-answers']) assert.equal((await request(path, options)).status, 404);
    for (const suffix of ['?', '?x=1']) assert.equal((await request('/v1/video-av-query-answers' + suffix, options)).status, 400);
    for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request('/v1/video-av-query-answers', { ...options, method })).status, 405);
    assert.equal((await request('/v1/video-av-query-answers', { ...options, headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await request('/v1/video-av-query-answers', { ...options, headers: { ...options.headers, Origin: 'https://other.invalid' } })).status, 403);
    assert.equal((await request('/v1/video-av-query-answers', { ...options, headers: { ...options.headers, Authorization: 'Bearer synthetic' } })).status, 400);
    assert.equal(calls, 0);
  });

  test(`${name} video reference route uses answer deadline and preserves response budget`, async t => {
    const { request } = await fixture(t, external, (req, res) => { req.resume(); req.on('end', () => setTimeout(() => {
      res.setHeader('Content-Type', 'application/json'); res.end('{}');
    }, 70)); }, { deadlineMs: 20, answerDeadlineMs: 1000 });
    assert.equal((await request('/v1/video-av-query-answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    const small = await fixture(t, external, (req, res) => { req.resume(); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end('x'.repeat(65)); }); }, { responseBytes: 64 });
    assert.equal((await small.request('/v1/video-av-query-answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 502);
  });

  test(`${name} video reference route shares the two-attachment admission and releases it after completion`, async t => {
    const waiting = []; let two; const ready = new Promise(resolve => { two = resolve; });
    const { request } = await fixture(t, external, (req, res) => { req.resume(); req.on('end', () => { waiting.push(res); if (waiting.length === 2) two(); if (waiting.length > 2) { res.setHeader('Content-Type', 'application/json'); res.end('{}'); } }); });
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    const first = request('/v1/video-av-query-answers', options), second = request('/v1/attachment-answers', options); await ready;
    assert.equal((await request('/v1/video-av-query-answers', options)).status, 429); assert.equal(waiting.length, 2);
    for (const response of waiting) { response.setHeader('Content-Type', 'application/json'); response.end('{}'); }
    assert.equal((await first).status, 200); assert.equal((await second).status, 200);
    assert.equal((await request('/v1/video-av-query-answers', options)).status, 200); assert.equal(waiting.length, 3);
  });
}
