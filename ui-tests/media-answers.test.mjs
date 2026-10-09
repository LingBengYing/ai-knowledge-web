import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApi, validateUpload } from '../public/api.mjs';
import { AnswerSession, answersEnabled } from '../public/answers.mjs';
const bytes = new Uint8Array([1, 2, 3, 4]);
const hash = createHash('sha256').update(bytes).digest('hex');
const audio = (patch = {}) => ({ number: 1, kind: 'audio_span', document_id: 'doc', revision_id: 'rev', source_sha256: hash,
  parser_revision: 'audio-v1', filename: 'clip.wav', media_type: 'audio/wav', start_ms: 1500, end_ms: 3000,
  quote: 'Synthetic fact.', quote_sha256: hash, text_origin: 'machine_asr', time_precision: 'server_chunk',
  source_url: '/v1/audio-sources/a/1', content_url: '/v1/audio-sources/a/1/content', ...patch });
const video = (patch = {}) => ({ number: 1, kind: 'video_frame', proof_origin: 'machine_vlm', document_id: 'doc', revision_id: 'rev', source_sha256: hash,
  parser_revision: 'video-v1', filename: 'clip.mp4', media_type: 'video/mp4', group_id: 'group', start_us: 1001, end_us: 35001,
  start_ms: 1.001, end_ms: 35.001, time_precision: 'group_interval', frame: { frame_us: 1001, frame_ms: 1.001, duration_us: 34000,
    frame_sha256: hash, width: 640, height: 320, media_type: 'image/png', origin: 'decoded_original', content_url: '/v1/video-sources/a/1/frame' },
  transcript: null, ocr: null, subtitle: null, source_url: '/v1/video-sources/a/1', content_url: '/v1/video-sources/a/1/content', ...patch });
function fixture(citation) {
  const calls = [], released = []; let ordinal = 0;
  const session = new AnswerSession(async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('answers')) return { answer_id: 'a', status: 'answered', answer: 'Synthetic answer.', reason: null, citations: [citation] };
    if (path.endsWith('/content') || path.endsWith('/frame')) return new Blob([bytes], { type: path.endsWith('/frame') ? 'image/png' : citation.media_type });
    return { answer_id: 'a', citation };
  }, { objectUrls: { createObjectURL: () => 'blob:media-' + (++ordinal), revokeObjectURL: value => released.push(value) } });
  return { session, calls, released };
}
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
test('audio question keeps complete scope and typed time source opens original bytes', async () => {
  assert.equal(answersEnabled({ capabilities: ['audio_answers', 'audio_sources'] }, 'audio'), true);
  const { session, calls, released } = fixture(audio());
  await session.ask('Question?', ['doc', 'unpublished'], 'audio'); await session.readSource(1);
  assert.equal(calls[0].path, '/v1/audio-answers'); assert.equal(calls[0].options.body.document_ids, undefined);
  assert.equal(session.value.sourcePhase, 'ready'); assert.equal(session.value.source.start_ms, 1500); assert.ok(session.value.source.mediaUrl);
  session.reset(); assert.equal(released.length, 1);
});
test('video question sends explicit proof mode and preserves exact time plus verified original frame', async () => {
  const { session, calls, released } = fixture(video());
  await session.ask('What color?', [], 'video-visual'); await session.readSource(1);
  assert.equal(calls[0].path, '/v1/video-answers'); assert.deepEqual(calls[0].options.body, { question: 'What color?', mode: 'visual' });
  assert.equal(session.value.sourcePhase, 'ready'); assert.equal(session.value.source.start_ms, 1.001);
  assert.ok(session.value.source.frameUrl); assert.ok(session.value.source.mediaUrl);
  session.closeSource(); assert.equal(released.length, 2);
});
test('media citation rejects reversed time and source reread cannot change temporal identity', async () => {
  const { session } = fixture(audio({ end_ms: 100 }));
  await session.ask('Question?', null, 'audio'); assert.equal(session.value.phase, 'error');
  const current = audio();
  const other = new AnswerSession(async path => path.endsWith('answers') ? { answer_id: 'a', status: 'answered', answer: 'x', reason: null, citations: [current] } : { answer_id: 'a', citation: audio({ start_ms: 1600 }) });
  await other.ask('Question?', null, 'audio'); await other.readSource(1); assert.equal(other.value.sourcePhase, 'error');
});
test('binary media API accepts exact audio/video content and frame with independent 20MiB media budget', async () => {
  const api = createApi({}, () => '', async path => new Response(new Uint8Array(11 * 1024 * 1024), { headers: { 'Content-Type': path.includes('audio') ? 'audio/wav' : 'image/png' } }));
  assert.equal((await api('/v1/audio-sources/a/1/content', { binary: true })).size, 11 * 1024 * 1024);
  await assert.rejects(api('/v1/video-sources/a/1/frame', { binary: true }));
});

test('video OCR and subtitle sources preserve their distinct evidence, including absent subtitle language', async () => {
  const ocr = video({ kind: 'video_frame_ocr', proof_origin: 'machine_ocr', time_precision: 'frame_interval', group_id: null,
    ocr: { start_code_point: 0, end_code_point: 4, quote: 'Fact', quote_sha256: hash, ocr_revision: 'synthetic-ocr', regions: [{ start: 0, end: 4, left: 20, top: 30, right: 100, bottom: 50 }] } });
  const subtitle = video({ kind: 'video_subtitle', proof_origin: 'embedded_subtitle', time_precision: 'subtitle_cue', group_id: null, frame: null,
    subtitle: { cue_id: 'cue', track_id: 'track', stream_index: 2, codec: 'subrip', language: null, cue_ordinal: 0, pts: 1001, duration: 34000, time_base_numerator: 1, time_base_denominator: 1000000,
      start_code_point: 0, end_code_point: 4, quote: 'Fact', quote_sha256: hash, payload_sha256: hash, subtitle_manifest_sha256: hash, native_manifest_sha256: hash, track_text_sha256: hash, decoder_revision: 'synthetic-decoder', text_format: 'plain_text' } });
  for (const [citation, mode] of [[ocr, 'video-ocr'], [subtitle, 'video-subtitle']]) {
    const { session } = fixture(citation); await session.ask('Question?', null, mode); await session.readSource(1);
    assert.equal(session.value.sourcePhase, 'ready', session.value.error?.message ?? session.value.sourceError?.message);
    assert.equal(!!session.value.source.frameUrl, mode === 'video-ocr');
    session.reset();
  }
});
