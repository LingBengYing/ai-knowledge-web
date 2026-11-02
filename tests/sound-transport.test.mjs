import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proxyFixture as fixture, publicOrigin, cookie } from './transport-fixture.mjs';

for (const external of [false, true]) {
  const name = external ? 'external' : 'development';
  test(`${name} sound transport preserves raw upload and explicit index build`, async t => {
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
    }, { publicDirectory: directory, requestBytes: 32 });
    assert.equal((await request('/sound-library.mjs')).status, 200);
    const encoded = encodeURIComponent('铃声 + 原文件.wav');
    const raw = Buffer.from([0, 128, 255, 0]);
    assert.equal((await request('/v1/sound-documents', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encoded }, body: raw })).status, 201);
    for (const method of ['GET', 'POST']) assert.equal((await request('/v1/documents/doc-one/sound-index', { method })).status, 200);
    for (const path of ['/v1/sound-answers', '/v1/sound-query-answers']) assert.equal((await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404, path);
    const source = await request('/v1/sound-sources/answer-one/32/content');
    assert.equal(source.status, 404);
    assert.equal(seen.length, 3);
    assert.deepEqual(seen[0].body, raw); assert.equal(seen[0].headers['x-filename'], encoded);
    for (const r of seen) assert.equal(r.headers['x-filename'], r.path === '/v1/sound-documents' ? encoded : undefined);
    assert.equal(seen[0].headers.origin, external ? publicOrigin : backendOrigin);
    if (external) assert.equal(seen[0].headers.cookie, cookie);
    assert.match(source.headers['cache-control'], /no-store/);
  });

  test(`${name} sound transport rejects malformed names, alternate routes, bodies and queries before upstream`, async t => {
    let calls = 0;
    const { request } = await fixture(t, external, (_req, res) => { calls++; res.end('{}'); }, { requestBytes: 32, uploadBytes: 8 });
    const upload = { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': 'tone.wav' }, body: 'x' };
    for (const value of ['', '%FF.wav', '%2Ftone.wav', 'tone%5C.wav', 'tone%00.wav', 'tone.png', '%E4%B8.wav']) {
      assert.equal((await request('/v1/sound-documents', { ...upload, headers: { ...upload.headers, 'X-Filename': value } })).status, 400, value);
    }
    assert.equal((await request('/v1/sound-documents', { ...upload, headers: { 'Content-Type': 'application/octet-stream' } })).status, 400);
    assert.equal((await request('/v1/sound-documents', { ...upload, body: '' })).status, 400);
    assert.equal((await request('/v1/sound-documents', { ...upload, body: 'x'.repeat(9) })).status, 413);
    assert.equal((await request('/v1/sound-documents', { ...upload, headers: { ...upload.headers, 'Content-Type': 'audio/wav' } })).status, 415);
    for (const path of ['/v1/sound-documents', '/v1/documents/doc-one/sound-index']) {
      assert.equal((await request(path + '?', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400, path);
    }
    for (const method of ['GET', 'POST']) assert.equal((await request('/v1/documents/doc-one/sound-index', { method, body: '{}' })).status, 400);
    for (const path of ['/v1/sound-sources/answer-one/0', '/v1/sound-sources/answer-one/33', '/v1/sound-sources/answer-one/01', '/v1/sound-sources/%61nswer/1', '/v1/sound-sources/answer-one/1/frame', '/v1/sound-documents/more']) assert.equal((await request(path)).status, 404, path);
    assert.equal((await request('/v1/documents/doc-one/sound-index', { method: 'DELETE' })).status, 405);
    assert.equal((await request('/sound-library.mjs?')).status, 400);
    assert.equal(calls, 0);
  });

  test(`${name} sound build retains explicit processing deadline, independent bounds and no retries`, async t => {
    let calls = 0;
    const { request } = await fixture(t, external, (req, res) => {
      calls++; req.resume();
      if (req.url.endsWith('/content')) res.end('x'.repeat(9));
      else setTimeout(() => res.end('{}'), 45);
    }, { deadlineMs: 20, answerDeadlineMs: 180, uploadDeadlineMs: 180, mediaBytes: 8 });
    assert.equal((await request('/v1/documents/doc-one/sound-index', { method: 'POST' })).status, 200);
    assert.equal((await request('/v1/sound-documents', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': 'tone+literal.wav' }, body: 'x' })).status, 200);
    assert.equal((await request('/v1/documents/doc-one/sound-index')).status, 504);
    assert.equal(calls, 3);
  });
}
