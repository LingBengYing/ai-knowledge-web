import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startExternalServer, readConfiguration } from '../scripts/external-server.mjs';

const publicOrigin = 'https://knowledge.example.invalid';
const publicHost = new URL(publicOrigin).host;
const sessionPair = 'rag_session=fixture';

test('0040 retrieval settings retain precise routes and authenticated external session', async t => {
  const seen = [];
  const { origin } = await fixture(t, {}, (req, res) => { seen.push([req.url, req.method]); req.resume(); req.on('end', () => res.end('{}')); });
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  assert.equal((await raw(origin, '/retrieval-settings.mjs', { headers })).status, 200);
  assert.equal((await raw(origin, '/retrieval-settings.mjs?', { headers })).status, 400);
  assert.equal((await raw(origin, '/v1/retrieval-settings')).status, 401);
  assert.equal((await raw(origin, '/v1/retrieval-settings', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/retrieval-settings', { method: 'PUT', headers, body: '{}' })).status, 200);
  assert.equal((await raw(origin, '/v1/retrieval-settings', { method: 'POST', headers, body: '{}' })).status, 405);
  assert.equal((await raw(origin, '/v1/retrieval-settings?', { headers })).status, 400);
  assert.equal((await raw(origin, '/v1/retrieval-settings/more', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/retrieval-settings', { method: 'PUT', headers: { ...headers, Origin: 'https://other.invalid' }, body: '{}' })).status, 403);
  assert.deepEqual(seen, [['/v1/retrieval-settings', 'GET'], ['/v1/retrieval-settings', 'PUT']]);
});

test('shared-library citation expansion retains login and exact relative source routes', async t => {
  const seen = [];
  const { origin } = await fixture(t, {}, (req, res) => { seen.push(req.url); res.end('{}'); });
  const headers = { Origin: publicOrigin, Cookie: sessionPair };
  assert.equal((await raw(origin, '/v1/knowledge-sources/answer-one/33')).status, 401);
  for (const number of [1, 33, 1000]) {
    assert.equal((await raw(origin, `/v1/knowledge-sources/answer-one/${number}`, { headers })).status, 200);
  }
  for (const suffix of ['0', '01', '-1', '1.5', '33/more']) {
    assert.equal((await raw(origin, `/v1/knowledge-sources/answer-one/${suffix}`, { headers })).status, 404);
  }
  assert.equal(seen.length, 3);
});

test('file synopsis authenticated static, generation, task and source routes use their own exact contracts', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-file-synopsis-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'file-synopsis.mjs'), 'export const synthetic = true;');
  const received = [];
  const { origin } = await fixture(t, { publicDirectory, responseBytes: 4, contentBytes: 6, mediaBytes: 10 }, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
      res.setHeader('Content-Type', req.url.endsWith('/content') ? 'application/pdf' : req.url.endsWith('/frame') ? 'image/png' : 'application/json');
      res.statusCode = req.method === 'POST' ? 202 : 200;
      res.end(req.url.endsWith('/content') || req.url.endsWith('/frame') ? '12345678' : '{}');
    });
  });
  const headers = { Origin: publicOrigin, Cookie: sessionPair };
  assert.equal((await raw(origin, '/file-synopsis.mjs', { headers })).status, 200);
  assert.equal((await raw(origin, '/file-synopsis.mjs')).status, 303);
  for (const [path, method] of [['/v1/documents/doc-one/synopsis', 'GET'], ['/v1/documents/doc-one/synopsis', 'POST'],
    ['/v1/synopsis-tasks/task-one', 'GET'], ['/v1/synopsis-sources/syn-one/1/1', 'GET'], ['/v1/synopsis-sources/syn-one/32/8', 'GET']]) {
    assert.equal((await raw(origin, path, { method, headers })).status, method === 'POST' ? 202 : 200, path);
  }
  const content = await raw(origin, '/v1/synopsis-sources/syn-one/1/1/content', { headers });
  assert.equal(content.status, 200); assert.equal(content.body, '12345678');
  assert.equal(content.headers['content-type'], 'application/pdf');
  assert.equal((await raw(origin, '/v1/synopsis-sources/syn-one/1/1/frame', { headers })).status, 502);
  assert.equal(received.length, 7);
  for (const request of received) {
    assert.equal(request.body.length, 0);
    assert.equal(request.headers.origin, publicOrigin);
    assert.equal(request.headers.cookie, sessionPair);
    assert.equal(request.headers['content-type'], undefined);
    assert.equal(request.headers['x-principal-id'], undefined);
  }
});

test('file synopsis external routes reject query, body and extra actions while preserving authentication', async t => {
  let calls = 0;
  const { origin } = await fixture(t, {}, (_req, res) => { calls++; res.end('{}'); });
  const headers = { Origin: publicOrigin, Cookie: sessionPair };
  for (const [path, method] of [['/v1/documents/doc-one/synopsis', 'POST'], ['/v1/documents/doc-one/synopsis', 'GET'],
    ['/v1/synopsis-tasks/task-one', 'GET'], ['/v1/synopsis-sources/syn-one/1/1', 'GET'],
    ['/v1/synopsis-sources/syn-one/1/1/content', 'GET'], ['/v1/synopsis-sources/syn-one/1/1/frame', 'GET']]) {
    assert.equal((await raw(origin, path + '?', { method, headers })).status, 400, path);
    assert.equal((await raw(origin, path, { method, headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400, path);
    assert.equal((await raw(origin, path, { method: 'DELETE', headers })).status, 405, path);
  }
  for (const path of ['/v1/documents/%64oc-one/synopsis', '/v1/synopsis-tasks/task-one/cancel', '/v1/synopsis-sources/syn-one/0/1',
    '/v1/synopsis-sources/syn-one/33/1', '/v1/synopsis-sources/syn-one/1/9', '/v1/synopsis-sources/syn-one/01/1', '/v1/synopsis-sources/syn-one/1/1/content/more']) {
    assert.equal((await raw(origin, path, { headers })).status, 404, path);
  }
  assert.equal((await raw(origin, '/v1/documents/doc-one/synopsis', { method: 'POST', headers: { Origin: publicOrigin } })).status, 401);
  assert.equal((await raw(origin, '/v1/documents/doc-one/synopsis', { method: 'POST', headers: { ...headers, Origin: 'https://other.example.invalid' } })).status, 403);
  assert.equal(calls, 0);
});

test('file synopsis external generation retains ordinary deadline and JSON limits without retries', async t => {
  let calls = 0;
  const { origin } = await fixture(t, { requestBytes: 32, responseBytes: 64, deadlineMs: 30, answerDeadlineMs: 500 }, (req, res) => {
    calls++; req.resume();
    if (req.url === '/v1/documents/large/synopsis') res.end('x'.repeat(65));
    else res.write('{}');
  });
  const path = '/v1/documents/doc-one/synopsis';
  const options = { method: 'POST', headers: { Origin: publicOrigin, Cookie: sessionPair } };
  assert.equal((await raw(origin, path, options)).status, 504);
  assert.equal((await raw(origin, path, { ...options, body: ' '.repeat(33) })).status, 413);
  assert.equal((await raw(origin, '/v1/documents/large/synopsis', { headers: { Cookie: sessionPair } })).status, 502);
  assert.equal(calls, 2);
});

test('query attachment module uses the exact authenticated static route', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-query-attachments-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'query-attachments.mjs'), 'export const synthetic = true;');
  const { origin } = await fixture(t, { publicDirectory });
  const headers = { Cookie: sessionPair };
  const result = await raw(origin, '/query-attachments.mjs', { headers });
  assert.equal(result.status, 200);
  assert.equal(result.body, 'export const synthetic = true;');
  assert.equal(result.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.match(result.headers['cache-control'], /no-store/);
  assert.equal((await raw(origin, '/query-attachments.mjs', { method: 'HEAD', headers })).status, 200);
  assert.equal((await raw(origin, '/query-attachments.mjs')).status, 303);
  assert.equal((await raw(origin, '/query-attachments.mjs?', { headers })).status, 400);
  assert.equal((await raw(origin, '/query-attachments.mjs', { method: 'POST', headers: { ...headers, Origin: publicOrigin } })).status, 405);
  for (const path of ['/query-attachments.mjs/more', '/query-attachments.js', '/%71uery-attachments.mjs']) {
    assert.equal((await raw(origin, path, { headers })).status, 404, path);
  }
});

test('query attachment POST preserves large original JSON and external cookie origin without retries', async t => {
  const received = [];
  const { origin, backendOrigin } = await fixture(t, {}, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url, method: req.method, body: Buffer.concat(chunks), headers: req.headers });
      res.setHeader('Set-Cookie', `${sessionPair}; Path=/; HttpOnly; Secure; SameSite=Strict`);
      res.end('{"mode":"text","query_attachments":[],"result":{"status":"abstained"}}');
    });
  });
  const body = Buffer.from(JSON.stringify({ question: '  合成问题\n保留完整尾部  ', mode: 'text', document_ids: ['doc-one', 'not-published'],
    attachments: [{ filename: 'query.png', media_type: 'image/png', content_base64: 'a'.repeat(140 * 1024) }] }));
  assert.ok(body.length > 128 * 1024);
  const headers = { Origin: publicOrigin, 'Content-Type': 'application/json', Cookie: `unrelated=private; ${sessionPair}` };
  const response = await raw(origin, '/v1/attachment-answers', { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(received.length, 1);
  assert.ok(received[0].body.equals(body));
  assert.equal(received[0].path, '/v1/attachment-answers');
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].headers.origin, publicOrigin);
  assert.equal(received[0].headers.host, new URL(backendOrigin).host);
  assert.equal(received[0].headers.cookie, sessionPair);
  assert.equal(received[0].headers['x-principal-id'], undefined);
  assert.equal(received[0].headers['x-workspace-id'], undefined);
  assert.equal((await raw(origin, '/v1/answers', { method: 'POST', headers, body })).status, 413);
  assert.equal(received.length, 1);
});

test('query attachment route rejects queries, wrong methods, non-JSON and unauthenticated or spoofed users', async t => {
  let calls = 0;
  const { origin } = await fixture(t, {}, (_req, res) => { calls++; res.end('{}'); });
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  for (const suffix of ['?', '?mode=text', '?filename=query.png']) {
    assert.equal((await raw(origin, '/v1/attachment-answers' + suffix, { method: 'POST', headers, body: '{}' })).status, 400);
  }
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    assert.equal((await raw(origin, '/v1/attachment-answers', { method, headers })).status, 405);
  }
  for (const type of [undefined, 'text/plain', 'application/octet-stream', 'multipart/form-data']) {
    assert.equal((await raw(origin, '/v1/attachment-answers', { method: 'POST', headers: { Origin: publicOrigin, Cookie: sessionPair, ...(type ? { 'Content-Type': type } : {}) }, body: '{}' })).status, 415);
  }
  for (const badHeaders of [{ Origin: 'https://other.example.invalid' }, { Host: 'other.example.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await raw(origin, '/v1/attachment-answers', { method: 'POST', headers: { ...headers, ...badHeaders }, body: '{}' })).status, 403);
  }
  for (const badHeaders of [{ Authorization: 'Bearer synthetic' }, { 'X-Principal-Id': 'admin' }, { 'X-Forwarded-Proto': 'https' }]) {
    assert.equal((await raw(origin, '/v1/attachment-answers', { method: 'POST', headers: { ...headers, ...badHeaders }, body: '{}' })).status, 400);
  }
  assert.equal((await raw(origin, '/v1/attachment-answers', { method: 'POST', headers: { Origin: publicOrigin, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  for (const path of ['/v1/attachment-answers/more', '/v1/%61ttachment-answers', '/v1/attachment-answers/']) {
    assert.equal((await raw(origin, path, { method: 'POST', headers, body: '{}' })).status, 404);
  }
  assert.equal(calls, 0);
});

test('query attachment defaults permit exactly 28MiB and reject the next byte before forwarding externally', async t => {
  const sizes = [];
  const { origin } = await fixture(t, {}, (req, res) => {
    let size = 0;
    req.on('data', chunk => { size += chunk.length; });
    req.on('end', () => { sizes.push(size); res.end('{}'); });
  });
  const limit = 28 * 1024 * 1024;
  const body = Buffer.alloc(limit, 0x20);
  body[0] = 0x7b; body[body.length - 1] = 0x7d;
  const options = { method: 'POST', headers: { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' }, body };
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 200);
  assert.deepEqual(sizes, [limit]);
  assert.equal((await raw(origin, '/v1/attachment-answers', { ...options, body: Buffer.concat([body, Buffer.from(' ')]) })).status, 413);
  assert.deepEqual(sizes, [limit]);
});

test('query attachment budgets leave ordinary JSON, deadline and response caps unchanged externally', async t => {
  const seen = [];
  const { origin } = await fixture(t, { requestBytes: 32, attachmentBytes: 64, responseBytes: 64, deadlineMs: 30, answerDeadlineMs: 500 }, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push(req.url);
      if (Buffer.concat(chunks).toString() === 'large-response') res.end('x'.repeat(65));
      else setTimeout(() => res.end('{}'), 75);
    });
  });
  const options = { method: 'POST', headers: { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' }, body: ' '.repeat(64) };
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 200);
  assert.equal((await raw(origin, '/v1/attachment-answers', { ...options, body: ' '.repeat(65) })).status, 413);
  assert.equal((await raw(origin, '/v1/answers', options)).status, 413);
  assert.equal((await raw(origin, '/v1/management/tags', { headers: { Cookie: sessionPair } })).status, 504);
  assert.equal((await raw(origin, '/v1/attachment-answers', { ...options, body: 'large-response' })).status, 502);
  assert.equal(seen.length, 3);
});

test('query attachment capacity is two authenticated exchanges and released capacity is independent of uploads', async t => {
  const responses = [];
  const { origin } = await fixture(t, {}, (req, res) => {
    req.resume();
    if (req.url === '/v1/attachment-answers') responses.push(res);
    else res.end('{}');
  });
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  const options = { method: 'POST', headers, body: '{}' };
  const first = raw(origin, '/v1/attachment-answers', options);
  const second = raw(origin, '/v1/attachment-answers', options);
  for (let i = 0; responses.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(responses.length, 2);
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 429);
  assert.equal((await raw(origin, '/v1/management/tags', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/documents?filename=synthetic.txt', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: 'synthetic' })).status, 200);
  assert.equal(responses.length, 2);
  responses[0].end('{}'); responses[1].destroy();
  assert.equal((await first).status, 200);
  assert.equal((await second).status, 502);
  const next = raw(origin, '/v1/attachment-answers', options);
  for (let i = 0; responses.length < 3 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(responses.length, 3);
  responses[2].end('{}');
  assert.equal((await next).status, 200);
});

test('query attachment external deadline covers incoming body and full response and never retries', async t => {
  let calls = 0;
  const { origin } = await fixture(t, { deadlineMs: 30, answerDeadlineMs: 80 }, (req, res) => {
    calls++; req.resume();
    if (calls === 1) res.write('{}');
    else req.socket.destroy();
  });
  const headers = { Host: publicHost, Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  const incoming = await new Promise((resolveResult, rejectResult) => {
    const req = http.request(`${origin}/v1/attachment-answers`, { method: 'POST', headers }, res => {
      res.resume(); res.on('end', () => { resolveResult(res.statusCode); req.end(); });
    });
    req.on('error', rejectResult); req.write('{');
  });
  assert.equal(incoming, 504); assert.equal(calls, 0);
  const options = { method: 'POST', headers, body: '{}' };
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 504);
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 502);
  assert.equal(calls, 2);
});

test('query attachment external size limit cannot exceed 28MiB or become nonpositive', async t => {
  for (const attachmentBytes of [0, -1, 1.5, 28 * 1024 * 1024 + 1, NaN]) {
    await assert.rejects(fixture(t, { attachmentBytes }), error => error.code === 'invalid_limit');
  }
});

function raw(origin, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(origin, { path, method, headers: { Host: publicHost, ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function fixture(t, options = {}, handler) {
  const seen = [];
  const backend = http.createServer((request, response) => {
    seen.push({ path: request.url, headers: request.headers });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/health/entry-policy') {
      response.end(JSON.stringify({ enabled: options.enabled ?? true, public_origin: publicOrigin, auth_mode: 'jwt' }));
    } else if (request.url === '/v1/config') {
      response.end(JSON.stringify({ auth_mode: options.authMode ?? 'jwt', capabilities: [] }));
    } else if (request.url === '/v1/session' && request.method === 'GET') {
      response.statusCode = request.headers.cookie === sessionPair ? 200 : 401;
      response.end(JSON.stringify({ status: response.statusCode === 200 ? 'authenticated' : 'unauthorized' }));
    } else if (handler) handler(request, response);
    else response.end('{}');
  }).listen(0, '127.0.0.1');
  await once(backend, 'listening');
  t.after(() => new Promise(resolve => { backend.close(resolve); backend.closeAllConnections(); }));
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
  const frontend = await startExternalServer({ backendOrigin, publicOrigin, port: 0, ...options });
  t.after(() => new Promise(resolve => { frontend.close(resolve); frontend.closeAllConnections(); }));
  return { origin: `http://127.0.0.1:${frontend.address().port}`, backendOrigin, seen };
}

test('authenticated original-file details use only pinned GET paths and load the original module', async t => {
  const { origin, seen } = await fixture(t, {}, (request, response) => {
    response.setHeader('Content-Type', request.url.endsWith('/content') ? 'application/pdf' : 'application/json');
    response.end(request.url.endsWith('/content') ? '%PDF-synthetic' : '{"document_id":"doc-one"}');
  });
  const headers = { Cookie: sessionPair };
  assert.equal((await raw(origin, '/document-originals.mjs', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/original', { headers })).status, 200);
  const file = await raw(origin, '/v1/documents/doc-one/revisions/rev-one/content', { headers });
  assert.equal(file.status, 200); assert.equal(file.body, '%PDF-synthetic');
  const before = seen.filter(item => item.path.startsWith('/v1/documents/')).length;
  for (const path of ['/v1/documents/doc-one/original?x=1', '/v1/documents/doc-one/revisions/rev-one/content?x=1', '/v1/documents/doc-one/content']) {
    assert.notEqual((await raw(origin, path, { headers })).status, 200);
  }
  assert.equal(seen.filter(item => item.path.startsWith('/v1/documents/')).length, before);
  assert.equal((await raw(origin, '/v1/documents/doc-one/original')).status, 401);
});

test('public address must be a canonical HTTPS origin and backend remains literal loopback', () => {
  assert.equal(readConfiguration({ RAG_PUBLIC_ORIGIN: publicOrigin }).publicOrigin, publicOrigin);
  for (const invalid of [undefined, 'http://knowledge.example.invalid', publicOrigin + '/', publicOrigin + '?x=1', 'https://user@knowledge.example.invalid', 'https://127.0.0.1', publicOrigin + ':443']) {
    assert.throws(() => readConfiguration({ RAG_PUBLIC_ORIGIN: invalid }));
  }
  assert.throws(() => readConfiguration({ RAG_PUBLIC_ORIGIN: publicOrigin, RAG_WEB_BACKEND_ORIGIN: 'http://localhost:18084' }));
});

test('startup refuses disabled entry policy and development-header authentication', async t => {
  await assert.rejects(fixture(t, { enabled: false }), error => error.code === 'backend_entry_policy_mismatch');
  await assert.rejects(fixture(t, { authMode: 'development_headers' }), error => error.code === 'backend_entry_policy_mismatch');
});

test('anonymous visitors receive only login shell and knowledge APIs require actual backend session', async t => {
  const { origin } = await fixture(t);
  const root = await raw(origin, '/');
  assert.equal(root.status, 303);
  assert.equal(root.headers.location, '/login');
  assert.equal((await raw(origin, '/api.mjs')).status, 303);
  assert.equal((await raw(origin, '/v1/management/documents')).status, 401);
  const login = await raw(origin, '/login');
  assert.equal(login.status, 200);
  assert.match(login.body, /登录知识库/);
  assert.match(login.headers['content-security-policy'], /form-action 'self'/);
  assert.equal((await raw(origin, '/login.mjs')).status, 200);
  assert.equal((await raw(origin, '/', { headers: { Cookie: 'rag_session=invalid' } })).status, 303);
  assert.equal((await raw(origin, '/', { headers: { Cookie: sessionPair } })).status, 200);
  assert.equal((await raw(origin, '/v1/config', { headers: { Cookie: sessionPair } })).status, 200);
  assert.equal((await raw(origin, '/health/entry-policy', { headers: { Cookie: sessionPair } })).status, 404);
});

test('origin reaches Java unchanged; session only accepts secure host-only cookie and never retries', async t => {
  let exchanges = 0;
  const { origin, seen } = await fixture(t, {}, (request, response) => {
    if (request.url === '/v1/session' && request.method === 'POST') {
      exchanges += 1;
      response.setHeader('Set-Cookie', `${sessionPair}; Path=/; HttpOnly; Secure; SameSite=Strict`);
      response.end('{"status":"authenticated"}');
    } else response.end('{}');
  });
  const login = await raw(origin, '/v1/session', { method: 'POST', headers: { Origin: publicOrigin, 'Content-Type': 'application/json' }, body: '{"token":"REPLACE_ME"}' });
  assert.equal(login.status, 200);
  assert.match(login.headers['set-cookie'][0], /Secure/);
  assert.equal(seen.at(-1).headers.origin, publicOrigin);
  assert.equal(exchanges, 1);
  assert.equal(seen.at(-1).headers['x-forwarded-host'], undefined);
});

test('missing/cross origins, wrong Host, duplicate cookies and spoofed identity headers stop before backend', async t => {
  const { origin, seen } = await fixture(t);
  const count = seen.length;
  for (const headers of [
    { Origin: 'https://other.example.invalid' }, { Origin: 'null' }, {},
    { Origin: publicOrigin, Host: 'other.example.invalid' },
    { Origin: publicOrigin, 'X-Principal-Id': 'admin' },
    { Origin: publicOrigin, 'X-Forwarded-Proto': 'https' },
    { Origin: publicOrigin, Forwarded: 'proto=https' },
    { Origin: publicOrigin, Authorization: 'Bearer REPLACE_ME' },
    { Origin: publicOrigin, Cookie: sessionPair + '; ' + sessionPair },
  ]) {
    const response = await raw(origin, '/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
    assert.ok([400, 403].includes(response.status));
  }
  assert.equal(seen.length, count);
});

test('non-secure upstream session cookie fails closed and public access has bounded login attempts', async t => {
  const { origin } = await fixture(t, {}, (_request, response) => {
    response.setHeader('Set-Cookie', `${sessionPair}; Path=/; HttpOnly; SameSite=Strict`);
    response.end('{}');
  });
  const login = () => raw(origin, '/v1/session', { method: 'POST', headers: { Origin: publicOrigin, 'Content-Type': 'application/json' }, body: '{}' });
  const first = await login();
  assert.equal(first.status, 502);
  assert.equal(first.headers['set-cookie'], undefined);
  for (let index = 1; index < 20; index += 1) assert.equal((await login()).status, 502);
  assert.equal((await login()).status, 429);
});

test('route, upload MIME and path constraints remain in place for authenticated users', async t => {
  const { origin, seen } = await fixture(t);
  const headers = { Cookie: sessionPair, Origin: publicOrigin };
  assert.equal((await raw(origin, '/v1/answers?x=1', { method: 'POST', headers, body: '{}' })).status, 400);
  assert.equal((await raw(origin, '/v1/documents?filename=payload.exe', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: 'x' })).status, 400);
  assert.equal((await raw(origin, '/.env', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/unrestricted-target', { headers })).status, 404);
  assert.equal(seen.filter(request => request.path === '/v1/answers?x=1').length, 0);
});

test('authenticated four-type entry forwards exact media contracts with separate image, media and JSON budgets', async t => {
  const { origin, seen } = await fixture(t, { responseBytes: 4, contentBytes: 6, mediaBytes: 10, imageUploadBytes: 5, uploadBytes: 10 }, (req, res) => {
    res.setHeader('Content-Type', req.url.endsWith('/content') ? 'video/mp4' : req.url.endsWith('/frame') ? 'image/png' : 'application/json');
    res.end(req.url.endsWith('/content') || req.url.endsWith('/frame') ? '12345678' : '{}');
  });
  const headers = { Cookie: sessionPair, Origin: publicOrigin };
  for (const type of ['visual', 'audio', 'video']) assert.equal((await raw(origin, `/v1/${type}-answers`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  for (const type of ['audio', 'video']) {
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1`, { headers })).status, 200);
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1/content`, { headers })).body, '12345678');
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1/content`, { headers: { Origin: publicOrigin } })).status, 401);
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1/content?`, { headers })).status, 400);
  }
  for (const path of ['/v1/visual-sources/a/1/content', '/v1/sources/a/1/content', '/v1/video-sources/a/1/frame']) assert.equal((await raw(origin, path, { headers })).status, 502);
  const upload = (name, type, size) => raw(origin, '/v1/documents?filename=' + name, { method: 'POST', headers: { ...headers, 'Content-Type': type }, body: 'x'.repeat(size) });
  assert.equal((await upload('clip.mp4', 'application/octet-stream', 10)).status, 200);
  assert.equal((await upload('clip.mp4', 'video/mp4', 10)).status, 200);
  assert.equal((await upload('clip.mp4', 'video/webm', 10)).status, 400);
  assert.equal((await upload('picture.png', 'application/octet-stream', 5)).status, 200);
  assert.equal((await upload('picture.png', 'application/octet-stream', 6)).status, 413);
  assert.equal((await raw(origin, '/media-sources.mjs', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/video-sources/a/1/frame/more', { headers })).status, 404);
  for (const request of seen.filter(request => request.path.endsWith('-answers'))) assert.equal(request.headers.origin, publicOrigin);
});


test('tag suggestion asset and exact read/apply routes preserve ordinary JSON transport', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-tags-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'tag-suggestions.mjs'), 'export const synthetic = true;');
  const seen = [];
  const handler = (req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { seen.push({ method: req.method, path: req.url, body: Buffer.concat(chunks).toString() }); res.setHeader('Content-Type', 'application/json'); res.end('{}'); });
  };
  const { origin } = await fixture(t, { publicDirectory }, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair };
  assert.equal((await raw(origin, '/tag-suggestions.mjs', { headers })).status, 200);
  const path = '/v1/documents/doc-one/tag-suggestions';
  assert.equal((await raw(origin, path, { headers })).status, 200);
  const body = JSON.stringify({ suggestion_fingerprint: 'a'.repeat(64), ordinals: [1] });
  assert.equal((await raw(origin, path + '/apply', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body })).status, 200);
  assert.deepEqual(seen, [{ method: 'GET', path, body: '' }, { method: 'POST', path: path + '/apply', body }]);
});

test('tag suggestion routes reject extra paths, query, read body and non-JSON writes', async t => {
  let calls = 0;
  const handler = (_req, res) => { calls++; res.end('{}'); };
  const { origin } = await fixture(t, {}, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair }, path = '/v1/documents/doc-one/tag-suggestions';
  assert.equal((await raw(origin, path + '?', { headers })).status, 400);
  assert.equal((await raw(origin, path, { headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
  assert.equal((await raw(origin, path, { method: 'POST', headers })).status, 405);
  assert.equal((await raw(origin, path + '/apply', { headers })).status, 405);
  assert.equal((await raw(origin, path + '/apply?', { method: 'POST', headers })).status, 400);
  assert.equal((await raw(origin, path + '/apply', { method: 'POST', headers, body: '{}' })).status, 415);
  assert.equal((await raw(origin, path + '/apply/more', { method: 'POST', headers })).status, 404);
  assert.equal(calls, 0);
});

test('image vector authenticated reads and explicit bodyless builds retain their exact deadline and boundary', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-image-vector-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'image-vectors.mjs'), 'export const synthetic = true;');
  const seen = [];
  const { origin } = await fixture(t, { publicDirectory, imageVectorDeadlineMs: 150, deadlineMs: 10 }, (req, res) => {
    seen.push({ path: req.url, method: req.method, origin: req.headers.origin, cookie: req.headers.cookie });
    if (req.method === 'POST' || req.url === '/v1/management/tags') setTimeout(() => res.end('{}'), 40); else res.end('{}');
  });
  const headers = { Origin: publicOrigin, Cookie: sessionPair };
  assert.equal((await raw(origin, '/image-vectors.mjs', { headers })).status, 200);
  assert.equal((await raw(origin, '/image-vectors.mjs')).status, 303);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method: 'POST', headers })).status, 200);
  assert.equal(seen.length, 2); assert.equal(seen[1].origin, publicOrigin); assert.equal(seen[1].cookie, sessionPair);
  for (const method of ['GET', 'POST']) {
    assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector?', { method, headers })).status, 400);
    assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method, headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
  }
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method: 'DELETE', headers })).status, 405);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector/more', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/%64oc-one/image-vector', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' } })).status, 403);
  assert.equal(seen.length, 2);
  assert.equal((await raw(origin, '/v1/management/tags', { headers })).status, 504);
  assert.equal(seen.length, 3, 'ordinary and build requests are never retried');
});

test('audio vector authenticated reads and explicit bodyless builds retain their exact deadline and boundary', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-audio-vector-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'audio-vectors.mjs'), 'export const synthetic = true;');
  const seen = [];
  const { origin } = await fixture(t, { publicDirectory, audioVectorDeadlineMs: 150, deadlineMs: 10 }, (req, res) => {
    seen.push({ path: req.url, method: req.method, origin: req.headers.origin, cookie: req.headers.cookie });
    if (req.method === 'POST' || req.url === '/v1/management/tags') setTimeout(() => res.end('{}'), 40); else res.end('{}');
  });
  const headers = { Origin: publicOrigin, Cookie: sessionPair };
  assert.equal((await raw(origin, '/audio-vectors.mjs', { headers })).status, 200);
  assert.equal((await raw(origin, '/audio-vectors.mjs')).status, 303);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method: 'POST', headers })).status, 200);
  assert.equal(seen.length, 2); assert.equal(seen[1].origin, publicOrigin); assert.equal(seen[1].cookie, sessionPair);
  for (const method of ['GET', 'POST']) {
    assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector?', { method, headers })).status, 400);
    assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method, headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
  }
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method: 'DELETE', headers })).status, 405);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector/more', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/%64oc-one/audio-vector', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' } })).status, 403);
  assert.equal(seen.length, 2);
  assert.equal((await raw(origin, '/v1/management/tags', { headers })).status, 504);
  assert.equal(seen.length, 3, 'ordinary and build requests are never retried');
});


test('model setup and retrieval routes forward only exact methods and bodies with the existing identity boundary', async t => {
  const seen = [];
  const handler = (req, res) => { const chunks=[]; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { seen.push({path:req.url,method:req.method,body:Buffer.concat(chunks).toString()}); res.setHeader('Content-Type','application/json');res.end('{}'); }); };
  const { origin } = await fixture(t, {}, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  for (const [path, method, body] of [['/v1/model-configuration','GET',undefined],['/v1/model-configuration','PUT','{}'],['/v1/model-configuration/test','POST','{}'],['/v1/model-configuration/activate','POST','{}'],['/v1/retrieval-tests','POST','{}']]) {
    const response=await raw(origin,path,{method,headers,body});assert.equal(response.status,200,path);assert.match(response.headers['cache-control'],/no-store/u);
  }
  assert.equal(seen.length,5);assert.deepEqual(seen.map(item=>item.method),['GET','PUT','POST','POST','POST']);
  assert.deepEqual(seen.map(item=>item.body),['','{}','{}','{}','{}']);
});

test('model setup and retrieval reject empty queries extra routes wrong methods and non JSON before dispatch', async t => {
  let calls=0;const handler=(_req,res)=>{calls++;res.end('{}');};
  const { origin } = await fixture(t, {}, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  for(const path of ['/v1/model-configuration','/v1/model-configuration/test','/v1/model-configuration/activate','/v1/retrieval-tests']) {
    const method=path==='/v1/model-configuration'?'PUT':'POST';
    assert.equal((await raw(origin,path+'?',{method,headers,body:'{}'})).status,400,path);
    assert.equal((await raw(origin,path+'/extra',{method,headers,body:'{}'})).status,404,path);
    assert.equal((await raw(origin,path,{method:'DELETE',headers})).status,405,path);
    assert.equal((await raw(origin,path,{method,headers:{...headers,'Content-Type':'text/plain'},body:'{}'})).status,415,path);
  }
  assert.equal(calls,0);
});


test('model tests and retrieval have separate bounded deadlines and retain ordinary configuration and JSON limits', async t => {
  let calls=0;const handler=(req,res)=>{calls++;req.resume();setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end('{}');},60);};
  const { origin } = await fixture(t, { deadlineMs:20, modelTestDeadlineMs:250, retrievalDeadlineMs:250, requestBytes:32 }, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  assert.equal((await raw(origin,'/v1/model-configuration',{headers})).status,504);
  for(const path of ['/v1/model-configuration/test','/v1/retrieval-tests'])assert.equal((await raw(origin,path,{method:'POST',headers,body:'{}'})).status,200,path);
  assert.equal((await raw(origin,'/v1/model-configuration/activate',{method:'POST',headers,body:'{}'})).status,504);
  assert.equal((await raw(origin,'/v1/retrieval-tests',{method:'POST',headers,body:'x'.repeat(33)})).status,413);
  assert.equal(calls,4);
});


test('reindex JSON creation forwards its exact pinned publication and preserves ordinary identity transport', async t => {
  const seen = [];
  const handler = (req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { seen.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers }); res.writeHead(202, { 'Content-Type': 'application/json' }); res.end('{"task_id":"index-rebuild"}'); });
  };
  const { origin, backendOrigin } = await fixture(t, {}, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ base_publication_id: 'publication-old' });
  const result = await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers, body });
  assert.equal(result.status, 202); assert.match(result.headers['cache-control'], /no-store/u);
  assert.equal(seen.length, 1); assert.equal(seen[0].path, '/v1/documents/doc-one/reindex');
  assert.equal(seen[0].method, 'POST'); assert.equal(seen[0].body, body);
  assert.equal(seen[0].headers.origin, publicOrigin); assert.equal(seen[0].headers.cookie, sessionPair); assert.equal(seen[0].headers['x-principal-id'], undefined);
});

test('reindex transport rejects queries expanded routes wrong methods and non JSON before forwarding', async t => {
  let calls = 0; const handler = (_req, res) => { calls++; res.end('{}'); };
  const { origin } = await fixture(t, {}, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' }; const body = '{"base_publication_id":"publication-old"}';
  for (const suffix of ['?', '?base_publication_id=publication-old', '?unknown=1']) {
    assert.equal((await raw(origin, '/v1/documents/doc-one/reindex' + suffix, { method: 'POST', headers, body })).status, 400);
  }
  for (const path of ['/v1/documents/doc-one/reindex/extra', '/v1/documents/%64oc-one/reindex', '/v1/documents/doc.one/reindex']) {
    assert.equal((await raw(origin, path, { method: 'POST', headers, body })).status, 404);
  }
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await raw(origin, '/v1/documents/doc-one/reindex', { method, headers })).status, 405);
  assert.equal((await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.equal((await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body })).status, 403);
  assert.equal(calls, 0);
});

test('reindex uses ordinary 128 KiB JSON budget and ordinary deadline without automatic retries', async t => {
  let calls = 0;
  const handler = (req, res) => { calls++; req.resume(); if (req.url.includes('timeout')) res.write('{}'); else res.end('{}'); };
  const { origin } = await fixture(t, { deadlineMs: 40, answerDeadlineMs: 500 }, handler);
  const headers = { Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  const exact = '{"base_publication_id":"publication-old"}'.padEnd(128 * 1024, ' ');
  assert.equal((await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers, body: exact })).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers, body: exact + ' ' })).status, 413);
  assert.equal((await raw(origin, '/v1/documents/doc-timeout/reindex', { method: 'POST', headers, body: '{"base_publication_id":"publication-old"}' })).status, 504);
  assert.equal(calls, 2, 'oversize was never forwarded and timeout was never retried');
});
