import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { answerRequest, AnswerSession } from '../public/answers.mjs';
import { knowledgeAnswerFixture } from './knowledge-answer-fixture.mjs';

const answered = (answerId = 'knowledge-answer-one') => {
  const { answer } = knowledgeAnswerFixture();
  return { ...answer, answer_id: answerId, citations: answer.citations.map(citation => ({ ...citation,
    source_url: citation.source_url.replace('knowledge-answer-one', answerId) })) };
};
function abstained(reason = 'no_evidence') {
  return { answer_id: 'answer-1', status: 'abstained', answer: '没有足够证据。', reason, citations: [] };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

test('shared-library requests omit both legacy selection and empty selection', () => {
  assert.deepEqual(answerRequest('原始问题', null), { question: '原始问题' });
  assert.deepEqual(answerRequest('原始问题', []), { question: '原始问题' });
});

test('deprecated selected IDs are ignored without mutating caller input', () => {
  const ids = ['ready-document', 'unready-document', 'a.b:c-2'];
  const body = answerRequest(' 原始问题\n第二行\t内容 ', ids);
  assert.deepEqual(body, { question: ' 原始问题\n第二行\t内容 ' });
  assert.deepEqual(ids, ['ready-document', 'unready-document', 'a.b:c-2']);
  ids.push('later-selection');
  assert.equal(body.document_ids, undefined);
});

test('question preserves long multiline input and rejects invalid/control input before network', async () => {
  assert.equal(answerRequest('😀'.repeat(1024), null).question.length, 2048);
  assert.equal(answerRequest('😀'.repeat(1024) + 'x').question, '😀'.repeat(1024) + 'x');
  for (const question of ['', ' \n\t ', 'a\u0000b', 'a\u000db', 'a\u007fb', '\ud800']) {
    assert.throws(() => answerRequest(question, null), error => error instanceof ApiError && error.status === 422);
  }
  let calls = 0;
  const session = new AnswerSession(async () => { calls += 1; });
  await session.ask('a\u0000b');
  assert.equal(session.value.phase, 'error');
  assert.equal(calls, 0);
});

test('deprecated selection never narrows shared-library requests', () => {
  for (const ids of [['doc-1', 'doc-1'], ['valid', '../bad'], [null], ['a'.repeat(101)],
    Array.from({ length: 129 }, (_, number) => `doc-${number}`), { document_ids: ['doc-1'] }]) {
    assert.deepEqual(answerRequest('问题', ids), { question: '问题' });
  }
});

test('one POST produces answered state with verified document and video citations and loading notification', async () => {
  const calls = [];
  const phases = [];
  const session = new AnswerSession(async (path, options) => {
    calls.push({ path, options });
    return answered();
  }, { onChange: value => phases.push(value.phase) });
  await session.ask('如何开启夜间模式？');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/v1/knowledge-answers');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].options.body, { question: '如何开启夜间模式？' });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(phases, ['loading', 'answered']);
  assert.equal(session.value.result.answer_id, 'knowledge-answer-one');
  assert.deepEqual(session.value.result.citations.map(citation => citation.kind), ['document_text', 'video_subtitle']);
  assert.equal(session.value.result.citations[0].page, 2);
  assert.equal(session.value.result.citations[1].start_ms, 3200);
});

test('a citation whose quote does not match its text hash is rejected', async () => {
  const value = answered();
  value.citations[0].quote = '被篡改的引用';
  const session = new AnswerSession(async () => value);
  await session.ask('问题');
  assert.equal(session.value.phase, 'error');
  assert.equal(session.value.error.status, 502);
  assert.equal(session.value.result, null);
});

test('HTTP200 refusal retains its server reason', async () => {
  const session = new AnswerSession(async () => abstained('empty_scope'));
  await session.ask('问题');
  assert.equal(session.value.phase, 'abstained');
  assert.equal(session.value.result.reason, 'empty_scope');
  assert.equal(session.value.error, null);
});

test('a 404 is one error and never retries', async () => {
  const calls = [];
  const error = new ApiError(404, '资料不可用。');
  const session = new AnswerSession(async (path, options) => { calls.push({ path, body: options.body }); throw error; });
  await session.ask('问题');
  assert.equal(calls.length, 1);
  assert.equal(session.value.phase, 'error');
  assert.equal(session.value.error, error);
  assert.equal(session.value.result, null);
});

test('identity reset aborts waiting and ignores old success even if request ignores abort', async () => {
  const pending = deferred();
  let signal;
  const phases = [];
  const session = new AnswerSession(async (_path, options) => { signal = options.signal; return pending.promise; },
    { onChange: value => phases.push(value.phase) });
  const ask = session.ask('旧身份问题');
  session.reset();
  assert.equal(signal.aborted, true);
  pending.resolve(answered());
  await ask;
  assert.equal(session.value.phase, 'idle');
  assert.equal(session.value.result, null);
  assert.deepEqual(phases, ['loading', 'idle']);
});

test('a new ask invalidates the old answer', async () => {
  const oldAnswer = deferred();
  let answerCalls = 0;
  let firstSignal;
  const session = new AnswerSession(async (_path, options) => {
    answerCalls += 1;
    if (answerCalls === 1) { firstSignal = options.signal; return oldAnswer.promise; }
    return answered(`answer-${answerCalls}`);
  });
  const first = session.ask('旧问题');
  await session.ask('新问题');
  assert.equal(firstSignal.aborted, true);
  oldAnswer.resolve(answered('answer-1'));
  await first;
  assert.equal(session.value.result.answer_id, 'answer-2');
});

test('cancel is local abort/reset, not a backend task action or retry', async () => {
  const pending = deferred();
  const calls = [];
  const session = new AnswerSession(async (path, options) => { calls.push({ path, options }); return pending.promise; });
  const ask = session.ask('问题');
  session.cancel();
  assert.equal(calls[0].options.signal.aborted, true);
  pending.reject(new DOMException('Local abort', 'AbortError'));
  await ask;
  assert.equal(calls.length, 1);
  assert.equal(session.value.phase, 'idle');
});

test('only current 401 invokes existing authentication-failure handler', async () => {
  let failures = 0;
  const pending = deferred();
  const session = new AnswerSession(async () => pending.promise,
    { onAuthenticationFailure: error => { assert.equal(error.status, 401); failures += 1; } });
  const old = session.ask('旧问题');
  session.reset();
  pending.reject(new ApiError(401, '旧会话失效。'));
  await old;
  assert.equal(failures, 0);
  const active = new AnswerSession(async () => { throw new ApiError(401, '会话失效。'); },
    { onAuthenticationFailure: () => { failures += 1; } });
  await active.ask('当前问题');
  assert.equal(failures, 1);
  assert.equal(active.value.result, null);
});
