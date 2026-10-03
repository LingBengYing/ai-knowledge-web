import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AnswerSession, answersEnabled } from '../public/answers.mjs';
import { createApi, validateUpload } from '../public/api.mjs';

const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const hash = createHash('sha256').update(bytes).digest('hex');
const visual = (changes = {}) => ({ number: 1, kind: 'image_region', document_id: 'doc-1', revision_id: 'rev-1',
  source_sha256: hash, parser_revision: 'java-visual-v1', filename: 'shapes.png', media_type: 'image/png',
  width: 300, height: 200, bbox: [0, 0, 1, 1], coordinate_system: 'normalized_xyxy',
  model_revision: 'synthetic-vision', policy_revision: 'synthetic-policy',
  source_url: '/v1/visual-sources/answer-1/1', content_url: '/v1/visual-sources/answer-1/1/content', ...changes });
const text = (changes = {}) => ({ number: 1, document_id: 'doc-1', revision_id: 'rev-1', source_sha256: hash,
  parser_revision: 'java-image-ocr-v2-tsv:synthetic:eng', filename: 'budget.png', page: 1, start: 2, end: 6,
  quote: 'test', quote_sha256: 'a'.repeat(64), source_url: '/v1/sources/answer-1/1', ...changes });
const image = (changes = {}) => ({ type: 'image', mime_type: 'image/png', width: 300, height: 200,
  bbox: [0, 0, 1, 1], coordinate_system: 'normalized_xyxy', text_origin: 'machine_ocr',
  content_url: '/v1/sources/answer-1/1/content', region_kind: 'ocr_word',
  regions: [{ start: 2, end: 6, bbox: [0.1, 0.2, 0.8, 0.4] }], ...changes });
const answer = citation => ({ answer_id: 'answer-1', status: 'answered', answer: 'Synthetic answer', reason: null, citations: [citation] });
function fixture(citation = visual(), metadata = { answer_id: 'answer-1', citation }, binary = new Blob([bytes], { type: 'image/png' })) {
  const calls = [], released = [];
  const session = new AnswerSession(async (path, options) => {
    calls.push({ path, options });
    return path.endsWith('/content') ? binary : path.endsWith('answers') ? answer(citation) : metadata;
  }, { objectUrls: { createObjectURL: () => 'blob:synthetic', revokeObjectURL: url => released.push(url) } });
  return { session, calls, released };
}

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

test('visual mode requires both typed capabilities and preserves every selected ID', async () => {
  assert.equal(answersEnabled({ capabilities: ['answers', 'sources'] }, 'visual'), false);
  assert.equal(answersEnabled({ capabilities: ['visual_answers', 'visual_sources'] }, 'visual'), true);
  const { session, calls } = fixture();
  await session.ask('What is visible?', ['doc-1', 'unpublished-text'], 'visual');
  assert.equal(calls[0].path, '/v1/visual-answers');
  assert.deepEqual(calls[0].options.body.document_ids, ['doc-1', 'unpublished-text']);
  assert.equal(session.value.phase, 'answered');
  assert.equal(session.value.result.citations[0].page, undefined);
});

test('typed visual source verifies identity and bytes before exposing a disposable object URL', async () => {
  const { session, calls, released } = fixture();
  await session.ask('What?', [], 'visual');
  await session.readSource(1);
  assert.equal(calls[2].path, '/v1/visual-sources/answer-1/1/content');
  assert.equal(calls[2].options.binary, true);
  assert.equal(session.value.sourcePhase, 'ready');
  assert.equal(session.value.source.imageUrl, 'blob:synthetic');
  session.closeSource();
  assert.equal(session.value.source, null);
  assert.deepEqual(released, ['blob:synthetic']);
});

test('OCR source keeps transcription offsets and server word rectangles', async () => {
  const citation = text();
  const { session } = fixture(citation, { answer_id: 'answer-1', citation, image: image() });
  await session.ask('What?'); await session.readSource(1);
  assert.equal(session.value.sourcePhase, 'ready');
  assert.equal(session.value.source.quote, 'test');
  assert.deepEqual(session.value.source.image.regions[0].bbox, [0.1, 0.2, 0.8, 0.4]);
});

test('legacy OCR accepts whole-image anchoring but v2 requires valid intersecting word regions', async () => {
  for (const patch of [{ regions: [] }, { region_kind: null, regions: null },
    { regions: [{ start: 8, end: 10, bbox: [0, 0, 1, 1] }] },
    { regions: [{ start: 2, end: 6, bbox: [0.8, 0, 0.2, 1] }] },
    { content_url: 'https://example.invalid/a.png' }]) {
    const citation = text();
    const { session, calls } = fixture(citation, { answer_id: 'answer-1', citation, image: image(patch) });
    await session.ask('What?'); await session.readSource(1);
    assert.equal(session.value.sourcePhase, 'error'); assert.equal(calls.length, 2);
  }
  const citation = text({ parser_revision: 'java-image-ocr-v1:synthetic:eng' });
  const { session } = fixture(citation, { answer_id: 'answer-1', citation, image: image({ region_kind: null, regions: null }) });
  await session.ask('What?'); await session.readSource(1);
  assert.equal(session.value.sourcePhase, 'ready');
});

test('image byte mismatch and MIME mismatch never expose an image', async () => {
  for (const blob of [new Blob(['wrong'], { type: 'image/png' }), new Blob([bytes], { type: 'image/jpeg' })]) {
    const { session } = fixture(visual(), undefined, blob);
    await session.ask('What?', null, 'visual'); await session.readSource(1);
    assert.equal(session.value.sourcePhase, 'error'); assert.equal(session.value.source, null);
  }
});

test('visual source cannot change dimensions, bbox or model identity on reread', async () => {
  for (const patch of [{ width: 301 }, { model_revision: 'other' }, { policy_revision: 'other' }, { bbox: [0, 0, 0.5, 1] }]) {
    const { session, calls } = fixture(visual(), { answer_id: 'answer-1', citation: visual(patch) });
    await session.ask('What?', null, 'visual'); await session.readSource(1);
    assert.equal(session.value.sourcePhase, 'error'); assert.equal(calls.length, 2);
  }
});

test('mode change resets pending image reads and late content cannot create a URL', async () => {
  let deliver, created = 0;
  const pending = new Promise(resolve => { deliver = resolve; });
  const session = new AnswerSession(async path => path.endsWith('/content') ? pending : path.endsWith('answers')
    ? answer(visual()) : { answer_id: 'answer-1', citation: visual() },
  { objectUrls: { createObjectURL: () => { created++; return 'blob:late'; }, revokeObjectURL() {} } });
  await session.ask('What?', null, 'visual');
  const read = session.readSource(1); await new Promise(resolve => setImmediate(resolve));
  session.reset(); deliver(new Blob([bytes], { type: 'image/png' })); await read;
  assert.equal(created, 0); assert.equal(session.value.source, null);
});

test('binary API is restricted, bounded while reading, and retains current authentication', async () => {
  let seen;
  const api = createApi({ auth_mode: 'development_headers', workspace_id: 'org-main' }, () => 'owner', async (path, options) => {
    seen = options; return new Response(bytes, { headers: { 'Content-Type': 'image/png' } });
  });
  const blob = await api('/v1/sources/answer-1/1/content', { binary: true });
  assert.ok(blob instanceof Blob); assert.equal(blob.size, bytes.length);
  assert.equal(seen.headers['X-Principal-Id'], 'owner');
  for (const path of ['/v1/config', '/v1/sources/answer-1/1/content?q=x']) await assert.rejects(api(path, { binary: true }));
  const oversized = createApi({}, () => '', async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }));
  await assert.rejects(oversized('/v1/sources/answer-1/1/content', { binary: true }));
});
