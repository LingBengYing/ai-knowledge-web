import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  test(`${name} sound transport preserves raw upload, complete query scope and exact sources`, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'sound-web-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'sound-library.mjs'), 'export const synthetic = true;');
    const seen = [];
    const { request, backendOrigin } = await fixture(t, external, (req, res) => {
      const chunks = []; req.on('data', x => chunks.push(x)); req.on('end', () => {
        seen.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
        res.setHeader('Content-Type', req.url.endsWith('/content') ? 'audio/wav' : 'application/json');
        res.statusCode = req.url === '/v1/sound-documents' ? 201 : 200;
        res.end(req.url.endsWith('/content') ? 'synthetic-complete-audio' : '{}');
      });
    }, { publicDirectory: directory, requestBytes: 32, attachmentBytes: 1024 });
    assert.equal((await request('/sound-library.mjs')).status, 200);
    const encoded = encodeURIComponent('铃声 + 原文件.wav');
    const raw = Buffer.from([0, 128, 255, 0]);
    assert.equal((await request('/v1/sound-documents', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encoded }, body: raw })).status, 201);
    const question = JSON.stringify({ mode: 'SOUND', question: '原问题完整尾部', document_ids: ['doc-one', 'unindexed'], attachments: [{ media_kind: 'audio', content_base64: 'a'.repeat(160) }] });
    assert.equal((await request('/v1/sound-query-answers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Filename': 'ignored.wav' }, body: question })).status, 200);
    assert.equal((await request('/v1/sound-answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"question":"synthetic"}' })).status, 200);
    for (const method of ['GET', 'POST']) assert.equal((await request('/v1/documents/doc-one/sound-index', { method })).status, 200);
    assert.equal((await request('/v1/sound-sources/answer-one/32')).status, 200);
    const source = await request('/v1/sound-sources/answer-one/32/content');
    assert.equal(source.status, 200); assert.equal(source.body, 'synthetic-complete-audio'); assert.equal(source.headers['content-type'], 'audio/wav');
    assert.equal(seen.length, 7);
    assert.deepEqual(seen[0].body, raw); assert.equal(seen[0].headers['x-filename'], encoded);
    assert.equal(seen[1].body.toString(), question); assert.equal(seen[1].headers['x-filename'], undefined);
    for (const r of seen) assert.equal(r.headers['x-filename'], r.path === '/v1/sound-documents' ? encoded : undefined);
    assert.equal(seen[0].headers.origin, external ? publicOrigin : backendOrigin);
    if (external) assert.equal(seen[0].headers.cookie, cookie);
    assert.match(source.headers['cache-control'], /no-store/);
  });

  test(`${name} sound transport rejects malformed names, alternate routes, bodies and queries before upstream`, async t => {
    let calls = 0;
    const { request } = await fixture(t, external, (_req, res) => { calls++; res.end('{}'); }, { requestBytes: 32, attachmentBytes: 64, uploadBytes: 8 });
    const upload = { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': 'tone.wav' }, body: 'x' };
    for (const value of ['', '%FF.wav', '%2Ftone.wav', 'tone%5C.wav', 'tone%00.wav', 'tone.png', '%E4%B8.wav']) {
      assert.equal((await request('/v1/sound-documents', { ...upload, headers: { ...upload.headers, 'X-Filename': value } })).status, 400, value);
    }
    assert.equal((await request('/v1/sound-documents', { ...upload, headers: { 'Content-Type': 'application/octet-stream' } })).status, 400);
    assert.equal((await request('/v1/sound-documents', { ...upload, body: '' })).status, 400);
    assert.equal((await request('/v1/sound-documents', { ...upload, body: 'x'.repeat(9) })).status, 413);
    assert.equal((await request('/v1/sound-documents', { ...upload, headers: { ...upload.headers, 'Content-Type': 'audio/wav' } })).status, 415);
    for (const path of ['/v1/sound-documents', '/v1/sound-answers', '/v1/sound-query-answers', '/v1/documents/doc-one/sound-index']) {
      assert.equal((await request(path + '?', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400, path);
    }
    for (const method of ['GET', 'POST']) assert.equal((await request('/v1/documents/doc-one/sound-index', { method, body: '{}' })).status, 400);
    const json = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    assert.equal((await request('/v1/sound-answers', { ...json, body: 'x'.repeat(33) })).status, 413);
    assert.equal((await request('/v1/sound-query-answers', { ...json, body: 'x'.repeat(65) })).status, 413);
    for (const path of ['/v1/sound-sources/answer-one/0', '/v1/sound-sources/answer-one/33', '/v1/sound-sources/answer-one/01', '/v1/sound-sources/%61nswer/1', '/v1/sound-sources/answer-one/1/frame', '/v1/sound-documents/more']) assert.equal((await request(path)).status, 404, path);
    assert.equal((await request('/v1/sound-sources/answer-one/1/content', { body: 'x' })).status, 400);
    assert.equal((await request('/v1/sound-sources/answer-one/1/content?')).status, 400);
    assert.equal((await request('/v1/documents/doc-one/sound-index', { method: 'DELETE' })).status, 405);
    assert.equal((await request('/sound-library.mjs?')).status, 400);
    assert.equal(calls, 0);
  });

  test(`${name} sound build and query retain explicit processing deadline, independent bounds and no retries`, async t => {
    let calls = 0;
    const { request } = await fixture(t, external, (req, res) => {
      calls++; req.resume();
      if (req.url.endsWith('/content')) res.end('x'.repeat(9));
      else setTimeout(() => res.end('{}'), 45);
    }, { deadlineMs: 20, answerDeadlineMs: 180, uploadDeadlineMs: 180, mediaBytes: 8 });
    assert.equal((await request('/v1/documents/doc-one/sound-index', { method: 'POST' })).status, 200);
    assert.equal((await request('/v1/sound-query-answers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal((await request('/v1/sound-documents', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': 'tone+literal.wav' }, body: 'x' })).status, 200);
    assert.equal((await request('/v1/documents/doc-one/sound-index')).status, 504);
    assert.equal((await request('/v1/sound-sources/answer-one/1/content')).status, 502);
    assert.equal(calls, 5);
  });
}
