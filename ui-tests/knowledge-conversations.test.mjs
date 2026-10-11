import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeConversationsApi, checkedConversationDetail } from '../public/knowledge-conversations.mjs';
import { createKnowledgeAgentApi, KnowledgeAgentSession } from '../public/knowledge-agent.mjs';

const id = '253d79e9-103c-4898-b698-967fc106fc57';
const runId = '64ccaf3b-6801-4d68-8df6-c40ec575b318';
const record = { id, title: '上下文测试', created_at: 1, updated_at: 2, turn_count: 1, active_run_id: null,
  compression: { status: 'compressed', covered_turn_count: 1, summary_characters: 20 } };
const run = { id: runId, status: 'failed', events: [], result: null, suggestions: [], error: { code: 'agent_interrupted', message: 'private error' } };
const turn = { ordinal: 1, run_id: runId, question: '原始完整问题', status: 'failed', result: run, created_at: 1, updated_at: 2 };

test('conversation CRUD preserves identities and exact methods without model requests', async () => {
  const seen = [];
  const api = createKnowledgeConversationsApi(async (path, options = {}) => {
    seen.push([path, options.method ?? 'GET', options.body]);
    if (options.method === 'DELETE') return null;
    if (options.method === 'PATCH') return { ...record, title: options.body.title };
    if (options.method === 'POST') return record;
    if (path.includes('?')) return { items: [record], limit: 30, offset: 0 };
    return { conversation: record, turns: [turn], offset: 0, limit: 20, has_more: false };
  });
  await api.listConversations(); await api.createConversation({ title: '上下文测试' });
  const detail = await api.getConversation(id); await api.renameConversation(id, '改名'); await api.deleteConversation(id);
  assert.equal(detail.turns[0].question, turn.question);
  assert.equal(detail.turns[0].result.error.code, 'agent_interrupted');
  assert.doesNotMatch(detail.turns[0].result.error.message, /private/);
  assert.deepEqual(seen, [
    ['/v1/knowledge-conversations?limit=30&offset=0', 'GET', undefined],
    ['/v1/knowledge-conversations', 'POST', { title: '上下文测试' }],
    [`/v1/knowledge-conversations/${id}`, 'GET', undefined],
    [`/v1/knowledge-conversations/${id}`, 'PATCH', { title: '改名' }],
    [`/v1/knowledge-conversations/${id}`, 'DELETE', undefined],
  ]);
});

test('conversation rejects mismatched turn, active task and truncated or duplicate histories', async () => {
  for (const value of [
    { conversation: record, turns: [] },
    { conversation: record, turns: [{ ...turn, ordinal: 2 }] },
    { conversation: record, turns: [{ ...turn, run_id: id }] },
    { conversation: record, turns: [{ ...turn, result: null }] },
    { conversation: { ...record, active_run_id: runId }, turns: [turn] },
    { conversation: { ...record, turn_count: 2 }, turns: [turn, { ...turn, ordinal: 2 }] },
  ]) await assert.rejects(checkedConversationDetail(value, id), error => error.status === 502);
  const active = await checkedConversationDetail({ conversation: { ...record, active_run_id: runId }, turns: [{ ...turn, status: 'running', result: null }] }, id);
  assert.equal(active.conversation.active_run_id, runId);
});

test('conversation strips private fields and preserves full original long answers after compaction', async () => {
  const answer = '完整历史。'.repeat(4000);
  const completed = { ...run, status: 'completed', error: null, result: { answer_id: 'answer', status: 'abstained', answer, reason: 'no_evidence', citations: [] } };
  const detail = await checkedConversationDetail({ conversation: { ...record, summary: 'private checkpoint' }, turns: [{ ...turn, status: 'completed', result: completed, tool_output: 'private body' }] }, id);
  assert.equal(detail.turns[0].result.result.answer, answer);
  assert.equal(detail.conversation.summary, undefined); assert.equal(detail.turns[0].tool_output, undefined);
});

test('invalid conversation input and read errors never cause automatic writes or retries', async () => {
  let count = 0;
  const api = createKnowledgeConversationsApi(async () => { count++; throw new Error('offline'); });
  for (const title of ['', 'x'.repeat(201), 'line\nbreak']) await assert.rejects(api.renameConversation(id, title), error => error.status === 422);
  await assert.rejects(api.getConversation('../wrong'), error => error.status === 422);
  await assert.rejects(api.listConversations({ limit: 101 }), error => error.status === 422);
  assert.equal(count, 0);
  await assert.rejects(api.getConversation(id), /offline/); assert.equal(count, 1);
});

test('continued run sends conversation id once and resume only reads existing task', async () => {
  const calls = [];
  const api = createKnowledgeAgentApi(async (path, options = {}) => { calls.push([path, options.body]); return run; });
  const session = new KnowledgeAgentSession(api, { requestId: () => runId });
  await session.start('继续追问', { conversationId: id }); session.close();
  assert.equal(calls[0][1].conversation_id, id);
  const resumed = new KnowledgeAgentSession(api); await resumed.resume({ ...run, status: 'running', error: null }); resumed.close();
  assert.equal(calls.length, 2); assert.equal(calls[1][0], `/v1/knowledge-agent/runs/${runId}`); assert.equal(calls[1][1], undefined);
});

test('full original history is assembled from bounded pages without truncating after compaction', async () => {
  const calls = [], originals = Array.from({ length: 25 }, (_, index) => ({ ...turn, ordinal: index + 1,
    question: `原始问题${index}`, run_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    result: { ...run, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` } }));
  const api = createKnowledgeConversationsApi(async path => {
    calls.push(path); const offset = Number(new URL(path, 'http://localhost').searchParams.get('offset') ?? 0);
    // Byte-budgeted pages can contain fewer than limit entries.
    return { conversation: { ...record, turn_count: 25 }, turns: originals.slice(offset, offset + 10), offset, limit: 20, has_more: offset + 10 < 25 };
  });
  const detail = await api.getConversation(id);
  assert.deepEqual(detail.turns.map(item => item.question), originals.map(item => item.question));
  assert.equal(calls.length, 3); assert.match(calls[1], /offset=10&limit=20$/u); assert.match(calls[2], /offset=20&limit=20$/u);
});

test('inconsistent or stalled historical pagination stops rather than silently dropping turns', async () => {
  let reads = 0;
  const api = createKnowledgeConversationsApi(async () => { reads++; return { conversation: record, turns: [], offset: 0, limit: 20, has_more: true }; });
  await assert.rejects(api.getConversation(id), error => error.status === 502); assert.equal(reads, 1);
});
