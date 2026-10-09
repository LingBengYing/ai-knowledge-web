import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { answerRequest, AnswerSession } from '../public/answers.mjs';
import { checkedRetrievalResult, retrievalRequest } from '../public/retrieval-tests.mjs';
import { knowledgeAnswerFixture } from './knowledge-answer-fixture.mjs';

test('shared-workspace questions have no client length or document selection restriction', () => {
  const question = '这是完整问题。'.repeat(1500);
  for (const selection of [null, [], ['old-selected-document']]) {
    assert.deepEqual(answerRequest(question, selection), { question });
    assert.deepEqual(retrievalRequest(question, selection), { question });
  }
});

test('shared-workspace retrieval accepts more than 128 searchable documents', async () => {
  const result = { test_id: '00000000-0000-0000-0000-000000000001', configuration_version: 1,
    status: 'empty', reason: 'no_matches', scope_count: 1000, score_kind: 'rrf', effective_settings: { version: 0, search_method: 'hybrid', ranking_mode: 'rerank', dense_weight: 0.5, top_k: 5, score_threshold_enabled: false, score_threshold: 0.5 }, matches: [] };
  assert.deepEqual(await checkedRetrievalResult(result, retrievalRequest('未命中')), result);
});

test('unified answers accept more than 32 real typed citations without weakening source URLs', async () => {
  const fixture = knowledgeAnswerFixture();
  fixture.answer.citations = Array.from({ length: 40 }, (_, index) => ({ ...fixture.answer.citations[0],
    citation_id: index + 1, source_url: `/v1/knowledge-sources/${fixture.answer.answer_id}/${index + 1}` }));
  const calls = [];
  const session = new AnswerSession(async (path, options) => { calls.push(options.body); return fixture.answer; });
  await session.ask('灯塔', ['old-selected-document'], 'knowledge');
  assert.equal(session.value.phase, 'answered');
  assert.equal(session.value.result.citations.length, 40);
  assert.deepEqual(calls, [{ question: '灯塔' }]);
  fixture.answer.citations[39].source_url = 'https://example.invalid/source';
  await session.ask('灯塔', null, 'knowledge');
  assert.equal(session.value.phase, 'error');
});

test('question and retrieval UI expose one shared library, no range picker or question maxlength', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="(?:answer-all|retrieval-all|answer-scope-documents|retrieval-scope-documents)"/u);
  assert.doesNotMatch(html, /<textarea[^>]+id="(?:answer-question|retrieval-question)"[^>]+maxlength/u);
  assert.match(html, /退出/u);
});
