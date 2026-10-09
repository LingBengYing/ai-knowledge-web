import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../public/api.mjs';
import { createKnowledgeAgentApi, checkedAgentConfig, checkedAgentRun, KnowledgeAgentSession } from '../public/knowledge-agent.mjs';

const runId = '64ccaf3b-6801-4d68-8df6-c40ec575b318';
const requestId = 'c1028b3b-7dd8-4620-a619-d0aaadccfe7b';
const result = { answer_id: 'answer-one', status: 'abstained', answer: '资料不足。', reason: 'no_evidence', citations: [] };
const run = (status = 'running', events = [{ sequence: 1, type: 'running', message: '任务已开始' }]) => ({ id: runId, status, events, result: status === 'completed' ? result : null, suggestions: [], error: status === 'failed' ? { code: 'agent_failed', message: '智能体任务未完成，请重新发起。' } : null });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Agent exact JSON requests preserve UUID and question and reuse the ordinary same-origin client', async () => {
  const calls = [];
  const api = createKnowledgeAgentApi(createApi({ auth_mode: 'jwt' }, () => '', async (path, options) => {
    calls.push([path, options]);
    return new Response(JSON.stringify(path.endsWith('/config') ? { enabled: true, engine: 'db-gpt', max_steps: 8 } : run()), { status: options.method === 'POST' ? 202 : 200, headers: { 'Content-Type': 'application/json' } });
  }));
  assert.deepEqual(await api.getAgentConfig(), { enabled: true, engine: 'db-gpt', max_steps: 8 });
  await api.createAgentRun({ question: '原始问题\n第二行', request_id: requestId });
  await api.getAgentRun(runId); await api.cancelAgentRun(runId);
  assert.deepEqual(calls.map(([path, options]) => [path, options.method, options.body && JSON.parse(options.body)]), [
    ['/v1/knowledge-agent/config', 'GET', undefined], ['/v1/knowledge-agent/runs', 'POST', { question: '原始问题\n第二行', request_id: requestId }],
    [`/v1/knowledge-agent/runs/${runId}`, 'GET', undefined], [`/v1/knowledge-agent/runs/${runId}/cancel`, 'POST', {}],
  ]);
  assert.ok(calls.every(([, options]) => options.credentials === 'same-origin'));
  await assert.rejects(api.createAgentRun({ question: 'q', request_id: 'bad' }), error => error.status === 422);
});

test('Agent validates result citations and safe event types, strips thought fields and keeps suggestions separate', async () => {
  const input = { ...run('completed'), thoughts: 'private chain', suggestions: [{ title: '<b>整理</b>', reason: '资料存在更新', document_ids: ['doc-one'], thought: 'hidden' }] };
  const checked = await checkedAgentRun(input, runId);
  assert.equal(checked.result.answer_id, 'answer-one'); assert.equal(checked.suggestions[0].title, '<b>整理</b>');
  assert.equal(checked.thoughts, undefined); assert.equal(checked.suggestions[0].thought, undefined);
  for (const invalid of [ { ...run(), id: 'other' }, { ...run(), events: [{ sequence: 1, type: 'thought', message: 'private' }] },
    { ...run(), events: [{ sequence: 2, type: 'running', message: 'bad order' }] }, { ...run('completed'), result: { ...result, status: 'answered' } },
    { ...run('completed'), suggestions: [{ title: 'x', reason: 'y', document_ids: ['../private'] }] }, { ...run('failed'), error: { code: 'secret_raw_error', message: 'secret' } } ]) {
    await assert.rejects(checkedAgentRun(invalid, runId), error => error.status === 502);
  }
  assert.throws(() => checkedAgentConfig({ enabled: 'yes', engine: 'db-gpt', max_steps: 8 }), error => error.status === 502);
});

test('Agent lifecycle creates once, polls only reads and stops on completion without silent fallback', async () => {
  const calls = [], changes = [];
  const api = { createAgentRun: async command => { calls.push(['create', command]); return run(); }, getAgentRun: async id => { calls.push(['get', id]); return run('completed'); } };
  const session = new KnowledgeAgentSession(api, { onChange: value => changes.push(value.phase), pollDelay: 100000, requestId: () => requestId });
  const first = session.start('question'); await session.start('duplicate'); await first;
  assert.equal(session.value.phase, 'running'); await session.refresh();
  assert.equal(session.value.phase, 'completed'); assert.equal(calls.filter(([name]) => name === 'create').length, 1);
  assert.deepEqual(changes, ['submitting', 'running', 'reading', 'completed']); session.close();
  let attempts = 0; const failure = new KnowledgeAgentSession({ createAgentRun: async () => { attempts++; throw new Error('private raw details'); } });
  await failure.start('q'); assert.equal(failure.value.phase, 'unknown'); assert.equal(attempts, 1);
  assert.doesNotMatch(failure.value.error.message, /private/u); failure.close();
});

test('Agent cancellation supersedes an in-flight poll and is confirmed only by server state', async () => {
  let finishRead, finishCancel, cancels = 0;
  const api = { createAgentRun: async () => run(), getAgentRun: () => new Promise(resolve => { finishRead = resolve; }), cancelAgentRun: () => { cancels++; return new Promise(resolve => { finishCancel = resolve; }); } };
  const session = new KnowledgeAgentSession(api, { pollDelay: 100000 }); await session.start('q');
  const pending = session.refresh(); const stopping = session.cancel(); await session.cancel();
  assert.equal(session.value.phase, 'cancelling'); assert.equal(cancels, 1);
  finishRead(run('completed')); await pending; assert.equal(session.value.phase, 'cancelling');
  finishCancel(run('cancelled')); await stopping; assert.equal(session.value.phase, 'cancelled'); session.close();
});

test('closing Agent waiting prevents a late create response from publishing into the next context', async () => {
  let finish; const changes = [];
  const session = new KnowledgeAgentSession({ createAgentRun: () => new Promise(resolve => { finish = resolve; }) }, { onChange: value => changes.push(value.phase) });
  const pending = session.start('q'); session.close(); finish(run('completed')); await pending; await tick();
  assert.deepEqual(changes, ['submitting']);
});
