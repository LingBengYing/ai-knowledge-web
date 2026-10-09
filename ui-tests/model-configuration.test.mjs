import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { ModelConfigurationSession, modelConfigurationEnabled, checkedModelConfiguration } from '../public/model-configuration.mjs';

const configured = (version = 1, active = null, canEdit = true) => ({ version, active_version: active, state: active === version ? 'active' : 'draft', can_edit: canEdit, provider: 'siliconflow', embedding: { model: 'synthetic/embedding', dimensions: 2, revision: 'fixture-v1', has_key: true }, rerank: { model: 'synthetic/rerank', has_key: true }, generation: { model: 'synthetic/generation', has_key: true }, projection: { configured: true, dimension: 2, can_test: canEdit } });
const unconfigured = () => ({ ...configured(), version: null, active_version: null, state: 'unconfigured', embedding: { model: null, dimensions: null, revision: null, has_key: false }, rerank: { model: null, has_key: false }, generation: { model: null, has_key: false } });
const draft = (withKeys = false) => ({ embedding: { model: 'synthetic/embedding', dimensions: 2, revision: 'fixture-v1', ...(withKeys ? { api_key: 'YOUR_EMBEDDING_KEY_HERE' } : {}) }, rerank: { model: 'synthetic/rerank', ...(withKeys ? { api_key: 'YOUR_RERANK_KEY_HERE' } : {}) }, generation: { model: 'synthetic/generation', ...(withKeys ? { api_key: 'YOUR_GENERATION_KEY_HERE' } : {}) } });

test('model setup uses its own capability and only accepts the exact safe configuration shape', () => {
  assert.equal(modelConfigurationEnabled({ capabilities: ['answers', 'text_index'] }), false);
  assert.equal(modelConfigurationEnabled({ capabilities: ['model_configuration'] }), true);
  const legacy = unconfigured();
  assert.deepEqual(checkedModelConfiguration(legacy), { ...legacy,
    embedding: { ...legacy.embedding, provider: 'siliconflow' },
    rerank: { ...legacy.rerank, provider: 'siliconflow' },
    generation: { ...legacy.generation, provider: 'siliconflow' } });
  assert.deepEqual(legacy, unconfigured(), 'normalizing a legacy response must not mutate its input');
  for (const bad of [{ ...configured(), api_key: 'REPLACE_ME' }, { ...configured(), provider: 'other' }, { ...configured(), state: 'active' }, { ...configured(), active_version: 2 }, { ...configured(), embedding: { ...configured().embedding, api_key: 'REPLACE_ME' } }, { ...configured(), projection: { ...configured().projection, endpoint: 'https://example.invalid' } }]) {
    assert.throws(() => checkedModelConfiguration(bad), ApiError);
  }
});

test('saving a complete initial draft only performs one PUT and clears secrets before transport', async () => {
  const calls = [], states = [];
  let cleared = 0;
  const session = new ModelConfigurationSession(async (path, options) => { calls.push([path, options]); if (options.method === 'PUT') assert.equal(cleared, 1); return options.method === 'GET' ? unconfigured() : configured(); }, { onClearSecrets: () => cleared++, onChange: value => states.push(value) });
  await session.load();
  session.edit();
  await session.save(draft(true));
  assert.deepEqual(calls.map(([path, options]) => [path, options.method]), [['/v1/model-configuration', 'GET'], ['/v1/model-configuration', 'PUT']]);
  assert.equal(calls[1][1].body.base_version, null);
  assert.equal(calls[1][1].body.embedding.api_key, 'YOUR_EMBEDDING_KEY_HERE');
  assert.equal(session.value.configuration.state, 'draft');
  assert.equal(session.value.dirty, false);
  assert.equal(JSON.stringify(states).includes('YOUR_EMBEDDING_KEY_HERE'), false);
  assert.deepEqual(session.value.tests, {});
});

test('omitted keys retain stored credentials and null or first-use missing keys never dispatch', async () => {
  let calls = 0;
  const saved = new ModelConfigurationSession(async (_path, options) => { calls++; return configured(options.method === 'GET' ? 1 : 2); });
  await saved.load(); saved.edit(); await saved.save(draft());
  assert.equal(calls, 2);
  const initial = new ModelConfigurationSession(async () => { calls++; return unconfigured(); });
  await initial.load(); initial.edit();
  await assert.rejects(initial.save(draft()), ApiError);
  const bad = draft(true); bad.rerank.api_key = null;
  await assert.rejects(initial.save(bad), ApiError);
  assert.equal(calls, 3);
});

test('tests and activation require a clean saved administrator version and are explicit separate operations', async () => {
  const calls = [];
  const session = new ModelConfigurationSession(async (path, options) => { calls.push([path, options.body]); return path.endsWith('/test') ? { version: 1, role: options.body.role, status: 'passed', error_code: null } : path.endsWith('/activate') ? configured(1, 1) : configured(); });
  await session.load(); session.edit();
  assert.equal(await session.test('embedding'), null); assert.equal(await session.activate(), null);
  await session.load(); await session.test('embedding');
  assert.deepEqual(session.value.tests.embedding, { version: 1, role: 'embedding', status: 'passed', error_code: null });
  await session.activate();
  assert.equal(session.value.configuration.active_version, 1);
  assert.deepEqual(calls.at(-1), ['/v1/model-configuration/activate', { version: 1 }]);
  session.edit(); assert.deepEqual(session.value.tests, {});
  const memberCalls = [];
  const reader = new ModelConfigurationSession(async (path, options) => {
    memberCalls.push(options.method);
    return path.endsWith('/test') ? { version: 2, role: 'generation', status: 'passed', error_code: null }
      : path.endsWith('/activate') ? configured(2, 2, false) : options.method === 'PUT' ? configured(2, 1, false) : configured(1, 1, false);
  });
  await reader.load(); await reader.save(draft()); await reader.test('generation'); await reader.activate();
  assert.deepEqual(memberCalls, ['GET', 'PUT', 'POST', 'POST']);
  assert.equal(reader.value.configuration.active_version, 2);
});

test('network-unknown save and local stop prohibit write retries until a successful safe GET', async () => {
  const methods = [];
  const session = new ModelConfigurationSession(async (_path, options) => { methods.push(options.method); if (options.method === 'PUT') throw new ApiError(504, 'unsafe transport body'); return configured(); });
  await session.load(); session.edit(); await assert.rejects(session.save(draft()));
  assert.equal(session.value.phase, 'unknown'); assert.equal(session.value.error.message.includes('unsafe'), false);
  assert.equal(await session.save(draft()), null); assert.equal(await session.activate(), null);
  await session.load(); assert.equal(session.value.phase, 'ready'); assert.deepEqual(methods, ['GET', 'PUT', 'GET']);
  let deliver;
  const waiting = new ModelConfigurationSession((_path, options) => options.method === 'GET' ? Promise.resolve(configured()) : new Promise(resolve => { deliver = resolve; }));
  await waiting.load(); waiting.edit(); const pending = waiting.save(draft()); waiting.stop(); deliver(configured(2)); await pending;
  assert.equal(waiting.value.phase, 'unknown'); assert.equal(waiting.value.configuration.version, 1);
});

test('identity close and authentication loss erase sensitive context and cannot accept late versions', async () => {
  let deliver, cleared = 0;
  const session = new ModelConfigurationSession(() => new Promise(resolve => { deliver = resolve; }), { onClearSecrets: () => cleared++ });
  const pending = session.load(); session.close(); deliver(configured()); await pending;
  assert.equal(session.value.configuration, null); assert.equal(session.value.phase, 'idle'); assert.equal(cleared, 1);
  let expired = 0;
  const lost = new ModelConfigurationSession(async () => { throw new ApiError(401, 'expired'); }, { onAuthenticationFailure: () => expired++, onClearSecrets: () => cleared++ });
  await lost.load(); assert.equal(expired, 1); assert.equal(lost.value.configuration, null); assert.equal(cleared, 2);
});

test('test replies bind the requested version and role and never accept a successful error payload', async () => {
  for (const result of [{ version: 2, role: 'embedding', status: 'passed', error_code: null }, { version: 1, role: 'rerank', status: 'passed', error_code: null }, { version: 1, role: 'embedding', status: 'passed', error_code: 'secret' }]) {
    const session = new ModelConfigurationSession(async path => path.endsWith('/test') ? result : configured());
    await session.load(); await assert.rejects(session.test('embedding'), ApiError);
    assert.deepEqual(session.value.tests, {});
  }
});

test('failed refresh cannot turn an unknown activation into permission to repeat writes', async () => {
  let calls = 0;
  const session = new ModelConfigurationSession(async () => { if (++calls === 1) return configured(); throw new ApiError(504, 'timeout'); });
  await session.load(); await assert.rejects(session.activate()); assert.equal(session.value.phase, 'unknown');
  await session.load(); assert.equal(session.value.phase, 'unknown'); assert.equal(await session.activate(), null); assert.equal(calls, 3);
});
