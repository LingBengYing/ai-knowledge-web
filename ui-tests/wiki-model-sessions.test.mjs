import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../public/api.mjs';
import { createWikiWorkspaceApi } from '../public/wiki-workspace-api.mjs';
import { ModelConfigurationSession } from '../public/model-configuration.mjs';
import { ModelRebuildSession } from '../public/model-rebuild.mjs';

const config = { auth_mode: 'development_headers', workspace_id: 'synthetic-workspace', capabilities: ['model_configuration', 'model_index_rebuild'] };
const configuration = (version = 1, activeVersion = 1) => ({
  version, active_version: activeVersion, state: version === activeVersion ? 'active' : 'draft', can_edit: true, provider: 'mixed',
  embedding: { provider: 'siliconflow', model: 'synthetic/embedding', dimensions: 2, revision: 'fixture-v1', has_key: true },
  rerank: { provider: 'siliconflow', model: 'synthetic/rerank', has_key: true },
  generation: { provider: 'deepseek', model: 'synthetic-generation', has_key: true },
  projection: { configured: true, dimension: 2, can_test: true },
});
const draft = () => ({
  embedding: { provider: 'siliconflow', model: 'synthetic/embedding', dimensions: 2, revision: 'fixture-v1' },
  rerank: { provider: 'siliconflow', model: 'synthetic/rerank' },
  generation: { provider: 'deepseek', model: 'synthetic-generation', api_key: 'YOUR_SYNTHETIC_GENERATION_KEY_HERE' },
});
const rebuild = (state = null) => ({
  target_version: 2, active_version: state === 'completed' ? 2 : 1, required: state !== 'completed', can_start: state === null,
  reason: state === null || state === 'completed' ? null : 'rebuild_in_progress', total_documents: 3,
  job: state === null ? null : { id: 'synthetic-rebuild', base_active_version: 1, target_version: 2, state,
    total_documents: 3, completed_documents: state === 'completed' ? 3 : 0, error_code: null,
    created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:01Z' },
});
function client(respond, settings = config) {
  const calls = [];
  const api = createApi(settings, () => 'synthetic-member', async (path, options) => {
    const call = { path, ...options, body: options.body === undefined ? undefined : JSON.parse(options.body) };
    calls.push(call);
    const response = await respond(call);
    return response instanceof Response ? response : Response.json(response);
  });
  const wiki = createWikiWorkspaceApi({ api });
  assert.equal(wiki.request, api, 'existing Sessions receive the original same-origin request Adapter');
  return { wiki, calls };
}

test('Wiki reuses the model Session for saved roles, separate tests, explicit activation and current capabilities', async () => {
  let cleared = 0;
  const states = [];
  const { wiki, calls } = client(call => {
    if (call.path === '/v1/config') return config;
    if (call.path.endsWith('/test')) return { version: 2, role: call.body.role, status: 'passed', error_code: null };
    if (call.path.endsWith('/activate')) return configuration(2, 2);
    if (call.method === 'PUT') { assert.equal(cleared, 1); return configuration(2, 1); }
    return configuration();
  });
  const session = new ModelConfigurationSession(wiki.request, { onClearSecrets: () => cleared++, onChange: value => states.push(value) });
  await session.load();
  assert.equal(session.edit(), true);
  await session.save(draft());
  assert.equal(session.value.configuration.state, 'draft');
  assert.equal(session.value.configuration.active_version, 1, 'saving does not activate');
  assert.equal(calls.length, 2, 'saving never starts model tests or index rebuilding');
  for (const role of ['embedding', 'rerank', 'generation', 'projection']) await session.test(role);
  await session.activate();
  assert.equal(session.value.configuration.active_version, 2);
  assert.deepEqual(await wiki.config(), config);
  assert.deepEqual(calls.map(({ path, method }) => [path, method]), [
    ['/v1/model-configuration', 'GET'], ['/v1/model-configuration', 'PUT'],
    ...Array.from({ length: 4 }, () => ['/v1/model-configuration/test', 'POST']),
    ['/v1/model-configuration/activate', 'POST'], ['/v1/config', 'GET'],
  ]);
  assert.equal(calls[1].body.base_version, 1);
  assert.equal(Object.hasOwn(calls[1].body.embedding, 'api_key'), false, 'blank same-provider credentials stay omitted');
  assert.equal(calls[1].body.generation.api_key, 'YOUR_SYNTHETIC_GENERATION_KEY_HERE');
  assert.deepEqual(calls.slice(2, 6).map(call => call.body), ['embedding', 'rerank', 'generation', 'projection'].map(role => ({ version: 2, role })));
  assert.deepEqual(calls[6].body, { version: 2 });
  assert.equal(JSON.stringify(states).includes('YOUR_SYNTHETIC_GENERATION_KEY_HERE'), false);
  for (const call of calls) {
    assert.equal(call.credentials, 'same-origin');
    assert.equal(call.cache, 'no-store');
    assert.equal(call.headers['X-Workspace-Id'], config.workspace_id);
    assert.equal(call.headers['X-Principal-Id'], 'synthetic-member');
    assert.equal(Object.hasOwn(call.headers, 'Authorization'), false);
    assert.equal(call.signal instanceof AbortSignal || call.signal === undefined, true);
  }
  session.close();
});

test('Wiki rebuild Session explicitly starts one saved version and resumes by reading the same server batch', async () => {
  let completed = false, clearedTimers = 0;
  const timers = [];
  const { wiki, calls } = client(call => {
    if (call.path === '/v1/config') return config;
    if (call.path === '/v1/model-configuration') return configuration(2, completed ? 2 : 1);
    return rebuild(completed ? 'completed' : call.method === 'POST' ? 'queued' : null);
  });
  const model = new ModelConfigurationSession(wiki.request);
  const confirmed = [];
  const session = new ModelRebuildSession(wiki.request, {
    setTimer: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimer: () => clearedTimers++,
    onCompleted: async job => {
      await model.load(); await wiki.config(); confirmed.push(job.id);
      return model.value.configuration.active_version === job.target_version;
    },
  });
  await model.load(); await session.load();
  assert.equal(await session.start(1), null, 'a different saved version cannot start the batch');
  await session.start(model.value.configuration.version);
  assert.equal(session.value.status.job.state, 'queued');
  assert.equal(timers.length, 1); assert.equal(timers[0].delay, 1500);
  assert.equal(await session.start(2), null, 'pending batch cannot be submitted again');
  session.pause();
  const beforeStaleTimer = calls.length;
  await timers[0].callback();
  assert.equal(calls.length, beforeStaleTimer, 'leaving the page cancels polling but never cancels backend work');
  completed = true;
  await session.load();
  assert.equal(session.value.status.job.completed_documents, 3);
  assert.equal(model.value.configuration.active_version, 2);
  assert.deepEqual(confirmed, ['synthetic-rebuild']);
  await session.load();
  assert.equal(confirmed.length, 1, 'confirmed completion does not repeat config callbacks');
  assert.deepEqual(calls.filter(call => call.method === 'POST').map(({ path, body }) => [path, body]), [
    ['/v1/model-configuration/rebuild', { version: 2 }],
  ]);
  assert.ok(clearedTimers > 0);
  session.close(); model.close();
});

test('Wiki model failures retain safe Session state and never retry writes or send development identity in JWT mode', async () => {
  let rejectSave = true;
  const { wiki, calls } = client(call => call.method === 'PUT' && rejectSave
    ? Response.json({ detail: 'untrusted upstream text', error_code: 'gateway_timeout' }, { status: 504 })
    : configuration(2, 1), { ...config, auth_mode: 'jwt' });
  const model = new ModelConfigurationSession(wiki.request);
  await model.load(); model.edit();
  await assert.rejects(model.save(draft()), error => error.status === 504 && !error.message.includes('untrusted'));
  assert.equal(model.value.phase, 'unknown');
  assert.equal(await model.activate(), null);
  assert.equal(await model.save(draft()), null);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 1);
  rejectSave = false;
  await model.load();
  assert.equal(model.value.phase, 'ready');
  for (const call of calls) {
    assert.equal(call.credentials, 'same-origin');
    assert.equal(Object.hasOwn(call.headers, 'X-Workspace-Id'), false);
    assert.equal(Object.hasOwn(call.headers, 'X-Principal-Id'), false);
    assert.equal(Object.hasOwn(call.headers, 'Authorization'), false);
  }
  const failing = client(call => call.method === 'POST'
    ? Response.json({ detail: 'unknown batch result' }, { status: 504 }) : rebuild());
  const batch = new ModelRebuildSession(failing.wiki.request);
  await batch.load();
  assert.equal(await batch.start(2), null, 'failed rebuild returns null, not a successful batch');
  assert.equal(batch.value.phase, 'unknown');
  assert.equal(await batch.start(2), null);
  assert.equal(failing.calls.filter(call => call.method === 'POST').length, 1);
  batch.close(); model.close();
});
