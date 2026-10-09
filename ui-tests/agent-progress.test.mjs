import test from 'node:test';
import assert from 'node:assert/strict';
import * as agent from '../public/knowledge-agent.mjs';

const event = (type, index) => ({ sequence: index + 1, type, message: 'private-provider-text' });
const run = (types, status = 'running', result = null) => ({ status, events: types.map(event), result });
const view = (phase, value) => agent.agentProgressView({ phase, run: value });

test('progress uses actual repeated service events and neutral planning labels', () => {
  const value = view('running', run(['running', 'planning', 'searching', 'planning', 'reading', 'planning']));
  assert.equal(value.title, '正在分析查阅任务');
  assert.equal(value.status, '处理中');
  assert.equal(value.active, true);
  assert.equal(value.entries.length, 6);
  assert.deepEqual(value.entries.map(item => item.current), [false, false, false, false, false, true]);
  assert.equal(value.entries[1].label, '分析查阅任务');
  assert.equal(value.summary, '检索发起 1 次 · 阅读发起 1 次');
  assert.doesNotMatch(JSON.stringify(value), /private-provider-text|撰写|命中|已读完/u);
});

test('progress polling reading phase is identical to running business state', () => {
  for (const type of ['running', 'planning', 'searching', 'reading']) {
    const value = run([type]);
    assert.deepEqual(view('reading', value), view('running', value));
  }
  assert.equal(view('reading', run(['searching'])).title, '正在检索知识库');
  assert.equal(view('running', run(['reading'])).title, '正在阅读原始资料');
});

test('submission and empty events never invent future tool stages', () => {
  const submitting = view('submitting', null);
  assert.equal(submitting.title, '正在提交查阅任务');
  assert.equal(submitting.status, '提交中');
  assert.equal(submitting.active, true);
  assert.deepEqual(submitting.entries, []);
  assert.equal(submitting.summary, '检索发起 0 次 · 阅读发起 0 次');
  const waiting = view('running', run([]));
  assert.deepEqual(waiting.entries, []);
  assert.equal(waiting.title, '正在等待查阅进度');
});

test('unknown paused and cancellation waiting override the last tool event', () => {
  const expected = {
    unknown: ['任务状态待核对', '待核对'],
    paused: ['已停止等待', '停止等待'],
    cancelling: ['正在停止查阅', '停止中'],
  };
  for (const [phase, [title, status]] of Object.entries(expected)) {
    const value = view(phase, run(['running', 'searching']));
    assert.equal(value.title, title);
    assert.equal(value.status, status);
    assert.equal(value.active, false);
    assert.ok(value.entries.every(item => !item.current));
    assert.doesNotMatch(value.detail, /已取消|取消成功/u);
  }
});

test('completion counts actual calls and validated result citations without claiming hits', () => {
  const value = view('completed', run(['searching', 'reading', 'searching', 'reading', 'completed'], 'completed', {
    status: 'answered', citations: [{ filename: 'private-source-name' }, {}],
  }));
  assert.equal(value.title, '查阅完成');
  assert.equal(value.status, '已完成');
  assert.equal(value.active, false);
  assert.equal(value.summary, '检索发起 2 次 · 阅读发起 2 次 · 引用 2 条');
  assert.ok(value.entries.every(item => !item.current));
  assert.doesNotMatch(JSON.stringify(value), /private-source-name|命中|读完/u);
});

test('completed abstention is not presented as a successfully supported answer', () => {
  for (const reason of ['no_evidence', 'incomplete_evidence']) {
    const value = view('completed', run(['searching', 'completed'], 'completed', { status: 'abstained', reason, citations: [] }));
    assert.equal(value.title, '查阅结束，证据不足');
    assert.match(value.detail, /证据不足/u);
    assert.equal(value.summary, '检索发起 1 次 · 阅读发起 0 次 · 引用 0 条');
    assert.equal(value.active, false);
  }
});

test('non-evidence abstention reasons do not claim evidence insufficiency or completed review', () => {
  for (const reason of ['scope_changed', 'configuration_changed', 'agent_timeout', undefined]) {
    const value = view('completed', run(['searching', 'completed'], 'completed', { status: 'abstained', reason, citations: [] }));
    assert.equal(value.title, '未形成有据回答');
    assert.equal(value.detail, '本次未返回有据回答，请查看回答说明。');
    assert.doesNotMatch(`${value.title} ${value.detail}`, /证据不足|已完成|查阅完成/u);
    assert.equal(value.active, false);
  }
});

test('failed and confirmed cancelled preserve records without active or successful steps', () => {
  for (const [phase, title, status] of [['failed', '查阅未完成', '未完成'], ['cancelled', '查阅已取消', '已取消']]) {
    const value = view(phase, run(['searching', phase], phase));
    assert.equal(value.title, title);
    assert.equal(value.status, status);
    assert.equal(value.entries.length, 2);
    assert.equal(value.active, false);
    assert.ok(value.entries.every(item => !item.current));
    assert.equal(value.summary, '检索发起 1 次 · 阅读发起 0 次');
  }
});

test('progress rejects display of arbitrary event metadata and does not mutate input', () => {
  const input = { phase: 'running', run: run(['searching']) };
  input.run.events.push({ sequence: 2, type: 'thought', message: 'raw-reasoning' });
  input.run.events[0].query = 'private-query';
  input.run.events[0].filename = 'private-filename';
  input.run.events[0].timestamp = 'invented-time';
  const before = structuredClone(input);
  const value = agent.agentProgressView(input);
  assert.deepEqual(input, before);
  assert.deepEqual(value.entries, [{ sequence: 1, type: 'searching', label: '检索知识库', current: true }]);
  assert.doesNotMatch(JSON.stringify(value), /raw-reasoning|private-|invented-time/u);
  assert.doesNotMatch(view('completed', run([], 'completed')).summary, /引用/u);
});
