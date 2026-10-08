import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { startDevServer } from '../scripts/dev-server.mjs';
import { startExternalServer } from '../scripts/external-server.mjs';
import bundle from '../public/vendor/pdfjs/manifest.json' with { type: 'json' };

test('vendored PDF modules, worker, CMaps and fonts match the pinned manifest', async () => {
  assert.equal(bundle.version, '6.4.299');
  assert.equal(bundle.source, 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz');
  assert.equal(new Set(bundle.assets.map(asset => asset.path)).size, bundle.assets.length);
  for (const asset of bundle.assets) {
    assert.match(asset.file, /^vendor\/pdfjs\/(?:[A-Za-z0-9_.-]+|(?:cmaps|standard_fonts)\/[A-Za-z0-9_.-]+)$/u);
    assert.equal(asset.path, `/${asset.file}`);
    const bytes = await readFile(new URL(`../public/${asset.file}`, import.meta.url));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
});

for (const mode of ['development', 'external']) {
  test(`${mode} serves only explicit PDF assets with same-origin worker and authentication`, async t => {
    const publicOrigin = 'https://knowledge.example.invalid';
    const backend = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/health/entry-policy') res.end(JSON.stringify({ enabled: true, public_origin: publicOrigin, auth_mode: 'jwt' }));
      else if (req.url === '/v1/config') res.end(JSON.stringify({ auth_mode: 'jwt', capabilities: [] }));
      else if (req.url === '/v1/session') { res.statusCode = req.headers.cookie === 'rag_session=fixture' ? 200 : 401; res.end(JSON.stringify({ status: res.statusCode === 200 ? 'authenticated' : 'unauthorized' })); }
      else res.end('{}');
    }).listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const options = { backendOrigin: `http://127.0.0.1:${backend.address().port}`, port: 0 };
    const frontend = mode === 'development' ? await startDevServer(options) : await startExternalServer({ ...options, publicOrigin });
    t.after(async () => { await Promise.all([backend, frontend].map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }))); });
    const origin = `http://127.0.0.1:${frontend.address().port}`;
    const headers = mode === 'external' ? { Host: new URL(publicOrigin).host, Cookie: 'rag_session=fixture' } : {};
    for (const path of ['/pdf-preview.mjs', '/vendor/pdfjs/pdf.min.mjs', '/vendor/pdfjs/pdf.worker.min.mjs',
      '/vendor/pdfjs/cmaps/UniGB-UCS2-H.bcmap', '/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf']) {
      const response = await request(origin, path, headers);
      assert.equal(response.status, 200, path);
      assert.ok(response.body.length > 0);
      assert.match(response.headers['content-security-policy'], /worker-src 'self'/);
      assert.doesNotMatch(response.headers['content-security-policy'], /unsafe-eval|unsafe-inline|https:/);
    }
    for (const path of ['/vendor/pdfjs/unknown.mjs', '/vendor/pdfjs/package.json', '/vendor/pdfjs/manifest.json',
      '/vendor/pdfjs/pdf.min.mjs/extra', '/vendor/pdfjs/%70df.min.mjs']) {
      assert.equal((await request(origin, path, headers)).status, 404, path);
    }
    assert.equal((await request(origin, '/vendor/pdfjs/pdf.min.mjs?', headers)).status, 400);
    if (mode === 'external') {
      const anonymous = { ...headers }; delete anonymous.Cookie;
      assert.equal((await request(origin, '/vendor/pdfjs/pdf.min.mjs', anonymous)).status, 303);
    }
  });
}

function request(origin, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get(origin, { path, headers }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
  });
}
