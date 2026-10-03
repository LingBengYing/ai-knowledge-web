import test from 'node:test';
import assert from 'node:assert/strict';
import { videoAvEnabled, canReadVideoAvIndex, VideoAvIndexSession, checkedVideoAvAnswer, checkedVideoAvSource,
  checkedVideoAvUpload } from '../public/video-av.mjs';
import { AnswerSession, answersEnabled } from '../public/answers.mjs';
import { createApi, validateUpload } from '../public/api.mjs';

const hash = async data => Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex');
const bytes = value => new TextEncoder().encode(value);
const capabilities = ['ingestions', 'video_av_upload', 'video_av_index', 'video_av_answers', 'video_av_sources'];
const row = extra => ({ document_id: 'video-one', document_type: 'video', registered_revision_id: 'source-one', synthetic_fixture: false,
  can_edit: true, active_revision_id: null, index_publication_id: null, media_info: { mime_type: 'video/mp4', sha256: 'a'.repeat(64), size_bytes: 200 }, ...extra });
const index = (available = false, extra = {}) => ({ status: available ? 'available' : 'missing', document_id: 'video-one',
  source_revision_id: 'source-one', source_sha256: 'a'.repeat(64), profile_fingerprint: 'b'.repeat(64), model_revision: 'av-model-v1',
  embedding_model_revision: 'av-embedding-v1', dimensions: 4, publication_id: available ? 'publication-one' : null,
  generation_id: available ? 'publication-one' : null, manifest_sha256: available ? 'c'.repeat(64) : null,
  window_count: available ? 3 : 0, video_window_count: available ? 2 : 0, audio_window_count: available ? 3 : 0, ...extra });
const fact = (text, requirement, ordinal = 1) => ({ id: String(ordinal).padStart(64, '0'), text, requirement,
  visual_contribution: requirement !== 'AUDIO', audio_contribution: requirement !== 'VISUAL' });
const defaultFacts = [fact('画面中的杯子是红色。', 'VISUAL'), fact('背景有持续提示音。', 'AUDIO', 2)];
async function citation(extra = {}) {
  const facts = extra.facts ?? defaultFacts;
  return { number: 1, kind: 'video_av_window', mode: 'JOINT', document_id: 'video-one', revision_id: 'source-one', source_sha256: 'a'.repeat(64),
    publication_id: 'publication-one', profile_fingerprint: 'b'.repeat(64), decoder_revision: 'av-decoder-v1', filename: 'motion.mp4', media_type: 'video/mp4',
    epoch: { pts: '32000', time_base_num: '1', time_base_den: '16000', ticks_per_second: '16000' },
    window: { id: 'window-one', ordinal: 1, start_tick: '32000', end_tick: '48001', start_ms: 2000, end_ms: 3001,
      video: { clip_sha256: 'd'.repeat(64), frame_count: 8, frames_manifest_sha256: 'e'.repeat(64), first_local_tick: '0', end_local_tick: '16000' },
      audio: { pcm_sha256: 'f'.repeat(64), wav_sha256: '0'.repeat(64), start_sample: '32000', end_sample: '48001', sample_rate: 16000 } },
    facts, facts_sha256: await hash(bytes(JSON.stringify(facts))), analysis_model_revision: 'av-model-v1', policy_revision: 'java-video-av-answer-v1',
    time_precision: 'server_window', source_url: '/v1/video-av-sources/answer-one/1', content_url: '/v1/video-av-sources/answer-one/1/content', ...extra };
}
async function answer(extra = {}) {
  const source = extra.citations?.[0] ?? await citation();
  return { answer_id: 'answer-one', status: 'answered', mode: source.mode, answer: source.facts.map(item => item.text).join('\n'),
    reason_code: null, citations: [source], policy_revision: 'java-video-av-answer-v1', ...extra };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };

test('video AV needs four actual capabilities and preserves genuine raw videos without ASR', () => {
  assert.equal(videoAvEnabled({ capabilities }), true);
  for (const omitted of capabilities.slice(1)) assert.equal(videoAvEnabled({ capabilities: capabilities.filter(name => name !== omitted) }), false);
  assert.equal(answersEnabled({ capabilities: ['video_answers', 'video_sources'] }, 'video-av-joint'), false);
  for (const mode of ['video-av-visual', 'video-av-audio', 'video-av-joint']) assert.equal(answersEnabled({ capabilities }, mode), true);
  assert.equal(canReadVideoAvIndex(row()), true);
  for (const extra of [{ document_type: 'audio' }, { synthetic_fixture: true }, { can_edit: null }]) assert.equal(canReadVideoAvIndex(row(extra)), false);
});

test('explicit AV build binds fourteen fields and accepts absent audio receipts without invented silence', async () => {
  const calls = [], session = new VideoAvIndexSession(async (path, options) => { calls.push({ path, options }); return index(options.method === 'POST', options.method === 'POST' ? { video_window_count: 3, audio_window_count: 0 } : {}); });
  await session.open(row()); await session.build(row());
  assert.equal(session.value.phase, 'ready'); assert.equal(session.value.index.audio_window_count, 0);
  assert.equal(calls[0].path, '/v1/documents/video-one/video-av-index'); assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, undefined); await session.build(row()); assert.equal(calls.length, 2);
  const reader = new VideoAvIndexSession(async () => index()); await reader.open(row({ can_edit: false })); await reader.build(row({ can_edit: false })); assert.equal(reader.value.phase, 'ready');
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

test('joint facts allow independent attributes and require both contributions for a relational fact', async () => {
  const checked = await checkedVideoAvAnswer(await answer(), 'JOINT'); assert.equal(checked.citations[0].facts.length, 2);
  const relation = await citation({ facts: [fact('敲击杯子的动作与提示音同时出现。', 'JOINT')] });
  assert.equal((await checkedVideoAvAnswer(await answer({ citations: [relation] }), 'JOINT')).citations[0].facts[0].audio_contribution, true);
  const incomplete = await citation({ facts: [fact('杯子是红色。', 'VISUAL')] });
  await assert.rejects(checkedVideoAvAnswer(await answer({ citations: [incomplete] }), 'JOINT'), { status: 502 });
  const bad = await citation({ facts: [{ ...fact('有声音。', 'JOINT'), visual_contribution: false }] });
  await assert.rejects(checkedVideoAvAnswer(await answer({ citations: [bad] }), 'JOINT'), { status: 502 });
});

test('precise rational ticks use canonical strings and preserve epochs beyond JavaScript integer precision', async () => {
  const source = await citation();
  source.epoch = { pts: '9007199254740993', time_base_num: '1', time_base_den: '30000', ticks_per_second: '240000' };
  source.window = { ...source.window, start_tick: '480008', end_tick: '720008', start_ms: 2000, end_ms: 3001,
    video: { ...source.window.video, end_local_tick: '240000' }, audio: { ...source.window.audio, end_sample: '48000' } };
  const checked = await checkedVideoAvAnswer(await answer({ citations: [source] }), 'JOINT'); assert.equal(checked.citations[0].epoch.pts, '9007199254740993');
  for (const epoch of [{ ...source.epoch, pts: 9007199254740993 }, { ...source.epoch, pts: '-0' }, { ...source.epoch, ticks_per_second: '16000' },
    { ...source.epoch, time_base_num: '2', time_base_den: '60000' }]) {
    await assert.rejects(checkedVideoAvAnswer(await answer({ citations: [{ ...source, epoch }] }), 'JOINT'), { status: 502 });
  }
});

test('absent video or audio remains typed and cannot qualify a joint citation', async () => {
  const audio = await citation({ mode: 'AUDIO', facts: [fact('末尾仍有铃声。', 'AUDIO')] }); audio.window = { ...audio.window, video: null };
  assert.equal((await checkedVideoAvAnswer(await answer({ citations: [audio] }), 'AUDIO')).citations[0].window.video, null);
  await assert.rejects(checkedVideoAvAnswer(await answer({ mode: 'JOINT', citations: [{ ...audio, mode: 'JOINT' }] }), 'JOINT'), { status: 502 });
  const visual = await citation({ mode: 'VISUAL', facts: [fact('杯子在移动。', 'VISUAL')] }); visual.window = { ...visual.window, audio: null };
  assert.equal((await checkedVideoAvAnswer(await answer({ citations: [visual] }), 'VISUAL')).citations[0].window.audio, null);
  await assert.rejects(checkedVideoAvAnswer(await answer({ citations: [{ ...visual, window: { ...visual.window, video: null } }] }), 'VISUAL'), { status: 502 });
});

test('video AV rejects fabricated times, missing media hashes, ASR fields and modified claims', async () => {
  const source = await citation();
  const variants = [{ quote: 'fake ASR' }, { proof_origin: 'machine_asr' }, { facts_sha256: 'c'.repeat(64) },
    { window: { ...source.window, start_ms: 2001 } }, { window: { ...source.window, start_tick: '032000' } },
    { window: { ...source.window, audio: { ...source.window.audio, start_sample: '32001' } } },
    { window: { ...source.window, video: { ...source.window.video, end_local_tick: '16002' } } },
    { window: { ...source.window, video: { ...source.window.video, frames_manifest_sha256: null } } }];
  for (const extra of variants) await assert.rejects(checkedVideoAvAnswer(await answer({ citations: [{ ...source, ...extra }] }), 'JOINT'), { status: 502 });
});

test('facts hash uses canonical five-field order and full legal text and separator budgets', async () => {
  const facts = Array.from({ length: 16 }, (_, i) => fact(`${String(i).padStart(2, '0')}"\\${'x'.repeat(508)}`, i % 2 ? 'AUDIO' : 'VISUAL', (i + 1).toString(16)));
  assert.equal(facts.reduce((sum, item) => sum + bytes(item.text).length, 0), 8192);
  const source = await citation({ facts }); const result = await answer({ citations: [source] }); assert.equal(bytes(result.answer).length, 8207);
  source.facts = facts.map(item => ({ audio_contribution: item.audio_contribution, requirement: item.requirement,
    id: item.id, visual_contribution: item.visual_contribution, text: item.text }));
  assert.equal((await checkedVideoAvAnswer(result, 'JOINT')).answer, result.answer);
  await assert.rejects(checkedVideoAvAnswer({ ...result, answer: `${result.answer}x` }, 'JOINT'), { status: 502 });
  const overflow = await citation({ facts: facts.map((item, i) => i === 15 ? { ...item, text: `${item.text}x` } : item) });
  await assert.rejects(checkedVideoAvAnswer(await answer({ citations: [overflow] }), 'JOINT'), { status: 502 });
});

test('source re-read binds every nested field of the saved citation', async () => {
  const source = await citation(), expected = (await checkedVideoAvAnswer(await answer({ citations: [source] }), 'JOINT')).citations[0];
  assert.deepEqual(await checkedVideoAvSource({ answer_id: 'answer-one', citation: source }, 'answer-one', expected), expected);
  for (const changed of [{ ...source, profile_fingerprint: 'c'.repeat(64) }, { ...source, epoch: { ...source.epoch, pts: '32001' } },
    { ...source, window: { ...source.window, video: { ...source.window.video, clip_sha256: 'c'.repeat(64) } } }]) {
    await assert.rejects(checkedVideoAvSource({ answer_id: 'answer-one', citation: changed }, 'answer-one', expected), { status: 502 });
  }
});

test('whole explicit selection and mode survive question submission and original SHA playback', async () => {
  const original = new Blob(['actual-synthetic-original'], { type: 'video/mp4' }), source = await citation({ source_sha256: await hash(await original.arrayBuffer()) });
  const calls = [], urls = [], revoked = [], session = new AnswerSession(async (path, options) => {
    calls.push({ path, options }); return path.endsWith('/content') ? original : path.includes('/sources/') || path.includes('-sources/') ? { answer_id: 'answer-one', citation: source } : answer({ citations: [source] });
  }, { objectUrls: { createObjectURL: () => { urls.push('blob:av'); return 'blob:av'; }, revokeObjectURL: value => revoked.push(value) } });
  await session.ask('整个原始问题', [], 'video-av-joint'); assert.equal(session.value.phase, 'answered');
  assert.equal(calls[0].path, '/v1/video-av-answers'); assert.deepEqual(calls[0].options.body, { question: '整个原始问题', document_ids: [], mode: 'JOINT' });
  await session.readSource(1); assert.equal(session.value.sourcePhase, 'ready'); assert.equal(session.value.source.mediaUrl, 'blob:av');
  session.reset(); assert.deepEqual(revoked, urls);
});

test('AV sources release asynchronous media after context changes and never dispatch attachments', async () => {
  const source = await citation(), gate = deferred(), urls = [], session = new AnswerSession(async path => path.endsWith('/content') ? gate.promise
    : path.includes('-sources/') ? { answer_id: 'answer-one', citation: source } : answer({ citations: [source] }),
  { objectUrls: { createObjectURL: () => { urls.push('blob:late'); return 'blob:late'; }, revokeObjectURL: () => {} }, canUseAttachments: () => true });
  await session.ask('问题', ['video-one'], 'video-av-joint'); const reading = session.readSource(1); await Promise.resolve(); await Promise.resolve();
  session.reset(); gate.resolve(new Blob(['late'], { type: 'video/mp4' })); await reading; assert.equal(session.value.phase, 'idle'); assert.deepEqual(urls, []);
  let calls = 0; const rejected = new AnswerSession(async () => { calls++; return answer(); }, { canUseAttachments: () => true });
  await rejected.ask('问题', null, 'video-av-joint', [{ file: new File(['x'], 'query.mp4'), kind: 'video' }]);
  assert.equal(rejected.value.phase, 'error'); assert.equal(calls, 0);
});

test('raw video upload binds complete original bytes and uses exact octet-stream header route', async () => {
  const file = new File(['saved-synthetic-video'], '运动 + 原片.mp4', { type: 'video/mp4' });
  const receipt = { document_id: 'video-one', source_revision_id: 'source-one', source_sha256: await hash(await file.arrayBuffer()), size_bytes: file.size };
  assert.equal((await checkedVideoAvUpload(receipt, file)).document_id, 'video-one');
  await assert.rejects(checkedVideoAvUpload({ ...receipt, source_sha256: 'a'.repeat(64) }, file), { status: 502 });
  assert.equal(validateUpload(file, { capabilities }, 'video-av'), file);
  let sent; const api = createApi({ capabilities }, () => 'synthetic', async (path, options) => { sent = { path, options }; return new Response(JSON.stringify(receipt), { status: 201 }); });
  await api('/v1/video-av-documents', { method: 'POST', file, uploadKind: 'video-av' });
  assert.equal(sent.path, '/v1/video-av-documents'); assert.equal(sent.options.body, file); assert.equal(sent.options.headers['Content-Type'], 'application/octet-stream');
  assert.equal(sent.options.headers['X-Filename'], encodeURIComponent(file.name));
});
