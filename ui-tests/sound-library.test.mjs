import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundIndexSession, soundEnabled, canReadSoundIndex } from '../public/sound-library.mjs';

const row = extra => ({ document_id: 'sound-one', document_type: 'audio', status: 'ready', index_status: 'not_indexed',
  active_revision_id: null, index_publication_id: null, synthetic_fixture: false, can_edit: true,
  media_info: { mime_type: 'audio/wav', sha256: 'a'.repeat(64), size_bytes: 200 }, ...extra });
const state = (status = 'missing', extra = {}) => ({ status, document_id: 'sound-one', source_revision_id: 'source-one',
  source_sha256: 'a'.repeat(64), profile_fingerprint: 'b'.repeat(64), model_revision: 'sound-v1', embedding_model_revision: 'embed-v1', dimensions: 4,
  publication_id: status === 'available' ? 'sound-publication-one' : null, generation_id: status === 'available' ? 'sound-generation-one' : null,
  manifest_sha256: status === 'available' ? 'c'.repeat(64) : null, span_count: status === 'available' ? 3 : 0, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('sound is independent of ASR and permits a genuine unindexed original only with explicit capabilities', () => {
  assert.equal(soundEnabled({ capabilities: ['sound_upload', 'sound_index', 'sound_answers', 'sound_sources', 'sound_query_attachments'] }), true);
  assert.equal(soundEnabled({ capabilities: ['audio_upload', 'audio_answers', 'audio_sources'] }), false);
  assert.equal(canReadSoundIndex(row()), true);
  for (const extra of [{ document_type: 'video' }, { synthetic_fixture: true }, { can_edit: null },
    { media_info: { mime_type: 'audio/wav', sha256: 'a'.repeat(64), size_bytes: 0 } }]) assert.equal(canReadSoundIndex(row(extra)), false);
});

test('sound index binds the registered source revision', async () => {
  const session = new SoundIndexSession(async () => state());
  await session.open(row({ registered_revision_id: 'different-source' }));
  assert.equal(session.value.phase, 'error');
  assert.equal(session.value.index, null);
});

test('sound status reads and explicit builds bind twelve fields without requiring a speech publication', async () => {
  const calls = [], session = new SoundIndexSession(async (path, options) => { calls.push({ path, options }); return state(options.method === 'POST' ? 'available' : 'missing'); });
  await session.open(row()); assert.equal(session.value.phase, 'ready'); assert.equal(session.value.index.span_count, 0);
  assert.equal(calls[0].path, '/v1/documents/sound-one/sound-index'); assert.equal(calls[0].options.method, undefined);
  await session.build(row()); assert.equal(session.value.index.span_count, 3); assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, undefined); await session.build(row()); assert.equal(calls.length, 2);
});

test('reader, altered source/profile and malformed readiness cannot create or retain an index', async () => {
  const calls = [], reader = row({ can_edit: false });
  const session = new SoundIndexSession(async (path, options) => { calls.push(options); return state(options.method === 'POST' ? 'available' : 'missing'); });
  await session.open(reader); await session.build(reader); assert.equal(calls.length, 2); assert.equal(session.value.phase, 'ready');
  for (const extra of [{ source_sha256: 'e'.repeat(64) }, { profile_fingerprint: 'bad' }, { dimensions: 1 }, { span_count: 1 },
    { internal_endpoint: 'fixture' }, { generation_id: 'unexpected' }]) {
    const bad = new SoundIndexSession(async () => state('missing', extra)); await bad.open(row()); assert.equal(bad.value.phase, 'error');
  }
  const drift = new SoundIndexSession(async (path, options) => state(options.method === 'POST' ? 'available' : 'missing',
    options.method === 'POST' ? { profile_fingerprint: 'e'.repeat(64) } : {}));
  await drift.open(row()); await drift.build(row()); assert.equal(drift.value.phase, 'error'); assert.equal(drift.value.index, null);
});

test('stop preserves unknown server outcome, suppresses duplicate POST and makes late results inert', async () => {
  const gate = deferred(), calls = []; let signal;
  const session = new SoundIndexSession(async (path, options) => { calls.push(options); if (options.method === 'POST') { signal = options.signal; return gate.promise; } return state(); });
  await session.open(row()); const building = session.build(row()); await session.build(row()); assert.equal(calls.length, 2);
  session.stop(); assert.equal(signal.aborted, true); assert.equal(session.value.phase, 'unknown');
  gate.resolve(state('available')); await building; await session.build(row()); assert.equal(calls.length, 2);
  await session.open(row()); assert.equal(calls.length, 3); assert.equal(session.value.phase, 'ready');
});

test('closing or changing identity rejects late sound status and triggers current authentication failure once', async () => {
  const gate = deferred(); const session = new SoundIndexSession(() => gate.promise); const reading = session.open(row()); session.close();
  gate.resolve(state()); await reading; assert.equal(session.value.phase, 'idle'); assert.equal(session.value.index, null);
  let auth = 0; const unauthorized = new SoundIndexSession(async () => { const error = new Error('fixture'); error.status = 401; throw error; }, { onAuthenticationFailure: () => auth++ });
  await unauthorized.open(row()); assert.equal(unauthorized.value.phase, 'error'); assert.equal(auth, 1);
});
