import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../public/api.mjs';
import { createHash } from 'node:crypto';
import { DocumentOriginalSession } from '../public/document-originals.mjs';

test('original-file API reads server PDF directly through the pinned revision content URL', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\nsynthetic original\n%%EOF');
  const calls = [];
  const api = createApi({}, () => '', async (path, options) => {
    calls.push({ path, options });
    return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length) } });
  });
  const path = '/v1/documents/doc-one/revisions/rev-one/content';
  const original = await api(path, { binary: true });
  assert.equal(original.type, 'application/pdf');
  assert.deepEqual(new Uint8Array(await original.arrayBuffer()), bytes);
  assert.equal(calls[0].path, path);
  assert.equal(calls[0].options.credentials, 'same-origin');
});

function originalFixture(type = 'application/pdf', changes = {}) {
  const bytes = new TextEncoder().encode('synthetic original <script>literal</script>');
  const documentType = type.startsWith('image/') ? 'image' : type.startsWith('audio/') ? 'audio' : type.startsWith('video/') ? 'video' : 'document';
  const hash = createHash('sha256').update(bytes).digest('hex');
  const item = { document_id: 'doc-one', filename: 'synthetic-file', document_type: documentType, latest_job: { revision_id: 'rev-one' },
    media_info: { mime_type: type, size_bytes: bytes.length, sha256: hash }, ...changes };
  const metadata = { document_id: 'doc-one', revision_id: 'rev-one', filename: 'synthetic-file', document_type: documentType,
    media_type: type, source_sha256: hash, size_bytes: bytes.length, content_url: '/v1/documents/doc-one/revisions/rev-one/content' };
  const calls = [], created = [], released = [];
  const session = new DocumentOriginalSession(async (path, options) => {
    calls.push({ path, options }); return path.endsWith('/content') ? new Blob([bytes], { type }) : metadata;
  }, { objectUrls: { createObjectURL(blob) { created.push(blob); return 'blob:original'; }, revokeObjectURL(url) { released.push(url); } } });
  return { bytes, item, metadata, calls, created, released, session };
}

test('saved sound original without a speech job binds registered source revision before preview', async () => {
  const fixture = originalFixture('audio/wav', { latest_job: null, active_revision_id: null, registered_revision_id: 'rev-one' });
  await fixture.session.open(fixture.item);
  assert.equal(fixture.session.value.phase, 'ready');
  assert.equal(fixture.session.value.original.revision_id, 'rev-one');
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.session.matches({ ...fixture.item, registered_revision_id: 'rev-two' }), false);
  fixture.session.close();
  assert.deepEqual(fixture.released, ['blob:original']);
});

test('all four originals and saved text bind metadata and SHA before exposing a disposable file', async () => {
  for (const type of ['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'audio/wav', 'video/mp4']) {
    const fixture = originalFixture(type); await fixture.session.open(fixture.item);
    assert.equal(fixture.session.value.phase, 'ready');
    assert.equal(fixture.session.value.original.url, 'blob:original');
    assert.equal(fixture.calls[1].options.binary, true);
    assert.equal(fixture.created.length, 1);
    if (type.startsWith('text/')) assert.equal(fixture.session.value.original.text, 'synthetic original <script>literal</script>');
    fixture.session.close(); assert.deepEqual(fixture.released, ['blob:original']);
    assert.equal(fixture.session.value.original, null);
  }
});

test('original metadata cannot redirect to another document, version, hash or remote URL', async () => {
  for (const change of [{ document_id: 'other' }, { revision_id: 'other' }, { source_sha256: 'a'.repeat(64) }, { size_bytes: 1 },
    { media_type: 'text/html' }, { content_url: 'https://example.invalid/file.pdf' }]) {
    const fixture = originalFixture(); Object.assign(fixture.metadata, change); await fixture.session.open(fixture.item);
    assert.equal(fixture.session.value.phase, 'error'); assert.equal(fixture.calls.length, 1); assert.equal(fixture.created.length, 0);
  }
});

test('corrupt original bytes and expired authorization never expose or retain a file URL', async () => {
  const fixture = originalFixture(); fixture.metadata.source_sha256 = fixture.item.media_info.sha256 = 'a'.repeat(64);
  await fixture.session.open(fixture.item); assert.equal(fixture.session.value.phase, 'error'); assert.equal(fixture.created.length, 0);
  let invalidated = 0;
  const { ApiError } = await import('../public/api.mjs');
  const session = new DocumentOriginalSession(async () => { throw new ApiError(401, 'expired'); }, { onAuthenticationFailure: () => invalidated++ });
  await session.open(fixture.item); assert.equal(invalidated, 1); assert.equal(session.value.phase, 'error');
});

test('closing details cancels both original stages and ignores late completion', async () => {
  for (const stage of ['metadata', 'content']) {
    const fixture = originalFixture(); let deliver; let signal;
    const session = new DocumentOriginalSession((path, options) => {
      signal = options.signal;
      if (stage === 'metadata' || path.endsWith('/content')) return new Promise(resolve => { deliver = resolve; });
      return Promise.resolve(fixture.metadata);
    }, { objectUrls: { createObjectURL() { assert.fail('late result cannot create URL'); }, revokeObjectURL() {} } });
    const pending = session.open(fixture.item);
    await new Promise(resolve => setImmediate(resolve)); session.close(); assert.equal(signal.aborted, true);
    deliver(stage === 'metadata' ? fixture.metadata : new Blob([fixture.bytes], { type: 'application/pdf' }));
    await pending; assert.equal(session.value.phase, 'idle');
  }
});

test('original binary reader rejects unsupported SVG, partial status, query paths and streams exceeding 20MiB', async () => {
  for (const response of [new Response('x', { headers: { 'Content-Type': 'image/svg+xml' } }),
    new Response('x', { status: 206, headers: { 'Content-Type': 'application/pdf' } }),
    new Response(new Uint8Array(20 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/pdf' } })]) {
    const api = createApi({}, () => '', async () => response);
    await assert.rejects(api('/v1/documents/doc-one/revisions/rev-one/content', { binary: true }));
  }
  const api = createApi({}, () => '', async () => { assert.fail('noncanonical binary URL must not reach network'); });
  await assert.rejects(api('/v1/documents/doc-one/revisions/rev-one/content?download=1', { binary: true }));
});

test('original-file API treats saved TXT and Markdown as bounded original text', async () => {
  for (const type of ['text/plain; charset=utf-8', 'text/markdown']) {
    const api = createApi({}, () => '', async () => new Response('合成原文 <script>literal</script>', { headers: { 'Content-Type': type } }));
    const original = await api('/v1/documents/doc-one/revisions/rev-one/content', { binary: true });
    assert.equal(await original.text(), '合成原文 <script>literal</script>');
    assert.equal(original.type, type.split(';')[0]);
  }
});
