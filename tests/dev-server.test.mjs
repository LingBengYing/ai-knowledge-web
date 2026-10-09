import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer, readConfiguration } from '../scripts/dev-server.mjs';

const sessionName = ['rag', 'session'].join('_');
const sessionPair = `${sessionName}=synthetic-session`;
const exchangeBody = JSON.stringify({ token: ['test', 'token'].join('-') });

test('0040 retrieval settings expose only exact GET PUT and static module with ordinary transport', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => { seen.push([req.url, req.method]); req.resume(); req.on('end', () => res.end('{}')); });
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  assert.equal((await raw(origin, '/retrieval-settings.mjs')).status, 200);
  assert.equal((await raw(origin, '/retrieval-settings.mjs?')).status, 400);
  assert.equal((await raw(origin, '/v1/retrieval-settings')).status, 200);
  assert.equal((await raw(origin, '/v1/retrieval-settings', { method: 'PUT', headers, body: '{}' })).status, 200);
  assert.equal((await raw(origin, '/v1/retrieval-settings', { method: 'POST', headers, body: '{}' })).status, 405);
  assert.equal((await raw(origin, '/v1/retrieval-settings?', { headers })).status, 400);
  assert.equal((await raw(origin, '/v1/retrieval-settings/more', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/retrieval-settings', { method: 'PUT', headers: { ...headers, Origin: 'http://other.invalid' }, body: '{}' })).status, 403);
  assert.deepEqual(seen, [['/v1/retrieval-settings', 'GET'], ['/v1/retrieval-settings', 'PUT']]);
});

test('shared-library knowledge citations above 32 retain exact relative routes', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => { seen.push(req.url); res.end('{}'); });
  for (const number of [1, 33, 1000]) {
    assert.equal((await raw(origin, `/v1/knowledge-sources/answer-one/${number}`)).status, 200);
  }
  for (const suffix of ['0', '01', '-1', '1.5', '33/more']) {
    assert.equal((await raw(origin, `/v1/knowledge-sources/answer-one/${suffix}`)).status, 404);
  }
  assert.equal(seen.length, 3);
});

test('file synopsis module and bodyless generation, task and source routes preserve exact transport', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-file-synopsis-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'file-synopsis.mjs'), 'export const synthetic = true;');
  const seen = [];
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
      res.setHeader('Content-Type', req.url.endsWith('/content') ? 'application/pdf' : req.url.endsWith('/frame') ? 'image/png' : 'application/json');
      res.statusCode = req.method === 'POST' ? 202 : 200;
      res.end(req.url.endsWith('/content') || req.url.endsWith('/frame') ? '12345678' : '{}');
    });
  }, { publicDirectory, responseBytes: 4, contentBytes: 6, mediaBytes: 10 });
  const headers = { Origin: origin, Cookie: sessionPair, 'X-Principal-Id': 'owner', 'X-Workspace-Id': 'org-main' };
  assert.equal((await raw(origin, '/file-synopsis.mjs')).status, 200);
  for (const [path, method] of [['/v1/documents/doc-one/synopsis', 'GET'], ['/v1/documents/doc-one/synopsis', 'POST'],
    ['/v1/synopsis-tasks/task-one', 'GET'], ['/v1/synopsis-sources/syn-one/1/1', 'GET'], ['/v1/synopsis-sources/syn-one/32/8', 'GET']]) {
    assert.equal((await raw(origin, path, { method, headers })).status, method === 'POST' ? 202 : 200, path);
  }
  const content = await raw(origin, '/v1/synopsis-sources/syn-one/1/1/content', { headers });
  assert.equal(content.status, 200); assert.equal(content.body, '12345678');
  assert.equal(content.headers['content-type'], 'application/pdf');
  assert.equal((await raw(origin, '/v1/synopsis-sources/syn-one/1/1/frame', { headers })).status, 502);
  assert.equal(seen.length, 7);
  for (const request of seen) {
    assert.equal(request.body.length, 0);
    assert.equal(request.headers.origin, backendOrigin);
    assert.equal(request.headers.cookie, sessionPair);
    assert.equal(request.headers['x-principal-id'], 'owner');
    assert.equal(request.headers['x-workspace-id'], 'org-main');
    assert.equal(request.headers['content-type'], undefined);
  }
});

test('file synopsis routes reject queries, bodies, extra paths and out-of-range source ordinals', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; res.end('{}'); });
  const headers = { Origin: origin };
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
  assert.equal((await raw(origin, '/v1/documents/doc-one/synopsis', { method: 'POST', headers: { Origin: 'http://other.invalid' } })).status, 403);
  assert.equal(calls, 0);
});

test('file synopsis generation retains ordinary deadline and JSON limits without retries', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (req, res) => {
    calls++; req.resume();
    if (req.url === '/v1/documents/large/synopsis') res.end('x'.repeat(65));
    else res.write('{}');
  }, { requestBytes: 32, responseBytes: 64, deadlineMs: 30, answerDeadlineMs: 500 });
  const path = '/v1/documents/doc-one/synopsis';
  const options = { method: 'POST', headers: { Origin: origin } };
  assert.equal((await raw(origin, path, options)).status, 504);
  assert.equal((await raw(origin, path, { ...options, body: ' '.repeat(33) })).status, 413);
  assert.equal((await raw(origin, '/v1/documents/large/synopsis')).status, 502);
  assert.equal(calls, 2);
});

test('query attachment module is an exact static asset with the existing browser boundary', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-query-attachments-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'query-attachments.mjs'), 'export const synthetic = true;');
  const { origin } = await fixture(t, undefined, { publicDirectory });
  const result = await raw(origin, '/query-attachments.mjs');
  assert.equal(result.status, 200);
  assert.equal(result.body, 'export const synthetic = true;');
  assert.equal(result.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.match(result.headers['cache-control'], /no-store/);
  assert.equal((await raw(origin, '/query-attachments.mjs', { method: 'HEAD' })).status, 200);
  assert.equal((await raw(origin, '/query-attachments.mjs?', {})).status, 400);
  assert.equal((await raw(origin, '/query-attachments.mjs', { method: 'POST', headers: { Origin: origin } })).status, 405);
  for (const path of ['/query-attachments.mjs/more', '/query-attachments.js', '/%71uery-attachments.mjs']) {
    assert.equal((await raw(origin, path)).status, 404, path);
  }
});

test('query attachment POST preserves large original JSON and approved identity without retries', async t => {
  const received = [];
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url, method: req.method, body: Buffer.concat(chunks), headers: req.headers });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Set-Cookie', `${sessionPair}; Path=/; HttpOnly; SameSite=Strict`);
      res.end('{"mode":"text","query_attachments":[],"result":{"status":"abstained"}}');
    });
  });
  const body = Buffer.from(JSON.stringify({ question: '  合成问题\n保留完整尾部  ', mode: 'text', document_ids: ['doc-one', 'not-published'],
    attachments: [{ filename: 'query.png', media_type: 'image/png', content_base64: 'a'.repeat(140 * 1024) }] }));
  assert.ok(body.length > 128 * 1024);
  const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: `unrelated=private; ${sessionPair}`,
    'X-Principal-Id': 'owner', 'X-Workspace-Id': 'org-main' };
  const response = await raw(origin, '/v1/attachment-answers', { method: 'POST', headers, body });
  assert.equal(response.status, 200);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.equal(received.length, 1);
  assert.equal(received[0].path, '/v1/attachment-answers');
  assert.equal(received[0].method, 'POST');
  assert.ok(received[0].body.equals(body));
  assert.equal(received[0].headers.origin, backendOrigin);
  assert.equal(received[0].headers.cookie, sessionPair);
  assert.equal(received[0].headers['x-principal-id'], 'owner');
  assert.equal(received[0].headers['x-workspace-id'], 'org-main');
  assert.equal((await raw(origin, '/v1/answers', { method: 'POST', headers, body })).status, 413);
  assert.equal(received.length, 1);
});

test('query attachment route rejects queries, wrong methods, non-JSON and unsafe identities before forwarding', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; res.end('{}'); });
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  for (const suffix of ['?', '?mode=text', '?filename=query.png']) {
    assert.equal((await raw(origin, '/v1/attachment-answers' + suffix, { method: 'POST', headers, body: '{}' })).status, 400);
  }
  for (const method of ['GET', 'PUT', 'DELETE', 'HEAD']) {
    assert.equal((await raw(origin, '/v1/attachment-answers', { method, headers })).status, 405);
  }
  for (const type of [undefined, 'text/plain', 'application/octet-stream', 'multipart/form-data']) {
    assert.equal((await raw(origin, '/v1/attachment-answers', { method: 'POST', headers: { Origin: origin, ...(type ? { 'Content-Type': type } : {}) }, body: '{}' })).status, 415);
  }
  for (const badHeaders of [{ Origin: 'http://other.invalid' }, { Host: 'other.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await raw(origin, '/v1/attachment-answers', { method: 'POST', headers: { ...headers, ...badHeaders }, body: '{}' })).status, 403);
  }
  assert.equal((await raw(origin, '/v1/attachment-answers', { method: 'POST', headers: { ...headers, Authorization: 'Bearer synthetic', Cookie: sessionPair }, body: '{}' })).status, 400);
  for (const path of ['/v1/attachment-answers/more', '/v1/%61ttachment-answers', '/v1/attachment-answers/']) {
    assert.equal((await raw(origin, path, { method: 'POST', headers, body: '{}' })).status, 404);
  }
  assert.equal(calls, 0);
});

test('query attachment defaults permit exactly 28MiB and reject the next byte before forwarding', async t => {
  const sizes = [];
  const { origin } = await fixture(t, (req, res) => {
    let size = 0;
    req.on('data', chunk => { size += chunk.length; });
    req.on('end', () => { sizes.push(size); res.end('{}'); });
  });
  const limit = 28 * 1024 * 1024;
  const body = Buffer.alloc(limit, 0x20);
  body[0] = 0x7b; body[body.length - 1] = 0x7d;
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body };
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 200);
  assert.deepEqual(sizes, [limit]);
  assert.equal((await raw(origin, '/v1/attachment-answers', { ...options, body: Buffer.concat([body, Buffer.from(' ')]) })).status, 413);
  assert.deepEqual(sizes, [limit]);
});

test('query attachment budgets are independent and preserve ordinary deadlines, JSON and response caps', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push(req.url);
      if (Buffer.concat(chunks).toString() === 'large-response') res.end('x'.repeat(65));
      else setTimeout(() => res.end('{}'), 75);
    });
  }, { requestBytes: 32, attachmentBytes: 64, responseBytes: 64, deadlineMs: 30, answerDeadlineMs: 500 });
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: ' '.repeat(64) };
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 200);
  assert.equal((await raw(origin, '/v1/attachment-answers', { ...options, body: ' '.repeat(65) })).status, 413);
  assert.equal((await raw(origin, '/v1/answers', options)).status, 413);
  assert.equal((await raw(origin, '/v1/config')).status, 504);
  assert.equal((await raw(origin, '/v1/attachment-answers', { ...options, body: 'large-response' })).status, 502);
  assert.equal(seen.length, 3);
});

test('query attachment capacity is at most two and success or failure releases its independent reservation', async t => {
  const responses = [];
  const { origin } = await fixture(t, (req, res) => {
    req.resume();
    if (req.url === '/v1/attachment-answers') responses.push(res);
    else res.end('{}');
  });
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' };
  const first = raw(origin, '/v1/attachment-answers', options);
  const second = raw(origin, '/v1/attachment-answers', options);
  for (let i = 0; responses.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(responses.length, 2);
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 429);
  assert.equal((await raw(origin, '/v1/config')).status, 200);
  assert.equal((await raw(origin, '/v1/documents?filename=synthetic.txt', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, body: 'synthetic' })).status, 200);
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

test('query attachment answer deadline covers incoming bytes and complete response without retries', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (req, res) => {
    calls++; req.resume();
    if (calls === 1) res.write('{}');
    else req.socket.destroy();
  }, { deadlineMs: 30, answerDeadlineMs: 80 });
  const incoming = await new Promise((resolveResult, rejectResult) => {
    const req = http.request(`${origin}/v1/attachment-answers`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', () => { resolveResult(res.statusCode); req.end(); });
    });
    req.on('error', rejectResult); req.write('{');
  });
  assert.equal(incoming, 504); assert.equal(calls, 0);
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' };
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 504);
  assert.equal((await raw(origin, '/v1/attachment-answers', options)).status, 502);
  assert.equal(calls, 2);
});

test('query attachment size has a hard 28MiB maximum and permits only positive integer limits', async () => {
  for (const attachmentBytes of [0, -1, 1.5, 28 * 1024 * 1024 + 1, NaN]) {
    await assert.rejects(async () => {
      const server = await startDevServer({ port: 0, attachmentBytes });
      await new Promise(resolve => server.close(resolve));
    }, error => error.code === 'invalid_limit');
  }
});

async function fixture(t, handler = (_req, res) => res.end('{}'), options = {}) {
  const backend = http.createServer(handler).listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
  const frontend = await startDevServer({ backendOrigin, port: 0, ...options });
  t.after(async () => {
    await Promise.all([frontend, backend].map(server => new Promise(resolve => {
      server.close(resolve); server.closeAllConnections();
    })));
  });
  const origin = `http://127.0.0.1:${frontend.address().port}`;
  return { origin, backendOrigin, frontend, backend };
}

function raw(origin, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin, { path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('saved original routes and module are exact allowlisted reads with an independent binary budget', async t => {
  const seen = [];
  const { origin } = await fixture(t, (request, response) => {
    seen.push(request.url);
    response.setHeader('Content-Type', request.url.endsWith('/content') ? 'application/pdf' : 'application/json');
    response.end(request.url.endsWith('/content') ? '%PDF-synthetic' : '{"document_id":"doc-one"}');
  });
  assert.equal((await raw(origin, '/document-originals.mjs')).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/original')).status, 200);
  const file = await raw(origin, '/v1/documents/doc-one/revisions/rev-one/content');
  assert.equal(file.status, 200); assert.equal(file.body, '%PDF-synthetic');
  for (const path of ['/v1/documents/doc-one/original?x=1', '/v1/documents/doc-one/revisions/rev-one/content?x=1', '/v1/documents/doc-one/content']) {
    assert.notEqual((await raw(origin, path)).status, 200);
  }
  assert.notEqual((await raw(origin, '/v1/documents/doc-one/original', { method: 'POST', headers: { Origin: origin } })).status, 200);
  assert.deepEqual(seen, ['/v1/documents/doc-one/original', '/v1/documents/doc-one/revisions/rev-one/content']);
});

test('configuration permits only explicit literal-loopback HTTP origins and valid ports', () => {
  assert.deepEqual(readConfiguration({}), { backendOrigin: 'http://127.0.0.1:18084', port: 18085 });
  assert.equal(readConfiguration({ RAG_WEB_PORT: '18086' }).port, 18086);
  for (const value of ['http://localhost:18084', 'https://127.0.0.1:18084', 'http://127.1:18084', 'http://2130706433:18084', 'http://127.0.0.1:18084/', 'http://127.0.0.1:18084?q=x', 'http://127.0.0.1:18084#x', 'http://user@127.0.0.1:18084', 'http://example.invalid']) {
    assert.throws(() => readConfiguration({ RAG_WEB_BACKEND_ORIGIN: value }));
  }
  for (const value of ['0', '80', '-1', '1.2', '65536', '18085junk', '']) assert.throws(() => readConfiguration({ RAG_WEB_PORT: value }));
  assert.throws(() => readConfiguration({ NODE_ENV: 'production' }));
});

test('the development server rejects port 80 before binding or forwarding', async () => {
  await assert.rejects(startDevServer({ port: 80 }), error => error.code === 'invalid_port');
});

test('serves only six allowlisted files, with security headers and no directory/source access', async t => {
  const { origin } = await fixture(t);
  for (const path of ['/', '/index.html', '/app.js', '/api.mjs', '/notices.mjs', '/workbench-state.mjs', '/styles.css']) {
    const response = await raw(origin, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.match(response.headers['content-security-policy'], /default-src 'self'/);
    assert.match(response.headers['cache-control'], /no-store/);
  }
  for (const path of ['/../README.md', '/%2e%2e/README.md', '/.env', '/scripts/dev-server.mjs', '/public/', '/app.js/more', '//example.invalid/v1/config']) {
    assert.equal((await raw(origin, path)).status, 404, path);
  }
  assert.equal((await raw(origin, '/', { method: 'POST', headers: { Origin: origin } })).status, 405);
});

test('static symlinks cannot escape even through an allowlisted filename', async t => {
  const publicDirectory = await mkdtemp(join(tmpdir(), 'ai-knowledge-web-assets-'));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await symlink(new URL('../README.md', import.meta.url), join(publicDirectory, 'index.html'));
  const { origin } = await fixture(t, undefined, { publicDirectory });
  const response = await raw(origin, '/');
  assert.equal(response.status, 404);
  assert.doesNotMatch(response.body, /Quick|快速开始/);
});

test('API proxy preserves path/query, backend errors and only approved identity headers', async t => {
  let seen;
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    seen = { path: req.url, headers: req.headers };
    res.writeHead(503, { 'Content-Type': 'application/json', 'Location': 'http://elsewhere.invalid', 'X-Private': 'private' });
    res.end('{"status":"migration_incomplete"}');
  });
  const response = await raw(origin, '/v1/management/documents?page=2&q=%E7%9F%A5%E8%AF%86', {
    headers: { Origin: origin, 'X-Principal-Id': 'owner', 'X-Workspace-Id': 'org-main',
      Cookie: `irrelevant=private; ${sessionPair}`, 'X-Forwarded-Host': 'elsewhere.invalid',
      'X-Private': 'private' },
  });
  assert.equal(response.status, 503);
  assert.equal(seen.path, '/v1/management/documents?page=2&q=%E7%9F%A5%E8%AF%86');
  assert.equal(seen.headers.host, new URL(backendOrigin).host);
  assert.equal(seen.headers.origin, backendOrigin);
  assert.equal(seen.headers.cookie, sessionPair);
  assert.equal(seen.headers['x-principal-id'], 'owner');
  assert.equal(seen.headers['x-workspace-id'], 'org-main');
  assert.equal(seen.headers.authorization, undefined);
  assert.equal(seen.headers['x-private'], undefined);
  assert.equal(seen.headers['x-forwarded-host'], undefined);
  assert.equal(response.headers.location, undefined);
  assert.equal(response.headers['x-private'], undefined);
  assert.match(response.body, /migration_incomplete/);
});

test('origin/Host/fetch metadata checks fail before forwarding or rewriting', async t => {
  let requests = 0;
  const { origin } = await fixture(t, (_req, res) => { requests++; res.end('{}'); });
  const cases = [
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { method: 'POST', headers: { Origin: 'http://other.invalid', 'Content-Type': 'application/json' } },
    { headers: { Origin: 'null' } }, { headers: { Origin: `${origin}/` } },
    { headers: { Origin: [origin, origin] } },
    { headers: { Host: 'other.invalid' } }, { headers: { Host: new URL(origin).host.replace('127.0.0.1', 'localhost') } },
    { headers: { 'Sec-Fetch-Site': 'cross-site' } }, { headers: { 'Sec-Fetch-Site': 'same-site' } },
  ];
  for (const value of cases) assert.equal((await raw(origin, '/v1/session', value)).status, 403);
  assert.equal(requests, 0);
});

test('only current routes and methods forward; absolute, encoded and future API targets are rejected', async t => {
  let requests = 0;
  const { origin } = await fixture(t, (_req, res) => { requests++; res.end('{}'); });
  for (const path of ['/v1/visual-answers/extra', '/v1/uploads', '/v1/management/documents/%2e%2e', '/v1/management/../session', '/v1/config#x', 'http://other.invalid/v1/config']) {
    assert.equal((await raw(origin, path)).status, 404, path);
  }
  assert.equal((await raw(origin, '/v1/config', { method: 'DELETE', headers: { Origin: origin } })).status, 405);
  assert.equal((await raw(origin, '/v1/management/documents/synthetic-id')).status, 405);
  assert.equal(requests, 0);
});

test('JSON writes require same-origin, no redirects/retries, and session cookies are narrowly scoped', async t => {
  let calls = 0;
  let received = '';
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    calls++;
    assert.equal(req.headers.origin, backendOrigin);
    req.on('data', chunk => { received += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': [
        `${sessionPair}; Path=/; HttpOnly; SameSite=Strict`,
        'unrelated=synthetic; Path=/; HttpOnly; SameSite=Strict',
        `${sessionPair}; Domain=example.invalid; Path=/; HttpOnly; SameSite=Strict`,
      ] });
      res.end('{"status":"authenticated"}');
    });
  });
  const response = await raw(origin, '/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: exchangeBody });
  assert.equal(response.status, 200);
  assert.equal(received, exchangeBody);
  assert.deepEqual(response.headers['set-cookie'], [`${sessionPair}; Path=/; HttpOnly; SameSite=Strict`]);
  assert.equal(calls, 1);
  assert.equal((await raw(origin, '/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal(calls, 1);
  const patchBody = JSON.stringify({ display_name: 'Synthetic title' });
  const patch = await raw(origin, '/v1/management/documents/synthetic-id', {
    method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: patchBody,
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.headers['set-cookie'], undefined);
  assert.equal(received, exchangeBody + patchBody);
  assert.equal(calls, 2);
});

test('duplicate identity and cookie headers fail closed without reaching backend', async t => {
  let requests = 0;
  const { origin } = await fixture(t, (_req, res) => { requests++; res.end('{}'); });
  for (const headers of [{ Cookie: 'rag_session=one; rag_session=two' }, { 'X-Principal-Id': ['owner', 'reader'] }, { 'X-Workspace-Id': ['org-main', 'other'] },
    { Authorization: 'Bearer synthetic', Cookie: sessionPair }, { Authorization: ['Bearer synthetic', 'Bearer second'], Cookie: sessionPair }]) {
    assert.equal((await raw(origin, '/v1/management/documents', { headers })).status, 400);
  }
  assert.equal(requests, 0);
});

test('bounded request and response sizes, deadline, backend failure and redirects produce safe errors', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (req, res) => {
    calls++;
    if (req.url === '/health/live') { res.writeHead(302, { Location: 'http://other.invalid' }); res.end(); }
    else if (req.url === '/health/ready') res.end('x'.repeat(128));
    else if (req.url === '/v1/config') { /* exercise total deadline */ }
    else req.socket.destroy();
  }, { requestBytes: 32, responseBytes: 64, deadlineMs: 80 });
  assert.equal((await raw(origin, '/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(33) })).status, 413);
  assert.equal(calls, 0);
  for (const [path, expected] of [['/health/live', 502], ['/health/ready', 502], ['/v1/config', 504], ['/v1/management/documents', 502]]) {
    const response = await raw(origin, path);
    assert.equal(response.status, expected);
    assert.equal(response.headers.location, undefined);
    assert.doesNotMatch(response.body, /ECONN|stack|other\.invalid|127\.0\.0\.1/);
    assert.ok(JSON.parse(response.body).request_id);
  }
  assert.equal(calls, 4);
});

test('the deadline covers request upload and streamed backend response, not just headers', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; res.write('{}'); }, { deadlineMs: 100 });
  const first = await new Promise((resolveResult, rejectResult) => {
    const req = http.request(`${origin}/v1/session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } }, res => {
      res.resume();
      res.on('end', () => { resolveResult(res.statusCode); req.end(); });
    });
    req.on('error', rejectResult);
    req.write('{');
  });
  assert.equal(first, 504);
  assert.equal(calls, 0);
  assert.equal((await raw(origin, '/v1/config')).status, 504);
  assert.equal(calls, 1);
});

test('non-session responses cannot set cookies; malformed session attributes fail closed', async t => {
  const { origin } = await fixture(t, (_req, res) => {
    res.writeHead(200, { 'Set-Cookie': [
      `${sessionPair}; Path=/; HttpOnly; SameSite=Strict`,
      `${sessionPair}; Path=/; SameSite=Strict`,
      `${sessionPair}; Path=/; HttpOnly; SameSite=None`,
    ] });
    res.end('{}');
  });
  assert.equal((await raw(origin, '/v1/config')).headers['set-cookie'], undefined);
  const response = await raw(origin, '/v1/session', { method: 'DELETE', headers: { Origin: origin } });
  assert.deepEqual(response.headers['set-cookie'], [`${sessionPair}; Path=/; HttpOnly; SameSite=Strict`]);
});

test('only exact text upload receives binary body with independent upload size and deadline', async t => {
  let seen;
  const { origin } = await fixture(t, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen = { path: req.url, type: req.headers['content-type'], bytes: Buffer.concat(chunks) };
      setTimeout(() => { res.writeHead(202, { 'Content-Type': 'application/json' }); res.end('{}'); }, 75);
    });
  }, { requestBytes: 32, deadlineMs: 30, uploadBytes: 512, uploadDeadlineMs: 500 });
  const bytes = Buffer.from('原始文本'.repeat(10));
  const response = await raw(origin, '/v1/documents?filename=%E6%96%87%E6%A1%A3.md', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, body: bytes,
  });
  assert.equal(response.status, 202);
  assert.equal(seen.path, '/v1/documents?filename=%E6%96%87%E6%A1%A3.md');
  assert.equal(seen.type, 'application/octet-stream');
  assert.deepEqual(seen.bytes, bytes);
  const ordinary = await raw(origin, '/v1/session', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'x'.repeat(33) });
  assert.equal(ordinary.status, 413);
});

test('upload rejects missing/duplicate/unsafe filename, wrong type, empty/over-limit bytes and unsafe origin', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; res.end('{}'); }, { uploadBytes: 32 });
  const headers = { Origin: origin, 'Content-Type': 'application/octet-stream' };
  for (const suffix of ['', '?filename=a.txt&filename=b.txt', '?filename=a.txt&unknown=1', '?filename=video.avi', '?filename=../a.txt', '?filename=a%5Cb.md', '?filename=%FF.txt', '?filename=a%00.txt']) {
    assert.equal((await raw(origin, `/v1/documents${suffix}`, { method: 'POST', headers, body: 'x' })).status, 400, suffix);
  }
  assert.equal((await raw(origin, '/v1/documents?filename=a.txt', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 415);
  assert.equal((await raw(origin, '/v1/documents?filename=a.txt', { method: 'POST', headers })).status, 400);
  assert.equal((await raw(origin, '/v1/documents?filename=a.txt', { method: 'POST', headers, body: 'x'.repeat(33) })).status, 413);
  assert.equal((await raw(origin, '/v1/documents?filename=a.txt', { method: 'POST', headers: { ...headers, Origin: 'http://other.invalid' }, body: 'x' })).status, 403);
  assert.equal(calls, 0);
});

test('task GET and bodyless cancel/retry POST are precise routes, never broad API proxying', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { seen.push({ path: req.url, body: Buffer.concat(chunks).toString() }); res.end('{}'); });
  });
  assert.equal((await raw(origin, '/v1/ingestions/task-one')).status, 200);
  for (const action of ['cancel', 'retry']) assert.equal((await raw(origin, `/v1/ingestions/task-one/${action}`, { method: 'POST', headers: { Origin: origin } })).status, 200);
  assert.deepEqual(seen.map(value => value.body), ['', '', '']);
  assert.equal((await raw(origin, '/v1/ingestions/task-one/cancel', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  for (const path of ['/v1/ingestions', '/v1/ingestions/task-one/remove', '/v1/ingestions/task-one/retry/more']) assert.equal((await raw(origin, path)).status, 404);
  assert.equal(seen.length, 3);
});

test('at most two upload exchanges remain in flight and released capacity is reusable', async t => {
  const responses = [];
  const { origin } = await fixture(t, (req, res) => { req.resume(); responses.push(res); });
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, body: 'synthetic' };
  const first = raw(origin, '/v1/documents?filename=a.txt', options);
  const second = raw(origin, '/v1/documents?filename=b.txt', options);
  for (let i = 0; responses.length < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(responses.length, 2);
  assert.equal((await raw(origin, '/v1/documents?filename=c.txt', options)).status, 429);
  assert.equal(responses.length, 2);
  for (const response of responses) { response.writeHead(202); response.end('{}'); }
  assert.equal((await first).status, 202);
  assert.equal((await second).status, 202);
  const next = raw(origin, '/v1/documents?filename=d.txt', options);
  for (let i = 0; responses.length < 3 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(responses.length, 3);
  responses[2].writeHead(202); responses[2].end('{}');
  assert.equal((await next).status, 202);
});

test('index creation and task routes forward exact bodyless requests without changing identity', async t => {
  const seen = [];
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers });
      res.writeHead(req.method === 'POST' ? 202 : 200); res.end('{}');
    });
  });
  for (const [path, method] of [['/v1/documents/doc-one/index', 'POST'], ['/v1/indexings/index-one', 'GET'],
    ['/v1/indexings/index-one/cancel', 'POST'], ['/v1/indexings/index-one/retry', 'POST']]) {
    const result = await raw(origin, path, { method, headers: { Origin: origin, 'X-Principal-Id': 'owner', Cookie: `unrelated=private; ${sessionPair}` } });
    assert.equal(result.status, method === 'POST' ? 202 : 200, path);
  }
  assert.equal(seen.length, 4);
  for (const request of seen) {
    assert.equal(request.body, '');
    assert.equal(request.headers.origin, backendOrigin);
    assert.equal(request.headers.cookie, sessionPair);
    assert.equal(request.headers['x-principal-id'], 'owner');
    assert.equal(request.headers['content-type'], undefined);
  }
});

test('index routes reject query, body, wrong method, unsafe identity and expanded paths before forwarding', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; res.end('{}'); });
  const routes = [['/v1/documents/doc-one/index', 'POST'], ['/v1/indexings/index-one', 'GET'],
    ['/v1/indexings/index-one/cancel', 'POST'], ['/v1/indexings/index-one/retry', 'POST']];
  for (const [path, method] of routes) {
    const headers = { Origin: origin, 'Content-Type': 'application/json', 'Content-Length': '2' };
    for (const suffix of ['?', '?unknown=1', '?filename=synthetic.txt']) assert.equal((await raw(origin, path + suffix, { method, headers: { Origin: origin } })).status, 400, path + suffix);
    assert.equal((await raw(origin, path, { method, headers, body: '{}' })).status, 400);
    assert.equal((await raw(origin, path, { method: method === 'GET' ? 'POST' : 'GET', headers: { Origin: origin } })).status, 405);
    assert.equal((await raw(origin, path, { method, headers: { Origin: 'http://other.invalid' } })).status, 403);
    assert.equal((await raw(origin, path, { method, headers: { Origin: origin, Authorization: 'Bearer synthetic', Cookie: sessionPair } })).status, 400);
  }
  for (const path of ['/v1/documents/doc-one/index/more', '/v1/documents/%64oc/index', '/v1/indexings', '/v1/indexings/index-one/remove', '/v1/indexings/index-one/retry/more', '/v1/indexings/index.one']) {
    assert.equal((await raw(origin, path, { headers: { Origin: origin } })).status, 404, path);
  }
  assert.equal(calls, 0);
});

test('index writes retain ordinary deadline and never retry after an upstream failure', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (req, res) => {
    calls++;
    if (req.url.endsWith('/retry')) req.socket.destroy();
    else res.write('{}');
  }, { deadlineMs: 80, uploadDeadlineMs: 500 });
  for (const [path, expected] of [['/v1/documents/doc-one/index', 504], ['/v1/indexings/index-one/retry', 502]]) {
    assert.equal((await raw(origin, path, { method: 'POST', headers: { Origin: origin } })).status, expected);
  }
  assert.equal(calls, 2);
});

test('preview static module and local blob media are allowed without enabling remote media or API routes', async t => {
  const { origin } = await fixture(t);
  const response = await raw(origin, '/preview.mjs');
  assert.equal(response.status, 200);
  assert.match(response.headers['content-security-policy'], /img-src 'self' data: blob:;/);
  assert.match(response.headers['content-security-policy'], /media-src 'self' blob:;/);
  assert.match(response.headers['content-security-policy'], /object-src blob:;/);
  assert.match(response.headers['content-security-policy'], /connect-src 'self';/);
  assert.equal((await raw(origin, '/v1/documents/demo/content')).status, 404);
  assert.equal((await raw(origin, '/preview.mjs/more')).status, 404);
});

test('answers module is an exact static asset, not a directory or arbitrary script allowance', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-answers-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'answers.mjs'), 'export const synthetic = true;');
  const { origin } = await fixture(t, undefined, { publicDirectory });
  const result = await raw(origin, '/answers.mjs');
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(result.body, 'export const synthetic = true;');
  for (const path of ['/answers.mjs/more', '/answers.js', '/answers/', '/%61nswers.mjs']) {
    assert.equal((await raw(origin, path)).status, 404, path);
  }
});

test('answer POST preserves complete JSON scope, refusal responses and approved identity without retry', async t => {
  const seen = [];
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), headers: req.headers });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `${sessionPair}; Path=/; HttpOnly; SameSite=Strict` });
      res.end(JSON.stringify({ answer_id: 'synthetic-answer', status: 'abstained', answer: '', reason: 'no_evidence', citations: [] }));
    });
  });
  const bodies = [JSON.stringify({ question: '合成问题' }), JSON.stringify({ question: '合成问题', document_ids: ['doc-one', 'not-published'] }),
    JSON.stringify({ question: '合成问题', document_ids: [] })];
  for (const body of bodies) {
    const result = await raw(origin, '/v1/answers', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
      'X-Principal-Id': 'owner', 'X-Workspace-Id': 'org-main', Cookie: `unrelated=private; ${sessionPair}` }, body });
    assert.equal(result.status, 200);
    assert.equal(JSON.parse(result.body).reason, 'no_evidence');
    assert.equal(result.headers['set-cookie'], undefined);
  }
  assert.deepEqual(seen.map(value => value.body), bodies);
  assert.equal(seen.length, 3);
  for (const request of seen) {
    assert.equal(request.path, '/v1/answers');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.origin, backendOrigin);
    assert.equal(request.headers.cookie, sessionPair);
    assert.equal(request.headers['x-principal-id'], 'owner');
    assert.equal(request.headers['x-workspace-id'], 'org-main');
  }
});

test('answer and source transport permits only exact methods, unencoded IDs and source numbers 1..32', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => { seen.push(req.url); req.resume(); res.end('{}'); });
  for (const path of ['/v1/sources/answer-one/1', `/v1/sources/${'a'.repeat(128)}/32`]) {
    assert.equal((await raw(origin, path)).status, 200, path);
  }
  for (const path of ['/v1/sources', '/v1/sources/answer-one', '/v1/sources/answer-one/0', '/v1/sources/answer-one/01',
    '/v1/sources/answer-one/33', '/v1/sources/answer-one/-1', '/v1/sources/answer-one/1/more', '/v1/sources/answer.one/1',
    '/v1/sources/%61nswer-one/1', '/v1/sources/answer-one/%31', `/v1/sources/${'a'.repeat(129)}/1`,
    '/v1/answers/more', '/v1/%61nswers']) {
    assert.equal((await raw(origin, path, { headers: { Origin: origin } })).status, 404, path);
  }
  for (const path of ['/v1/answers', '/v1/sources/answer-one/1']) {
    const method = path === '/v1/answers' ? 'POST' : 'GET';
    for (const suffix of ['?', '?unknown=1']) {
      assert.equal((await raw(origin, path + suffix, { method, headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: method === 'POST' ? '{}' : undefined })).status, 400, path + suffix);
    }
    assert.equal((await raw(origin, path, { method: method === 'GET' ? 'POST' : 'GET', headers: { Origin: origin } })).status, 405);
    assert.equal((await raw(origin, path, { method, headers: { Origin: 'http://other.invalid', 'Content-Type': 'application/json' } })).status, 403);
    assert.equal((await raw(origin, path, { method, headers: { Origin: origin, Authorization: 'Bearer synthetic', Cookie: sessionPair } })).status, 400);
  }
  assert.equal((await raw(origin, '/v1/answers', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await raw(origin, '/v1/sources/answer-one/1', { headers: { 'Content-Length': '2' }, body: '{}' })).status, 400);
  assert.equal(seen.length, 2);
});

test('answer deadline is independent while request/response limits and ordinary deadline stay unchanged', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (req, res) => {
    calls++;
    req.resume();
    if (req.url === '/v1/sources/large/1') res.end('x'.repeat(65));
    else setTimeout(() => res.end('{}'), 75);
  }, { requestBytes: 32, responseBytes: 64, deadlineMs: 30, uploadDeadlineMs: 500, answerDeadlineMs: 500 });
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' };
  assert.equal((await raw(origin, '/v1/answers', options)).status, 200);
  assert.equal((await raw(origin, '/v1/config')).status, 504);
  assert.equal((await raw(origin, '/v1/answers', { ...options, body: 'x'.repeat(33) })).status, 413);
  assert.equal((await raw(origin, '/v1/sources/large/1')).status, 502);
  assert.equal(calls, 3);
});

test('answer deadline covers incoming body and complete response; upstream errors never cause retries', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (req, res) => {
    calls++;
    req.resume();
    if (calls === 1) res.write('{}');
    else req.socket.destroy();
  }, { deadlineMs: 30, answerDeadlineMs: 80 });
  const incoming = await new Promise((resolveResult, rejectResult) => {
    const req = http.request(`${origin}/v1/answers`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' } }, res => {
      res.resume();
      res.on('end', () => { resolveResult(res.statusCode); req.end(); });
    });
    req.on('error', rejectResult);
    req.write('{');
  });
  assert.equal(incoming, 504);
  assert.equal(calls, 0);
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' };
  assert.equal((await raw(origin, '/v1/answers', options)).status, 504);
  assert.equal((await raw(origin, '/v1/answers', options)).status, 502);
  assert.equal(calls, 2);
});

test('answer deadline has a hard 180 second maximum and accepts only positive integer limits', async () => {
  for (const answerDeadlineMs of [0, -1, 1.5, 180_001, NaN]) {
    await assert.rejects(async () => {
      const server = await startDevServer({ port: 0, answerDeadlineMs });
      await new Promise(resolveClosed => server.close(resolveClosed));
    }, error => error.code === 'invalid_limit');
  }
});

test('image routes forward exact visual POST, typed metadata and bounded source bytes', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => {
    seen.push(req.url);
    res.setHeader('Content-Type', req.url.endsWith('/content') ? 'image/png' : 'application/json');
    res.end(req.url.endsWith('/content') ? 'synthetic-image' : '{}');
  }, { responseBytes: 4, contentBytes: 20 });
  assert.equal((await raw(origin, '/v1/visual-answers', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  for (const prefix of ['sources', 'visual-sources']) {
    assert.equal((await raw(origin, `/v1/${prefix}/answer-1/1`)).status, 200);
    assert.equal((await raw(origin, `/v1/${prefix}/answer-1/1/content`)).body, 'synthetic-image');
  }
  const before = seen.length;
  for (const path of ['/v1/visual-sources/a/01', '/v1/visual-sources/a/33/content', '/v1/sources/%61/1/content', '/v1/visual-sources/a/1/content/more']) assert.equal((await raw(origin, path)).status, 404);
  for (const path of ['/v1/visual-sources/a/1?x=1', '/v1/sources/a/1/content?']) assert.equal((await raw(origin, path)).status, 400);
  assert.equal((await raw(origin, '/v1/visual-sources/a/1/content', { headers: { 'Content-Length': '1' }, body: 'x' })).status, 400);
  assert.equal(seen.length, before);
});

test('PNG/JPEG uploads get their own limit without expanding text or JSON limits', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; res.end('{}'); }, { uploadBytes: 20, imageUploadBytes: 10, requestBytes: 4 });
  const send = (name, size) => raw(origin, `/v1/documents?filename=${name}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/octet-stream' }, body: 'x'.repeat(size) });
  for (const name of ['a.png', 'a.JPG', 'a.jpeg']) assert.equal((await send(name, 10)).status, 200);
  assert.equal((await send('a.png', 11)).status, 413);
  assert.equal((await send('a.pdf', 20)).status, 200);
  assert.equal((await send('a.pdf', 21)).status, 413);
  assert.equal(calls, 4);
});

test('visual answer has an independent deadline while content retains ordinary deadline and no retries', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; setTimeout(() => res.end('{}'), 80); }, { deadlineMs: 25, answerDeadlineMs: 250 });
  assert.equal((await raw(origin, '/v1/visual-answers', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
  assert.equal((await raw(origin, '/v1/visual-sources/a/1/content')).status, 504);
  assert.equal(calls, 2);
});

test('content limits only shrink and oversized content fails before bytes reach the browser', async t => {
  for (const options of [{ contentBytes: 10 * 1024 * 1024 + 1 }, { imageUploadBytes: 10 * 1024 * 1024 + 1 }]) await assert.rejects(startDevServer({ port: 0, ...options }));
  const { origin } = await fixture(t, (_req, res) => res.end('12345'), { contentBytes: 4 });
  const response = await raw(origin, '/v1/sources/a/1/content');
  assert.equal(response.status, 502); assert.doesNotMatch(response.body, /12345/);
});

test('audio/video routes keep exact MIME upload distinction and independent frame/media limits', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => { seen.push([req.url, req.headers['content-type']]); res.end(req.url.endsWith('/content') || req.url.endsWith('/frame') ? '12345678' : '{}'); }, { responseBytes: 4, contentBytes: 6, mediaBytes: 10 });
  const upload = (type, name = 'clip.mp4') => raw(origin, '/v1/documents?filename=' + name, { method: 'POST', headers: { Origin: origin, 'Content-Type': type }, body: '123' });
  assert.equal((await upload('application/octet-stream')).status, 200);
  assert.equal((await upload('video/mp4')).status, 200);
  assert.equal((await upload('video/webm')).status, 400);
  assert.deepEqual(seen.slice(0, 2).map(value => value[1]), ['application/octet-stream', 'video/mp4']);
  for (const type of ['audio', 'video']) {
    assert.equal((await raw(origin, `/v1/${type}-answers`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1`)).status, 200);
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1/content`)).body, '12345678');
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1/content?`)).status, 400);
    assert.equal((await raw(origin, `/v1/${type}-sources/a/1/content/extra`)).status, 404);
  }
  assert.equal((await raw(origin, '/v1/video-sources/a/1/frame')).status, 502);
  assert.equal((await raw(origin, '/v1/audio-sources/a/1/frame')).status, 404);
  assert.equal((await raw(origin, '/media-sources.mjs')).status, 200);
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
  const { origin } = await fixture(t, handler, { publicDirectory });
  const headers = { Origin: origin, Cookie: sessionPair };
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
  const { origin } = await fixture(t, handler);
  const headers = { Origin: origin, Cookie: sessionPair }, path = '/v1/documents/doc-one/tag-suggestions';
  assert.equal((await raw(origin, path + '?', { headers })).status, 400);
  assert.equal((await raw(origin, path, { headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
  assert.equal((await raw(origin, path, { method: 'POST', headers })).status, 405);
  assert.equal((await raw(origin, path + '/apply', { headers })).status, 405);
  assert.equal((await raw(origin, path + '/apply?', { method: 'POST', headers })).status, 400);
  assert.equal((await raw(origin, path + '/apply', { method: 'POST', headers, body: '{}' })).status, 415);
  assert.equal((await raw(origin, path + '/apply/more', { method: 'POST', headers })).status, 404);
  assert.equal(calls, 0);
});

test('voice question exact asset and POST use independent media JSON capacity', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-voice-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'voice-question.mjs'), 'export const synthetic = true;');
  const seen = [];
  const { origin } = await fixture(t, (req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { seen.push({ path: req.url, body: Buffer.concat(chunks).toString() }); res.setHeader('Content-Type', 'application/json'); res.end('{}'); });
  }, { publicDirectory, requestBytes: 8, voiceBytes: 1024 });
  const headers = { Origin: origin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  assert.equal((await raw(origin, '/voice-question.mjs', { headers })).status, 200);
  const body = JSON.stringify({ filename: 'voice.wav', media_type: 'audio/wav', content_base64: 'AQID' });
  assert.equal((await raw(origin, '/v1/voice-questions', { method: 'POST', headers, body })).status, 200);
  assert.deepEqual(seen, [{ path: '/v1/voice-questions', body }]);
  assert.equal((await raw(origin, '/v1/management/folders', { method: 'POST', headers, body })).status, 413);
  assert.equal((await raw(origin, '/v1/voice-questions', { method: 'POST', headers, body: 'x'.repeat(1025) })).status, 413);
  assert.equal((await raw(origin, '/v1/voice-questions?', { method: 'POST', headers, body })).status, 400);
  assert.equal((await raw(origin, '/v1/voice-questions', { headers })).status, 405);
  assert.equal((await raw(origin, '/v1/voice-questions', { method: 'POST', headers: { Origin: origin }, body })).status, 415);
  assert.equal((await raw(origin, '/v1/voice-questions/extra', { method: 'POST', headers, body })).status, 404);
  assert.equal((await raw(origin, '/voice-question.mjs?', { headers })).status, 400);
  assert.equal(seen.length, 1);
});

test('voice transport retains its own deadline and two slots without retrying', async t => {
  let calls = 0;
  const { origin } = await fixture(t, (_req, res) => { calls++; setTimeout(() => res.end('{}'), 70); }, { deadlineMs: 15, voiceDeadlineMs: 250 });
  const options = { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' };
  const pending = [raw(origin, '/v1/voice-questions', options), raw(origin, '/v1/voice-questions', options)];
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await raw(origin, '/v1/voice-questions', options)).status, 429);
  assert.deepEqual((await Promise.all(pending)).map(response => response.status), [200, 200]);
  assert.equal(calls, 2);
  assert.equal((await raw(origin, '/v1/management/tags')).status, 504); assert.equal(calls, 3);
});

test('image vector exact reads and bodyless builds use independent build deadline and retain browser boundaries', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-image-vector-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'image-vectors.mjs'), 'export const synthetic = true;');
  const seen = [];
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    seen.push({ path: req.url, method: req.method, origin: req.headers.origin });
    if (req.method === 'POST' || req.url === '/v1/management/tags') setTimeout(() => res.end('{}'), 40); else res.end('{}');
  }, { publicDirectory, imageVectorDeadlineMs: 150, deadlineMs: 10 });
  const headers = { Origin: origin };
  assert.equal((await raw(origin, '/image-vectors.mjs')).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method: 'POST', headers })).status, 200);
  assert.equal(seen.length, 2); assert.equal(seen[1].origin, backendOrigin);
  for (const method of ['GET', 'POST']) {
    assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector?', { method, headers })).status, 400);
    assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method, headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
  }
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method: 'DELETE', headers })).status, 405);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector/more', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/%64oc-one/image-vector', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/doc-one/image-vector', { method: 'POST', headers: { Origin: 'http://other.invalid' } })).status, 403);
  assert.equal(seen.length, 2);
  assert.equal((await raw(origin, '/v1/management/tags', { headers })).status, 504);
  assert.equal(seen.length, 3, 'ordinary and build requests are never retried');
});

test('audio vector exact reads and bodyless builds use independent build deadline and retain browser boundaries', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'ai-knowledge-web-audio-vector-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'audio-vectors.mjs'), 'export const synthetic = true;');
  const seen = [];
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    seen.push({ path: req.url, method: req.method, origin: req.headers.origin });
    if (req.method === 'POST' || req.url === '/v1/management/tags') setTimeout(() => res.end('{}'), 40); else res.end('{}');
  }, { publicDirectory, audioVectorDeadlineMs: 150, deadlineMs: 10 });
  const headers = { Origin: origin };
  assert.equal((await raw(origin, '/audio-vectors.mjs')).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { headers })).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method: 'POST', headers })).status, 200);
  assert.equal(seen.length, 2); assert.equal(seen[1].origin, backendOrigin);
  for (const method of ['GET', 'POST']) {
    assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector?', { method, headers })).status, 400);
    assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method, headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
  }
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method: 'DELETE', headers })).status, 405);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector/more', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/%64oc-one/audio-vector', { headers })).status, 404);
  assert.equal((await raw(origin, '/v1/documents/doc-one/audio-vector', { method: 'POST', headers: { Origin: 'http://other.invalid' } })).status, 403);
  assert.equal(seen.length, 2);
  assert.equal((await raw(origin, '/v1/management/tags', { headers })).status, 504);
  assert.equal(seen.length, 3, 'ordinary and build requests are never retried');
});


test('model setup and retrieval routes forward only exact methods and bodies with the existing identity boundary', async t => {
  const seen = [];
  const handler = (req, res) => { const chunks=[]; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { seen.push({path:req.url,method:req.method,body:Buffer.concat(chunks).toString()}); res.setHeader('Content-Type','application/json');res.end('{}'); }); };
  const { origin } = await fixture(t, handler);
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Workspace-Id':'org-main', 'X-Principal-Id':'owner' };
  for (const [path, method, body] of [['/v1/model-configuration','GET',undefined],['/v1/model-configuration','PUT','{}'],['/v1/model-configuration/test','POST','{}'],['/v1/model-configuration/activate','POST','{}'],['/v1/retrieval-tests','POST','{}']]) {
    const response=await raw(origin,path,{method,headers,body});assert.equal(response.status,200,path);assert.match(response.headers['cache-control'],/no-store/u);
  }
  assert.equal(seen.length,5);assert.deepEqual(seen.map(item=>item.method),['GET','PUT','POST','POST','POST']);
  assert.deepEqual(seen.map(item=>item.body),['','{}','{}','{}','{}']);
});

test('model setup and retrieval reject empty queries extra routes wrong methods and non JSON before dispatch', async t => {
  let calls=0;const handler=(_req,res)=>{calls++;res.end('{}');};
  const { origin } = await fixture(t, handler);
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Workspace-Id':'org-main', 'X-Principal-Id':'owner' };
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
  const { origin } = await fixture(t, handler, { deadlineMs:20, modelTestDeadlineMs:250, retrievalDeadlineMs:250, requestBytes:32 });
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Workspace-Id':'org-main', 'X-Principal-Id':'owner' };
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
  const { origin, backendOrigin } = await fixture(t, handler);
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Principal-Id': 'owner', 'X-Workspace-Id': 'org-main' };
  const body = JSON.stringify({ base_publication_id: 'publication-old' });
  const result = await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers, body });
  assert.equal(result.status, 202); assert.match(result.headers['cache-control'], /no-store/u);
  assert.equal(seen.length, 1); assert.equal(seen[0].path, '/v1/documents/doc-one/reindex');
  assert.equal(seen[0].method, 'POST'); assert.equal(seen[0].body, body);
  assert.equal(seen[0].headers.origin, backendOrigin); assert.equal(seen[0].headers['x-principal-id'], 'owner'); assert.equal(seen[0].headers['x-workspace-id'], 'org-main');
});

test('reindex transport rejects queries expanded routes wrong methods and non JSON before forwarding', async t => {
  let calls = 0; const handler = (_req, res) => { calls++; res.end('{}'); };
  const { origin } = await fixture(t, handler);
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Principal-Id': 'owner', 'X-Workspace-Id': 'org-main' }; const body = '{"base_publication_id":"publication-old"}';
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
  const { origin } = await fixture(t, handler, { deadlineMs: 40, answerDeadlineMs: 500 });
  const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Principal-Id': 'owner', 'X-Workspace-Id': 'org-main' };
  const exact = '{"base_publication_id":"publication-old"}'.padEnd(128 * 1024, ' ');
  assert.equal((await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers, body: exact })).status, 200);
  assert.equal((await raw(origin, '/v1/documents/doc-one/reindex', { method: 'POST', headers, body: exact + ' ' })).status, 413);
  assert.equal((await raw(origin, '/v1/documents/doc-timeout/reindex', { method: 'POST', headers, body: '{"base_publication_id":"publication-old"}' })).status, 504);
  assert.equal(calls, 2, 'oversize was never forwarded and timeout was never retried');
});
