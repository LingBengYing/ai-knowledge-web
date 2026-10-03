import test from 'node:test';
import assert from 'node:assert/strict';
import { AnswerSession } from '../public/answers.mjs';
import { ApiError } from '../public/api.mjs';
import { queryAttachmentsEnabled, attachmentAccept, checkedQueryAttachments, encodeQueryAttachments, attachmentMode } from '../public/query-attachments.mjs';

const entry = (name = 'query.png', kind = 'image', bytes = new Uint8Array([0, 1, 128, 254, 255])) => ({ file: new File([bytes], name), kind });
const result = () => ({ answer_id: 'attached-one', status: 'abstained', answer: '没有足够的库内证据。', reason: 'no_evidence', citations: [] });
const notice = (kind = 'image', ordinal = 0) => ({ ordinal, media_kind: kind, status: 'prepared', visual_sampled: false, reason: null });
const envelope = (mode = 'text', notices = [notice()]) => ({ mode, result: result(), query_attachments: notices });
const enabled = request => new AnswerSession(request, { canUseAttachments: () => true });

test('attachment capability is opt-in and explicit kinds disambiguate MP4/WebM', () => {
  assert.equal(queryAttachmentsEnabled({ capabilities: ['answers', 'sources'] }), false);
  assert.equal(queryAttachmentsEnabled({ capabilities: ['query_attachments'] }), true);
  assert.match(attachmentAccept('image'), /\.png/);
  assert.doesNotMatch(attachmentAccept('audio'), /\.mov/);
  const items = checkedQueryAttachments([entry('voice.mp4', 'audio'), entry('clip.mp4', 'video'), entry('query.jpeg')]);
  assert.deepEqual(items.map(item => item.mediaType), ['audio/mp4', 'video/mp4', 'image/jpeg']);
});

test('whole attachment batch is validated before reading any file', async () => {
  let reads = 0;
  const first = entry(); first.file.arrayBuffer = async () => { reads++; return new ArrayBuffer(5); };
  for (const invalid of [entry('query.pdf'), entry('../query.png'), entry('empty.png', 'image', ''), entry('query.png', 'unknown'),
    entry('x.png', 'image', new Uint8Array(10 * 1024 * 1024 + 1))]) {
    await assert.rejects(encodeQueryAttachments([first, invalid]), error => error instanceof ApiError && error.status === 422);
  }
  assert.throws(() => checkedQueryAttachments(Array.from({ length: 4 }, () => entry())), /最多3/);
  assert.throws(() => checkedQueryAttachments([entry('a.wav', 'audio', new Uint8Array(11 * 1024 * 1024)), entry('b.wav', 'audio', new Uint8Array(10 * 1024 * 1024))]), /20MiB/);
  assert.equal(reads, 0);
});

test('three media kinds encode complete original bytes with canonical base64', async () => {
  const bytes = Uint8Array.from({ length: 65539 }, (_, index) => index % 256);
  const files = [entry('query.png', 'image', bytes), entry('query.wav', 'audio', bytes), entry('query.mp4', 'video', bytes)];
  const encoded = await encodeQueryAttachments(files);
  assert.deepEqual(encoded.map(item => item.media_type), ['image/png', 'audio/wav', 'video/mp4']);
  for (const item of encoded) assert.equal(item.content_base64, Buffer.from(bytes).toString('base64'));
  assert.deepEqual(Object.keys(encoded[0]), ['filename', 'media_type', 'content_base64']);
});

test('attachment requests preserve raw question, complete selection, eight evidence modes and refusal notices', async () => {
  for (const [mode, wire] of Object.entries({ text: 'text', visual: 'image', audio: 'audio', 'video-visual': 'video_visual', 'video-transcript': 'video_transcript', 'video-joint': 'video_joint', 'video-ocr': 'video_ocr', 'video-subtitle': 'video_subtitle' })) {
    assert.equal(attachmentMode(mode), wire);
    let call;
    const session = enabled(async (path, options) => { call = { path, options }; return envelope(wire); });
    await session.ask(' 原问题\n\t保持 ', ['published', 'unpublished'], mode, [entry()]);
    assert.equal(call.path, '/v1/attachment-answers');
    assert.equal(call.options.body.question, ' 原问题\n\t保持 ');
    assert.deepEqual(call.options.body.document_ids, ['published', 'unpublished']);
    assert.equal(call.options.body.mode, wire);
    assert.equal(call.options.body.attachments[0].content_base64, Buffer.from([0, 1, 128, 254, 255]).toString('base64'));
    assert.equal(session.value.phase, 'abstained');
    assert.equal(session.value.queryAttachments[0].status, 'prepared');
  }
});

test('attachment selection cannot silently fall back when capability is absent, or scope/question is invalid', async () => {
  let calls = 0, reads = 0;
  const file = entry(); file.file.arrayBuffer = async () => { reads++; return new ArrayBuffer(5); };
  const request = async () => { calls++; return envelope(); };
  const disabled = new AnswerSession(request);
  await disabled.ask('问题', null, 'text', [file]);
  assert.equal(disabled.value.phase, 'error');
  const session = enabled(request);
  await session.ask('', null, 'text', [file]);
  await session.ask('问题', ['valid', '../invalid'], 'text', [file]);
  assert.equal(calls, 0); assert.equal(reads, 0);
});

test('cancellation during file read prevents POST; later successful answer keeps explicit empty scope', async () => {
  let deliver;
  const item = entry(); item.file.arrayBuffer = () => new Promise(resolve => { deliver = resolve; });
  const calls = [];
  const session = enabled(async (path, options) => { calls.push({ path, options }); return envelope(); });
  const pending = session.ask('问题', ['old'], 'text', [item]);
  assert.equal(session.value.phase, 'loading');
  session.cancel(); deliver(new Uint8Array([0, 1, 128, 254, 255]).buffer); await pending;
  assert.equal(calls.length, 0); assert.equal(session.value.phase, 'idle');
  await session.ask('问题', [], 'text', [entry()]);
  assert.deepEqual(calls[0].options.body.document_ids, []);
});

test('attachment envelope rejects mismatched mode, count, ordinal, kind and malformed preparation notices', async () => {
  for (const value of [envelope('image'), envelope('text', []), envelope('text', [notice('audio')]), envelope('text', [notice('image', 1)]),
    envelope('text', [{ ...notice(), visual_sampled: 'yes' }]), envelope('text', [{ ...notice(), status: 'ready' }]),
    envelope('text', [{ ...notice(), status: 'failed' }]), envelope('text', [{ ...notice(), reason: 'unexpected text' }])]) {
    const session = enabled(async () => value);
    await session.ask('问题', null, 'text', [entry()]);
    assert.equal(session.value.phase, 'error'); assert.equal(session.value.result, null);
  }
});

test('prepared sampled and failed notices retain safe reason while source reread uses existing library locator', async () => {
  const citation = { number: 1, document_id: 'library-doc', revision_id: 'rev-one', source_sha256: 'a'.repeat(64), parser_revision: 'parser-v1', filename: 'library.txt',
    page: 1, start: 0, end: 4, quote: '库内证据', quote_sha256: 'b'.repeat(64), source_url: '/v1/sources/attached-one/1' };
  const calls = [];
  const session = enabled(async path => {
    calls.push(path);
    return path === '/v1/attachment-answers' ? { mode: 'text', result: { ...result(), status: 'answered', answer: '库内证据[1]', reason: null, citations: [citation] },
      query_attachments: [{ ...notice(), visual_sampled: true }] } : { answer_id: 'attached-one', citation };
  });
  await session.ask('问题', ['library-doc'], 'text', [entry()]);
  assert.equal(session.value.phase, 'answered'); assert.equal(session.value.queryAttachments[0].visual_sampled, true);
  await session.readSource(1); assert.equal(session.value.sourcePhase, 'ready');
  assert.deepEqual(calls, ['/v1/attachment-answers', citation.source_url]);
  const failure = enabled(async () => envelope('text', [{ ...notice(), status: 'failed', reason: 'query_text_limit' }]));
  await failure.ask('问题', null, 'text', [entry()]);
  assert.equal(failure.value.phase, 'abstained'); assert.equal(failure.value.queryAttachments[0].reason, 'query_text_limit');
});

test('empty attachment selection preserves original endpoint and response contract', async () => {
  let call;
  const session = enabled(async (path, options) => { call = { path, options }; return result(); });
  await session.ask('问题', null, 'video-joint', []);
  assert.equal(call.path, '/v1/video-answers'); assert.deepEqual(call.options.body, { question: '问题', mode: 'joint' });
  assert.equal(session.value.phase, 'abstained');
});
