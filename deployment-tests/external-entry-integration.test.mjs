import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startExternalServer } from '../scripts/external-server.mjs';

const publicOrigin = 'https://knowledge.example.invalid';
function request(origin, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(origin, { path, method, headers: { Host: 'knowledge.example.invalid', ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

test('external entry connects real isolated Java JAR: anonymous login, JWT exchange, authenticated app, ACL API and logout', { timeout: 30_000 }, async t => {
  const data = await mkdtemp(join(tmpdir(), 'knowledge-external-integration-'));
  const secret = randomBytes(48).toString('base64url'); // Ephemeral synthetic test only; never persisted or printed.
  const jar = process.env.RAG_EXTERNAL_ENTRY_JAR ?? fileURLToPath(new URL('../../artifacts/application-external-preview.jar', import.meta.url));
  const java = spawn('java', ['-jar', jar, '--server.port=0'], { env: {
    PATH: process.env.PATH, JAVA_HOME: process.env.JAVA_HOME, LANG: 'en_US.UTF-8',
    RAG_ENVIRONMENT: 'test', RAG_BIND_ADDRESS: '127.0.0.1', RAG_AUTH_MODE: 'jwt',
    RAG_JWT_SECRET: secret, RAG_JWT_ISSUER: 'integration-fixture', RAG_JWT_AUDIENCE: 'fixture-browser',
    RAG_WORKSPACE_ID: 'org-main', RAG_DATA_DIRECTORY: data,
    RAG_EXTERNAL_ENTRY_ENABLED: 'true', RAG_PUBLIC_ORIGIN: publicOrigin,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stopped = false;
  const exited = new Promise(resolve => java.once('exit', () => { stopped = true; resolve(); }));
  t.after(async () => {
    if (!stopped) { java.kill('SIGTERM'); await exited; }
    await rm(data, { recursive: true, force: true });
  });
  java.stderr.resume();
  const backendOrigin = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Isolated Java startup timed out')), 15_000);
    java.once('error', error => { clearTimeout(timer); reject(new Error('Cannot start isolated Java process')); });
    java.once('exit', () => { clearTimeout(timer); reject(new Error('Isolated Java exited before startup')); });
    java.stdout.on('data', chunk => {
      buffer = (buffer + chunk.toString()).slice(-4096);
      const match = buffer.match(/Tomcat started on port (\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  const gateway = await startExternalServer({ publicOrigin, backendOrigin, port: 0 });
  t.after(() => new Promise(resolve => { gateway.close(resolve); gateway.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  assert.equal((await request(origin, '/')).status, 303);
  assert.equal((await request(origin, '/login')).status, 200);
  assert.equal((await request(origin, '/v1/management/documents')).status, 401);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: 'integration-fixture', aud: 'fixture-browser', workspace_id: 'org-main', sub: 'synthetic-owner', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const signingInput = `${header}.${claims}`;
  const token = `${signingInput}.${createHmac('sha256', secret).update(signingInput).digest('base64url')}`;
  const login = await request(origin, '/v1/session', { method: 'POST', headers: { Origin: publicOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie']?.[0];
  assert.ok(cookie?.includes('Secure') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict'));
  const headers = { Cookie: cookie.split(';', 1)[0] };
  assert.equal((await request(origin, '/', { headers })).status, 200);
  assert.equal((await request(origin, '/app.js', { headers })).status, 200);
  assert.equal((await request(origin, '/v1/config', { headers })).status, 200);
  assert.equal((await request(origin, '/v1/management/documents', { headers })).status, 200);
  const foreign = await request(origin, '/v1/session', { method: 'POST', headers: { Origin: 'https://other.example.invalid', 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(foreign.status, 403);
  const logout = await request(origin, '/v1/session', { method: 'DELETE', headers: { ...headers, Origin: publicOrigin } });
  assert.equal(logout.status, 200);
  assert.ok(logout.headers['set-cookie']?.[0].includes('Max-Age=0'));
  assert.equal((await request(origin, '/', { headers: { Cookie: 'rag_session=' } })).status, 303);
});
