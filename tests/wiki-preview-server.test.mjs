import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPreviewServer } from '../scripts/wiki-preview-server.mjs';

const assets = [
  ['/', 'wiki-preview.html', 'text/html; charset=utf-8'],
  ['/wiki-preview.mjs', 'wiki-preview.mjs', 'text/javascript; charset=utf-8'],
  ['/wiki-preview-data.mjs', 'wiki-preview-data.mjs', 'text/javascript; charset=utf-8'],
  ['/wiki-preview.css', 'wiki-preview.css', 'text/css; charset=utf-8'],
];

async function fixture(t) {
  const publicDirectory = await mkdtemp(join(tmpdir(), 'wiki-preview-server-'));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await Promise.all(assets.map(([, file]) => writeFile(join(publicDirectory, file), `synthetic ${file}`)));
  const server = await createPreviewServer({ port: 0, publicDirectory });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal(server.address().address, '127.0.0.1');
  return `http://127.0.0.1:${server.address().port}`;
}

function request(origin, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(origin, { path, method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('0041 preview serves only the four fixed frontend assets with no network capability', async t => {
  const origin = await fixture(t);
  for (const [path, file, type] of assets) {
    const response = await request(origin, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, `synthetic ${file}`);
    assert.equal(response.headers['content-type'], type);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
    assert.match(response.headers['content-security-policy'], /style-src 'self'/);
    assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-inline|https?:/);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.equal(response.headers['set-cookie'], undefined);
    const head = await request(origin, path, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(head.headers['content-length'], response.headers['content-length']);
  }
});

test('0041 preview has no API, generic file, query, encoded path or traversal routes', async t => {
  const origin = await fixture(t);
  for (const path of ['/v1/config', '/v1/knowledge-answers', '/health/live', '/app.js', '/index.html', '/.env',
    '/wiki-preview.html', '/wiki-preview.mjs?', '/wiki-preview.css?x=1', '/../package.json',
    '/%2e%2e/package.json', '/%77iki-preview.mjs', '//wiki-preview.mjs', '/wiki-preview.mjs/more']) {
    const response = await request(origin, path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body, 'Not found');
  }
});

test('0041 preview rejects mutation methods without exposing a proxy', async t => {
  const origin = await fixture(t);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await request(origin, '/', { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, 'GET, HEAD');
    assert.equal(response.body, 'Method not allowed');
  }
});

test('0041 preview accepts only the exact bound loopback Host', async t => {
  const origin = await fixture(t);
  for (const host of ['other.invalid', 'localhost', '127.0.0.1', '127.0.0.1:1', 'other.invalid:18090']) {
    const response = await request(origin, '/', { headers: { Host: host } });
    assert.equal(response.status, 403, host);
    assert.equal(response.body, 'Forbidden');
  }
});

test('0041 preview validates its listening port before opening a socket', async () => {
  for (const port of [-1, 65536, 1.5, '18090', Number.NaN]) {
    await assert.rejects(createPreviewServer({ port }), /Invalid preview port/);
  }
});
