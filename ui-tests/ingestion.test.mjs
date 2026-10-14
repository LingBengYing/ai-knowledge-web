import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError, validateUpload } from '../public/api.mjs';
import { checkedTask, taskPending, taskLabel } from '../public/workbench-state.mjs';

const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const task = (change = {}) => ({ task_id: 'task-one', document_id: 'doc-one', revision_id: 'rev-one', state: 'queued', attempt: 1, error_code: null, can_cancel: true, can_retry: false, ...change });

test('raw upload keeps original File bytes, filename and same-origin identity; no JSON serialization', async () => {
  const file = new File(['中文原文件'], '政策 2026.md', { type: 'text/markdown' });
  let seen;
  const api = createApi({ auth_mode: 'development_headers', workspace_id: 'org-main' }, () => 'owner', async (path, options) => {
    seen = { path, options };
    return { status: 202, ok: true, json: async () => task() };
  });
  const path = `/v1/documents?filename=${encodeURIComponent(file.name)}`;
  assert.equal(validateUpload(file), file);
  assert.deepEqual(await api(path, { method: 'POST', file }), task());
  assert.equal(seen.path, path);
  assert.equal(seen.options.body, file);
  assert.equal(seen.options.headers['Content-Type'], 'application/octet-stream');
  assert.equal(seen.options.headers['X-Principal-Id'], 'owner');
  assert.equal(seen.options.credentials, 'same-origin');
  assert.equal(await seen.options.body.text(), '中文原文件');
});

test('file validation rejects unsupported, empty, oversized or unsafe names before network', async () => {
  let calls = 0;
  const api = createApi({}, () => '', () => { calls++; });
  for (const file of [new File([], 'empty.txt'), new File(['x'], 'video.mp4'), new File(['x'], '../a.md'), new File(['x'], 'a\\b.txt'), new File(['x'], 'a\n.txt'), new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'large.pdf'), {}, null]) {
    assert.throws(() => validateUpload(file), error => error instanceof ApiError);
  }
  const file = new File(['text'], 'safe.txt');
  for (const [path, options] of [['/v1/session', { method: 'POST', file }], ['/v1/documents?filename=other.txt', { method: 'POST', file }], ['/v1/documents?filename=safe.txt', { method: 'POST', file, body: {} }], ['/v1/documents?filename=safe.txt', { method: 'GET', file }]]) {
    await assert.rejects(api(path, options));
  }
  assert.equal(calls, 0);
});

test('task action sends no JSON body or unnecessary content-type', async () => {
  let seen;
  const api = createApi({ auth_mode: 'jwt' }, () => '', async (_path, options) => {
    seen = options;
    return { status: 200, ok: true, json: async () => task({ state: 'cancelled', can_cancel: false, can_retry: true }) };
  });
  await api('/v1/ingestions/task-one/cancel', { method: 'POST' });
  assert.equal(seen.body, undefined);
  assert.equal(seen.headers['Content-Type'], undefined);
});

test('checked task exposes safe finite fields only and refuses malformed capabilities', () => {
  const output = checkedTask({ ...task(), private_text: 'must not be copied' });
  assert.deepEqual(output, task());
  assert.ok(Object.isFrozen(output));
  for (const value of [null, {}, task({ state: 'ready' }), task({ attempt: 4 }), task({ attempt: '1' }), task({ task_id: '../secret' }), task({ can_cancel: 'true' }), task({ state: 'parsed' }), task({ error_code: 'private text\nexception' }), task({ state: 'failed', attempt: 3, can_cancel: false, can_retry: true })]) {
    assert.throws(() => checkedTask(value));
  }
  assert.equal(taskPending(task()), true);
  assert.equal(taskPending(task({ state: 'processing' })), true);
  for (const state of ['parsed', 'failed', 'cancelled']) assert.equal(taskPending(task({ state })), false);
  assert.match(taskLabel('parsed'), /未索引/);
});

test('PNG/JPEG uploads require image and ingestion capabilities and use a separate 10MiB limit', async () => {
  const config = { capabilities: ['image_text_upload', 'ingestions'] };
  for (const name of ['a.png', 'a.JPG', 'a.jpeg']) assert.equal(validateUpload(new File([bytes], name), config).name, name);
  for (const caps of [[], ['ingestions'], ['image_text_upload']]) assert.throws(() => validateUpload(new File([bytes], 'a.png'), { capabilities: caps }));
  assert.throws(() => validateUpload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'a.png'), config));
  assert.equal(validateUpload(new File([new Uint8Array(20 * 1024 * 1024)], 'a.pdf')).size, 20 * 1024 * 1024);
  let body;
  const api = createApi({ capabilities: ['visual_image_upload', 'ingestions'] }, () => '', async (_url, options) => {
    body = options.body; return new Response('{}', { status: 202 });
  });
  const file = new File([bytes], 'a.png');
  await api('/v1/documents?filename=a.png', { method: 'POST', file });
  assert.equal(body, file);
});

test('binary API is restricted, bounded while reading, and retains current authentication', async () => {
  let seen;
  const api = createApi({ auth_mode: 'development_headers', workspace_id: 'org-main' }, () => 'owner', async (path, options) => {
    seen = options; return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  });
  const blob = await api('/v1/synopsis-sources/answer-1/1/1/frame', { binary: true });
  assert.ok(blob instanceof Blob); assert.equal(blob.size, bytes.length);
  assert.equal(seen.headers['X-Principal-Id'], 'owner');
  for (const path of ['/v1/config', '/v1/synopsis-sources/answer-1/1/1/frame?q=x']) await assert.rejects(api(path, { binary: true }));
  const oversized = createApi({}, () => '', async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }));
  await assert.rejects(oversized('/v1/synopsis-sources/answer-1/1/1/frame', { binary: true }));
});

test('explicit audio and video upload modes preserve MP4 distinction and require their server capabilities', async () => {
  const config = { capabilities: ['audio_upload', 'video_upload', 'ingestions'] };
  const file = new File([bytes], 'clip.mp4'); let seen;
  const api = createApi(config, () => '', async (_url, options) => { seen = options; return new Response('{}', { status: 202 }); });
  assert.equal(validateUpload(file, config, 'audio'), file);
  await api('/v1/documents?filename=clip.mp4', { method: 'POST', file, uploadKind: 'audio' });
  assert.equal(seen.headers['Content-Type'], 'application/octet-stream');
  await api('/v1/documents?filename=clip.mp4', { method: 'POST', file, uploadKind: 'video' });
  assert.equal(seen.headers['Content-Type'], 'video/mp4');
  assert.throws(() => validateUpload(file, { capabilities: ['audio_upload', 'ingestions'] }, 'video'));
  assert.throws(() => validateUpload(new File([bytes], 'clip.wav'), config, 'video'));
});
