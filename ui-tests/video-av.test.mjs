import test from 'node:test';
import assert from 'node:assert/strict';
import { videoAvEnabled, canReadVideoAvIndex, VideoAvIndexSession } from '../public/video-av.mjs';
import { createApi, validateUpload } from '../public/api.mjs';

const hash = async data => Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex');
const capabilities = ['ingestions', 'video_av_upload', 'video_av_index', 'video_av_answers', 'video_av_sources'];
const row = extra => ({ document_id: 'video-one', document_type: 'video', registered_revision_id: 'source-one', synthetic_fixture: false,
  can_edit: true, active_revision_id: null, index_publication_id: null, media_info: { mime_type: 'video/mp4', sha256: 'a'.repeat(64), size_bytes: 200 }, ...extra });
const index = (available = false, extra = {}) => ({ status: available ? 'available' : 'missing', document_id: 'video-one',
  source_revision_id: 'source-one', source_sha256: 'a'.repeat(64), profile_fingerprint: 'b'.repeat(64), model_revision: 'av-model-v1',
  embedding_model_revision: 'av-embedding-v1', dimensions: 4, publication_id: available ? 'publication-one' : null,
  generation_id: available ? 'publication-one' : null, manifest_sha256: available ? 'c'.repeat(64) : null,
  window_count: available ? 3 : 0, video_window_count: available ? 2 : 0, audio_window_count: available ? 3 : 0, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

test('video AV needs four actual capabilities and preserves genuine raw videos without ASR', () => {
  assert.equal(videoAvEnabled({ capabilities }), true);
  for (const omitted of capabilities.slice(1)) assert.equal(videoAvEnabled({ capabilities: capabilities.filter(name => name !== omitted) }), false);
  assert.equal(canReadVideoAvIndex(row()), true);
  for (const extra of [{ document_type: 'audio' }, { synthetic_fixture: true }, { can_edit: null }]) assert.equal(canReadVideoAvIndex(row(extra)), false);
});

test('explicit AV build binds fourteen fields and accepts absent audio receipts without invented silence', async () => {
  const calls = [], session = new VideoAvIndexSession(async (path, options) => { calls.push({ path, options }); return index(options.method === 'POST', options.method === 'POST' ? { video_window_count: 3, audio_window_count: 0 } : {}); });
  await session.open(row()); await session.build(row());
  assert.equal(session.value.phase, 'ready'); assert.equal(session.value.index.audio_window_count, 0);
  assert.equal(calls[0].path, '/v1/documents/video-one/video-av-index'); assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, undefined); await session.build(row()); assert.equal(calls.length, 2);
  const reader = new VideoAvIndexSession(async (_path, options) => index(options.method === 'POST')); await reader.open(row({ can_edit: false })); await reader.build(row({ can_edit: false })); assert.equal(reader.value.phase, 'ready');
});

test('AV index rejects drift and unmapped windows and isolates stopped or late requests', async () => {
  for (const extra of [{ source_revision_id: 'other' }, { dimensions: 1 }, { unknown: true }, { generation_id: 'different' },
    { video_window_count: 0 }, { window_count: 1202 }, { video_window_count: 1, audio_window_count: 1 }]) {
    const session = new VideoAvIndexSession(async () => index(true, extra)); await session.open(row()); assert.equal(session.value.phase, 'error');
  }
  const gate = deferred(), session = new VideoAvIndexSession(async (_path, options) => options.method === 'POST' ? gate.promise : index());
  await session.open(row()); const building = session.build(row()); session.stop(); gate.resolve(index(true)); await building;
  assert.equal(session.value.phase, 'unknown'); assert.equal(session.value.index, null); await session.open(row()); assert.equal(session.value.phase, 'ready');
  const late = deferred(), closed = new VideoAvIndexSession(() => late.promise); const read = closed.open(row()); closed.close(); late.resolve(index()); await read; assert.equal(closed.value.phase, 'idle');
});

test('raw video upload uses exact octet-stream header route with the encoded filename', async () => {
  const file = new File(['saved-synthetic-video'], '运动 + 原片.mp4', { type: 'video/mp4' });
  const receipt = { document_id: 'video-one', source_revision_id: 'source-one', source_sha256: await hash(await file.arrayBuffer()), size_bytes: file.size };
  assert.equal(validateUpload(file, { capabilities }, 'video-av'), file);
  let sent; const api = createApi({ capabilities }, () => 'synthetic', async (path, options) => { sent = { path, options }; return new Response(JSON.stringify(receipt), { status: 201 }); });
  await api('/v1/video-av-documents', { method: 'POST', file, uploadKind: 'video-av' });
  assert.equal(sent.path, '/v1/video-av-documents'); assert.equal(sent.options.body, file); assert.equal(sent.options.headers['Content-Type'], 'application/octet-stream');
  assert.equal(sent.options.headers['X-Filename'], encodeURIComponent(file.name));
});
