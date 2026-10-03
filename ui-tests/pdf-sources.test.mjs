import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AnswerSession } from '../public/answers.mjs';
import { ApiError } from '../public/api.mjs';

// Synthetic protocol bytes only; native PDF rendering/OCR is verified by backend acceptance.
function fixture({ enabled = true, metadataChange = {}, content = null, waitContent = null } = {}) {
  const bytes = new TextEncoder().encode('%PDF synthetic protocol fixture');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const quote = 'Launch code is 73921.';
  const citation = { number: 1, document_id: 'doc-one', revision_id: 'rev-one', source_sha256: sha,
    parser_revision: `java-pdf-ocr-v1:${'a'.repeat(64)}`, filename: 'synthetic.PDF', page: 2,
    start: 0, end: [...quote].length, quote, quote_sha256: createHash('sha256').update(quote).digest('hex'),
    source_url: '/v1/sources/answer-one/1' };
  const metadata = { document_id: citation.document_id, revision_id: citation.revision_id,
    filename: citation.filename, source_sha256: sha, document_type: 'document', media_type: 'application/pdf',
    size_bytes: bytes.length, content_url: '/v1/documents/doc-one/revisions/rev-one/content', ...metadataChange };
  const calls = [], created = [], released = [];
  const session = new AnswerSession(async (path, options) => {
    calls.push({ path, options });
    if (path === '/v1/answers') return { answer_id: 'answer-one', status: 'answered', answer: quote, reason: null, citations: [citation] };
    if (path === citation.source_url) return { answer_id: 'answer-one', citation };
    if (path === '/v1/documents/doc-one/original') return metadata;
    assert.equal(path, '/v1/documents/doc-one/revisions/rev-one/content');
    return waitContent ? waitContent : content ?? new Blob([bytes], { type: 'application/pdf' });
  }, { canReadOriginal: () => enabled,
    objectUrls: { createObjectURL(blob) { created.push(blob); return 'blob:pdf-source'; }, revokeObjectURL(url) { released.push(url); } } });
  return { session, calls, created, released, citation, metadata, bytes };
}

test('PDF citation reads authority source, matching original metadata and full SHA before exposing the file', async () => {
  const f = fixture(); await f.session.ask('Code?', ['doc-one']); await f.session.readSource(1);
  assert.equal(f.session.value.sourcePhase, 'ready');
  assert.equal(f.session.value.source.pdfUrl, 'blob:pdf-source');
  assert.equal(f.session.value.source.page, 2);
  assert.deepEqual(f.calls.map(c => c.path), ['/v1/answers', '/v1/sources/answer-one/1',
    '/v1/documents/doc-one/original', '/v1/documents/doc-one/revisions/rev-one/content']);
  assert.equal(f.calls[3].options.binary, true);
  assert.equal(f.created.length, 1);
  f.session.closeSource(); assert.deepEqual(f.released, ['blob:pdf-source']);
});

test('PDF original identity, size and exact route are checked before content is fetched', async () => {
  for (const metadataChange of [{ document_id: 'other' }, { revision_id: 'other' }, { filename: 'other.pdf' },
    { source_sha256: 'b'.repeat(64) }, { document_type: 'image' }, { media_type: 'text/plain' },
    { size_bytes: 0 }, { size_bytes: 20 * 1024 * 1024 + 1 }, { size_bytes: 1.2 },
    { content_url: '/v1/documents/other/revisions/rev-one/content' }]) {
    const f = fixture({ metadataChange }); await f.session.ask('Code?'); await f.session.readSource(1);
    assert.equal(f.session.value.sourcePhase, 'error', JSON.stringify(metadataChange));
    assert.equal(f.calls.length, 3); assert.equal(f.created.length, 0);
  }
});

test('PDF bytes require exact MIME, declared size and SHA with no Blob URL on mismatch', async () => {
  const sample = fixture();
  for (const content of [new Blob([sample.bytes], { type: 'text/plain' }),
    new Blob(['x'], { type: 'application/pdf' }),
    new Blob(['x'.repeat(sample.bytes.length)], { type: 'application/pdf' })]) {
    const f = fixture({ content }); await f.session.ask('Code?'); await f.session.readSource(1);
    assert.equal(f.session.value.sourcePhase, 'error'); assert.equal(f.created.length, 0);
  }
});

test('disabled original capability preserves text-only source and makes no file request', async () => {
  const f = fixture({ enabled: false }); await f.session.ask('Code?'); await f.session.readSource(1);
  assert.equal(f.session.value.sourcePhase, 'ready'); assert.equal(f.session.value.source.pdfUrl, undefined);
  assert.equal(f.calls.length, 2);
});

test('closing a PDF source suppresses late file bytes and aborts their request', async () => {
  let resolve;
  const waiting = new Promise(done => { resolve = done; });
  const f = fixture({ waitContent: waiting }); await f.session.ask('Code?');
  const reading = f.session.readSource(1); await new Promise(done => setImmediate(done));
  assert.equal(f.calls.length, 4); f.session.closeSource();
  assert.equal(f.calls[3].options.signal.aborted, true);
  resolve(new Blob([f.bytes], { type: 'application/pdf' })); await reading;
  assert.equal(f.session.value.sourcePhase, 'idle'); assert.equal(f.created.length, 0);
});

test('failed PDF reread removes prior verified bytes and exposes the authorization failure', async () => {
  const f = fixture(); await f.session.ask('Code?'); await f.session.readSource(1);
  f.metadata.revision_id = 'new-revision'; await f.session.readSource(1);
  assert.equal(f.session.value.sourcePhase, 'error'); assert.equal(f.session.value.source, null);
  assert.deepEqual(f.released, ['blob:pdf-source']); assert.ok(f.session.value.sourceError instanceof ApiError);
});
