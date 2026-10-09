import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { ImageVectorSession, imageVectorsEnabled, canReadImageVector } from '../public/image-vectors.mjs';

const item = (extra = {}) => ({ document_id: 'image-one', index_publication_id: 'publication-one', active_revision_id: 'revision-one',
  document_type: 'image', status: 'parsed', index_status: 'indexed', synthetic_fixture: false, can_edit: true,
  media_info: { mime_type: 'image/png', sha256: 'a'.repeat(64), size_bytes: 512 }, ...extra });
const reply = (row, status = 'missing', extra = {}) => ({ status, document_id: row.document_id, publication_id: row.index_publication_id,
  source_revision_id: row.active_revision_id, source_sha256: row.media_info.sha256, profile_fingerprint: 'b'.repeat(64),
  model_revision: 'java-image-embedding-v1:fixture', dimensions: 4,
  vector_generation_id: status === 'available' ? 'generation-one' : null,
  manifest_sha256: status === 'available' ? 'c'.repeat(64) : null, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('image-vector capability and real indexed original admission are explicit', () => {
  assert.equal(imageVectorsEnabled({ capabilities: ['image_vector_retrieval', 'visual_answers', 'visual_sources'] }), true);
  assert.equal(imageVectorsEnabled({ capabilities: ['visual_answers', 'visual_sources'] }), false);
  assert.equal(canReadImageVector(item()), true);
  for (const changed of [{ document_type: 'document' }, { index_status: 'not_indexed' }, { index_publication_id: null }, { synthetic_fixture: true },
    { media_info: { mime_type: 'image/png', sha256: 'a'.repeat(64), size_bytes: 10 * 1024 * 1024 + 1 } }]) assert.equal(canReadImageVector(item(changed)), false);
});

test('opening reads exact identity and never starts a model build', async () => {
  const row = item(), calls = [];
  const session = new ImageVectorSession(async (path, options) => { calls.push({ path, options }); return reply(row); });
  await session.open(row);
  assert.equal(session.value.phase, 'ready'); assert.equal(session.value.vector.status, 'missing');
  assert.equal(session.matches(row), true); assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/v1/documents/image-one/image-vector');
  assert.equal(calls[0].options.method, undefined); assert.equal(calls[0].options.body, undefined);
});

test('only explicit current editor build posts no body and returns a complete available receipt', async () => {
  const row = item(), calls = [];
  const session = new ImageVectorSession(async (path, options) => { calls.push({ path, options }); return reply(row, options.method === 'POST' ? 'available' : 'missing'); });
  await session.open(row); await session.build(row);
  assert.equal(calls.length, 2); assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.body, undefined);
  assert.equal(session.value.vector.status, 'available'); assert.equal(Object.isFrozen(session.value.vector), true);
  await session.build(row); assert.equal(calls.length, 2, 'ready vector should not rebuild or retry');
  const reader = item({ can_edit: false }); await session.open(reader); await session.build(reader); assert.equal(calls.length, 4);
});

test('all response fields bind current source, complete profile and readiness shape', async () => {
  const row = item();
  for (const extra of [{ source_sha256: 'd'.repeat(64) }, { publication_id: 'other' }, { source_revision_id: 'other' },
    { profile_fingerprint: 'bad' }, { dimensions: 1 }, { dimensions: 4.5 }, { model_revision: 'unsafe\nrevision' },
    { manifest_sha256: 'c'.repeat(64) }, { internal_endpoint: 'private' }]) {
    const session = new ImageVectorSession(async () => reply(row, 'missing', extra)); await session.open(row);
    assert.equal(session.value.phase, 'error', JSON.stringify(extra)); assert.equal(session.value.vector, null);
  }
  for (const extra of [{ vector_generation_id: null }, { manifest_sha256: null }]) {
    const session = new ImageVectorSession(async () => reply(row, 'available', extra)); await session.open(row); assert.equal(session.value.phase, 'error');
  }
});

test('build duplication, profile drift and late failure do not retry or retain a stale receipt', async () => {
  const row = item(), gate = deferred(), calls = [];
  const session = new ImageVectorSession(async (path, options) => { calls.push(options); return options.method === 'POST' ? gate.promise : reply(row); });
  await session.open(row); const first = session.build(row); await session.build(row);
  assert.equal(calls.length, 2); assert.equal(session.value.phase, 'building');
  gate.resolve(reply(row, 'available', { profile_fingerprint: 'd'.repeat(64) })); await first;
  assert.equal(session.value.phase, 'error'); assert.equal(session.value.vector, null); assert.equal(calls.length, 2);
});

test('changing document or permission makes late build results inert and aborts local waiting', async () => {
  const row = item(), next = item({ document_id: 'image-two', index_publication_id: 'publication-two' }), gate = deferred();
  let buildSignal;
  const session = new ImageVectorSession(async (path, options) => { if (options.method === 'POST') { buildSignal = options.signal; return gate.promise; }
    return reply(path.includes('image-two') ? next : row); });
  await session.open(row); const building = session.build(row); await session.open(next);
  assert.equal(buildSignal.aborted, true); gate.resolve(reply(row, 'available')); await building;
  assert.equal(session.value.vector.document_id, 'image-two'); assert.equal(session.matches(row), false);
  const reads = []; const reader = item({ can_edit: false });
  const other = new ImageVectorSession(async (path, options) => { reads.push(options); return reply(row); });
  await other.open(row); await other.build(reader); assert.equal(reads.length, 2, 'legacy role changes do not block shared-workspace writes');
});

test('closed reads and authentication failures never restore an old document', async () => {
  const row = item(), gate = deferred();
  const session = new ImageVectorSession(() => gate.promise); const reading = session.open(row); session.close();
  gate.resolve(reply(row)); await reading; assert.equal(session.value.phase, 'idle'); assert.equal(session.value.vector, null);
  let auth = 0; const other = new ImageVectorSession(async () => { throw new ApiError(401, 'synthetic'); }, { onAuthenticationFailure: () => auth++ });
  await other.open(row); assert.equal(other.value.phase, 'error'); assert.equal(auth, 1);
});
