import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer, readConfiguration } from '../scripts/dev-server.mjs';

const sessionName = ['rag', 'session'].join('_');
const sessionPair = `${sessionName}=synthetic-session`;
const exchangeBody = JSON.stringify({ token: ['test', 'token'].join('-') });

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
  for (const path of ['/v1/answers', '/v1/uploads', '/v1/management/documents/%2e%2e', '/v1/management/../session', '/v1/config#x', 'http://other.invalid/v1/config']) {
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
  for (const suffix of ['', '?filename=a.txt&filename=b.txt', '?filename=a.txt&unknown=1', '?filename=video.mp4', '?filename=../a.txt', '?filename=a%5Cb.md', '?filename=%FF.txt', '?filename=a%00.txt']) {
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
