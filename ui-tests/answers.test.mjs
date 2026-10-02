import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { answersEnabled, answerRequest, AnswerSession } from '../public/answers.mjs';

const hash = 'a'.repeat(64);
function citation(answerId = 'answer-1', number = 1, overrides = {}) {
  return { number, document_id: 'doc-1', revision_id: 'revision-1', source_sha256: hash,
    parser_revision: 'parser-v1', filename: '合成资料.txt', page: 1, start: 3, end: 7,
    quote: '合成证据', quote_sha256: hash, source_url: `/v1/sources/${answerId}/${number}`, ...overrides };
}
function answered(answerId = 'answer-1', citations = [citation(answerId)]) {
  return { answer_id: answerId, status: 'answered', answer: '合成证据[1]', reason: null, citations };
}
function abstained(reason = 'no_evidence') {
  return { answer_id: 'answer-1', status: 'abstained', answer: '没有足够证据。', reason, citations: [] };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

test('answers require both server capabilities, not document status or one capability', () => {
  for (const config of [null, {}, { capabilities: ['answers'] }, { capabilities: ['sources'] },
    { capabilities: 'answers,sources' }]) assert.equal(answersEnabled(config), false);
  assert.equal(answersEnabled({ capabilities: ['answers', 'sources'] }), true);
});

test('all-library request omits selection, while explicit empty scope stays empty', () => {
  assert.deepEqual(answerRequest('原始问题', null), { question: '原始问题' });
  assert.deepEqual(answerRequest('原始问题', []), { question: '原始问题', document_ids: [] });
});

test('complete selected IDs retain order and include unavailable items without mutating input', () => {
  const ids = ['ready-document', 'unready-document', 'a.b:c-2'];
  const body = answerRequest(' 原始问题\n第二行\t内容 ', ids);
  assert.deepEqual(body, { question: ' 原始问题\n第二行\t内容 ', document_ids: ids });
  assert.notEqual(body.document_ids, ids);
  ids.push('later-selection');
  assert.equal(body.document_ids.length, 3);
});

test('question limit is UTF-8 bytes, allows multiline, and rejects invalid/control input before network', async () => {
  assert.equal(answerRequest('😀'.repeat(1024), null).question.length, 2048);
  for (const question of ['', ' \n\t ', '😀'.repeat(1024) + 'x', 'a\u0000b', 'a\u000db', 'a\u007fb', '\ud800']) {
    assert.throws(() => answerRequest(question, null), error => error instanceof ApiError && error.status === 422);
  }
  let calls = 0;
  const session = new AnswerSession(async () => { calls += 1; });
  await session.ask('😀'.repeat(1025));
  assert.equal(session.value.phase, 'error');
  assert.equal(calls, 0);
});

test('invalid selection fails as a whole instead of dropping IDs or falling back to the library', () => {
  for (const ids of [['doc-1', 'doc-1'], ['valid', '../bad'], [null], ['a'.repeat(101)],
    Array.from({ length: 129 }, (_, number) => `doc-${number}`), { document_ids: ['doc-1'] }]) {
    assert.throws(() => answerRequest('问题', ids), error => error instanceof ApiError && error.status === 422);
  }
});

test('one POST produces answered state with server citation and loading notification', async () => {
  const calls = [];
  const phases = [];
  const session = new AnswerSession(async (path, options) => {
    calls.push({ path, options });
    return answered();
  }, { onChange: value => phases.push(value.phase) });
  await session.ask('完整问题', ['doc-1', 'unpublished-document']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/v1/answers');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].options.body, { question: '完整问题', document_ids: ['doc-1', 'unpublished-document'] });
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(phases, ['loading', 'answered']);
  assert.equal(session.value.result.answer_id, 'answer-1');
  assert.equal(session.value.result.citations[0].quote, '合成证据');
  assert.equal(session.value.sourcePhase, 'idle');
});

test('HTTP200 refusal retains its server reason and explicit empty scope', async () => {
  let request;
  const session = new AnswerSession(async (_path, options) => { request = options; return abstained('empty_scope'); });
  await session.ask('问题', []);
  assert.deepEqual(request.body.document_ids, []);
  assert.equal(session.value.phase, 'abstained');
  assert.equal(session.value.result.reason, 'empty_scope');
  assert.equal(session.value.error, null);
});

test('selected-scope 404 is one error and never retries as all-library', async () => {
  const calls = [];
  const error = new ApiError(404, '所选资料不可用。');
  const session = new AnswerSession(async (path, options) => { calls.push({ path, body: options.body }); throw error; });
  await session.ask('问题', ['doc-1', 'unavailable-document']);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.document_ids, ['doc-1', 'unavailable-document']);
  assert.equal(session.value.phase, 'error');
  assert.equal(session.value.error, error);
  assert.equal(session.value.result, null);
});

test('current source is fetched from exact server URL and returned as the verified citation', async () => {
  const calls = [];
  const session = new AnswerSession(async (path, options) => {
    calls.push({ path, options });
    return path === '/v1/answers' ? answered() : { answer_id: 'answer-1', citation: citation() };
  });
  await session.ask('问题');
  const read = session.readSource(1);
  assert.equal(session.value.sourcePhase, 'loading');
  assert.equal(session.value.source, null);
  await read;
  assert.equal(calls[1].path, '/v1/sources/answer-1/1');
  assert.equal(calls[1].options.body, undefined);
  assert.equal(session.value.sourcePhase, 'ready');
  assert.deepEqual(session.value.source, citation());
});

test('source reread clears old excerpt first and 404 does not leave it verified', async () => {
  const pending = deferred();
  let sourceReads = 0;
  const session = new AnswerSession(async path => {
    if (path === '/v1/answers') return answered();
    sourceReads += 1;
    return sourceReads === 1 ? { answer_id: 'answer-1', citation: citation() } : pending.promise;
  });
  await session.ask('问题');
  await session.readSource(1);
  assert.equal(session.value.sourcePhase, 'ready');
  const reread = session.readSource(1);
  assert.equal(session.value.source, null);
  pending.reject(new ApiError(404, '来源已不可用。'));
  await reread;
  assert.equal(session.value.sourcePhase, 'error');
  assert.equal(session.value.source, null);
  assert.equal(session.value.sourceError.status, 404);
  assert.equal(sourceReads, 2);
});

test('source response must match answer, number, evidence identity, offsets, hash and quote', async () => {
  const variants = [
    { answer_id: 'other-answer', citation: citation() },
    { answer_id: 'answer-1', citation: citation('answer-1', 2) },
    ...['document_id', 'revision_id', 'parser_revision', 'filename'].map(field => ({
      answer_id: 'answer-1', citation: citation('answer-1', 1, { [field]: 'other-value' }),
    })),
    ...['source_sha256', 'quote_sha256'].map(field => ({
      answer_id: 'answer-1', citation: citation('answer-1', 1, { [field]: 'b'.repeat(64) }),
    })),
    { answer_id: 'answer-1', citation: citation('answer-1', 1, { page: 2 }) },
    { answer_id: 'answer-1', citation: citation('answer-1', 1, { start: 5, end: 9 }) },
    { answer_id: 'answer-1', citation: citation('answer-1', 1, { quote: '另一证据' }) },
  ];
  for (const variant of variants) {
    const session = new AnswerSession(async path => path === '/v1/answers' ? answered() : variant);
    await session.ask('问题');
    await session.readSource(1);
    assert.equal(session.value.sourcePhase, 'error');
    assert.equal(session.value.source, null);
  }
});

test('malformed response and free-form source URL fail without requesting an untrusted URL', async () => {
  for (const result of [null, { ...answered(), status: 'unknown' }, { ...answered(), answer_id: '../bad' },
    answered('answer-1', []), answered('answer-1', [citation('answer-1', 1, { page: null })]),
    answered('answer-1', [citation('answer-1', 1, { source_url: 'https://example.invalid/source' })]),
    answered('answer-1', [citation('answer-1', 1, { source_url: '/v1/sources/answer-1/1?extra=1' })]),
    answered('answer-1', [citation('answer-1', 1, { source_url: '/v1/sources/other-answer/1' })]),
    answered('answer-1', [citation('answer-1', 1, { source_url: '/v1/sources/answer-1/01' })])]) {
    let calls = 0;
    const session = new AnswerSession(async () => { calls += 1; return result; });
    await session.ask('问题');
    assert.equal(session.value.phase, 'error');
    assert.equal(session.value.result, null);
    await session.readSource(1);
    assert.equal(calls, 1);
    assert.equal(session.value.source, null);
  }
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

test('a new ask invalidates both old answer and source reads', async () => {
  const oldAnswer = deferred();
  const oldSource = deferred();
  let answerCalls = 0;
  let firstSignal;
  let sourceSignal;
  const session = new AnswerSession(async (path, options) => {
    if (path !== '/v1/answers') { sourceSignal = options.signal; return oldSource.promise; }
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
  const source = session.readSource(1);
  await session.ask('再次提问');
  assert.equal(sourceSignal.aborted, true);
  oldSource.resolve({ answer_id: 'answer-2', citation: citation('answer-2') });
  await source;
  assert.equal(session.value.result.answer_id, 'answer-3');
  assert.equal(session.value.source, null);
  assert.equal(session.value.sourcePhase, 'idle');
});

test('new source click invalidates a late previous source response', async () => {
  const oldSource = deferred();
  const citations = [citation(), citation('answer-1', 2)];
  let signal;
  const session = new AnswerSession(async (path, options) => {
    if (path === '/v1/answers') return answered('answer-1', citations);
    if (path.endsWith('/1')) { signal = options.signal; return oldSource.promise; }
    return { answer_id: 'answer-1', citation: citations[1] };
  });
  await session.ask('问题');
  const first = session.readSource(1);
  await session.readSource(2);
  assert.equal(signal.aborted, true);
  oldSource.resolve({ answer_id: 'answer-1', citation: citations[0] });
  await first;
  assert.equal(session.value.source.number, 2);
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
  const source = new AnswerSession(async path => {
    if (path === '/v1/answers') return answered();
    throw new ApiError(401, '来源会话失效。');
  }, { onAuthenticationFailure: () => { failures += 1; } });
  await source.ask('问题');
  await source.readSource(1);
  assert.equal(failures, 2);
  assert.equal(source.value.source, null);
});
