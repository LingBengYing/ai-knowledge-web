import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { RetrievalSettingsSession, checkedRetrievalSettings, retrievalSettingsEnabled, retrievalSettingsFields, retrievalScoreLabel } from '../public/retrieval-settings.mjs';
import { retrievalRequest, checkedRetrievalResult } from '../public/retrieval-tests.mjs';

const settings = (version = 0, changes = {}) => ({ version, search_method: 'hybrid', ranking_mode: 'rerank', dense_weight: 0.5, top_k: 5, score_threshold_enabled: false, score_threshold: 0.5, ...changes });

test('retrieval settings validates all fields without inventing provider score normalization', () => {
  assert.equal(retrievalSettingsEnabled({ capabilities: ['retrieval_settings'] }), true);
  assert.equal(retrievalSettingsEnabled({ capabilities: ['retrieval_test'] }), false);
  assert.deepEqual(checkedRetrievalSettings(settings()), settings());
  assert.equal(checkedRetrievalSettings(settings(2, { score_threshold: -2.5 })).score_threshold, -2.5);
  for (const change of [{ version: -1 }, { search_method: 'anything' }, { ranking_mode: 'rrf' }, { dense_weight: 1.1 }, { top_k: 21 }, { score_threshold: Infinity }, { score_threshold_enabled: 'false' }, { extra: true }]) assert.throws(() => checkedRetrievalSettings(settings(1, change)), ApiError);
  assert.equal(retrievalScoreLabel('bm25'), 'BM25 分');
  assert.equal(retrievalScoreLabel('rrf'), 'RRF 召回分');
});

test('read edit save performs one CAS PUT only and accepts the actual new settings snapshot', async () => {
  const calls = [], session = new RetrievalSettingsSession(async (path, options) => {
    calls.push([path, options.method, options.body]);
    return options.method === 'PUT' ? { ...options.body, version: 1 } : settings();
  });
  await session.load(); session.edit();
  await session.save(retrievalSettingsFields(settings(0, { search_method: 'full_text', ranking_mode: 'weighted', top_k: 12 })));
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['/v1/retrieval-settings', 'GET'], ['/v1/retrieval-settings', 'PUT']]);
  assert.equal(calls[1][2].version, 0); assert.equal(session.value.settings.top_k, 12);
  assert.equal(session.value.dirty, false); assert.equal(session.value.phase, 'ready');
});

test('CAS conflict and unknown write require explicit successful reread, never retry or overwrite', async () => {
  for (const status of [409, 504]) {
    const methods = [], session = new RetrievalSettingsSession(async (_path, options) => {
      methods.push(options.method); if (options.method === 'PUT') throw new ApiError(status, 'unsafe provider text'); return settings(methods.length > 1 ? 2 : 1);
    });
    await session.load(); session.edit(); await session.save(retrievalSettingsFields(settings()));
    assert.equal(session.value.phase, status === 409 ? 'conflict' : 'unknown');
    assert.doesNotMatch(session.value.error.message, /unsafe/u);
    await session.save(retrievalSettingsFields(settings())); assert.deepEqual(methods, ['GET', 'PUT']);
    await session.load(); assert.equal(session.value.settings.version, 2); assert.equal(session.value.dirty, false);
  }
});

test('close and authentication failure isolate delayed settings from the next identity', async () => {
  let deliver, signal;
  const session = new RetrievalSettingsSession((_path, options) => { signal = options.signal; return new Promise(resolve => { deliver = resolve; }); });
  const pending = session.load(); session.close(); deliver(settings()); await pending;
  assert.equal(signal.aborted, true); assert.equal(session.value.settings, null);
  let expired = 0;
  const lost = new RetrievalSettingsSession(async () => { throw new ApiError(401, 'expired'); }, { onAuthenticationFailure: () => expired++ });
  await lost.load(); assert.equal(expired, 1); assert.equal(lost.value.phase, 'idle');
});

test('recall inherits global settings by omission and uses a complete temporary override without version', () => {
  assert.deepEqual(retrievalRequest('问题'), { question: '问题' });
  const override = retrievalSettingsFields(settings(8, { search_method: 'vector', ranking_mode: 'weighted' }));
  assert.deepEqual(retrievalRequest('问题', null, override), { question: '问题', retrieval_settings: override });
  assert.throws(() => retrievalRequest('问题', null, override, true), ApiError);
});

test('recall response uses effective settings snapshot and correct score family even without matches', async () => {
  const command = retrievalRequest('问题');
  const response = { test_id: '00000000-0000-0000-0000-000000000001', configuration_version: 3, effective_settings: settings(7, { search_method: 'full_text', ranking_mode: 'weighted' }), status: 'empty', reason: 'no_matches', scope_count: 2, score_kind: 'bm25', matches: [] };
  assert.equal((await checkedRetrievalResult(response, command)).effective_settings.version, 7);
  await assert.rejects(checkedRetrievalResult({ ...response, score_kind: 'rrf' }, command), ApiError);
});
