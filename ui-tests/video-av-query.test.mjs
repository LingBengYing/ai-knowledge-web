import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AnswerSession } from '../public/answers.mjs';
import * as videoAv from '../public/video-av.mjs';
import { ApiError } from '../public/api.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const capabilities = ['video_av_upload', 'video_av_index', 'video_av_answers', 'video_av_sources'];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
const file = (name = 'reference.mp4', body = 'complete original reference ending') => new File([body], name, { type: 'video/mp4' });
const selection = count => Array.from({ length: count }, (_, i) => ({ file: file(`reference-${i}.mp4`, `whole video ${i} with tail ${i}`), kind: 'video' }));
const refusal = (mode, reason = 'no_evidence') => ({ answer_id: 'answer-query', status: 'abstained', mode,
  answer: '当前库内资料不足以可靠回答完整问题。', reason_code: reason, citations: [], policy_revision: 'java-video-av-answer-v1' });
const receipt = (sourceSha, ordinal, mode, prepared = true) => ({ ordinal, source_sha256: sourceSha, media_kind: 'video',
  compiler_revision: 'java-video-av-decoder-v1:pinned', content_sha256: prepared ? sha(`complete windows ${ordinal}`) : null,
  window_count: prepared ? 3 : null, visual_window_count: prepared ? 2 : null, audio_window_count: prepared ? 3 : null,
  audio_present: prepared ? true : null, used_mode: mode, status: prepared ? 'prepared' : 'not_prepared' });
const envelope = (body, prepared = true, reason = 'no_evidence') => ({ mode: body.mode, result: refusal(body.mode, reason),
  query_attachments: body.attachments.map((item, i) => receipt(sha(Buffer.from(item.content_base64, 'base64')), i, body.mode, prepared)) });
const enabled = { canUseVideoAvAttachments: () => true };

for (const mode of ['VISUAL', 'AUDIO', 'JOINT']) {
  test(`raw video reference ${mode} sends all three originals and the complete question and selection`, async () => {
    const input = selection(3), calls = [];
    const session = new AnswerSession(async (path, options) => { calls.push({ path, options }); return envelope(options.body); }, enabled);
    const question = '  原问题\n完整尾部\t不要截断  ';
    await session.ask(question, ['video-one', 'unindexed-tail'], `video-av-${mode.toLowerCase()}`, input);
    assert.equal(session.value.phase, 'abstained'); assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/v1/video-av-query-answers');
    assert.deepEqual(Object.keys(calls[0].options.body).sort(), ['attachments', 'mode', 'question']);
    assert.equal(calls[0].options.body.question, question); assert.equal(calls[0].options.body.mode, mode);
    assert.equal(calls[0].options.body.document_ids, undefined);
    for (let i = 0; i < 3; i++) {
      const sent = calls[0].options.body.attachments[i];
      assert.deepEqual(Object.keys(sent).sort(), ['content_base64', 'filename', 'media_type']);
      assert.equal(sent.filename, input[i].file.name); assert.equal(sent.media_type, 'video/mp4');
      assert.deepEqual(Buffer.from(sent.content_base64, 'base64'), Buffer.from(await input[i].file.arrayBuffer()));
      assert.equal(session.value.queryAttachments[i].source_sha256, sha(Buffer.from(sent.content_base64, 'base64')));
      assert.equal(session.value.queryAttachments[i].status, 'prepared');
    }
  });
}

test('new video reference capability is independent of the old attachment capability and needs the full video graph', () => {
  assert.equal(videoAv.videoAvQueryAttachmentsEnabled({ capabilities }), false);
  assert.equal(videoAv.videoAvQueryAttachmentsEnabled({ capabilities: [...capabilities, 'query_attachments'] }), false);
  assert.equal(videoAv.videoAvQueryAttachmentsEnabled({ capabilities: [...capabilities, 'video_av_query_attachments'] }), true);
  for (const missing of capabilities) assert.equal(videoAv.videoAvQueryAttachmentsEnabled({ capabilities: [...capabilities.filter(v => v !== missing), 'video_av_query_attachments'] }), false);
});

test('empty selected scope preserves every raw identity as not prepared and never becomes all scope', async () => {
  const input = selection(2); let sent;
  const session = new AnswerSession(async (_path, options) => { sent = options.body; return envelope(sent, false, 'empty_scope'); }, enabled);
  await session.ask('完整问题', [], 'video-av-joint', input);
  assert.equal(session.value.phase, 'abstained'); assert.equal(sent.document_ids, undefined);
  assert.equal(session.value.queryAttachments.length, 2);
  for (const item of session.value.queryAttachments) {
    assert.equal(item.status, 'not_prepared');
    for (const field of ['content_sha256', 'window_count', 'visual_window_count', 'audio_window_count', 'audio_present']) assert.equal(item[field], null);
  }
});

test('prepared visual reference accepts actual absent audio and preserves duplicate originals as separate ordinals', async () => {
  const original = file(), input = [{ file: original, kind: 'video' }, { file: original, kind: 'video' }];
  const session = new AnswerSession(async (_path, { body }) => {
    const result = envelope(body); for (const item of result.query_attachments) Object.assign(item, { visual_window_count: 3, audio_window_count: 0, audio_present: false }); return result;
  }, enabled);
  await session.ask('只问画面', null, 'video-av-visual', input);
  assert.equal(session.value.phase, 'abstained'); assert.equal(session.value.queryAttachments.length, 2);
  assert.equal(session.value.queryAttachments[0].source_sha256, session.value.queryAttachments[1].source_sha256);
  assert.deepEqual(session.value.queryAttachments.map(item => item.ordinal), [0, 1]);
});

test('query receipt rejects partial groups, wrong original identity, mode or compiler and unknown fields', async () => {
  const mutations = [
    v => { v.extra = true; }, v => { delete v.mode; }, v => { v.mode = 'VISUAL'; },
    v => { v.result.mode = 'AUDIO'; }, v => { v.query_attachments.pop(); }, v => { v.query_attachments = []; },
    v => { v.query_attachments[1].source_sha256 = 'a'.repeat(64); }, v => { v.query_attachments.reverse(); },
    v => { v.query_attachments[1].used_mode = 'VISUAL'; }, v => { v.query_attachments[1].media_kind = 'audio'; },
    v => { v.query_attachments[1].compiler_revision = 'different'; }, v => { v.query_attachments[1].filename = 'forbidden'; },
    v => { delete v.query_attachments[1].audio_present; },
    v => { v.query_attachments[1] = receipt(v.query_attachments[1].source_sha256, 1, 'JOINT', false); },
  ];
  for (const mutate of mutations) {
    const session = new AnswerSession(async (_path, { body }) => { const value = envelope(body); mutate(value); return value; }, enabled);
    await session.ask('完整问题', null, 'video-av-joint', selection(2));
    assert.equal(session.value.phase, 'error'); assert.equal(session.value.error.status, 502); assert.equal(session.value.result, null);
  }
});

test('receipt requires full window counts, whole prepared group resource limit and mode materials', async () => {
  for (const change of [{ window_count: 0 }, { window_count: 1202 }, { window_count: 3.5 }, { visual_window_count: 0 },
    { audio_window_count: 4 }, { visual_window_count: 1, audio_window_count: 1 }, { audio_present: false },
    { audio_window_count: 0, audio_present: false }, { content_sha256: null }]) {
    const session = new AnswerSession(async (_path, { body }) => { const value = envelope(body); Object.assign(value.query_attachments[0], change); return value; }, enabled);
    await session.ask('完整问题', null, 'video-av-joint', selection(1)); assert.equal(session.value.error?.status, 502);
  }
  const over = new AnswerSession(async (_path, { body }) => { const value = envelope(body); for (const item of value.query_attachments) Object.assign(item, { window_count: 601, visual_window_count: 601, audio_window_count: 601 }); return value; }, enabled);
  await over.ask('完整问题', null, 'video-av-joint', selection(2)); assert.equal(over.value.error?.status, 502);
});

test('not prepared group must be fully null and cannot carry an answered result', async () => {
  for (const mutate of [v => { v.query_attachments[0].content_sha256 = 'a'.repeat(64); }, v => { v.query_attachments[0].window_count = 0; },
    v => { v.query_attachments[0].audio_present = false; }, v => { v.result.status = 'answered'; }]) {
    const session = new AnswerSession(async (_path, { body }) => { const value = envelope(body, false); mutate(value); return value; }, enabled);
    await session.ask('完整问题', null, 'video-av-visual', selection(1)); assert.equal(session.value.error?.status, 502);
  }
});

test('reference encoding hashes the same complete bytes read once, including base64 block boundary and tail', async () => {
  const bytes = Uint8Array.from({ length: 24581 }, (_, i) => i % 251); let reads = 0;
  const input = file('whole.mp4', bytes); input.arrayBuffer = async () => { reads++; return bytes.buffer.slice(0); };
  const session = new AnswerSession(async (_path, { body }) => { assert.deepEqual(Buffer.from(body.attachments[0].content_base64, 'base64'), Buffer.from(bytes)); return envelope(body); }, enabled);
  await session.ask('尾段问题', null, 'video-av-visual', [{ file: input, kind: 'video' }]);
  assert.equal(session.value.phase, 'abstained'); assert.equal(reads, 1); assert.equal(session.value.queryAttachments[0].source_sha256, sha(bytes));
});

test('non-video or oversized complete reference selection is rejected before reading or dispatching', async () => {
  let reads = 0, calls = 0; const audio = new File(['x'], 'sound.wav'); audio.arrayBuffer = async () => { reads++; throw Error('must not read'); };
  const session = new AnswerSession(async () => { calls++; }, enabled);
  await session.ask('问题', null, 'video-av-joint', [{ file: audio, kind: 'audio' }]); assert.equal(session.value.error?.status, 422);
  await session.ask('问题', null, 'video-av-visual', [...selection(3), ...selection(1)]); assert.equal(session.value.error?.status, 422);
  const large = file('large.mp4', new Uint8Array(11 * 1024 * 1024));
  await session.ask('问题', null, 'video-av-visual', [{ file: large, kind: 'video' }, { file: large, kind: 'video' }]); assert.equal(session.value.error?.status, 422);
  assert.equal(reads, 0); assert.equal(calls, 0);
});

test('cancel or context reset during original file read cannot dispatch a late query', async () => {
  for (const action of ['cancel', 'reset']) {
    const gate = deferred(), input = file(); input.arrayBuffer = () => gate.promise; let calls = 0;
    const session = new AnswerSession(async () => { calls++; }, enabled);
    const pending = session.ask('旧问题', ['old'], 'video-av-joint', [{ file: input, kind: 'video' }]);
    assert.equal(session.value.phase, 'loading'); session[action](); gate.resolve(new TextEncoder().encode('old bytes').buffer); await pending;
    assert.equal(calls, 0); assert.equal(session.value.phase, 'idle');
  }
});

test('late reference reply and authentication error cannot replace a newer text answer or clear its identity', async () => {
  for (const reject of [false, true]) {
    const gate = deferred(); let oldBody, authentication = 0;
    const session = new AnswerSession(async (path, { body }) => {
      if (path === '/v1/video-av-query-answers') { oldBody = body; await gate.promise; if (reject) throw new ApiError(401, 'old identity'); return envelope(body); }
      return refusal(body.mode, 'empty_scope');
    }, { ...enabled, onAuthenticationFailure: () => { authentication++; } });
    const pending = session.ask('旧问题', null, 'video-av-joint', selection(1));
    while (!oldBody) await new Promise(resolve => setImmediate(resolve));
    await session.ask('新问题', [], 'video-av-visual'); gate.resolve(); await pending;
    assert.equal(session.value.phase, 'abstained'); assert.equal(session.value.result.mode, 'VISUAL'); assert.equal(session.value.queryAttachments.length, 0); assert.equal(authentication, 0);
  }
});

test('new query capability does not change the ordinary seven-field endpoint without attachments', async () => {
  let sent; const session = new AnswerSession(async (path, { body }) => { sent = { path, body }; return refusal(body.mode, 'empty_scope'); }, enabled);
  await session.ask('完整文字问题', [], 'video-av-audio'); assert.equal(session.value.phase, 'abstained');
  assert.deepEqual(sent, { path: '/v1/video-av-answers', body: { question: '完整文字问题', mode: 'AUDIO' } });
});

test('answered reference query opens only the original library source with its full SHA and server window', async () => {
  const original = new Blob(['entire authorized library original with final bytes'], { type: 'video/mp4' });
  const sourceSha = sha(Buffer.from(await original.arrayBuffer()));
  const facts = [{ id: '1'.repeat(64), text: '红色杯子落下时发出清脆声音。', requirement: 'JOINT', visual_contribution: true, audio_contribution: true }];
  const citation = { number: 1, kind: 'video_av_window', mode: 'JOINT', document_id: 'library-video', revision_id: 'library-revision', source_sha256: sourceSha,
    publication_id: 'library-publication', profile_fingerprint: 'b'.repeat(64), decoder_revision: 'decoder-v1', filename: 'library.mp4', media_type: 'video/mp4',
    epoch: { pts: '32000', time_base_num: '1', time_base_den: '16000', ticks_per_second: '16000' },
    window: { id: 'library-window', ordinal: 2, start_tick: '32000', end_tick: '48001', start_ms: 2000, end_ms: 3001,
      video: { clip_sha256: 'c'.repeat(64), frame_count: 8, frames_manifest_sha256: 'd'.repeat(64), first_local_tick: '0', end_local_tick: '16000' },
      audio: { pcm_sha256: 'e'.repeat(64), wav_sha256: 'f'.repeat(64), start_sample: '32000', end_sample: '48001', sample_rate: 16000 } },
    facts, facts_sha256: sha(JSON.stringify(facts)), analysis_model_revision: 'analysis-v1', policy_revision: 'java-video-av-answer-v1', time_precision: 'server_window',
    source_url: '/v1/video-av-sources/answer-query/1', content_url: '/v1/video-av-sources/answer-query/1/content' };
  const answer = { answer_id: 'answer-query', status: 'answered', mode: 'JOINT', answer: facts[0].text,
    reason_code: null, citations: [citation], policy_revision: 'java-video-av-answer-v1' };
  const calls = [], blobs = [], revoked = [];
  const session = new AnswerSession(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/v1/video-av-query-answers') return { ...envelope(options.body), result: answer };
    if (path === citation.source_url) return { answer_id: answer.answer_id, citation };
    assert.equal(path, citation.content_url); return original;
  }, { ...enabled, objectUrls: { createObjectURL: value => { blobs.push(value); return 'blob:library-only'; }, revokeObjectURL: value => revoked.push(value) } });
  await session.ask('杯子落下时有什么声音？', ['library-video'], 'video-av-joint', selection(3));
  assert.equal(session.value.phase, 'answered'); assert.equal(session.value.queryAttachments.length, 3);
  assert.equal(session.value.result.citations[0].document_id, 'library-video');
  assert.ok(session.value.queryAttachments.every(item => item.source_sha256 !== sourceSha));
  await session.readSource(1); assert.equal(session.value.sourcePhase, 'ready'); assert.equal(session.value.source.mediaUrl, 'blob:library-only');
  assert.deepEqual(calls.map(item => item.path), ['/v1/video-av-query-answers', citation.source_url, citation.content_url]);
  assert.deepEqual(blobs, [original]); assert.equal(calls[1].options.body, undefined); assert.equal(calls[2].options.binary, true);
  assert.equal(session.value.source.window.end_ms, 3001);
  session.reset(); assert.deepEqual(revoked, ['blob:library-only']); assert.equal(session.value.source, null);
});
