import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../public/api.mjs';
import { createKnowledgeAgentApi, KnowledgeAgentSession } from '../public/knowledge-agent.mjs';

const id = '64ccaf3b-6801-4d68-8df6-c40ec575b318';
const otherId = '253d79e9-103c-4898-b698-967fc106fc57';
const tick = () => new Promise(resolve => setImmediate(resolve));
const run = (status = 'running', preview = '', reasoning = '') => ({ id, status, preview,
  events: [{ sequence: 1, type: 'planning', message: 'ignored', details: {
    status: status === 'running' ? 'running' : 'completed', tool_name: 'model', reasoning,
  } }], suggestions: [], error: status === 'failed' ? { code: 'agent_model_unavailable', message: 'private' } : null,
  result: status === 'completed' ? { answer_id: 'answer-one', status: 'abstained', answer: '没有足够资料。', reason: 'no_evidence', citations: [] } : null });
const frame = (revision, value = run(), event = value.status === 'running' ? 'snapshot' : 'terminal') =>
  `id: ${revision}\nevent: ${event}\ndata: ${JSON.stringify({ revision, run: value })}\n\n`;
const response = stream => new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
function controlledStream() {
  let controller, cancelled = false;
  const body = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  return { body, write: text => controller.enqueue(new TextEncoder().encode(text)),
    bytes: value => controller.enqueue(value), end: () => controller.close(), get cancelled() { return cancelled; } };
}

test('SSE delivers split UTF-8 reasoning and answer previews before terminal response', async () => {
  const stream = controlledStream(), received = [], requests = [];
  const api = createKnowledgeAgentApi(createApi({ auth_mode: 'development_headers', workspace_id: 'org-main' }, () => 'owner', async (path, options) => {
    requests.push([path, options]); return response(stream.body);
  }));
  let ended = false;
  const watching = api.streamAgentRun(id, { onSnapshot: (value, revision) => received.push([revision, value]) }).then(() => { ended = true; });
  const bytes = new TextEncoder().encode(frame(1, run('running', '', '合成思考𠮷')));
  for (const byte of bytes) stream.bytes(Uint8Array.of(byte));
  await tick();
  assert.equal(ended, false); assert.equal(received.length, 1);
  assert.equal(received[0][1].events[0].details.reasoning, '合成思考𠮷');
  stream.write(frame(2, run('running', '先显示这半句', '合成思考𠮷')));
  await tick(); assert.equal(received[1][1].preview, '先显示这半句'); assert.equal(ended, false);
  stream.write(frame(3, run('completed', 'unverified draft')));
  await watching;
  assert.equal(received[2][1].preview, ''); assert.equal(received[2][1].result.answer, '没有足够资料。');
  assert.equal(stream.cancelled, true); assert.equal(requests.length, 1);
  assert.equal(requests[0][0], `/v1/knowledge-agent/runs/${id}/events`);
  assert.equal(requests[0][1].headers.Accept, 'text/event-stream');
  assert.equal(requests[0][1].headers['X-Principal-Id'], 'owner');
  assert.equal(requests[0][1].credentials, 'same-origin');
});

test('SSE accepts comments CRLF split delimiters and skips duplicate older revisions', async () => {
  const stream = controlledStream(), seen = [];
  const api = createKnowledgeAgentApi(createApi({ auth_mode: 'jwt' }, () => '', async () => response(stream.body)));
  const task = api.streamAgentRun(id, { onSnapshot: (value, revision) => seen.push([revision, value.preview]) });
  const input = `: heartbeat\r\n\r\n${frame(4, run('running', '累计')).replaceAll('\n', '\r\n')}`;
  for (const character of input) stream.write(character);
  stream.write(frame(4, run('running', 'duplicate')) + frame(3, run('running', 'older')));
  stream.write(frame(7, run('cancelled', 'discard')));
  await task; assert.deepEqual(seen, [[4, '累计'], [7, '']]);
});

test('SSE requires a well-formed terminal frame and never considers EOF an answer', async () => {
  for (const input of [frame(1), frame(1).slice(0, -1), 'event: snapshot\ndata: invalid\n\n']) {
    const api = createKnowledgeAgentApi(createApi({ auth_mode: 'jwt' }, () => '', async () => response(input)));
    await assert.rejects(api.streamAgentRun(id, { onSnapshot() {} }), error => error.status === 502);
  }
});

test('SSE checks run identity revision and terminal status without exposing raw frames', async () => {
  const invalid = [
    frame(1, { ...run(), id: otherId }), frame(1).replace('id: 1', 'id: 2'),
    frame(1, run(), 'terminal'), frame(1, run('completed'), 'snapshot'),
    frame(1, run(), 'arbitrary'), frame(-1), frame(1, { ...run(), preview: {} }),
  ];
  for (const input of invalid) {
    const api = createKnowledgeAgentApi(createApi({ auth_mode: 'jwt' }, () => '', async () => response(input)));
    await assert.rejects(api.streamAgentRun(id, { onSnapshot() {} }), error => error.status === 502 && !error.message.includes('private'));
  }
});

test('stream option cannot turn other paths or writes into a streaming request', async () => {
  let calls = 0;
  const request = createApi({ auth_mode: 'jwt' }, () => '', async () => { calls++; return response(''); });
  for (const [path, extra] of [
    ['/v1/knowledge-agent/runs', {}], [`/v1/knowledge-agent/runs/${id}/events?`, {}],
    [`/v1/knowledge-agent/runs/${id}/events`, { method: 'POST' }],
    [`/v1/knowledge-agent/runs/${id}/events`, { body: {} }],
  ]) await assert.rejects(request(path, { onEvent() {}, ...extra }), error => error.status === 422);
  assert.equal(calls, 0);
});

test('stream non-SSE response and invalid UTF-8 fail safely without retry', async () => {
  for (const make of [() => new Response('{}'), () => response(Uint8Array.of(0xff, 0xff)),
    () => new Response('{"detail":"登录已过期"}', { status: 401, headers: { 'Content-Type': 'application/json' } })]) {
    let calls = 0;
    const api = createKnowledgeAgentApi(createApi({ auth_mode: 'jwt' }, () => '', async () => { calls++; return make(); }));
    await assert.rejects(api.streamAgentRun(id, { onSnapshot() {} }), error => [401, 502].includes(error.status));
    assert.equal(calls, 1);
  }
});

test('session creates once streams updates and reconnects only on explicit same-run refresh', async () => {
  let created = 0, reads = 0, attached = 0, publish, breakConnection;
  const api = {
    createAgentRun: async () => { created++; return run(); },
    getAgentRun: async () => { reads++; return run('running', '服务器累计'); },
    streamAgentRun: (_id, { signal, onSnapshot }) => { attached++; publish = onSnapshot; return new Promise((resolve, reject) => {
      breakConnection = reject; signal.addEventListener('abort', resolve, { once: true });
    }); },
  };
  const session = new KnowledgeAgentSession(api);
  await session.start('问题'); await session.start('重复');
  publish(run('running', '实时前缀', '实时思考')); assert.equal(session.value.run.preview, '实时前缀');
  breakConnection(new Error('private network error')); await tick();
  assert.equal(session.value.phase, 'unknown'); assert.equal(created, 1); assert.equal(attached, 1); assert.equal(reads, 0);
  await tick(); assert.equal(attached, 1, 'no automatic reconnect or poll');
  await session.refresh(); assert.equal(reads, 1); assert.equal(attached, 2); assert.equal(created, 1);
  assert.equal(session.value.run.preview, '服务器累计');
  publish(run('completed')); assert.equal(session.value.phase, 'completed'); session.close();
});

test('cancel and close abort stream and ignore late previews from old attachment', async () => {
  let publish, streamSignal, cancels = 0;
  const session = new KnowledgeAgentSession({ createAgentRun: async () => run(),
    streamAgentRun: (_id, { signal, onSnapshot }) => { publish = onSnapshot; streamSignal = signal; return new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); },
    cancelAgentRun: async () => { cancels++; return run('cancelled'); },
  });
  await session.start('q'); publish(run('running', '未完成')); await session.cancel();
  assert.equal(streamSignal.aborted, true); assert.equal(cancels, 1);
  publish(run('running', '迟到')); assert.equal(session.value.phase, 'cancelled'); assert.equal(session.value.run.preview, '');
  await session.start('q2'); const latest = publish; session.close(); latest(run('completed'));
  assert.equal(session.value.phase, 'running'); assert.equal(streamSignal.aborted, true);
});
