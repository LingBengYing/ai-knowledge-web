import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDevServer } from '../scripts/dev-server.mjs';
import { startExternalServer } from '../scripts/external-server.mjs';

const sourcePaths = ['/v1/wiki/pages/page-one/versions/2/sources/source-one', '/v1/wiki/proposals/proposal-one/sources/source-one'];
const publicOrigin = 'https://wiki.example.invalid';
const sessionPair = 'rag_session=REPLACE_ME';
const body = JSON.stringify({ title: '合成知识', body: '原样保留', version: 2 });
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('all requested document formats preserve original upload and replacement bytes on both transports', async t => {
  const extensions = 'pdf properties html vtt csv msg markdown eml ppt docx doc txt pptx mdx xls odt md xlsx xml epub htm'.split(' ');
  for (const external of [false, true]) {
    const seen = [];
    const { origin } = await fixture(t, (req, res) => { const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { seen.push([req.url, req.headers['content-type'], Buffer.concat(chunks).toString()]); res.end('{}'); }); }, {}, external);
    const headers = external ? { Host: new URL(publicOrigin).host, Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/octet-stream' } : { Origin: origin, 'Content-Type': 'application/octet-stream' };
    for (const extension of extensions) {
      for (const path of [`/v1/documents?filename=synthetic.${extension}`, `/v1/documents/doc-one/replacement?filename=synthetic.${extension}&base_revision_id=rev-one`]) {
        assert.equal((await raw(origin, path, { method: 'POST', headers, body: 'synthetic original bytes' })).status, 200, path);
      }
    }
    assert.equal(seen.length, 42); assert.ok(seen.every(([, type, bytes]) => type === 'application/octet-stream' && bytes === 'synthetic original bytes'));
    assert.equal((await raw(origin, '/v1/documents?filename=synthetic.zip', { method: 'POST', headers, body: 'x' })).status, 400);
  }
});

test('original downloads preserve only bounded attachment protection on 200 and 206 responses', async t => {
  const originals = ['/v1/documents/doc-one/revisions/rev-one/content', '/v1/synopsis-sources/synopsis-one/1/1/content', ...sourcePaths.map(path => `${path}/content`)];
  for (const external of [false, true]) {
    let responseStatus = 200, disposition = 'attachment', policy = "sandbox; default-src 'none'";
    const { origin } = await fixture(t, (_req, res) => {
      res.statusCode = responseStatus;
      res.setHeader('Content-Type', 'text/html'); res.setHeader('Content-Disposition', disposition);
      res.setHeader('Content-Security-Policy', policy); res.setHeader('X-Content-Type-Options', 'unsafe');
      res.setHeader('X-Internal-Secret', 'synthetic-only'); res.setHeader('Access-Control-Allow-Origin', '*');
      res.end('<p>synthetic original</p>');
    }, {}, external);
    const headers = external ? { Host: new URL(publicOrigin).host, Cookie: sessionPair } : {};
    for (const status of [200, 206]) {
      responseStatus = status;
      for (const path of originals) {
        const result = await raw(origin, path, { headers });
        assert.equal(result.status, status); assert.equal(result.body, '<p>synthetic original</p>');
        assert.equal(result.headers['content-disposition'], 'attachment', path);
        assert.equal(result.headers['content-security-policy'], "sandbox; default-src 'none'");
        assert.equal(result.headers['x-content-type-options'], 'nosniff');
        assert.equal(result.headers['x-internal-secret'], undefined);
        assert.equal(result.headers['access-control-allow-origin'], undefined);
      }
    }
    responseStatus = 200;
    const metadata = await raw(origin, '/v1/documents/doc-one/original', { headers });
    assert.equal(metadata.headers['content-disposition'], undefined);
    assert.match(metadata.headers['content-security-policy'], /default-src 'self'/u);
    disposition = 'inline'; policy = "default-src *; script-src 'unsafe-inline'";
    const unsafe = await raw(origin, originals[0], { headers });
    assert.equal(unsafe.headers['content-disposition'], undefined);
    assert.match(unsafe.headers['content-security-policy'], /default-src 'self'/u);
    assert.equal(unsafe.headers['x-content-type-options'], 'nosniff');
  }
});

test('Wiki lifecycle routes keep double CAS, bodyless delete and exact restore on both transports', async t => {
  for (const external of [false, true]) {
    const seen = [];
    const { origin } = await fixture(t, (req, res) => { const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { seen.push([req.url, req.method, Buffer.concat(chunks).toString()]); res.end('{}'); }); }, {}, external);
    const headers = external ? { Host: new URL(publicOrigin).host, Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' } : { Origin: origin, 'Content-Type': 'application/json' };
    const deletion = '/v1/wiki/pages/page-one?version=2&lifecycle_version=0';
    assert.equal((await raw(origin, '/v1/wiki/pages?state=deleted', { headers })).status, 200);
    assert.equal((await raw(origin, deletion, { method: 'DELETE', headers })).status, 200);
    assert.equal((await raw(origin, '/v1/wiki/pages/page-one/restore', { method: 'POST', headers, body: '{"version":2,"lifecycle_version":1}' })).status, 200);
    assert.equal((await raw(origin, deletion, { method: 'DELETE', headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
    assert.equal((await raw(origin, `${deletion}&lifecycle_version=1`, { method: 'DELETE', headers })).status, 400);
    assert.equal((await raw(origin, '/v1/wiki/pages/page-one/versions/2', { method: 'DELETE', headers })).status, 405);
    assert.equal((await raw(origin, '/v1/wiki/pages/page-one/restore?version=2', { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal(seen.length, 3);
    assert.equal(seen[1][2], '');
  }
});

test('Wiki permanent deletion is bodyless double CAS DELETE only on both transports', async t => {
  for (const external of [false, true]) {
    const seen = [];
    const { origin } = await fixture(t, (req, res) => { seen.push([req.url, req.method]); res.end('{"page_id":"page-one","state":"purged"}'); }, {}, external);
    const headers = external ? { Host: new URL(publicOrigin).host, Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' } : { Origin: origin, 'Content-Type': 'application/json' };
    const path = '/v1/wiki/pages/page-one/purge?version=4&lifecycle_version=2';
    assert.equal((await raw(origin, path, { method: 'DELETE', headers })).status, 200);
    for (const invalid of ['/v1/wiki/pages/page-one/purge', `${path}&unexpected=1`, `${path}&version=4`, '/v1/wiki/pages/page-one/purge?version=0&lifecycle_version=2']) {
      assert.equal((await raw(origin, invalid, { method: 'DELETE', headers })).status, 400);
    }
    assert.equal((await raw(origin, path, { method: 'DELETE', headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
    for (const method of ['GET', 'POST']) {
      assert.equal((await raw(origin, '/v1/wiki/pages/page-one/purge', { method, headers })).status, 405);
      assert.equal((await raw(origin, path, { method, headers })).status, external ? 400 : 405);
    }
    assert.equal((await raw(origin, path, { method: 'DELETE', headers: { ...headers, Origin: 'http://unexpected.invalid' } })).status, 403);
    assert.equal((await raw(origin, '/v1/wiki/pages/page-one/purge/extra', { method: 'DELETE', headers })).status, 404);
    assert.deepEqual(seen, [[path, 'DELETE']]);
  }
});

function raw(origin, path, { method = 'GET', headers = {}, body: content } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(origin, { path, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject); request.end(content);
  });
}

async function fixture(t, handler = (_req, res) => res.end('{}'), options = {}, external = false) {
  const backend = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (external && req.url === '/health/entry-policy') return res.end(JSON.stringify({ enabled: true, public_origin: publicOrigin, auth_mode: 'jwt' }));
    if (external && req.url === '/v1/config') return res.end(JSON.stringify({ auth_mode: 'jwt', capabilities: [] }));
    if (external && req.url === '/v1/session' && req.method === 'GET') {
      res.statusCode = req.headers.cookie === sessionPair ? 200 : 401;
      return res.end(JSON.stringify({ status: res.statusCode === 200 ? 'authenticated' : 'unauthorized' }));
    }
    handler(req, res);
  }).listen(0, '127.0.0.1');
  await once(backend, 'listening'); t.after(() => close(backend));
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
  const frontend = await (external ? startExternalServer({ publicOrigin, backendOrigin, port: 0, ...options }) : startDevServer({ backendOrigin, port: 0, ...options }));
  t.after(() => close(frontend));
  return { origin: `http://127.0.0.1:${frontend.address().port}`, backendOrigin };
}

test('Wiki exact reads and persistent mutations preserve payloads, methods, identity and CAS query', async t => {
  const seen = [];
  const { origin, backendOrigin } = await fixture(t, (req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
      seen.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }); res.end('{}');
    });
  });
  const headers = { Origin: origin, Cookie: `unrelated=ignored; ${sessionPair}`, 'Content-Type': 'application/json', 'X-Workspace-Id': 'org-main', 'X-Principal-Id': 'owner' };
  const requests = [
    ['/v1/wiki/catalog?offset=20&limit=20&q=%E7%81%AF%E5%A1%94&kind=video', 'GET'], ['/v1/wiki/pages?offset=0&limit=100&q=manual', 'GET'],
    ['/v1/wiki/pages/page-one', 'GET'], ['/v1/wiki/pages/page-one/versions/2', 'GET'], ['/v1/wiki/proposals?offset=0&limit=20&status=accepted', 'GET'],
    ['/v1/wiki/proposals/proposal-one', 'GET'], ['/v1/wiki/proposals', 'POST'], ['/v1/wiki/proposals/proposal-one/accept', 'POST'],
    ['/v1/wiki/proposals/proposal-one/dismiss', 'POST'], ['/v1/wiki/drafts?offset=0&limit=100', 'GET'], ['/v1/wiki/drafts', 'POST'],
    ['/v1/wiki/drafts/draft-one', 'GET'], ['/v1/wiki/drafts/draft-one', 'PUT'], ['/v1/wiki/drafts/draft-one?version=2', 'DELETE'],
  ];
  for (const [path, method] of requests) {
    const result = await raw(origin, path, { method, headers, ...(['POST', 'PUT'].includes(method) ? { body } : {}) });
    assert.equal(result.status, 200, `${method} ${path}`); assert.match(result.headers['cache-control'], /no-store/u);
  }
  assert.deepEqual(seen.map(item => [item.path, item.method]), requests);
  for (const item of seen) {
    assert.equal(item.headers.origin, backendOrigin); assert.equal(item.headers.cookie, sessionPair);
    assert.equal(item.headers['x-workspace-id'], 'org-main'); assert.equal(item.headers['x-principal-id'], 'owner');
    assert.equal(item.body, ['POST', 'PUT'].includes(item.method) ? body : '');
  }
});

test('Wiki transport rejects wrong methods, query keys, duplicate parameters and expanded routes before upstream', async t => {
  let calls = 0; const { origin } = await fixture(t, (_req, res) => { calls++; res.end('{}'); });
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  for (const [path, method] of [['/v1/wiki/catalog', 'POST'], ['/v1/wiki/pages', 'PUT'], ['/v1/wiki/pages/page-one', 'PUT'],
    ['/v1/wiki/proposals', 'DELETE'], ['/v1/wiki/proposals/proposal-one', 'PUT'], ['/v1/wiki/proposals/proposal-one/accept', 'GET'], ['/v1/wiki/drafts/draft-one', 'POST']]) {
    assert.equal((await raw(origin, path, { method, headers })).status, 405, `${method} ${path}`);
  }
  for (const [path, method] of [['/v1/wiki/pages?kind=topic', 'GET'], ['/v1/wiki/catalog?offset=0&offset=1', 'GET'],
    ['/v1/wiki/drafts?q=word', 'GET'], ['/v1/wiki/proposals?offset=0', 'POST'], ['/v1/wiki/proposals?', 'POST'],
    ['/v1/wiki/proposals/proposal-one/accept?base_version=1', 'POST'], ['/v1/wiki/drafts/draft-one?version=1', 'GET'],
    ['/v1/wiki/drafts/draft-one?version=1', 'PUT'], ['/v1/wiki/drafts/draft-one?version=1&version=2', 'DELETE'],
    ['/v1/wiki/drafts/draft-one?unknown=2', 'DELETE'], ['/v1/wiki/pages/page-one?', 'GET'],
    ['/v1/wiki/pages/page-one', 'DELETE'], ['/v1/wiki/pages/page-one?version=1', 'DELETE']]) {
    assert.equal((await raw(origin, path, { method, headers, ...(['POST', 'PUT'].includes(method) ? { body } : {}) })).status, 400, `${method} ${path}`);
  }
  for (const path of ['/v1/wiki/pages/%70age-one', '/v1/wiki/pages/page.one', '/v1/wiki/pages/page-one/versions/0',
    '/v1/wiki/pages/page-one/versions/01', '/v1/wiki/pages/page-one/versions/2/more', '/v1/wiki/proposals/proposal-one/undo', '/v1/wiki/drafts/draft-one/more']) {
    assert.equal((await raw(origin, path, { headers })).status, 404, path);
  }
  assert.equal(calls, 0);
});

test('Wiki writes require same origin and JSON while delete and all reads are bodyless', async t => {
  let calls = 0; const { origin } = await fixture(t, (_req, res) => { calls++; res.end('{}'); });
  const path = '/v1/wiki/drafts';
  assert.equal((await raw(origin, path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await raw(origin, path, { method: 'POST', headers: { Origin: 'http://other.invalid', 'Content-Type': 'application/json' }, body })).status, 403);
  assert.equal((await raw(origin, path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body })).status, 415);
  assert.equal((await raw(origin, path, { headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await raw(origin, path, { headers: { Origin: origin, Authorization: 'Bearer synthetic' } })).status, 400);
  const headers = { Origin: origin, 'Content-Length': Buffer.byteLength(body), 'Content-Type': 'application/json' };
  assert.equal((await raw(origin, '/v1/wiki/pages', { headers, body })).status, 400);
  assert.equal((await raw(origin, '/v1/wiki/drafts/draft-one?version=2', { method: 'DELETE', headers, body })).status, 400);
  assert.equal(calls, 0);
});

test('Wiki source metadata, originals and frames have independent exact routes and byte budgets', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => {
    seen.push(req.url); res.setHeader('Content-Type', req.url.endsWith('/content') ? 'video/mp4' : req.url.endsWith('/frame') ? 'image/png' : 'application/json');
    res.end(req.url.endsWith('/content') || req.url.endsWith('/frame') ? '12345678' : '{}');
  }, { responseBytes: 4, contentBytes: 6, mediaBytes: 10 });
  for (const path of sourcePaths) {
    assert.equal((await raw(origin, path)).status, 200);
    const content = await raw(origin, `${path}/content`); assert.equal(content.status, 200); assert.equal(content.body, '12345678');
    assert.equal(content.headers['content-type'], 'video/mp4');
    assert.equal((await raw(origin, `${path}/frame`)).status, 502);
    for (const suffix of ['?', '/content?', '/frame?x=1']) assert.equal((await raw(origin, `${path}${suffix}`)).status, 400);
    assert.equal((await raw(origin, `${path}/content/more`)).status, 404);
    assert.equal((await raw(origin, `${path}/frame`, { method: 'POST', headers: { Origin: origin } })).status, 405);
  }
  assert.equal(seen.length, 6);
});

test('only proposal compilation receives the answer deadline; Wiki writes never gain upload limits or retries', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => {
    seen.push([req.url, req.method]); req.resume(); setTimeout(() => res.end('{}'), 90);
  }, { deadlineMs: 25, answerDeadlineMs: 500, requestBytes: 64 });
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  assert.equal((await raw(origin, '/v1/wiki/proposals', { method: 'POST', headers, body: '{}' })).status, 200);
  assert.equal((await raw(origin, '/v1/wiki/proposals', { headers })).status, 504);
  assert.equal((await raw(origin, '/v1/wiki/proposals/proposal-one/accept', { method: 'POST', headers, body: '{}' })).status, 504);
  assert.equal((await raw(origin, '/v1/wiki/drafts', { method: 'POST', headers, body: '{}' })).status, 504);
  assert.equal((await raw(origin, '/v1/wiki/proposals', { method: 'POST', headers, body: 'x'.repeat(65) })).status, 413);
  assert.equal(seen.length, 4, 'no oversized forward and no retry after timeout');
});

test('only draft POST and PUT admit the exact 512 KiB draft body on both transports', async t => {
  for (const external of [false, true]) {
    const seen = [];
    const { origin } = await fixture(t, (req, res) => {
      let bytes = 0; req.on('data', chunk => { bytes += chunk.length; });
      req.on('end', () => { seen.push({ path: req.url, method: req.method, bytes }); res.end('{}'); });
    }, {}, external);
    const headers = external ? { Host: new URL(publicOrigin).host, Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' }
      : { Origin: origin, 'Content-Type': 'application/json' };
    const exact = '{"title":"Synthetic","body":"正文"}'.padEnd(512 * 1024 - 4, ' ');
    assert.equal(Buffer.byteLength(exact), 512 * 1024);
    for (const [path, method] of [['/v1/wiki/drafts', 'POST'], ['/v1/wiki/drafts/draft-one', 'PUT']]) {
      assert.equal((await raw(origin, path, { method, headers, body: exact })).status, 200, `${external} ${method}`);
      assert.equal((await raw(origin, path, { method, headers, body: exact + ' ' })).status, 413, `${external} ${method} excess`);
    }
    assert.equal((await raw(origin, '/v1/wiki/proposals', { method: 'POST', headers, body: 'x'.repeat(128 * 1024 + 1) })).status, 413);
    assert.equal((await raw(origin, '/v1/wiki/proposals/proposal-one/accept', { method: 'POST', headers, body: 'x'.repeat(128 * 1024 + 1) })).status, 413);
    assert.deepEqual(seen, [{ path: '/v1/wiki/drafts', method: 'POST', bytes: 512 * 1024 }, { path: '/v1/wiki/drafts/draft-one', method: 'PUT', bytes: 512 * 1024 }]);
  }
});

test('Wiki root entry and classic alias serve distinct exact assets without exposing preview data', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'wiki-transport-assets-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  const files = { 'wiki-workspace.html': '<main>Live Wiki</main>', 'index.html': '<main>Classic management</main>',
    'wiki-workspace.mjs': 'export const live = true;', 'wiki-workspace-api.mjs': 'export const api = true;',
    'wiki-retrieval.mjs': 'export const retrieval = true;', 'wiki-maintenance.mjs': 'export const maintenance = true;',
    'wiki-workspace.css': 'body { color: green; }', 'wiki-preview.css': 'body { margin: 0; }' };
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(publicDirectory, name), content)));
  const { origin } = await fixture(t, undefined, { publicDirectory, wikiEntry: true });
  assert.equal((await raw(origin, '/')).body, files['wiki-workspace.html']);
  assert.equal((await raw(origin, '/classic/')).body, files['index.html']);
  assert.equal((await raw(origin, '/index.html')).body, files['index.html']);
  for (const path of ['/wiki/', '/wiki-workspace.html', '/wiki-workspace.mjs', '/wiki-workspace-api.mjs', '/wiki-retrieval.mjs', '/wiki-maintenance.mjs', '/wiki-workspace.css', '/wiki-preview.css']) {
    const response = await raw(origin, path); assert.equal(response.status, 200, path); assert.match(response.headers['cache-control'], /no-store/u);
    assert.equal((await raw(origin, path, { method: 'HEAD' })).status, 200, path);
    assert.equal((await raw(origin, path, { method: 'POST', headers: { Origin: origin } })).status, 405, path);
  }
  for (const path of ['/wiki-preview-data.mjs', '/wiki-workspace.mjs/extra', '/%77iki-workspace.mjs']) assert.equal((await raw(origin, path)).status, 404, path);
  const ordinary = await fixture(t, undefined, { publicDirectory });
  assert.equal((await raw(ordinary.origin, '/')).body, files['index.html'], 'non-Wiki developer entry is unchanged');
  const external = await fixture(t, undefined, { publicDirectory, wikiEntry: true }, true);
  const headers = { Host: new URL(publicOrigin).host, Cookie: sessionPair };
  assert.equal((await raw(external.origin, '/', { headers })).body, files['wiki-workspace.html'], 'production entry can select the live Wiki root');
  assert.equal((await raw(external.origin, '/classic/', { headers })).body, files['index.html']);
  for (const name of ['wiki-retrieval.mjs', 'wiki-maintenance.mjs']) {
    assert.equal((await raw(external.origin, `/${name}`, { headers })).body, files[name]);
    assert.equal((await raw(external.origin, `/${name}/extra`, { headers })).status, 404);
    assert.equal((await raw(external.origin, `/${name}?x=1`, { headers })).status, 400);
  }
  assert.equal((await raw(external.origin, '/', { headers: { Host: headers.Host } })).status, 303, 'the root selection preserves standard session enforcement');
  const ordinaryExternal = await fixture(t, undefined, { publicDirectory }, true);
  assert.equal((await raw(ordinaryExternal.origin, '/', { headers })).body, files['index.html'], 'default production entry remains unchanged');
});

test('Wiki named static assets reject query strings on the exact allowlist', async t => {
  const publicDirectory = await realpath(await mkdtemp(join(tmpdir(), 'wiki-transport-query-assets-')));
  t.after(() => rm(publicDirectory, { recursive: true, force: true }));
  await writeFile(join(publicDirectory, 'wiki-workspace.mjs'), 'export const live = true;');
  const { origin } = await fixture(t, undefined, { publicDirectory, wikiEntry: true });
  assert.equal((await raw(origin, '/wiki-workspace.mjs?')).status, 400);
  assert.equal((await raw(origin, '/wiki-workspace.mjs?target=http://other.invalid')).status, 400);
});

test('standard external Wiki routes preserve session and exact public-origin boundaries', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { seen.push({ path: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() }); res.end('{}'); });
  }, {}, true);
  const headers = { Host: new URL(publicOrigin).host, Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' };
  assert.equal((await raw(origin, '/v1/wiki/pages', { headers: { Host: headers.Host } })).status, 401);
  for (const [path, method] of [['/v1/wiki/catalog?q=synthetic', 'GET'], ['/v1/wiki/proposals', 'POST'], ['/v1/wiki/drafts/draft-one', 'PUT'], ['/v1/wiki/drafts/draft-one?version=2', 'DELETE'], [sourcePaths[0], 'GET']]) {
    assert.equal((await raw(origin, path, { method, headers, ...(['POST', 'PUT'].includes(method) ? { body } : {}) })).status, 200, path);
  }
  assert.equal((await raw(origin, '/v1/wiki/drafts/draft-one?version=2', { method: 'DELETE', headers: { ...headers, Origin: 'https://other.invalid' } })).status, 403);
  assert.equal((await raw(origin, '/v1/wiki/proposals?offset=0', { method: 'POST', headers, body })).status, 400);
  assert.equal((await raw(origin, '/v1/wiki/catalog?unknown=1', { headers })).status, 400);
  assert.equal((await raw(origin, '/v1/wiki/drafts/draft-one?version=2', { method: 'DELETE', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, body })).status, 400);
  assert.equal(seen.length, 5);
  for (const request of seen) {
    assert.equal(request.headers.origin, publicOrigin); assert.equal(request.headers.cookie, sessionPair); assert.equal(request.headers['x-principal-id'], undefined);
  }
});

test('Agent transports allow only four exact routes with existing session, origin and ordinary JSON limits', async t => {
  for (const external of [false, true]) {
    const seen = [];
    const { origin } = await fixture(t, (req, res) => {
      const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { seen.push([req.url, req.method, Buffer.concat(chunks).toString(), req.headers.cookie]); res.statusCode = req.method === 'POST' && req.url.endsWith('/runs') ? 202 : 200; res.end('{}'); });
    }, { requestBytes: 128 }, external);
    const headers = external ? { Host: new URL(publicOrigin).host, Origin: publicOrigin, Cookie: sessionPair, 'Content-Type': 'application/json' }
      : { Origin: origin, Cookie: sessionPair, 'Content-Type': 'application/json' };
    const paths = [['/v1/knowledge-agent/config', 'GET'], ['/v1/knowledge-agent/runs', 'POST'], ['/v1/knowledge-agent/runs/run-one', 'GET'], ['/v1/knowledge-agent/runs/run-one/cancel', 'POST']];
    for (const [path, method] of paths) assert.equal((await raw(origin, path, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) })).status, path.endsWith('/runs') ? 202 : 200);
    assert.deepEqual(seen.map(([path, method]) => [path, method]), paths);
    assert.ok(seen.every(([, , , cookie]) => cookie === sessionPair));
    for (const [path, method] of [['/v1/knowledge-agent/config', 'POST'], ['/v1/knowledge-agent/runs', 'GET'], ['/v1/knowledge-agent/runs/run-one', 'DELETE'], ['/v1/knowledge-agent/runs/run-one/cancel', 'GET']]) {
      assert.equal((await raw(origin, path, { method, headers })).status, 405);
    }
    for (const [path, method] of paths) assert.equal((await raw(origin, `${path}?`, { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) })).status, 400);
    for (const path of ['/v1/knowledge-agent/runs/run-one/more', '/v1/knowledge-agent/runs/%72un-one', '/v1/knowledge-agent/internal/callback', '/internal/knowledge-agent/tools']) assert.equal((await raw(origin, path, { headers })).status, 404);
    assert.equal((await raw(origin, paths[1][0], { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body: '{}' })).status, 403);
    assert.equal((await raw(origin, paths[1][0], { method: 'POST', headers, body: 'x'.repeat(129) })).status, 413);
    assert.equal((await raw(origin, paths[1][0], { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await raw(origin, paths[0][0], { headers: { ...headers, 'Content-Length': '2' }, body: '{}' })).status, 400);
    assert.equal(seen.length, 4, 'rejected paths and payloads never reach Java');
  }
});

test('Agent start and cancel keep ordinary request deadlines and never automatically retry', async t => {
  const seen = [];
  const { origin } = await fixture(t, (req, res) => { seen.push(req.url); req.resume(); setTimeout(() => res.end('{}'), 90); }, { deadlineMs: 25, answerDeadlineMs: 500 });
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  for (const path of ['/v1/knowledge-agent/runs', '/v1/knowledge-agent/runs/run-one/cancel']) assert.equal((await raw(origin, path, { method: 'POST', headers, body: '{}' })).status, 504);
  assert.deepEqual(seen, ['/v1/knowledge-agent/runs', '/v1/knowledge-agent/runs/run-one/cancel']);
});
