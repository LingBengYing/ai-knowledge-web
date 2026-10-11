import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../public/api.mjs';
import { createKnowledgeAgentApi, checkedAgentConfig, checkedAgentRun, agentProgressView, KnowledgeAgentSession } from '../public/knowledge-agent.mjs';

const runId = '64ccaf3b-6801-4d68-8df6-c40ec575b318';
const requestId = 'c1028b3b-7dd8-4620-a619-d0aaadccfe7b';
const result = { answer_id: 'answer-one', status: 'abstained', answer: '资料不足。', reason: 'no_evidence', citations: [] };
const run = (status = 'running', events = [{ sequence: 1, type: 'running', message: '任务已开始' }]) => ({ id: runId, status, events, result: status === 'completed' ? result : null, suggestions: [], error: status === 'failed' ? { code: 'agent_failed', message: '智能体任务未完成，请重新发起。' } : null });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Agent safe failure codes have actionable distinct labels and never expose server text', async () => {
  const codes = ['agent_unavailable', 'agent_timeout', 'agent_callback_failed', 'agent_callback_invalid',
    'agent_model_invalid', 'agent_invalid_action', 'agent_invalid_tool_input', 'agent_tool_failed',
    'agent_invalid_result', 'agent_step_limit', 'agent_execution_failed', 'scope_changed',
    'configuration_changed', 'evidence_changed'];
  const labels = [];
  for (const code of codes) {
    const checked = await checkedAgentRun({ ...run('failed'), error: { code, message: 'private-provider-secret' } }, runId);
    assert.equal(checked.error.code, code);
    assert.doesNotMatch(checked.error.message, /private-provider-secret|请重新发起/u);
    labels.push(checked.error.message);
  }
  assert.equal(new Set(labels).size, labels.length);
  const session = new KnowledgeAgentSession({ createAgentRun: async () => ({ ...run('failed'),
    error: { code: 'agent_invalid_action', message: 'private-provider-secret' } }) });
  await session.start('synthetic question');
  assert.equal(session.value.phase, 'failed');
  assert.doesNotMatch(session.value.run.error.message, /private-provider-secret/u);
  session.close();
});

test('Agent model protocol and provider failures retain distinct fixed messages without retry', async () => {
  const expected = new Map([
    ['agent_model_tool_required', /工具调用/u],
    ['agent_model_invalid', /格式/u],
    ['agent_model_timeout', /超时/u],
    ['agent_model_unavailable', /模型服务/u],
  ]);
  const messages = new Set();
  for (const [code, label] of expected) {
    const record = await checkedAgentRun({ ...run('failed'), error: { code, message: 'private-provider-secret' } }, runId);
    assert.equal(record.error.code, code);
    assert.match(record.error.message, label);
    assert.doesNotMatch(record.error.message, /private-provider-secret/u);
    messages.add(record.error.message);
    let attempts = 0;
    const session = new KnowledgeAgentSession({ createAgentRun: async () => { attempts++; return record; } });
    await session.start('synthetic question');
    await session.refresh();
    assert.equal(session.value.phase, 'failed');
    assert.equal(session.value.run.error.code, code);
    assert.equal(attempts, 1);
    session.close();
  }
  assert.equal(messages.size, expected.size);
  const unknown = await checkedAgentRun({ ...run('failed'), error: { code: 'agent_callback_failed', message: 'private-provider-secret' } }, runId);
  assert.doesNotMatch(unknown.error.message, /访问模型或资料接口失败|网络故障|private-provider-secret/u);
});

test('Agent exact JSON requests preserve UUID and question and reuse the ordinary same-origin client', async () => {
  const calls = [];
  const api = createKnowledgeAgentApi(createApi({ auth_mode: 'jwt' }, () => '', async (path, options) => {
    calls.push([path, options]);
    return new Response(JSON.stringify(path.endsWith('/config') ? { enabled: true, engine: 'knowledge-native-agent', max_steps: 8 } : run()), { status: options.method === 'POST' ? 202 : 200, headers: { 'Content-Type': 'application/json' } });
  }));
  assert.deepEqual(await api.getAgentConfig(), { enabled: true, engine: 'knowledge-native-agent', max_steps: 8 });
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
  assert.throws(() => checkedAgentConfig({ enabled: 'yes', engine: 'knowledge-native-agent', max_steps: 8 }), error => error.status === 502);
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

test('Agent execution details project only declared fields and preserve the actual provider reasoning', async () => {
  const details = { status: 'completed', tool_name: 'model', elapsed_ms: 1420,
    reasoning: '合成模型返回：先查找资料，再核对来源。<script>不可执行</script>', reasoning_truncated: false,
    tool_names: ['knowledge_search', 'knowledge_search'], body: 'private raw response', content: 'not reasoning' };
  const checked = await checkedAgentRun(run('running', [{ sequence: 1, type: 'planning', message: 'server stage', details }]), runId);
  assert.equal(checked.events[0].details.reasoning, details.reasoning);
  assert.equal(checked.events[0].details.body, undefined);
  assert.equal(checked.events[0].details.content, undefined);
  assert.deepEqual(checked.events[0].details.tool_names, ['knowledge_search', 'knowledge_search']);
  assert.deepEqual(checked.events[0].details.sources, []);
  assert.equal(checked.events[0].details.query, null);
  assert.deepEqual(agentProgressView({ phase: 'running', run: checked }).entries[0].details, checked.events[0].details);
  for (const absent of [undefined, null]) {
    const legacy = await checkedAgentRun(run('running', [{ sequence: 1, type: 'planning', message: 'stage', details: absent }]), runId);
    assert.equal(legacy.events[0].details, null);
  }
});

test('Agent details validate public sources, optional fields and Unicode display bounds', async () => {
  const source = { source_id: 'source_1', document_id: 'document_1', revision_id: 'revision_1', title: '合成资料', kind: 'document_text', page: 2, raw_text: 'not public' };
  const details = { status: 'completed', tool_name: 'knowledge_search', query: '合成检索词', result_count: 1, document_count: 1, sources: [source] };
  const record = value => run('running', [{ sequence: 1, type: 'searching', message: 'stage', details: value }]);
  const checked = await checkedAgentRun(record(details), runId);
  assert.equal(checked.events[0].details.sources[0].raw_text, undefined);
  assert.equal(checked.events[0].details.sources[0].start_ms, null);
  assert.equal(checked.events[0].details.reasoning_truncated, false);
  const legacyIdentity = await checkedAgentRun(record({ ...details, sources: [{ ...source, document_id: 'document:1', revision_id: 'revision:1.2' }] }), runId);
  assert.equal(legacyIdentity.events[0].details.sources[0].revision_id, 'revision:1.2');
  const long = await checkedAgentRun(record({ status: 'completed', tool_name: 'model', reasoning: '𠮷'.repeat(16000) }), runId);
  assert.equal([...long.events[0].details.reasoning].length, 16000);
  for (const bad of [
    { ...details, status: 'success' }, { ...details, tool_name: 'shell' }, { ...details, query: 42 },
    { ...details, elapsed_ms: -1 }, { ...details, result_count: 1.5 }, { ...details, sources: Array(33).fill(source) },
    { ...details, sources: [{ ...source, document_id: '../private' }] },
    { ...details, sources: [{ ...source, page: 0 }] }, { ...details, sources: [{ ...source, start_ms: 9, end_ms: 4 }] },
    { ...details, safe_code: 'private-provider-error' }, { ...details, reasoning: {} },
    { ...details, reasoning: 'a'.repeat(16001) }, { ...details, tool_names: ['exec'] }, { ...details, tool_names: Array(17).fill('knowledge_search') }, { ...details, reasoning_truncated: 'yes' },
  ]) await assert.rejects(checkedAgentRun(record(bad), runId), error => error.status === 502);
});

test('Agent same-sequence completion updates details without adding another search', async t => {
  let current = run('running', [{ sequence: 1, type: 'searching', message: 'stage', details: { status: 'running', tool_name: 'knowledge_search', query: '合成查询' } }]);
  const session = new KnowledgeAgentSession({ createAgentRun: async () => checkedAgentRun(current), getAgentRun: async () => checkedAgentRun(current) }, { pollDelay: 100000 });
  t.after(() => session.close());
  await session.start('合成问题');
  current = { ...current, events: current.events.map(event => ({ ...event, details: { ...event.details, status: 'completed', result_count: 2, elapsed_ms: 91 } })) };
  await session.refresh();
  assert.equal(session.value.run.events.length, 1);
  assert.equal(session.value.run.events[0].details.result_count, 2);
  assert.match(agentProgressView(session.value).summary, /检索发起 1 次/u);
  assert.equal(agentProgressView(session.value).entries[0].current, false);
  session.close();
});
