import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError } from '../public/api.mjs';
import { VoiceQuestionSession, voiceQuestionsEnabled } from '../public/voice-question.mjs';

const bytes = Uint8Array.from({ length: 65539 }, (_, index) => index % 256);
const sha = value => createHash('sha256').update(value).digest('hex');
const file = (name = 'question.wav', content = bytes) => new File([content], name);
const response = (transcript = '项目发射代码是多少？\n尾段保持 7,3,9,21。\n', source = bytes) => ({
  transcript, transcript_sha256: sha(transcript), source_sha256: sha(source), decoder_revision: 'decoder-v1',
  model_revision: 'model-v1', compiler_revision: 'compiler-v1', duration_ms: 16001, policy_revision: 'java-voice-question-v1',
});
const session = (request = async () => response(), options = {}) => new VoiceQuestionSession({ request, canUseVoice: () => true, ...options });
const waitFor = async predicate => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.ok(predicate(), 'expected bounded asynchronous stage'); };

test('voice capability is independent of query attachments and disabled sessions read nothing', () => {
  assert.equal(voiceQuestionsEnabled(null), false);
  assert.equal(voiceQuestionsEnabled({ capabilities: ['answers', 'sources', 'query_attachments'] }), false);
  assert.equal(voiceQuestionsEnabled({ capabilities: ['voice_questions'] }), true);
  let calls = 0, reads = 0;
  const original = file(); original.arrayBuffer = async () => { reads++; return bytes.buffer; };
  const disabled = new VoiceQuestionSession({ request: async () => { calls++; } });
  assert.throws(() => disabled.select(original), error => error instanceof ApiError && error.status === 503);
  assert.equal(calls, 0); assert.equal(reads, 0);
});

test('single audio selection validates names, type and full byte bound before reading', () => {
  const voice = session();
  let reads = 0;
  for (const extension of ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'mp4', 'webm']) {
    const original = file(`query.${extension}`); original.arrayBuffer = async () => { reads++; return bytes.buffer; };
    voice.select(original);
    assert.equal(voice.value.phase, 'selected'); assert.equal(voice.value.filename, original.name);
    assert.equal(voice.value.bytes, bytes.length); assert.equal(voice.value.transcript, '');
  }
  const malformedName = file();
  // Native File converts lone surrogates to replacement characters; preserve the invalid input.
  Object.defineProperty(malformedName, 'name', { value: 'x\ud800.wav' });
  for (const invalid of [null, [file()], file('query.png'), file('../query.wav'), file('x\u0000.wav'), malformedName,
    file(`${'x'.repeat(256)}.wav`), file('empty.wav', ''), file('large.wav', new Uint8Array(20 * 1024 * 1024 + 1))]) {
    assert.throws(() => voice.select(invalid), error => error instanceof ApiError && error.status === 422);
    assert.equal(voice.value.transcript, '');
  }
  assert.equal(reads, 0);
});

test('explicit transcription sends exact complete bytes once and preserves the full raw transcript', async () => {
  const calls = [], changes = [];
  let reads = 0;
  const original = file('query.mp4'); original.arrayBuffer = async () => { reads++; return bytes.buffer; };
  const voice = session(async (path, options) => { calls.push({ path, options }); return response(); }, { onChange: () => changes.push(voice.value.phase) });
  voice.select(original); assert.equal(calls.length, 0);
  const pending = voice.transcribe(); assert.equal(voice.value.phase, 'loading');
  assert.throws(() => voice.confirm(), error => error instanceof ApiError);
  await pending;
  assert.equal(reads, 1); assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/voice-questions');
  assert.equal(calls[0].options.method, 'POST'); assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(calls[0].options.body, { filename: 'query.mp4', media_type: 'audio/mp4', content_base64: Buffer.from(bytes).toString('base64') });
  assert.equal(voice.value.phase, 'ready'); assert.equal(voice.value.transcript, response().transcript);
  assert.equal(voice.confirm(), response().transcript); assert.equal(calls.length, 1);
  assert.ok(changes.includes('loading')); assert.ok(changes.includes('ready'));
});

test('response fields, original SHA, transcript SHA, revisions and duration are all bound', async () => {
  const missing = response(); delete missing.compiler_revision;
  const invalidValues = [missing, { ...response(), extra: true }, { ...response(), source_sha256: 'a'.repeat(64) },
    { ...response(), transcript_sha256: 'b'.repeat(64) }, { ...response(), transcript_sha256: sha(response().transcript).toUpperCase() },
    { ...response(), decoder_revision: '' }, { ...response(), model_revision: 'x'.repeat(201) }, { ...response(), compiler_revision: 'bad\nrevision' },
    { ...response(), duration_ms: 0 }, { ...response(), duration_ms: 600001 }, { ...response(), duration_ms: 1.5 },
    { ...response(), policy_revision: 'other' }, response(' '.repeat(5)), response('x'.repeat(65537)), response('\ud800'), response('x\u0000y')];
  for (const value of invalidValues) {
    const voice = session(async () => value); voice.select(file()); await voice.transcribe();
    assert.equal(voice.value.phase, 'error'); assert.equal(voice.value.error.status, 502);
    assert.equal(voice.value.transcript, ''); assert.throws(() => voice.confirm(), error => error instanceof ApiError);
  }
});

test('full preview may exceed question limits; only explicit edited confirmation returns the question', async () => {
  const full = `${'问'.repeat(21845)}?`;
  assert.equal(Buffer.byteLength(full), 65536);
  let calls = 0;
  const voice = session(async () => { calls++; return response(full); });
  voice.select(file()); await voice.transcribe();
  assert.equal(voice.value.phase, 'ready'); assert.equal(voice.value.transcript, full);
  assert.throws(() => voice.confirm(), error => error instanceof ApiError && error.status === 422);
  const question = ' 用户核对后的问题\n\t7,3,9,21？ ';
  voice.edit(question); assert.equal(voice.confirm(), question); assert.equal(calls, 1);
  voice.edit(`${'问'.repeat(1365)}?`); assert.equal(Buffer.byteLength(voice.confirm()), 4096);
  for (const invalid of ['', '   ', `${'问'.repeat(1366)}?`, 'bad\u0000text', 'bad\ud800', 'bad\rtext']) {
    voice.edit(invalid); assert.throws(() => voice.confirm(), error => error instanceof ApiError && error.status === 422);
  }
  assert.equal(calls, 1);
});

test('cancellation while reading stops upload and a changed selection ignores the old bytes', async () => {
  for (const action of ['cancel', 'replace']) {
    let complete, calls = 0;
    const original = file(); original.arrayBuffer = () => new Promise(resolve => { complete = resolve; });
    const voice = session(async () => { calls++; return response(); }); voice.select(original);
    const pending = voice.transcribe(); assert.equal(voice.value.phase, 'loading'); assert.equal(typeof complete, 'function');
    if (action === 'cancel') voice.cancel(); else voice.select(file('new.mp3'));
    complete(bytes.buffer); await pending;
    assert.equal(calls, 0); assert.equal(voice.value.phase, action === 'cancel' ? 'idle' : 'selected');
    assert.equal(voice.value.transcript, '');
  }
});

test('late transcription cannot revive a reset session and concurrent clicks do not resend', async () => {
  let finish, signal, calls = 0;
  const voice = session((_path, options) => { calls++; signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
  voice.select(file()); const pending = voice.transcribe();
  await voice.transcribe(); await waitFor(() => !!finish); assert.equal(calls, 1);
  voice.reset(); assert.equal(signal.aborted, true); finish(response()); await pending;
  assert.deepEqual(voice.value, { phase: 'idle', filename: '', bytes: 0, transcript: '', error: null });
});

test('changing capability during reading prevents upload; after a preview it prevents confirmation', async () => {
  let enabled = true, complete, calls = 0;
  const original = file(); original.arrayBuffer = () => new Promise(resolve => { complete = resolve; });
  const voice = session(async () => { calls++; return response(); }, { canUseVoice: () => enabled });
  voice.select(original); const pending = voice.transcribe(); assert.equal(typeof complete, 'function');
  enabled = false; complete(bytes.buffer); await pending;
  assert.equal(calls, 0); assert.equal(voice.value.phase, 'error'); assert.equal(voice.value.error.status, 503);
  enabled = true; voice.select(file()); await voice.transcribe(); enabled = false;
  assert.throws(() => voice.confirm(), error => error instanceof ApiError && error.status === 503);
});

test('upstream errors are shown without retries and authentication failure uses the existing callback', async () => {
  for (const status of [401, 422, 503, 504]) {
    let calls = 0, auth = 0;
    const failure = new ApiError(status, '合成安全错误');
    const voice = session(async () => { calls++; throw failure; }, { onAuthenticationFailure: error => { assert.equal(error, failure); auth++; } });
    voice.select(file()); await voice.transcribe();
    assert.equal(calls, 1); assert.equal(voice.value.phase, 'error'); assert.equal(voice.value.error, failure);
    assert.equal(voice.value.transcript, ''); assert.equal(auth, status === 401 ? 1 : 0);
  }
});

test('unreadable or incomplete original bytes fail before any request', async () => {
  for (const read of [async () => { throw new Error('unreadable fixture'); }, async () => new Uint8Array(1).buffer]) {
    let calls = 0;
    const original = file(); original.arrayBuffer = read;
    const voice = session(async () => { calls++; return response(); }); voice.select(original); await voice.transcribe();
    assert.equal(calls, 0); assert.equal(voice.value.phase, 'error'); assert.equal(voice.value.error.status, 422);
  }
});
