import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { RetrievalSession, retrievalEnabled, retrievalRequest, checkedRetrievalResult, matchCurrentOriginal } from '../public/retrieval-tests.mjs';

const sha = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const text = '星港😀预算47万元。';
const hit = async () => ({ rank: 1, document_id: 'doc-one', revision_id: 'revision-one', filename: 'fixture.txt', source_sha256: 'a'.repeat(64), parser_revision: 'java-text-v1', page: 2, start: 12, end: 12 + [...text].length, text, text_sha256: await sha(text), retrieval_score: 1 / 61, rerank_score: 0.75 });
const result = async () => ({ test_id: '00000000-0000-0000-0000-000000000001', configuration_version: 1, status: 'completed', reason: null, scope_count: 1, score_kind: 'rrf', matches: [await hit()] });

test('retrieval request preserves full selection and explicit empty scope with independent capability', () => {
  assert.equal(retrievalEnabled({ capabilities: ['answers', 'sources'] }), false);
  assert.equal(retrievalEnabled({ capabilities: ['retrieval_test'] }), true);
  assert.deepEqual(retrievalRequest('完整问题', []), { question: '完整问题', document_ids: [], top_k: 5, rerank: true });
  assert.deepEqual(retrievalRequest('完整问题', null, 20, false), { question: '完整问题', top_k: 20, rerank: false });
  for (const ids of [['doc-one', 'doc-one'], ['doc-one', '../private']]) assert.throws(() => retrievalRequest('问题', ids), ApiError);
  assert.throws(() => retrievalRequest('问题', null, 21), ApiError);
  assert.throws(() => retrievalRequest('问题', null, 5, 'false'), ApiError);
});

test('actual CP locators and untrimmed text SHA bind complete results without answer source fields', async () => {
  const response = await result(), command = retrievalRequest('预算', ['doc-one']);
  assert.deepEqual(await checkedRetrievalResult(response, command), response);
  assert.equal(response.matches[0].end - response.matches[0].start, [...text].length);
  assert.equal(Object.hasOwn(response, 'answer_id'), false);
  for (const change of [{ source_url: '/v1/sources/fake/1' }, { text_sha256: 'b'.repeat(64) }, { end: 12 + text.length }, { document_id: 'doc-outside' }, { rank: 2 }, { retrieval_score: Infinity }]) {
    await assert.rejects(checkedRetrievalResult({ ...response, matches: [{ ...response.matches[0], ...change }] }, command), ApiError);
  }
});

test('rerank disabled requires null scores and empty results retain exact scope meaning', async () => {
  const response = await result(), command = retrievalRequest('预算', ['doc-one'], 5, false);
  await assert.rejects(checkedRetrievalResult(response, command), ApiError);
  response.matches[0].rerank_score = null; await checkedRetrievalResult(response, command);
  const empty = { ...response, status: 'empty', reason: 'empty_scope', scope_count: 0, matches: [] };
  await checkedRetrievalResult(empty, retrievalRequest('预算', []));
  await assert.rejects(checkedRetrievalResult({ ...empty, reason: 'no_matches' }, retrievalRequest('预算', [])), ApiError);
  await assert.rejects(checkedRetrievalResult({ ...empty, scope_count: 1 }, retrievalRequest('预算', [])), ApiError);
});

test('one retrieval action sends only the exact request and never dispatches a generation or answer route', async () => {
  const calls = [], session = new RetrievalSession(async (path, options) => { calls.push([path, options.body]); return result(); });
  await session.run('完整问题', ['doc-one'], 5, true);
  assert.deepEqual(calls, [['/v1/retrieval-tests', { question: '完整问题', document_ids: ['doc-one'], top_k: 5, rerank: true }]]);
  assert.equal(session.value.phase, 'ready'); assert.equal(session.value.result.matches.length, 1);
  assert.deepEqual(session.value.command.document_ids, ['doc-one']);
});

test('new input, stop and identity reset suppress late preview and clear the previous full result', async () => {
  for (const cancel of ['invalidate', 'stop', 'close']) {
    let deliver, signal;
    const session = new RetrievalSession((_path, options) => { signal = options.signal; return new Promise(resolve => { deliver = resolve; }); });
    const pending = session.run('问题', ['doc-one']); session[cancel](); deliver(await result()); await pending;
    assert.equal(signal.aborted, true); assert.equal(session.value.result, null);
  }
});

test('bad tail invalidates the entire preview and authentication loss clears the current query context', async () => {
  const response = await result(); response.matches.push({ ...response.matches[0], rank: 2, text_sha256: 'b'.repeat(64) });
  const bad = new RetrievalSession(async () => response); await bad.run('问题', ['doc-one']);
  assert.equal(bad.value.phase, 'error'); assert.equal(bad.value.result, null);
  let expired = 0;
  const lost = new RetrievalSession(async () => { throw new ApiError(401, 'expired'); }, { onAuthenticationFailure: () => expired++ });
  await lost.run('问题', ['doc-one']); assert.equal(expired, 1); assert.equal(lost.value.command, null); assert.equal(lost.value.result, null);
});

test('opening a preview original requires the current saved document revision and source identity', async () => {
  const match = await hit();
  const row = { document_id: match.document_id, filename: match.filename, active_revision_id: match.revision_id, latest_job: { revision_id: match.revision_id }, media_info: { sha256: match.source_sha256 } };
  assert.equal(matchCurrentOriginal(match, row), true);
  for (const update of [{ active_revision_id: 'other' }, { latest_job: { revision_id: 'other' } }, { filename: 'other.txt' }, { media_info: { sha256: 'b'.repeat(64) } }]) assert.equal(matchCurrentOriginal(match, { ...row, ...update }), false);
});
