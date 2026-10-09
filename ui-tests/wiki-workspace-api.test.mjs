import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApi } from '../public/api.mjs';
import { createWikiWorkspaceApi, wikiSourcePath } from '../public/wiki-workspace-api.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const pageContext = { page_id: 'page-one', version: 2, source_id: 'source-one' };
const proposalContext = { proposal_id: 'proposal-one', source_id: 'source-one' };
const settings = { version: 4, search_method: 'hybrid', ranking_mode: 'rerank', dense_weight: 0.5, top_k: 5, score_threshold_enabled: true, score_threshold: -0.2 };

test('Wiki workflow sends exact persisted actions and CAS versions once without rewriting returned data', async () => {
  const calls = [], result = { marker: 'server' };
  const client = createWikiWorkspaceApi({ api: async (path, options) => { calls.push([path, options]); return result; } });
  const command = { title: '灯塔', kind: 'topic', base_version: 0, document_ids: ['doc-one'], generation_method: 'extractive' };
  assert.equal(await client.createProposal(command), result);
  await client.acceptProposal('proposal-one', 0);
  await client.dismissProposal('proposal-two');
  await client.createDraft({ title: '未核验', body: '<script>data</script>' });
  await client.updateDraft('draft-one', { version: 1, title: '保留正文', body: '新稿' });
  await client.deleteDraft('draft-one', 2);
  assert.deepEqual(calls.map(([path, options]) => [path, options.method, options.body]), [
    ['/v1/wiki/proposals', 'POST', command], ['/v1/wiki/proposals/proposal-one/accept', 'POST', { base_version: 0 }],
    ['/v1/wiki/proposals/proposal-two/dismiss', 'POST', {}], ['/v1/wiki/drafts', 'POST', { title: '未核验', body: '<script>data</script>' }],
    ['/v1/wiki/drafts/draft-one', 'PUT', { version: 1, title: '保留正文', body: '新稿' }], ['/v1/wiki/drafts/draft-one?version=2', 'DELETE', undefined],
  ]);
  const failing = createWikiWorkspaceApi({ api: async () => { throw new Error('no response'); } });
  await assert.rejects(failing.createProposal(command), /no response/u);
});

test('full page enumeration preserves all identities beyond Top K and rejects partial/inconsistent collections', async () => {
  const calls = [], items = Array.from({ length: 103 }, (_, index) => ({ page_id: `page-${index}`, content: { title: `${index}` } }));
  const client = createWikiWorkspaceApi({ api: async path => {
    calls.push(path); const offset = Number(new URL(path, 'http://local').searchParams.get('offset'));
    return { items: items.slice(offset, offset + 100), total: 103, offset, limit: 100 };
  } });
  assert.deepEqual(await client.allPages(), items);
  assert.equal(calls.length, 2);
  for (const malformed of [{ items: [], total: 1, offset: 0, limit: 100 },
    { items: [{ page_id: 'same' }, { page_id: 'same' }], total: 2, offset: 0, limit: 100 },
    { items: [], total: 0, offset: 3, limit: 100 }]) {
    await assert.rejects(createWikiWorkspaceApi({ api: async () => malformed }).allPages(), error => error.status === 502);
  }
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(client.allPages({ signal: cancelled.signal }), error => error.name === 'AbortError');
  assert.equal(calls.length, 2);
});

test('catalog query encodes literal text separately from kind and pagination', async () => {
  let path;
  const client = createWikiWorkspaceApi({ api: async value => { path = value; return { items: [], total: 0, offset: 20, limit: 20 }; } });
  await client.listCatalog({ q: '灯塔 & /项目?', kind: 'video', offset: 20 });
  const query = new URL(path, 'http://local').searchParams;
  assert.equal(query.get('q'), '灯塔 & /项目?'); assert.equal(query.get('kind'), 'video'); assert.equal(query.get('offset'), '20');
  assert.throws(() => client.listCatalog({ kind: 'guessed-product' }), error => error.status === 422);
  assert.throws(() => client.getPage('../secrets'), error => error.status === 422);
  assert.throws(() => client.deleteDraft('draft-one', 0), error => error.status === 422);
});

test('upload retains File bytes and explicit media type while indexing remains a separate bodyless action', async () => {
  const calls = [], file = new File(['synthetic text'], '合成 材料.txt', { type: 'text/plain' });
  const client = createWikiWorkspaceApi({ api: async (path, options) => { calls.push([path, options]); return {}; } });
  await client.upload(file); await client.startIndexing('doc-one'); await client.getIngestion('parse-one'); await client.getIndexing('index-one');
  assert.equal(calls[0][0], `/v1/documents?filename=${encodeURIComponent(file.name)}`);
  assert.equal(calls[0][1].file, file); assert.equal(calls[0][1].uploadKind, 'document');
  assert.equal(calls[1][0], '/v1/documents/doc-one/index'); assert.equal(calls[1][1].body, undefined);
  assert.equal(calls[2][0], '/v1/ingestions/parse-one'); assert.equal(calls[3][0], '/v1/indexings/index-one');
});

test('Wiki source paths retain page version or proposal context and never accept arbitrary URLs', () => {
  assert.equal(wikiSourcePath(pageContext), '/v1/wiki/pages/page-one/versions/2/sources/source-one');
  assert.equal(wikiSourcePath(proposalContext), '/v1/wiki/proposals/proposal-one/sources/source-one');
  for (const value of [{ ...pageContext, version: 0 }, { ...pageContext, proposal_id: 'proposal-one' }, { ...proposalContext, source_id: '../content' }]) {
    assert.throws(() => wikiSourcePath(value), error => error.status === 422);
  }
});

test('Wiki text evidence hash and source-file hash remain distinct and both are validated', async () => {
  const content = new Blob(['whole original file with more than the quote'], { type: 'text/plain' });
  const source = { source_id: 'source-one', evidence_id: 'evidence-one', filename: 'manual.txt', media_type: 'text/plain',
    text: 'the quote', sha256: sha('the quote'), content_url: `${wikiSourcePath(pageContext)}/content`, frame_url: null };
  const client = createWikiWorkspaceApi({ api: async path => path.endsWith('/content') ? content : source });
  assert.equal(await client.getSource(pageContext), source);
  assert.equal(await client.sourceContent(pageContext, { expectedSha256: sha(await content.text()) }), content);
  await assert.rejects(client.sourceContent(pageContext, { expectedSha256: source.sha256 }), error => error.status === 502);
  await assert.rejects(client.sourceContent(pageContext), error => error.status === 422);
  source.text = 'wrong quote'; await assert.rejects(client.getSource(pageContext), error => error.status === 502);
  source.text = 'the quote'; source.content_url = 'https://untrusted.invalid/source';
  await assert.rejects(client.getSource(pageContext), error => error.status === 502);
});

test('Wiki content uses original MIME/size policy; frames and precise paths stay restricted', async () => {
  for (const context of [pageContext, proposalContext]) {
    const base = wikiSourcePath(context);
    for (const type of ['application/pdf', 'text/plain; charset=utf-8', 'audio/wav', 'video/mp4', 'image/png']) {
      const api = createApi({ auth_mode: 'jwt' }, () => '', async () => new Response('original', { headers: { 'Content-Type': type } }));
      assert.equal((await api(`${base}/content`, { binary: true })).type, type.split(';')[0]);
    }
    const invalid = createApi({}, () => '', async () => new Response('pdf', { headers: { 'Content-Type': 'application/pdf' } }));
    await assert.rejects(invalid(`${base}/frame`, { binary: true }), error => error.status === 502);
    let count = 0;
    const blocked = createApi({}, () => '', async () => { count++; throw new Error('must not fetch'); });
    for (const path of [`${base}/content?`, `${base}/content/more`, base.replace('source-one', '%73ource-one') + '/content', base.replace('/2/', '/0/') + '/frame?']) {
      await assert.rejects(blocked(path, { binary: true }), error => error.status === 422);
    }
    await assert.rejects(blocked(`${base}/content`, { method: 'POST', binary: true }), error => error.status === 422);
    assert.equal(count, 0);
  }
});

test('saved original verifies pinned version path, MIME, byte length and SHA', async () => {
  const blob = new Blob(['original'], { type: 'text/plain' });
  const metadata = { document_id: 'doc-one', revision_id: 'revision-one', content_url: '/v1/documents/doc-one/revisions/revision-one/content',
    source_sha256: sha('original'), media_type: 'text/plain', size_bytes: 8 };
  const client = createWikiWorkspaceApi({ api: async () => blob });
  assert.equal(await client.originalContent(metadata), blob);
  await assert.rejects(client.originalContent({ ...metadata, revision_id: 'revision-two' }), error => error.status === 502);
  await assert.rejects(client.originalContent({ ...metadata, size_bytes: 7 }), error => error.status === 502);
});

test('answer citation reread keeps answer identity, unbounded positive ordinal and source hashes', async () => {
  const citation = { citation_id: 45, document_id: 'doc-one', revision_id: 'revision-one', source_sha256: sha('original'),
    text_sha256: sha('quote'), quote: 'quote', source_url: '/v1/knowledge-sources/answer-one/45', content_url: '/v1/documents/doc-one/revisions/revision-one/content',
    filename: 'original.txt', media_type: 'text/plain', evidence_kind: 'document_text', origin: 'source_text', page: 1, start: 0, end: 5,
    start_ms: null, end_ms: null, time_precision: null };
  const response = { answer_id: 'answer-one', citation };
  const client = createWikiWorkspaceApi({ api: async () => response });
  assert.equal(await client.getAnswerSource('answer-one', 45), response);
  await assert.rejects(client.getAnswerSource('answer-two', 45), error => error.status === 502);
  citation.quote = 'replaced'; await assert.rejects(client.getAnswerSource('answer-one', 45), error => error.status === 502);
  citation.quote = 'quote'; citation.page = 0; await assert.rejects(client.getAnswerSource('answer-one', 45), error => error.status === 502);
  Object.assign(citation, { evidence_kind: 'video_transcript', media_type: 'video/mp4', origin: 'machine_asr', time_precision: 'server_chunk', page: null, start: null, end: null, start_ms: 20, end_ms: 30 });
  assert.equal(await client.getAnswerSource('answer-one', 45), response);
  citation.end_ms = 20; await assert.rejects(client.getAnswerSource('answer-one', 45), error => error.status === 502);
});

test('retrieval settings preserve CAS and finite provider score outside zero to one', async () => {
  const calls = [];
  const client = createWikiWorkspaceApi({ api: async (path, options) => { calls.push([path, options]); return options.method === 'PUT' ? { ...options.body, version: 5 } : settings; } });
  assert.deepEqual(await client.getSettings(), settings);
  assert.deepEqual(await client.saveSettings(settings), { ...settings, version: 5 });
  assert.equal(calls[1][0], '/v1/retrieval-settings'); assert.equal(calls[1][1].body.version, 4);
  await assert.rejects(client.saveSettings({ ...settings, top_k: 100 }), error => error.status === 422);
  const bad = createWikiWorkspaceApi({ api: async () => settings });
  await assert.rejects(bad.saveSettings(settings), error => error.status === 502);
});
