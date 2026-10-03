import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../public/api.mjs';

test('sound upload uses complete original bytes and one encoded UTF8 filename header only on the dedicated route', async () => {
  const file = new File([Uint8Array.of(0, 128, 255)], '铃声 + 完整.wav', { type: 'audio/wav' });
  const seen = [];
  const api = createApi({ capabilities: ['ingestions', 'sound_upload'], auth_mode: 'jwt' }, () => 'unused', async (path, options) => {
    seen.push({ path, options }); return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });
  await api('/v1/sound-documents', { method: 'POST', file, uploadKind: 'sound' });
  assert.equal(seen[0].path, '/v1/sound-documents'); assert.equal(seen[0].options.body, file);
  assert.deepEqual(seen[0].options.headers, { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) });
  for (const path of ['/v1/sound-documents?', '/v1/documents?filename=tone.wav', '/v1/sound-documents/more']) await assert.rejects(api(path, { method: 'POST', file, uploadKind: 'sound' }), e => e.status === 422);
  assert.equal(seen.length, 1);
  const sourceApi = createApi({}, () => '', async () => new Response(file, { headers: { 'Content-Type': 'audio/wav' } }));
  const blob = await sourceApi('/v1/sound-sources/answer-one/1/content', { binary: true });
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array(await file.arrayBuffer()));
  const invalid = createApi({}, () => '', async () => new Response(file, { status: 206, headers: { 'Content-Type': 'audio/wav' } }));
  await assert.rejects(invalid('/v1/sound-sources/answer-one/1/content', { binary: true }), e => e.status === 502);
});

test('file synopsis original content accepts complete supported file MIME without changing identity', async () => {
  const content = '/v1/synopsis-sources/syn-one/32/8/content';
  const bytes = Uint8Array.of(0, 128, 255);
  for (const type of ['application/pdf', 'text/plain; charset=utf-8', 'text/markdown; charset=utf-8', 'image/png', 'image/jpeg',
    'audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']) {
    let received;
    const signal = new AbortController().signal;
    const api = createApi({ auth_mode: 'development_headers', workspace_id: 'org-main' }, () => 'owner', async (path, options) => {
      received = { path, options };
      return new Response(bytes, { status: 200, headers: { 'Content-Type': type } });
    });
    const blob = await api(content, { binary: true, signal });
    assert.equal(blob.type, type.split(';')[0]);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    assert.equal(received.path, content);
    assert.equal(received.options.signal, signal);
    assert.equal(received.options.method, 'GET');
    assert.equal(received.options.credentials, 'same-origin');
    assert.equal(received.options.cache, 'no-store');
    assert.deepEqual(received.options.headers, { Accept: '*/*', 'X-Workspace-Id': 'org-main', 'X-Principal-Id': 'owner' });
  }
});

test('file synopsis content and frame retain separate bounded reads, exact 200 and permitted MIME', async () => {
  const source = '/v1/synopsis-sources/syn-one/1/1';
  const largeImage = new Uint8Array(10 * 1024 * 1024 + 1);
  const api = createApi({ auth_mode: 'jwt' }, () => 'unused', async () => new Response(largeImage, { headers: { 'Content-Type': 'image/png' } }));
  assert.equal((await api(source + '/content', { binary: true })).size, largeImage.length);
  await assert.rejects(api(source + '/frame', { binary: true }), error => error instanceof ApiError && error.status === 502);
  for (const type of ['image/png', 'image/jpeg']) {
    const frameApi = createApi({}, () => '', async () => new Response('synthetic', { headers: { 'Content-Type': type } }));
    assert.equal((await frameApi(source + '/frame', { binary: true })).type, type);
  }
  for (const [path, status, type, bytes] of [[source + '/content', 206, 'application/pdf', 'synthetic'],
    [source + '/frame', 200, 'application/pdf', 'synthetic'], [source + '/content', 200, 'application/octet-stream', 'synthetic'],
    [source + '/content', 200, 'text/plain', '']]) {
    const invalid = createApi({}, () => '', async () => new Response(bytes, { status, headers: { 'Content-Type': type } }));
    await assert.rejects(invalid(path, { binary: true }), error => error instanceof ApiError && error.status === 502);
  }
  const oversized = createApi({}, () => '', async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'video/mp4' } }));
  await assert.rejects(oversized(source + '/content', { binary: true }), error => error instanceof ApiError && error.status === 502);
});

test('file synopsis binary paths reject unsupported ordinals, queries and non-GET before fetching', async () => {
  let calls = 0;
  const api = createApi({}, () => '', async () => { calls++; return new Response('synthetic', { headers: { 'Content-Type': 'image/png' } }); });
  for (const path of ['/v1/synopsis-sources/syn-one/0/1/content', '/v1/synopsis-sources/syn-one/33/1/content',
    '/v1/synopsis-sources/syn-one/1/9/content', '/v1/synopsis-sources/syn-one/01/1/content', '/v1/synopsis-sources/%73yn-one/1/1/content',
    '/v1/synopsis-sources/syn-one/1/1/content?', '/v1/synopsis-sources/syn-one/1/1/frame/more']) {
    await assert.rejects(api(path, { binary: true }), error => error instanceof ApiError && error.status === 422);
  }
  const content = '/v1/synopsis-sources/syn-one/1/1/content';
  await assert.rejects(api(content, { method: 'POST', binary: true }), error => error.status === 422);
  await assert.rejects(api(content, { body: {}, binary: true }), error => error.status === 422);
  assert.equal(calls, 0);
});

test('file synopsis JSON requests keep generation bodyless and do not require a JSON request type', async () => {
  const received = [];
  const api = createApi({ auth_mode: 'jwt' }, () => 'unused', async (path, options) => {
    received.push({ path, options });
    return new Response(JSON.stringify({ status: options.method === 'POST' ? 'queued' : 'available' }), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal((await api('/v1/documents/doc-one/synopsis', { method: 'POST' })).status, 'queued');
  assert.equal((await api('/v1/documents/doc-one/synopsis')).status, 'available');
  assert.equal((await api('/v1/synopsis-tasks/task-one')).status, 'available');
  for (const request of received) {
    assert.deepEqual(request.options.headers, { Accept: 'application/json' });
    assert.equal(request.options.body, undefined);
    assert.equal(request.options.credentials, 'same-origin');
  }
});

test('development requests capture explicit identity and use only same-origin no-store fetch', async () => {
  let request;
  const api = createApi({ auth_mode: 'development_headers', workspace_id: 'org-main' }, () => 'owner', async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  });
  await api('/v1/management/documents');
  assert.equal(request.options.headers['X-Workspace-Id'], 'org-main');
  assert.equal(request.options.headers['X-Principal-Id'], 'owner');
  assert.equal(request.options.credentials, 'same-origin');
  assert.equal(request.options.cache, 'no-store');
  await assert.rejects(api('https://elsewhere.example/data'));
});

test('JWT session uses cookie requests, not forged development headers or bearer persistence', async () => {
  let options;
  const api = createApi({ auth_mode: 'jwt', workspace_id: 'org-main' }, () => 'forged', async (_url, value) => {
    options = value;
    return { ok: true, status: 200, json: async () => ({ status: 'authenticated' }) };
  });
  await api('/v1/session', { method: 'POST', body: { token: 'test-token' } });
  assert.deepEqual(options.headers, { Accept: 'application/json', 'Content-Type': 'application/json' });
  assert.equal(options.body, JSON.stringify({ token: 'test-token' }));
});

test('RFC9457 conflict remains an error with its safe detail', async () => {
  const api = createApi({}, () => '', async () => ({ ok: false, status: 409, json: async () => ({ detail: '目录非空，不能删除。' }) }));
  await assert.rejects(api('/v1/management/folders/f', { method: 'DELETE' }), error => error instanceof ApiError && error.status === 409 && error.message === '目录非空，不能删除。');
});
test('configuration errors expose only safe optional code and field without changing legacy ApiError', async () => {
  const legacy = new ApiError(409, 'legacy'); assert.equal(legacy.status, 409); assert.equal(legacy.message, 'legacy'); assert.equal(legacy.errorCode, undefined);
  const request = createApi({}, () => 'owner', async () => new Response(JSON.stringify({ detail: 'safe input', error_code: 'configuration_invalid', field: 'embedding.dimensions' }), { status: 422, headers: { 'Content-Type': 'application/problem+json' } }));
  await assert.rejects(request('/v1/model-configuration', { method: 'PUT', body: {} }), error => error.status === 422 && error.message === 'safe input' && error.errorCode === 'configuration_invalid' && error.field === 'embedding.dimensions');
  const unsafe = new ApiError(422, 'safe', { errorCode: 'private /path', field: 'submitted-secret' }); assert.equal(unsafe.errorCode, undefined); assert.equal(unsafe.field, undefined);
});
