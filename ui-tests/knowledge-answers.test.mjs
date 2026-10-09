import test from 'node:test';
import assert from 'node:assert/strict';
import { AnswerSession, answersEnabled } from '../public/answers.mjs';
import { knowledgeAnswerFixture } from './knowledge-answer-fixture.mjs';

test('one unified answer retains the full selection and rereads both pinned document and video originals', async () => {
  const fixture = knowledgeAnswerFixture(), calls = [], created = [], revoked = [];
  const session = new AnswerSession(async (path, options = {}) => { calls.push({ path, options }); return fixture.read(path, options); }, {
    canReadOriginal: () => true,
    objectUrls: { createObjectURL: blob => { created.push(blob); return `blob:source-${created.length}`; }, revokeObjectURL: url => revoked.push(url) },
  });
  assert.equal(answersEnabled({ capabilities: ['knowledge_answers'] }, 'knowledge'), true);
  await session.ask('如何开启夜间模式？', ['manual', 'tutorial'], 'knowledge');
  assert.equal(session.value.phase, 'answered');
  assert.equal(calls[0].path, '/v1/knowledge-answers');
  assert.deepEqual(calls[0].options.body, { question: '如何开启夜间模式？' });
  assert.equal(session.value.result.citations.length, 2);
  await session.readSource(1);
  assert.equal(session.value.sourcePhase, 'ready');
  assert.equal(session.value.source.page, 2);
  assert.equal(session.value.source.pdfUrl, 'blob:source-1');
  assert.equal(session.value.source.original.revision_id, 'manual-v1');
  await session.readSource(2);
  assert.equal(session.value.sourcePhase, 'ready');
  assert.equal(session.value.source.mediaUrl, 'blob:source-2');
  assert.equal(session.value.source.start_ms, 3200);
  assert.equal(session.value.source.end_ms, 7800);
  assert.equal(session.value.source.original.revision_id, 'tutorial-v1');
  assert.deepEqual(revoked, ['blob:source-1']);
  session.closeSource();
  assert.deepEqual(revoked, ['blob:source-1', 'blob:source-2']);
  assert.equal(session.value.source, null);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
});
