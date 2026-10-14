import test from 'node:test';
import assert from 'node:assert/strict';
import * as stateModule from '../public/workbench-state.mjs';

const task = (change = {}) => ({ task_id: 'index-one', document_id: 'doc-one', revision_id: 'rev-one', state: 'queued', attempt: 1, error_code: null, can_cancel: true, can_retry: false, ...change });
const parsed = { task_id: 'parse-one', document_id: 'doc-one', revision_id: 'rev-one', state: 'parsed', attempt: 1, error_code: null, can_cancel: false, can_retry: false };

test('index task accepts indexed but never conflates parsing with published indexing', () => {
  const indexed = task({ state: 'indexed', can_cancel: false });
  const result = stateModule.checkedIndexTask({ ...indexed, private_text: 'not copied' });
  assert.deepEqual(result, indexed);
  assert.ok(Object.isFrozen(result));
  assert.throws(() => stateModule.checkedTask(indexed));
  assert.throws(() => stateModule.checkedIndexTask(parsed));
  for (const invalid of [task({ state: 'ready' }), task({ attempt: 4 }), task({ task_id: '../x' }), task({ can_retry: true }), task({ state: 'indexed' })]) {
    assert.throws(() => stateModule.checkedIndexTask(invalid));
  }
  assert.match(stateModule.indexTaskLabel('indexed'), /已索引/);
  assert.doesNotMatch(stateModule.indexTaskLabel('indexed'), /可问答/);
});

test('index creation requires explicit paired capabilities and a current indexable parsed row', () => {
  const row = { document_id: 'doc-one', status: 'parsed', can_index: true, synthetic_fixture: false, active_revision_id: null, latest_index_job: null };
  const enabled = { capabilities: ['management', 'text_index', 'indexings'] };
  assert.equal(stateModule.canStartIndexing(enabled, row), true);
  for (const config of [{}, { capabilities: ['text_index'] }, { capabilities: ['indexings'] }, { capabilities: ['text_upload', 'ingestions'] }]) assert.equal(stateModule.canStartIndexing(config, row), false);
  for (const change of [{ can_index: false }, { can_index: 'true' }, { status: 'queued' }, { synthetic_fixture: true }, { active_revision_id: 'rev-one' }, { latest_index_job: task() }]) assert.equal(stateModule.canStartIndexing(enabled, { ...row, ...change }), false);
  assert.equal(stateModule.canStartIndexing(enabled, undefined), false);
});

test('published list rows and their parsing task never claim to be unindexed or answerable', () => {
  const row = { status: 'parsed', synthetic_fixture: false, active_revision_id: 'rev-one', index_publication_id: 'publication-one', index_status: 'indexed', can_answer: false };
  assert.match(stateModule.documentStatusLabel(row), /已索引/);
  assert.doesNotMatch(stateModule.documentStatusLabel(row), /未索引|可问答/);
  assert.doesNotMatch(stateModule.taskLabel('parsed', row), /未索引|可问答/);
  assert.match(stateModule.documentStatusLabel({ status: 'parsed' }), /未索引/);
  assert.match(stateModule.documentStatusLabel({ status: 'parsed', index_status: 'processing' }), /正在索引/);
});
