import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundIndexSession, soundEnabled, canReadSoundIndex, checkedSoundAnswer, checkedSoundSource,
  checkedSoundAttachments, checkedSoundUpload } from '../public/sound-library.mjs';
import { answersEnabled } from '../public/answers.mjs';

const hash = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
const facts = ['末段有连续的高频提示音。'];
const factsSha = await hash(new TextEncoder().encode(JSON.stringify(facts)));
const row = extra => ({ document_id: 'sound-one', document_type: 'audio', status: 'ready', index_status: 'not_indexed',
  active_revision_id: null, index_publication_id: null, synthetic_fixture: false, can_edit: true,
  media_info: { mime_type: 'audio/wav', sha256: 'a'.repeat(64), size_bytes: 200 }, ...extra });
const state = (status = 'missing', extra = {}) => ({ status, document_id: 'sound-one', source_revision_id: 'source-one',
  source_sha256: 'a'.repeat(64), profile_fingerprint: 'b'.repeat(64), model_revision: 'sound-v1', embedding_model_revision: 'embed-v1', dimensions: 4,
  publication_id: status === 'available' ? 'sound-publication-one' : null, generation_id: status === 'available' ? 'sound-generation-one' : null,
  manifest_sha256: status === 'available' ? 'c'.repeat(64) : null, span_count: status === 'available' ? 3 : 0, ...extra });
const citation = extra => ({ number: 1, kind: 'sound_span', document_id: 'sound-one', revision_id: 'source-one', source_sha256: 'a'.repeat(64),
  publication_id: 'sound-publication-one', profile_fingerprint: 'b'.repeat(64), decoder_revision: 'pcm-fixture-v1', pcm_sha256: 'd'.repeat(64),
  filename: 'sound.wav', media_type: 'audio/wav', start_sample: 32000, end_sample: 48001, sample_rate: 16000,
  start_ms: 2000, end_ms: 3001, facts, facts_sha256: factsSha, analysis_model_revision: 'sound-v1', policy_revision: 'java-sound-answer-v1',
  time_precision: 'server_window', source_url: '/v1/sound-sources/answer-one/1', content_url: '/v1/sound-sources/answer-one/1/content', ...extra });
const answer = extra => ({ answer_id: 'answer-one', status: 'answered', answer: facts[0], reason_code: null,
  citations: [citation()], policy_revision: 'java-sound-answer-v1', ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('sound is independent of ASR and permits a genuine unindexed original only with explicit capabilities', () => {
  assert.equal(soundEnabled({ capabilities: ['sound_upload', 'sound_index', 'sound_answers', 'sound_sources', 'sound_query_attachments'] }), true);
  assert.equal(soundEnabled({ capabilities: ['audio_upload', 'audio_answers', 'audio_sources'] }), false);
  assert.equal(canReadSoundIndex(row()), true);
  for (const extra of [{ document_type: 'video' }, { synthetic_fixture: true }, { can_edit: null },
    { media_info: { mime_type: 'audio/wav', sha256: 'a'.repeat(64), size_bytes: 0 } }]) assert.equal(canReadSoundIndex(row(extra)), false);
});

test('sound question mode requires the complete independent capability set and source revision binding', async () => {
  assert.equal(answersEnabled({ capabilities: ['sound_answers', 'sound_sources'] }, 'sound'), false);
  assert.equal(answersEnabled({ capabilities: ['sound_upload', 'sound_index', 'sound_answers', 'sound_sources', 'sound_query_attachments'] }, 'sound'), true);
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

test('sound answers verify actual facts hash and exact server sample window while preserving typed origin', async () => {
  const good = await checkedSoundAnswer(answer()); assert.equal(good.citations[0].kind, 'sound_span'); assert.ok(Object.isFrozen(good.citations[0].facts));
  for (const extra of [{ quote: 'fake ASR' }, { text_origin: 'machine_asr' }, { start_ms: 2001 }, { end_ms: 3000 },
    { sample_rate: 44100 }, { facts_sha256: 'e'.repeat(64) }, { facts: ['different claim'] }, { kind: 'audio_span' }, { time_precision: 'word' }]) {
    await assert.rejects(checkedSoundAnswer(answer({ citations: [citation(extra)] })), { status: 502 });
  }
  await assert.rejects(checkedSoundAnswer(answer({ status: 'abstained', reason_code: 'no_evidence' })), { status: 502 });
});

test('sound accepts the full raw facts byte budget with JSON escapes and answer separators', async () => {
  const fullFacts = Array.from({ length: 16 }, (_, index) => `${String(index).padStart(2, '0')}"\\${'x'.repeat(508)}`);
  const encoder = new TextEncoder(), serialized = encoder.encode(JSON.stringify(fullFacts));
  assert.equal(fullFacts.reduce((total, fact) => total + encoder.encode(fact).length, 0), 8192);
  assert.ok(serialized.length > 8192);
  const joined = fullFacts.join('\n');
  assert.equal(encoder.encode(joined).length, 8207);
  const fullCitation = citation({ facts: fullFacts, facts_sha256: await hash(serialized) });
  const checked = await checkedSoundAnswer(answer({ answer: joined, citations: [fullCitation] }));
  assert.equal(checked.answer, joined);
  assert.deepEqual(checked.citations[0].facts, fullFacts);
  assert.deepEqual(await checkedSoundSource({ answer_id: 'answer-one', citation: fullCitation }, 'answer-one', checked.citations[0]), checked.citations[0]);
});

test('sound still rejects a raw facts budget overflow or answer beyond sixteen fact separators', async () => {
  const fullFacts = Array.from({ length: 16 }, (_, index) => `${String(index).padStart(2, '0')}${'x'.repeat(510)}`);
  fullFacts[15] += 'x';
  const facts_sha256 = await hash(new TextEncoder().encode(JSON.stringify(fullFacts)));
  await assert.rejects(checkedSoundAnswer(answer({ citations: [citation({ facts: fullFacts, facts_sha256 })] })), { status: 502 });
  await assert.rejects(checkedSoundAnswer(answer({ answer: 'x'.repeat(8208) })), { status: 502 });
});

test('sound source must match every saved citation field including facts and profile', async () => {
  const expected = (await checkedSoundAnswer(answer())).citations[0];
  const source = await checkedSoundSource({ answer_id: 'answer-one', citation: citation() }, 'answer-one', expected);
  assert.deepEqual(source, expected);
  for (const extra of [{ profile_fingerprint: 'e'.repeat(64) }, { publication_id: 'other-publication' }, { pcm_sha256: 'e'.repeat(64) }]) {
    await assert.rejects(checkedSoundSource({ answer_id: 'answer-one', citation: citation(extra) }, 'answer-one', expected), { status: 502 });
  }
});

test('sound query manifests cover all audio attachments and never invent ASR text or visual sampling', async () => {
  const file = new File(['waveform-fixture'], 'query.wav', { type: 'audio/wav' }); const sourceSha = await hash(await file.arrayBuffer());
  const selection = [{ file, kind: 'audio', mediaType: 'audio/wav' }];
  const manifest = { ordinal: 0, source_sha256: sourceSha, media_kind: 'audio', compiler_revision: 'sound-query-v1', content_sha256: 'e'.repeat(64),
    text_code_points: 0, visual_count: 0, selected_image_sha256: [], visual_sampled: false };
  const result = { ...answer(), mode: 'SOUND', attachment_manifest: [manifest] };
  const checked = await checkedSoundAttachments(result, selection); assert.equal(checked.notices.length, 1); assert.equal(checked.notices[0].status, 'prepared');
  for (const extra of [{ text_code_points: 1 }, { source_sha256: 'f'.repeat(64) }, { visual_sampled: true }, { ordinal: 1 }]) {
    await assert.rejects(checkedSoundAttachments({ ...result, attachment_manifest: [{ ...manifest, ...extra }] }, selection), { status: 502 });
  }
  await assert.rejects(checkedSoundAttachments({ ...result, attachment_manifest: [] }, selection), { status: 502 });
  const denied = await checkedSoundAttachments({ ...result, status: 'abstained', reason_code: 'sound_index_required', citations: [], attachment_manifest: [] }, selection);
  assert.equal(denied.notices[0].status, 'failed');
});

test('sound upload receipt binds exact complete original bytes and does not claim an ASR task', async () => {
  const file = new File(['saved-waveform'], 'sound.wav', { type: 'audio/wav' }); const sourceSha = await hash(await file.arrayBuffer());
  const response = { document_id: 'sound-one', source_revision_id: 'source-one', source_sha256: sourceSha, size_bytes: file.size };
  const good = await checkedSoundUpload(response, file); assert.equal(good.document_id, 'sound-one'); assert.ok(Object.isFrozen(good));
  for (const extra of [{ source_sha256: 'e'.repeat(64) }, { size_bytes: file.size - 1 }, { ingestion_task: { state: 'queued' } }]) {
    await assert.rejects(checkedSoundUpload({ ...response, ...extra }, file), { status: 502 });
  }
});
