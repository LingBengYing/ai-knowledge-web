import test from 'node:test';
import assert from 'node:assert/strict';
import { batchFeedback, parseTags } from '../public/workbench-state.mjs';

test('partial batch preserves each failure and treats missing results as failed', () => {
  const feedback = batchFeedback(['one', 'two', 'three'], [
    { document_id: 'one', ok: true },
    { document_id: 'two', ok: false, error_code: 'not_found', detail: '当前身份不可操作。' },
  ]);
  assert.equal(feedback.succeeded, 1);
  assert.equal(feedback.failed, 2);
  assert.equal(feedback.items[1].detail, '当前身份不可操作。');
  assert.equal(feedback.items[2].ok, false);
  assert.equal(feedback.items[2].error_code, 'missing_result');
});

test('tag input is deduplicated while an empty detail edit can clear tags', () => {
  assert.deepEqual(parseTags('制度， 财务,制度\n重要'), ['制度', '财务', '重要']);
  assert.deepEqual(parseTags('  '), []);
});
