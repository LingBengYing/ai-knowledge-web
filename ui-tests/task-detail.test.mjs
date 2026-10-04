import * as modelConfigurationModule from '../public/model-configuration.mjs';
import * as retrievalTestModule from '../public/retrieval-tests.mjs';
import * as cleanupModule from '../public/document-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createApi, ApiError, validateUpload, imageUploadMode } from '../public/api.mjs';
import * as stateModule from '../public/workbench-state.mjs';
import { showNotice } from '../public/notices.mjs';
import * as answerModule from '../public/answers.mjs';
import * as mediaModule from '../public/media-sources.mjs';
import * as queryModule from '../public/query-attachments.mjs';
import * as synopsisModule from '../public/file-synopsis.mjs';
import * as tagModule from '../public/tag-suggestions.mjs';
import * as voiceModule from '../public/voice-question.mjs';
import * as vectorModule from '../public/image-vectors.mjs';
import * as audioVectorModule from '../public/audio-vectors.mjs';
import * as soundModule from '../public/sound-library.mjs';
import * as videoAvModule from '../public/video-av.mjs';
import { DocumentOriginalSession } from '../public/document-originals.mjs';
import { createHash } from 'node:crypto';

const modelSummary = (version = 1, activeVersion = null, canEdit = true) => ({ version, active_version: activeVersion, state: version === 0 ? 'unconfigured' : activeVersion === version ? 'active' : 'draft', can_edit: canEdit, provider: 'siliconflow', embedding: { model: version ? 'synthetic/embedding' : null, dimensions: version ? 2 : null, revision: version ? 'fixture-v1' : null, has_key: version > 0 }, rerank: { model: version ? 'synthetic/rerank' : null, has_key: version > 0 }, generation: { model: version ? 'synthetic/generation' : null, has_key: version > 0 }, projection: { configured: true, dimension: 2, can_test: canEdit } });

test('actual settings form separates save, each role test and activation and clears write-only keys', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')), calls = [];
  fixture.app.enableModelSetup();
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith('/test')) return { version: 1, role: options.body.role, status: 'passed', error_code: null };
    if (path.endsWith('/activate')) return modelSummary(1, 1);
    if (path === '/v1/config') return { capabilities: ['management', 'model_configuration', 'retrieval_test', 'text_index', 'indexings', 'answers', 'sources'] };
    if (path.startsWith('/v1/management/documents?')) return { items: fixture.app.state.items, total: 1, total_pages: 1 };
    if (path.startsWith('/v1/management/')) return { items: [] };
    return modelSummary(options.method === 'PUT' ? 1 : 0);
  });
  fixture.app.showView('settings'); await settleAnswer();
  assert.equal(fixture.get('model-settings').hidden, false);
  for (const role of ['embedding', 'rerank', 'generation']) { fixture.get(`model-${role}-name`).value = `synthetic/${role}`; fixture.get(`model-${role}-key`).value = `fixture-${role}-only`; }
  fixture.get('model-embedding-dimensions').value = '2'; fixture.get('model-embedding-revision').value = 'fixture-v1'; fixture.get('model-form').dispatch('input');
  assert.equal(fixture.get('model-test-generation').disabled, true); fixture.get('model-form').dispatch('submit'); await settleAnswer();
  for (const role of ['embedding', 'rerank', 'generation']) assert.equal(fixture.get(`model-${role}-key`).value, '');
  assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1);
  assert.equal(calls.some(call => call.path.endsWith('/test') || call.path.endsWith('/activate')), false);
  fixture.get('model-test-rerank').dispatch('click'); await settleAnswer(); assert.match(fixture.get('model-test-rerank-status').textContent, /测试通过/u);
  fixture.get('model-activate').dispatch('click'); await settleAnswer(); assert.equal(fixture.app.modelSession.value.configuration.active_version, 1);
  assert.equal(calls.filter(call => call.path.endsWith('/test')).length, 1); assert.equal(calls.filter(call => call.path === '/v1/config').length, 1);
  assert.equal(calls.filter(call => call.path.startsWith('/v1/management/documents?')).length, 1);
  assert.equal(calls.some(call => call.path.endsWith('/index')), false);
});

test('actual settings hides administrator controls from reader and clears secret drafts on identity or leaving', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')); fixture.app.enableModelSetup(); fixture.app.setApi(async () => modelSummary(1, 1, false));
  fixture.app.showView('settings'); await settleAnswer(); assert.equal(fixture.get('model-save').disabled, true); assert.equal(fixture.get('model-generation-key').disabled, true);
  fixture.get('model-generation-key').value = 'fixture-transient'; fixture.app.navigate('documents'); assert.equal(fixture.get('model-generation-key').value, '');
  fixture.get('model-generation-key').value = 'fixture-transient'; fixture.app.resetContext({ identity: true }); assert.equal(fixture.get('model-generation-key').value, '');
});

test('refreshing the saved configuration clears unsaved model and key inputs before testing its saved version', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')), calls = [];
  fixture.app.enableModelSetup();
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    return path.endsWith('/test') ? { version: 1, role: options.body.role, status: 'passed', error_code: null } : modelSummary();
  });
  fixture.app.showView('settings'); await settleAnswer();
  fixture.get('model-generation-name').value = 'synthetic/unsaved'; fixture.get('model-generation-key').value = 'fixture-unsaved-only'; fixture.get('model-form').dispatch('input');
  assert.equal(fixture.get('model-save').disabled, false); assert.equal(fixture.get('model-test-generation').disabled, true);
  fixture.get('model-refresh').dispatch('click'); await settleAnswer();
  assert.equal(fixture.get('model-generation-name').value, 'synthetic/generation'); assert.equal(fixture.get('model-generation-key').value, '');
  assert.equal(fixture.app.modelSession.value.dirty, false); assert.equal(fixture.get('model-save').disabled, true); assert.equal(fixture.get('model-test-generation').disabled, false);
  fixture.get('model-test-generation').dispatch('click'); await settleAnswer();
  const request = calls.find(call => call.path.endsWith('/test'));
  assert.equal(JSON.stringify(request.options.body), JSON.stringify({ version: 1, role: 'generation' }));
  assert.equal(calls.some(call => call.options.method === 'PUT'), false);
});

test('a failed configuration refresh preserves the unsaved draft and cannot resolve an unknown write', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')); fixture.app.enableModelSetup(); fixture.app.setApi(async () => modelSummary());
  fixture.app.showView('settings'); await settleAnswer();
  fixture.get('model-generation-name').value = 'synthetic/unsaved'; fixture.get('model-generation-key').value = 'fixture-unsaved-only'; fixture.get('model-form').dispatch('input');
  fixture.app.setApi(async () => { throw new ApiError(503, 'synthetic unavailable'); });
  fixture.get('model-refresh').dispatch('click'); await settleAnswer();
  assert.equal(fixture.get('model-generation-name').value, 'synthetic/unsaved'); assert.equal(fixture.get('model-generation-key').value, 'fixture-unsaved-only');
  assert.equal(fixture.app.modelSession.value.dirty, true); assert.equal(fixture.get('model-test-generation').disabled, true);
  fixture.get('model-form').dispatch('submit'); await settleAnswer();
  assert.equal(fixture.app.modelSession.value.phase, 'unknown'); assert.equal(fixture.get('model-generation-key').value, '');
  fixture.get('model-refresh').dispatch('click'); await settleAnswer();
  assert.equal(fixture.app.modelSession.value.phase, 'unknown'); assert.equal(fixture.get('model-save').disabled, true); assert.equal(fixture.get('model-activate').disabled, true);
});

test('a late configuration refresh cannot clear keys entered after an identity change or stopped wait', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')); fixture.app.enableModelSetup(); fixture.app.setApi(async () => modelSummary());
  fixture.app.showView('settings'); await settleAnswer();
  let deliver;
  fixture.app.setApi(() => new Promise(resolve => { deliver = resolve; })); fixture.get('model-refresh').dispatch('click');
  const oldIdentityResponse = deliver; fixture.app.resetContext({ identity: true });
  fixture.app.setApi(async () => modelSummary(2)); fixture.get('model-refresh').dispatch('click'); await settleAnswer();
  fixture.get('model-generation-key').value = 'fixture-new-identity-only'; fixture.get('model-form').dispatch('input');
  oldIdentityResponse(modelSummary()); await settleAnswer();
  assert.equal(fixture.get('model-generation-key').value, 'fixture-new-identity-only'); assert.equal(fixture.app.modelSession.value.configuration.version, 2); assert.equal(fixture.app.modelSession.value.dirty, true);
  fixture.app.setApi(() => new Promise(resolve => { deliver = resolve; })); fixture.get('model-refresh').dispatch('click'); fixture.get('model-stop').dispatch('click');
  fixture.get('model-generation-key').value = 'fixture-new-edit-only'; fixture.get('model-form').dispatch('input');
  deliver(modelSummary(2)); await settleAnswer();
  assert.equal(fixture.get('model-generation-key').value, 'fixture-new-edit-only'); assert.equal(fixture.app.modelSession.value.dirty, true); assert.equal(fixture.get('model-test-generation').disabled, true);
});

test('retesting one model role clears only its previous outcome and a stopped late reply cannot restore passed', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')); fixture.app.enableModelSetup();
  fixture.app.setApi(async (path, options = {}) => path.endsWith('/test') ? { version: 1, role: options.body.role, status: 'passed', error_code: null } : modelSummary());
  fixture.app.showView('settings'); await settleAnswer();
  fixture.get('model-test-embedding').dispatch('click'); await settleAnswer(); fixture.get('model-test-generation').dispatch('click'); await settleAnswer();
  assert.match(fixture.get('model-test-embedding-status').textContent, /测试通过/u); assert.match(fixture.get('model-test-generation-status').textContent, /测试通过/u);
  let deliver;
  fixture.app.setApi(() => new Promise(resolve => { deliver = resolve; })); fixture.get('model-test-generation').dispatch('click');
  assert.doesNotMatch(fixture.get('model-test-generation-status').textContent, /测试通过/u); assert.match(fixture.get('model-test-embedding-status').textContent, /测试通过/u);
  fixture.get('model-stop').dispatch('click');
  assert.equal(fixture.app.modelSession.value.tests.generation, undefined); assert.doesNotMatch(fixture.get('model-test-generation-status').textContent, /测试通过/u);
  deliver({ version: 1, role: 'generation', status: 'passed', error_code: null }); await settleAnswer();
  assert.equal(fixture.app.modelSession.value.tests.generation, undefined); assert.doesNotMatch(fixture.get('model-test-generation-status').textContent, /测试通过/u); assert.match(fixture.get('model-test-embedding-status').textContent, /测试通过/u);
});

test('a timed out model role retest cannot keep its prior passed outcome or erase another role result', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')); fixture.app.enableModelSetup();
  fixture.app.setApi(async (path, options = {}) => path.endsWith('/test') ? { version: 1, role: options.body.role, status: 'passed', error_code: null } : modelSummary());
  fixture.app.showView('settings'); await settleAnswer();
  fixture.get('model-test-rerank').dispatch('click'); await settleAnswer(); fixture.get('model-test-generation').dispatch('click'); await settleAnswer();
  assert.match(fixture.get('model-test-rerank-status').textContent, /测试通过/u); assert.match(fixture.get('model-test-generation-status').textContent, /测试通过/u);
  fixture.app.setApi(async () => { throw new ApiError(504, 'synthetic timeout'); }); fixture.get('model-test-generation').dispatch('click'); await settleAnswer();
  assert.equal(fixture.app.modelSession.value.phase, 'error'); assert.equal(fixture.app.modelSession.value.tests.generation, undefined);
  assert.doesNotMatch(fixture.get('model-test-generation-status').textContent, /测试通过/u); assert.match(fixture.get('model-test-rerank-status').textContent, /测试通过/u); assert.equal(fixture.get('model-error').hidden, false);
});

test('reading a committed activation after its response is lost restores indexing and retrieval without replaying writes', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed'), { can_index: false }), calls = [];
  fixture.app.configureModelSetupOnly(); let saved = false, active = false;
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith('/activate')) { active = true; throw new ApiError(504, 'synthetic lost activation response'); }
    if (path === '/v1/model-configuration') { if (options.method === 'PUT') saved = true; return modelSummary(saved ? 1 : 0, active ? 1 : null); }
    if (path === '/v1/config') return { capabilities: ['management', 'model_configuration', 'retrieval_test', 'text_index', 'indexings', 'answers', 'sources'] };
    if (path.startsWith('/v1/management/documents?')) return { items: [{ ...fixture.app.state.items[0], can_index: true }], total: 1, total_pages: 1 };
    if (path.startsWith('/v1/management/')) return { items: [] };
    assert.fail(`unexpected fixture path ${path}`);
  });
  fixture.app.showView('settings'); await settleAnswer();
  for (const role of ['embedding', 'rerank', 'generation']) { fixture.get(`model-${role}-name`).value = `synthetic/${role}`; fixture.get(`model-${role}-key`).value = `fixture-${role}-only`; }
  fixture.get('model-embedding-dimensions').value = '2'; fixture.get('model-embedding-revision').value = 'fixture-v1'; fixture.get('model-form').dispatch('input'); fixture.get('model-form').dispatch('submit'); await settleAnswer();
  fixture.get('model-activate').dispatch('click'); await settleAnswer();
  assert.equal(fixture.app.modelSession.value.phase, 'unknown'); assert.equal(fixture.get('retrieval-panel').hidden, true); assert.equal(fixture.app.state.items[0].can_index, false);
  fixture.get('model-refresh').dispatch('click'); await settleAnswer();
  assert.equal(fixture.app.modelSession.value.configuration.active_version, 1); assert.equal(fixture.app.modelSession.value.phase, 'ready'); assert.equal(fixture.get('model-activate').disabled, true);
  assert.equal(fixture.get('retrieval-panel').hidden, false); assert.equal(fixture.app.state.items[0].can_index, true);
  assert.equal(calls.filter(call => call.path === '/v1/config').length, 1); assert.equal(calls.filter(call => call.path.startsWith('/v1/management/documents?')).length, 1);
  assert.equal(calls.filter(call => call.options.method === 'PUT').length, 1); assert.equal(calls.filter(call => call.path.endsWith('/activate')).length, 1);
  assert.equal(calls.some(call => call.path.endsWith('/test') || call.path.endsWith('/index') || call.path === '/v1/answers'), false);
  fixture.app.showView('answers'); assert.equal(fixture.get('answer-question').disabled, false);
});

test('an old model status read cannot begin a capability refresh after identity changes', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')), calls = [];
  fixture.app.configureModelSetupOnly(); fixture.app.setApi(async () => modelSummary()); fixture.app.showView('settings'); await settleAnswer();
  let deliver;
  fixture.app.setApi(path => { calls.push(path); return new Promise(resolve => { deliver = resolve; }); });
  fixture.get('model-refresh').dispatch('click'); fixture.app.resetContext({ identity: true });
  deliver(modelSummary(1, 1)); await settleAnswer();
  assert.deepEqual(calls, ['/v1/model-configuration']); assert.equal(fixture.app.modelSession.value.configuration, null); assert.equal(fixture.app.state.items.length, 0); assert.equal(fixture.get('retrieval-panel').hidden, true);
});

test('a recovery capability response cannot revive old identity rows after a confirmed active read', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')), calls = [];
  fixture.app.configureModelSetupOnly(); fixture.app.setApi(async () => modelSummary()); fixture.app.showView('settings'); await settleAnswer();
  let deliver;
  fixture.app.setApi(path => {
    calls.push(path);
    if (path === '/v1/model-configuration') return Promise.resolve(modelSummary(1, 1));
    if (path === '/v1/config') return new Promise(resolve => { deliver = resolve; });
    assert.fail(`unexpected fixture path ${path}`);
  });
  fixture.get('model-refresh').dispatch('click'); await settleAnswer();
  assert.equal(typeof deliver, 'function'); fixture.app.resetContext({ identity: true });
  deliver({ capabilities: ['management', 'model_configuration', 'retrieval_test', 'text_index', 'indexings', 'answers', 'sources'] }); await settleAnswer();
  assert.deepEqual(calls, ['/v1/model-configuration', '/v1/config']); assert.equal(fixture.app.state.items.length, 0); assert.equal(fixture.get('retrieval-panel').hidden, true);
});

test('actual retrieval control preserves full scope, renders plain excerpts and leaves answer generation explicit', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')), calls = [];
  fixture.app.enableModelSetup(); fixture.app.enableAnswers(); fixture.app.openAnswers(['doc-one', 'doc-tail']);
  fixture.get('answer-question').value = '完整预算问题'; fixture.get('answer-question').dispatch('input');
  fixture.get('retrieval-count').value = '5'; fixture.get('retrieval-rerank').value = 'false';
  const text = '<b>合成😀事实</b>';
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return { test_id: '00000000-0000-0000-0000-000000000001', configuration_version: 1, status: 'completed', reason: null, scope_count: 2, score_kind: 'rrf', matches: [{ rank: 1, document_id: 'doc-tail', revision_id: 'rev-tail', filename: '<tail>.txt', source_sha256: 'a'.repeat(64), parser_revision: 'java-text-v1', page: 3, start: 0, end: [...text].length, text, text_sha256: createHash('sha256').update(text).digest('hex'), retrieval_score: 1 / 61, rerank_score: null }] }; });
  fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/retrieval-tests'); assert.equal(calls[0].options.body.document_ids.join(','), 'doc-one,doc-tail');
  assert.match(fixture.get('retrieval-matches').textContent, /<tail>.txt.*第 3 页.*<b>合成😀事实<\/b>/su);
  assert.match(fixture.get('retrieval-matches').textContent, /RRF排序分.*未重排/u); assert.match(fixture.get('retrieval-help').textContent, /不是概率/u);
  fixture.get('retrieval-continue').dispatch('click'); assert.equal(calls.length, 1); assert.equal(fixture.get('answer-question').value, '完整预算问题');
  fixture.get('answer-question').value = '新问题'; fixture.get('answer-question').dispatch('input'); assert.equal(fixture.get('retrieval-matches').children.length, 0);
});

test('actual retrieval original navigation rereads the same version and validates full bytes before exposing a link', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')), calls = [], bytes = new TextEncoder().encode('complete synthetic original');
  const sourceSha = createHash('sha256').update(bytes).digest('hex'), text = '合成片段';
  fixture.app.enableModelSetup(); fixture.app.enableAnswers(); fixture.app.enableOriginals(); fixture.app.openAnswers(['doc-one']);
  fixture.get('answer-question').value = '完整问题'; fixture.get('retrieval-count').value = '5';
  fixture.app.setApi(async (path, options) => {
    calls.push(path);
    if (path === '/v1/retrieval-tests') return { test_id: '00000000-0000-0000-0000-000000000001', configuration_version: 1, status: 'completed', reason: null, scope_count: 1, score_kind: 'rrf', matches: [{ rank: 1, document_id: 'doc-one', revision_id: 'rev-one', filename: 'fixture.txt', source_sha256: sourceSha, parser_revision: 'java-text-v1', page: 2, start: 0, end: [...text].length, text, text_sha256: createHash('sha256').update(text).digest('hex'), retrieval_score: 1 / 61, rerank_score: 0.5 }] };
    if (path.endsWith('/original')) return { document_id: 'doc-one', revision_id: 'rev-one', filename: 'fixture.txt', document_type: 'document', media_type: 'text/plain', source_sha256: sourceSha, size_bytes: bytes.length, content_url: '/v1/documents/doc-one/revisions/rev-one/content' };
    assert.equal(options.binary, true); return new Blob([bytes], { type: 'text/plain' });
  });
  fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  fixture.get('retrieval-matches').querySelector('button').dispatch('click'); await settleAnswer();
  const link = fixture.get('retrieval-original').querySelector('a'); assert.ok(link.href.startsWith('blob:'));
  assert.match(fixture.get('retrieval-original').textContent, new RegExp(sourceSha)); assert.equal(calls.filter(path => path.endsWith('/content')).length, 1);
  assert.equal(calls.some(path => path.includes('/sources/') || path === '/v1/answers'), false);
  fixture.get('answer-question').dispatch('input'); assert.equal(fixture.get('retrieval-original').hidden, true);
});

test('activation read refresh updates indexing eligibility while preserving question scope and the actual detail draft', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed'), { can_index: false });
  fixture.app.enableModelSetup(); fixture.app.enableAnswers(); fixture.app.openAnswers(['doc-one']); fixture.get('answer-question').value = '保留完整问题';
  fixture.app.navigate('documents'); fixture.app.openDetail('doc-one'); const preserved = editUnsaved(fixture), calls = [];
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/v1/config') return { capabilities: ['management', 'model_configuration', 'retrieval_test', 'text_index', 'indexings', 'answers', 'sources'] };
    if (path.startsWith('/v1/management/documents?')) return { items: [{ ...fixture.app.state.items[0], can_index: true }], total: 1, total_pages: 1 };
    if (path === '/v1/retrieval-tests') return { test_id: '00000000-0000-0000-0000-000000000001', configuration_version: 1, status: 'empty', reason: 'no_matches', scope_count: 1, score_kind: 'rrf', matches: [] };
    return { items: [] };
  });
  await fixture.app.refreshModelCapabilities(); preserved(); assert.equal(fixture.app.state.items[0].can_index, true); assert.equal(fixture.get('answer-question').value, '保留完整问题');
  assert.equal(calls.some(call => call.options.method === 'POST' || call.path.endsWith('/index')), false);
  fixture.app.setConfirm(() => true); fixture.app.showView('answers'); fixture.get('retrieval-count').value = '5'; fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  const request = calls.find(call => call.path === '/v1/retrieval-tests'); assert.equal(request.options.body.question, '保留完整问题'); assert.equal(request.options.body.document_ids.join(','), 'doc-one');
});

test('a late capability refresh after identity change cannot reload the previous actors document rows', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed')); fixture.app.enableModelSetup(); let deliver; const calls = [];
  fixture.app.setApi(path => { calls.push(path); return new Promise(resolve => { deliver = resolve; }); });
  const pending = fixture.app.refreshModelCapabilities(); fixture.app.resetContext({ identity: true });
  deliver({ capabilities: ['management', 'model_configuration', 'retrieval_test', 'text_index', 'indexings', 'answers', 'sources'] }); await pending;
  assert.deepEqual(calls, ['/v1/config']); assert.equal(fixture.app.state.items.length, 0); assert.equal(fixture.get('answer-question').value, '');
});

// Execute the real app functions against a small DOM/transport Adapter, without a browser server.
// Only module loading and automatic startup are adapted; no app function is replaced or mocked.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')
  .replace(/^import .* from '[^']+';\n/gmu, '').replace(/\nstart\(\);\s*$/u, '\n');
const markup = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function controlledDocument() {
  let document;
  class Node {
    constructor(tag) {
      this.tagName = tag.toLowerCase(); this.children = []; this.parentElement = null;
      this.dataset = {}; this.attributes = new Map(); this.listeners = new Map();
      this.value = ''; this.hidden = false; this.disabled = false; this.open = false; this.text = '';
      this.classList = { toggle() {} };
    }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const node of this.children) node.parentElement = null; this.children = []; this.text = ''; this.append(...nodes); }
    set textContent(value) { this.replaceChildren(); this.text = String(value ?? ''); }
    get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'id' || name === 'value') this[name] = String(value);
      if (name === 'hidden') this.hidden = true;
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/gu, (_m, letter) => letter.toUpperCase())] = String(value);
    }
    matches(selector) {
      const [, tag, attribute] = selector.match(/^([a-z-]+)?(?:\[([a-z-]+)\])?$/u) ?? [];
      if (!tag && !attribute) return false;
      return (!tag || tag === this.tagName) && (!attribute || (attribute.startsWith('data-')
        ? Object.hasOwn(this.dataset, attribute.slice(5).replace(/-([a-z])/gu, (_m, letter) => letter.toUpperCase()))
        : attribute === 'id' ? typeof this.id === 'string' : this.attributes.has(attribute)));
    }
    querySelectorAll(selectors) {
      const result = [];
      const visit = node => { for (const child of node.children) { if (selectors.split(',').some(selector => child.matches(selector.trim()))) result.push(child); visit(child); } };
      visit(this); return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    get elements() { return this.querySelectorAll('input, select, textarea, button'); }
    get options() { return this.querySelectorAll('option'); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    addEventListener(name, listener) { const list = this.listeners.get(name) ?? []; list.push(listener); this.listeners.set(name, list); }
    dispatch(name) { for (const listener of this.listeners.get(name) ?? []) listener({ target: this, preventDefault() {} }); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    reset() { for (const child of this.elements) child.value = child.tagName === 'select' ? child.options[0]?.value ?? '' : ''; }
    removeAttribute(name) { this.attributes.delete(name); if (name === 'src') this.src = ''; }
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    load() { this.loaded = true; }
  }
  const root = new Node('document');
  const stack = [root];
  for (const [, close, tag, attrs] of markup.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>/giu)) {
    if (close) { while (stack.length > 1 && stack.pop().tagName !== tag) {} continue; }
    const node = new Node(tag);
    for (const [, name, value] of attrs.matchAll(/([a-z-]+)(?:="([^"]*)")?/giu)) node.setAttribute(name, value ?? '');
    stack.at(-1).append(node);
    if (!['meta', 'link', 'input', 'br', 'img', 'hr'].includes(tag)) stack.push(node);
  }
  document = {
    root, activeElement: null,
    createElement: tag => new Node(tag),
    createElementNS: (_namespace, tag) => new Node(tag),
    getElementById(id) { return root.querySelectorAll('[id]').find(node => node.id === id) ?? null; },
    querySelectorAll: selector => root.querySelectorAll(selector),
  };
  return { document, Option: class extends Node { constructor(text, value) { super('option'); this.textContent = text; this.value = value; } } };
}

const task = (kind, state = 'processing', change = {}) => ({ task_id: `${kind}-one`, document_id: 'doc-one', revision_id: 'rev-one',
  state, attempt: 1, error_code: state === 'failed' ? 'synthetic_failure' : null,
  can_cancel: ['queued', 'processing'].includes(state), can_retry: ['failed', 'cancelled'].includes(state), ...change });
const row = (kind, value, change = {}) => ({ document_id: value.document_id, display_name: '合成测试文档', filename: 'synthetic.txt',
  document_type: 'document', tags: ['已保存标签'], can_edit: true, current_role: 'owner', synthetic_fixture: false,
  status: kind === 'indexing' ? 'parsed' : value.state, latest_job: kind === 'indexing' ? task('ingestion', 'parsed') : value,
  index_status: kind === 'indexing' ? value.state : 'not_indexed', latest_index_job: kind === 'indexing' ? value : null,
  active_revision_id: null, index_publication_id: null, can_answer: false, ...change });

function appFixture(kind, initial = task(kind), rowChange = {}) {
  const dom = controlledDocument();
  const context = vm.createContext({ ...dom, ...stateModule, ...answerModule, ...mediaModule, ...queryModule, ...synopsisModule, ...tagModule, ...voiceModule, ...vectorModule, ...audioVectorModule, ...soundModule, ...videoAvModule, ...cleanupModule, ...modelConfigurationModule, ...retrievalTestModule, DocumentOriginalSession, createApi, ApiError, validateUpload, imageUploadMode, showNotice,
    AbortController, URLSearchParams, setTimeout: () => 1, clearTimeout() {}, confirm: () => false });
  vm.runInContext(`${source}\nglobalThis.app = { state, openDetail, watchTask, loadTask, taskAction, resetContext, loadData,
    showView, navigate, closeDetailPanel, changeFilter, documentQuery, renderControls, renderRows, openAnswers, answerSession, originalSession, refreshModelCapabilities,
    get modelSession() { return modelSession; }, get retrievalSession() { return retrievalSession; },
    enableModelSetup() { config.capabilities.push('model_configuration', 'retrieval_test'); renderControls(); },
    enableReindex() { config.capabilities.push('text_reindex'); renderControls(); renderRows(); if (state.detail) renderDetailEvidence(); },
    setReceiptReindexCapability(enabled) { config.capabilities = config.capabilities.filter(name => name !== 'text_reindex_with_vectors'); if (enabled) config.capabilities.push('text_reindex_with_vectors'); renderControls(); renderRows(); if (state.detail) renderDetailEvidence(); },
    configureModelSetupOnly() { config.capabilities = ['management', 'text_upload', 'ingestions', 'model_configuration']; renderControls(); },
    enableCleanup() { config.capabilities.push('document_cleanup'); renderControls(); },
    get cleanupSession() { return cleanupSession; },
    setConfirm(value) { globalThis.confirm = value; },
    setApi(value) { api = value; }, configure() { connected = true; config = { capabilities: ['management', 'text_upload', 'ingestions', 'text_index', 'indexings'] }; },
    enableAnswers() { config.capabilities.push('answers','sources'); renderControls(); },
    enableAttachments() { config.capabilities.push('query_attachments'); renderControls(); },
    enableVoice() { config.capabilities.push('voice_questions'); renderControls(); },
    get voiceSession() { return typeof voiceQuestionSession === 'undefined' ? null : voiceQuestionSession; },
    enableImageVectors() { config.capabilities.push('image_vector_retrieval','visual_answers','visual_sources'); if (typeof ensureDetailImageVector === 'function') ensureDetailImageVector(); if (typeof renderDetailImageVector === 'function') renderDetailImageVector(); },
    get vectorSession() { return typeof imageVectorSession === 'undefined' ? null : imageVectorSession; },
    enableAudioVectors() { config.capabilities.push('audio_vector_retrieval','audio_answers','audio_sources'); if (typeof ensureDetailAudioVector === 'function') ensureDetailAudioVector(); if (typeof renderDetailAudioVector === 'function') renderDetailAudioVector(); },
    get audioVectorSession() { return typeof audioVectorSession === 'undefined' ? null : audioVectorSession; },
    enableSound() { config.capabilities.push('sound_upload','sound_index','sound_answers','sound_sources','sound_query_attachments'); renderControls(); if (typeof ensureDetailSoundIndex === 'function') ensureDetailSoundIndex(); if (typeof renderDetailSoundIndex === 'function') renderDetailSoundIndex(); },
    get soundIndexSession() { return typeof soundIndexSession === 'undefined' ? null : soundIndexSession; },
    enableVideoAv() { config.capabilities.push('video_av_upload','video_av_index','video_av_answers','video_av_sources'); renderControls(); ensureDetailVideoAvIndex(); renderDetailVideoAvIndex(); },
    enableVideoAvQueries() { config.capabilities.push('video_av_query_attachments'); renderControls(); },
    get videoAvIndexSession() { return videoAvIndexSession; },
    enableSynopsis() { config.capabilities.push('file_synopsis','synopsis_sources'); renderDetailSynopsis(); ensureDetailSynopsis(); },
    get synopsisSession() { return typeof synopsisSession === 'undefined' ? null : synopsisSession; },
    enableTagSuggestions() { config.capabilities.push('tag_suggestions'); if (typeof renderDetailTagSuggestions === 'function') renderDetailTagSuggestions(); },
    enableOriginals() { config.capabilities.push('document_originals'); },
    enablePdfOcr() { config.capabilities.push('pdf_ocr_upload'); },
    enableMedia() { config.capabilities.push('audio_upload','video_upload','audio_answers','audio_sources','video_answers','video_sources'); renderControls(); },
    enableImages(mode) { config.capabilities.push(mode === 'visual' ? 'visual_image_upload' : 'image_text_upload', 'source_image_content', 'visual_answers', 'visual_sources'); renderControls(); } };`, context);
  const app = context.app;
  app.configure();
  app.state.commitPage(app.state.beginRead('documents'), [row(kind, initial, rowChange)]);
  app.openDetail('doc-one');
  app.watchTask(initial, kind);
  return { app, document: dom.document, get: id => dom.document.getElementById(id) };
}

function editUnsaved(fixture) {
  const name = fixture.get('detail-name'); const tags = fixture.get('detail-tags');
  name.value = '尚未保存的名称'; tags.value = '尚未保存的标签'; name.focus();
  return () => {
    assert.ok(fixture.get('detail-name') === name, 'name input must retain its DOM identity');
    assert.ok(fixture.get('detail-tags') === tags, 'tag input must retain its DOM identity');
    assert.equal(name.value, '尚未保存的名称'); assert.equal(tags.value, '尚未保存的标签');
  };
}

test('detail to answers then back opens the next file and questions that exact file', async () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed'));
  fixture.app.enableAnswers(); fixture.app.enableImages('visual');
  const png = { ...row('ingestion', task('ingestion', 'parsed', { document_id: 'doc-two', task_id: 'ingestion-two', revision_id: 'rev-two' })),
    document_id: 'doc-two', display_name: '合成图片', filename: 'synthetic.png', document_type: 'image' };
  fixture.app.state.commitPage(fixture.app.state.beginRead('documents'), [fixture.app.state.items[0], png]);
  fixture.app.openAnswers(['doc-one']);
  assert.equal(fixture.get('details').open, false);
  assert.equal(fixture.app.state.detail, null);
  fixture.app.showView('documents');
  assert.equal(fixture.get('details').open, false, 'return must not reopen the old PDF inspector');
  fixture.app.openDetail('doc-two');
  assert.equal(fixture.app.state.detail.document_id, 'doc-two');
  assert.equal(fixture.get('detail-name').value, '合成图片');
  const ask = fixture.get('detail-task-controls').querySelectorAll('button').find(node => node.textContent === '在本资料中提问');
  ask.dispatch('click');
  assert.match(fixture.get('answer-scope-documents').textContent, /合成图片/u);
  const requests = [];
  fixture.app.setApi(async (path, options) => { requests.push({ path, options }); return { answer_id: 'answer-next', status: 'abstained', answer: '没有足够证据。', reason: 'no_evidence', citations: [] }; });
  fixture.get('answer-question').value = 'What is visible?';
  fixture.get('answer-form').dispatch('submit');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(requests[0].options.body.document_ids), ['doc-two']);
  fixture.app.showView('documents'); fixture.app.openDetail('doc-one'); fixture.app.closeDetailPanel();
  fixture.app.openDetail('doc-two');
  assert.equal(fixture.get('detail-name').value, '合成图片');
});

test('cancelling detail draft departure leaves the inspector and question scope unchanged', () => {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed'));
  fixture.app.enableAnswers(); editUnsaved(fixture);
  fixture.app.openAnswers(['doc-one']);
  assert.equal(fixture.get('details').open, true);
  assert.equal(fixture.app.state.detail.document_id, 'doc-one');
  assert.equal(fixture.get('detail-name').value, '尚未保存的名称');
  assert.equal(fixture.get('view-answers').hidden, true);
  fixture.app.setConfirm(() => true); fixture.app.openAnswers(['doc-one']);
  assert.equal(fixture.get('details').open, false);
  assert.equal(fixture.app.state.detail, null);
  fixture.app.showView('documents'); assert.equal(fixture.get('details').open, false);
});

test('real app opens stored PDF, text, image, audio and video directly in details and releases them', async () => {
  for (const [mime, type, tag] of [['application/pdf', 'document', 'object'], ['text/plain', 'document', 'pre'],
    ['image/png', 'image', 'img'], ['audio/wav', 'audio', 'audio'], ['video/mp4', 'video', 'video']]) {
    const bytes = new TextEncoder().encode('合成原文件 <script>literal</script>');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const fixture = appFixture('ingestion', task('ingestion', 'parsed'), { document_type: type,
      media_info: { mime_type: mime, size_bytes: bytes.length, sha256: hash } });
    const calls = [];
    fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return path.endsWith('/content') ? new Blob([bytes], { type: mime })
      : { document_id: 'doc-one', revision_id: 'rev-one', filename: 'synthetic.txt', document_type: type, media_type: mime,
        source_sha256: hash, size_bytes: bytes.length, content_url: '/v1/documents/doc-one/revisions/rev-one/content' }; });
    fixture.app.enableOriginals(); fixture.app.openDetail('doc-one');
    for (let count = 0; count < 8 && fixture.app.originalSession.value.phase === 'loading'; count++) await new Promise(resolve => setTimeout(resolve, 5));
    const preview = fixture.get('detail-original');
    assert.equal(fixture.app.originalSession.value.phase, 'ready');
    assert.ok(preview.querySelector(tag));
    assert.equal(preview.querySelectorAll('a').find(node => node.textContent === '下载原文件').download, 'synthetic.txt');
    assert.equal(calls[0].path, '/v1/documents/doc-one/original');
    assert.equal(calls[1].options.binary, true);
    if (tag === 'pre') assert.equal(preview.querySelector('pre').textContent, '合成原文件 <script>literal</script>');
    const player = fixture.get('detail-original-media');
    if (player) { player.dispatch('error'); assert.match(preview.textContent, /浏览器无法播放/u); }
    const preserved = editUnsaved(fixture);
    await fixture.app.loadTask(); preserved();
    fixture.app.setConfirm(() => true); fixture.app.closeDetailPanel();
    assert.equal(fixture.app.originalSession.value.original, null);
    if (player) { assert.equal(player.src, ''); assert.equal(player.loaded, true); }
  }
});

function statusText(fixture) {
  const children = fixture.get('detail-metadata').children;
  return children[children.findIndex(node => node.textContent === '处理状态') + 1].textContent;
}

async function settleMutation(fixture) {
  for (let count = 0; count < 5; count++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.app.state.mutating, false);
}

for (const kind of ['ingestion', 'indexing']) {
  for (const terminal of ['failed', 'cancelled']) {
    test(`${kind} accepted ${terminal} poll refreshes open detail status without replacing unsaved inputs`, async () => {
      const fixture = appFixture(kind);
      const preserved = editUnsaved(fixture);
      const next = task(kind, terminal);
      const requests = [];
      fixture.app.setApi(async path => { requests.push(path); return next; });
      await fixture.app.loadTask();
      assert.equal(requests.length, 1);
      assert.equal(requests[0], `/v1/${kind === 'indexing' ? 'indexings' : 'ingestions'}/${next.task_id}`);
      const current = fixture.app.state.detail;
      assert.equal(kind === 'indexing' ? current.index_status : current.status, terminal);
      assert.equal(statusText(fixture), stateModule.documentStatusLabel(current));
      preserved();
    });
  }

  test(`${kind} delayed poll respects detail replacement, closure and identity/page epoch`, async () => {
    for (const change of ['other-detail', 'closed', 'page', 'identity']) {
      const fixture = appFixture(kind);
      let deliver;
      fixture.app.setApi(() => new Promise(resolve => { deliver = resolve; }));
      const pending = fixture.app.loadTask();
      let preserved;
      if (change === 'other-detail') {
        const other = row(kind, task(kind), { document_id: 'doc-other', display_name: '另一份合成文档', status: 'parsed', index_status: 'not_indexed', latest_job: null, latest_index_job: null });
        fixture.app.state.items.push(other); fixture.app.openDetail('doc-other'); preserved = editUnsaved(fixture);
      } else if (change === 'closed') fixture.get('close-detail').dispatch('click');
      else fixture.app.resetContext({ identity: change === 'identity' });
      deliver(task(kind, 'failed'));
      await pending;
      if (change === 'other-detail') {
        assert.equal(fixture.app.state.detail.document_id, 'doc-other');
        assert.equal(statusText(fixture), '已解析 · 未索引'); preserved();
      } else {
        assert.equal(fixture.app.state.detail, null);
        assert.equal(fixture.get('detail-metadata'), null);
      }
      if (['page', 'identity'].includes(change)) { assert.equal(fixture.app.state.items.length, 0); assert.equal(fixture.app.state.task, null); assert.equal(fixture.app.state.indexTask, null); }
      assert.equal(fixture.get('task-error').textContent, '');
    }
  });
}

for (const kind of ['ingestion', 'indexing']) for (const action of ['cancel', 'retry']) {
  test(`${kind} ${action} success refreshes the authorized list and preserves unsaved detail inputs`, async () => {
    const initial = task(kind, action === 'retry' ? 'failed' : 'processing');
    const fixture = appFixture(kind, initial);
    const preserved = editUnsaved(fixture);
    const next = task(kind, action === 'retry' ? 'queued' : 'cancelled', { attempt: action === 'retry' ? 2 : 1 });
    const calls = [];
    fixture.app.setApi(async (path, options) => {
      calls.push({ path, options });
      if (path === `/v1/${kind === 'indexing' ? 'indexings' : 'ingestions'}/${kind}-one/${action}`) return next;
      if (path.startsWith('/v1/management/documents?')) return { items: [row(kind, next)], total: 1, total_pages: 1 };
      if (['/v1/management/folders', '/v1/management/tags'].includes(path)) return { items: [] };
      throw new Error(`unexpected fixture route ${path}`);
    });
    fixture.app.taskAction(action);
    if (kind === 'indexing' && action === 'retry') {
      assert.equal(fixture.get('edit-dialog').open, true);
      assert.match(fixture.get('dialog-description').textContent, /嵌入模型和Milvus/);
      assert.equal(calls.length, 0, 'retry must wait for explicit confirmation');
      fixture.get('dialog-form').dispatch('submit');
    }
    await settleMutation(fixture);
    assert.equal(calls.filter(call => call.options?.method === 'POST').length, 1);
    assert.ok(calls.some(call => call.path.startsWith('/v1/management/documents?')));
    assert.equal((kind === 'indexing' ? fixture.app.state.indexTask : fixture.app.state.task).state, next.state);
    assert.equal(statusText(fixture), stateModule.documentStatusLabel(fixture.app.state.detail));
    preserved();
  });
}

for (const kind of ['ingestion', 'indexing']) {
  test(`${kind} action refresh never retains an unauthorized detail or revives an old identity`, async () => {
    for (const invalidation of ['authorized-page-removal', 'identity-change']) {
      const fixture = appFixture(kind);
      editUnsaved(fixture);
      const next = task(kind, 'cancelled');
      const calls = [];
      let deliver;
      fixture.app.setApi(async (path, options) => {
        calls.push({ path, options });
        if (options?.method === 'POST') return new Promise(resolve => { deliver = resolve; });
        if (path.startsWith('/v1/management/documents?')) return { items: [], total: 0, total_pages: 0 };
        return { items: [] };
      });
      fixture.app.taskAction('cancel');
      if (invalidation === 'identity-change') fixture.app.resetContext({ identity: true });
      deliver(next);
      await settleMutation(fixture);
      assert.equal(fixture.app.state.detail, null);
      assert.equal(fixture.get('detail-name'), null);
      assert.equal(fixture.get('detail-metadata'), null);
      assert.equal(fixture.app.state.items.length, 0);
      if (invalidation === 'identity-change') {
        assert.equal(calls.length, 1, 'a stale write completion cannot start reads for the new identity');
        assert.equal(fixture.app.state.task, null); assert.equal(fixture.app.state.indexTask, null);
      } else assert.ok(calls.some(call => call.path.startsWith('/v1/management/documents?')));
    }
  });
}

function detailForm(fixture) { return fixture.get('detail-name').closest('form'); }
function detailSave(fixture) { return detailForm(fixture).querySelectorAll('button').find(node => node.type === 'submit'); }

function permissionTransport(fixture, kind, latestRow, nextTask = task(kind, 'cancelled')) {
  const calls = [];
  fixture.app.setApi(async (path, options) => {
    calls.push({ path, options });
    if (path === `/v1/${kind === 'indexing' ? 'indexings' : 'ingestions'}/${kind}-one/cancel`) return nextTask;
    if (options?.method === 'PATCH') return {};
    if (path.startsWith('/v1/management/documents?')) return { items: latestRow ? [latestRow] : [], total: latestRow ? 1 : 0, total_pages: latestRow ? 1 : 0 };
    if (['/v1/management/folders', '/v1/management/tags'].includes(path)) return { items: [] };
    throw new Error(`unexpected permission fixture route ${path}`);
  });
  return calls;
}

for (const kind of ['ingestion', 'indexing']) {
  test(`${kind} action refresh from editor to reader disables the existing save button and preserves inputs`, async () => {
    const fixture = appFixture(kind, task(kind), { current_role: 'editor' });
    const preserved = editUnsaved(fixture);
    const save = detailSave(fixture);
    const reader = row(kind, task(kind, 'cancelled', { can_retry: false }), { can_edit: false, current_role: 'reader' });
    permissionTransport(fixture, kind, reader);
    fixture.app.taskAction('cancel');
    await settleMutation(fixture);
    assert.equal(fixture.app.state.items[0].can_edit, false);
    assert.equal(fixture.app.state.detail.current_role, 'reader');
    assert.equal(fixture.get('detail-name').disabled, true);
    preserved();
    assert.ok(detailSave(fixture) === save, 'permission updates must retain the save node');
    assert.equal(save.disabled, true, 'the detail save button must follow current authorization');
  });

  test(`${kind} downgraded preserved form submit cannot PATCH through its old editor closure`, async () => {
    const fixture = appFixture(kind, task(kind), { current_role: 'editor' });
    const preserved = editUnsaved(fixture);
    const form = detailForm(fixture);
    const reader = row(kind, task(kind, 'cancelled', { can_retry: false }), { can_edit: false, current_role: 'reader' });
    const calls = permissionTransport(fixture, kind, reader);
    fixture.app.taskAction('cancel');
    await settleMutation(fixture);
    assert.equal(fixture.app.state.items[0].can_edit, false);
    preserved();
    form.dispatch('submit'); // A submit event must be checked independently of disabled controls.
    await settleMutation(fixture);
    assert.equal(calls.filter(call => call.options?.method === 'PATCH').length, 0);
    preserved();
  });

  test(`${kind} reader to editor refresh enables the existing form and saves using current authorization`, async () => {
    const initial = task(kind, 'cancelled', { can_retry: false });
    const fixture = appFixture(kind, initial, { can_edit: false, current_role: 'reader' });
    const name = fixture.get('detail-name'); const tags = fixture.get('detail-tags');
    const form = detailForm(fixture);
    assert.equal(name.disabled, true);
    const editor = row(kind, initial, { can_edit: true, current_role: 'editor' });
    const calls = permissionTransport(fixture, kind, editor);
    await fixture.app.loadData({ preserveDetail: true });
    assert.ok(fixture.get('detail-name') === name); assert.ok(fixture.get('detail-tags') === tags);
    assert.equal(name.disabled, false); assert.equal(tags.disabled, false);
    const save = detailSave(fixture);
    assert.ok(save, 'an upgraded reader needs a save control without reopening the detail');
    assert.equal(save.disabled, false);
    name.value = '权限恢复后编辑'; tags.value = '新标签';
    form.dispatch('submit');
    await settleMutation(fixture);
    const writes = calls.filter(call => call.options?.method === 'PATCH');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].options.body.display_name, '权限恢复后编辑');
    assert.equal(writes[0].options.body.tags.join(','), '新标签');
  });

  test(`${kind} detached form cannot submit after authorized page removal or a new identity opens the same document`, async () => {
    for (const invalidation of ['page-removal', 'new-identity']) {
      const fixture = appFixture(kind);
      const oldForm = detailForm(fixture);
      editUnsaved(fixture);
      const calls = permissionTransport(fixture, kind, null);
      if (invalidation === 'page-removal') await fixture.app.loadData({ preserveDetail: true });
      else {
        fixture.app.resetContext({ identity: true });
        fixture.app.configure();
        fixture.app.state.commitPage(fixture.app.state.beginRead('documents'), [row(kind, task(kind))]);
        fixture.app.openDetail('doc-one');
        assert.equal(fixture.get('detail-name').value, '合成测试文档');
      }
      oldForm.dispatch('submit');
      await settleMutation(fixture);
      assert.equal(calls.filter(call => call.options?.method === 'PATCH').length, 0, invalidation);
    }
  });
}

// Workflow regressions execute app behavior, not just the navigation markup.
test('workflow route closes native inspector and restores the same draft on return', () => {
  const fixture = appFixture('ingestion');
  const preserved = editUnsaved(fixture);
  assert.equal(fixture.get('details').open, true);
  fixture.app.showView('tasks');
  assert.equal(fixture.get('details').open, false);
  assert.equal(fixture.get('view-documents').hidden, true);
  assert.equal(fixture.get('view-tasks').hidden, false);
  assert.equal(fixture.document.activeElement, fixture.get('tasks-heading'));
  fixture.app.showView('documents');
  assert.equal(fixture.get('details').open, true);
  assert.equal(fixture.document.activeElement, fixture.get('detail-heading'));
  preserved();
});

test('cancelled settings navigation preserves the draft and current task route', () => {
  const fixture = appFixture('ingestion');
  const preserved = editUnsaved(fixture);
  fixture.app.showView('tasks');
  assert.equal(fixture.app.showView('settings'), false);
  assert.equal(fixture.get('view-settings').hidden, true);
  assert.equal(fixture.get('view-tasks').hidden, false);
  preserved();
  fixture.app.setConfirm(() => true);
  fixture.app.showView('settings');
  assert.equal(fixture.get('view-settings').hidden, false);
  assert.equal(fixture.app.state.detail, null);
});

test('cancelled filter changes restore values and do not discard hidden drafts or issue reads', () => {
  const fixture = appFixture('ingestion');
  fixture.get('search').value = 'original';
  fixture.get('type').value = '';
  fixture.app.documentQuery();
  const preserved = editUnsaved(fixture);
  fixture.app.showView('tasks');
  fixture.app.setApi(() => { assert.fail('cancelled filter must not issue a request'); });
  fixture.get('search').value = 'changed';
  fixture.get('type').value = 'image';
  fixture.app.changeFilter();
  assert.equal(fixture.get('search').value, 'original');
  assert.equal(fixture.get('type').value, '');
  assert.equal(fixture.app.state.items.length, 1);
  preserved();
});

test('cancelled pagination cannot invalidate a hidden draft', () => {
  const fixture = appFixture('ingestion');
  const preserved = editUnsaved(fixture);
  fixture.app.showView('tasks');
  fixture.app.setApi(() => { assert.fail('cancelled pagination must not issue a request'); });
  fixture.get('next-page').dispatch('click');
  assert.equal(fixture.app.state.items.length, 1);
  preserved();
});

test('native inspector close preserves cancelled edits and discards only after confirmation', () => {
  const fixture = appFixture('ingestion');
  const preserved = editUnsaved(fixture);
  assert.equal(fixture.app.closeDetailPanel(), false);
  assert.equal(fixture.get('details').open, true);
  preserved();
  fixture.app.setConfirm(() => true);
  assert.equal(fixture.app.closeDetailPanel(), true);
  assert.equal(fixture.get('details').open, false);
  assert.equal(fixture.app.state.detail, null);
});

test('task page filters both real task kinds and remains within the authorized page', () => {
  const fixture = appFixture('indexing');
  fixture.app.showView('tasks');
  assert.equal(fixture.get('task-list').children.length, 2);
  fixture.get('tasks-ingestion').dispatch('click');
  assert.equal(fixture.get('task-list').children.length, 1);
  assert.match(fixture.get('task-list').textContent, /解析/u);
  fixture.get('tasks-indexing').dispatch('click');
  assert.equal(fixture.get('task-list').children.length, 1);
  assert.match(fixture.get('task-list').textContent, /索引/u);
  fixture.app.resetContext({ identity: true });
  assert.match(fixture.get('task-list').textContent, /当前范围没有任务/u);
  assert.equal(fixture.get('task-panel').hidden, true);
});

test('batch toolbar appears only for selections and unknown navigation falls back safely', () => {
  const fixture = appFixture('ingestion');
  fixture.app.renderControls();
  assert.equal(fixture.get('batch-tools').hidden, true);
  fixture.app.state.select('doc-one', true);
  fixture.app.renderControls();
  assert.equal(fixture.get('batch-tools').hidden, false);
  fixture.app.state.selectPage(false);
  fixture.app.renderControls();
  assert.equal(fixture.get('batch-tools').hidden, true);
  fixture.app.showView('unknown');
  assert.equal(fixture.get('view-documents').hidden, false);
  assert.equal(fixture.get('view-tasks').hidden, true);
});

const textCitation = {
  number: 1, document_id: 'doc-one', revision_id: 'rev-one', source_sha256: 'a'.repeat(64),
  parser_revision: 'text-v1', filename: 'synthetic.txt', page: 1, start: 0, end: 4,
  quote: '合成证据', quote_sha256: 'b'.repeat(64), source_url: '/v1/sources/answer-one/1',
};
const textAnswer = { answer_id: 'answer-one', status: 'answered', answer: '<script>合成证据</script>[1]', reason: null, citations: [textCitation] };
async function settleAnswer() {
  for (let count = 0; count < 5; count++) await new Promise(resolve => setImmediate(resolve));
}

test('question view is gated by Java capabilities and opens the complete selected set, including unpublished rows', async () => {
  const fixture = appFixture('ingestion');
  fixture.app.renderControls();
  assert.equal(fixture.get('batch-ask').hidden, true);
  assert.equal(fixture.get('answer-question').disabled, true);
  fixture.app.enableAnswers();
  const other = row('ingestion', task('ingestion', 'processing', { task_id: 'ingestion-other', document_id: 'doc-unpublished' }), { display_name: '尚未发布' });
  fixture.app.state.items.push(other);
  fixture.app.state.select('doc-one', true);
  fixture.app.state.select('doc-unpublished', true);
  fixture.app.renderControls();
  const requests = [];
  fixture.app.setApi(async (path, options) => {
    requests.push({ path, options });
    return { answer_id: 'answer-one', status: 'abstained', answer: '没有足够证据。', reason: 'no_evidence', citations: [] };
  });
  fixture.get('batch-ask').dispatch('click');
  assert.equal(fixture.get('view-answers').hidden, false);
  assert.match(fixture.get('answer-scope-label').textContent, /所选 2 份/u);
  fixture.get('answer-question').value = '完整问题';
  fixture.get('answer-form').dispatch('submit');
  await settleAnswer();
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].options.body.document_ids, ['doc-one', 'doc-unpublished']);
  assert.equal(fixture.get('answer-result').hidden, false);
  assert.match(fixture.get('answer-reason').textContent, /no_evidence/u);
  assert.equal(fixture.get('answer-error').hidden, true);
  fixture.get('answer-all').dispatch('click');
  fixture.get('answer-form').dispatch('submit');
  await settleAnswer();
  assert.equal(Object.hasOwn(requests[1].options.body, 'document_ids'), false);
});

test('real app renders text answer and current source, then removes verified source on a failed reread', async () => {
  const fixture = appFixture('indexing');
  fixture.app.enableAnswers();
  let sourceFails = false;
  fixture.app.setApi(async path => {
    if (path === '/v1/answers') return textAnswer;
    assert.equal(path, '/v1/sources/answer-one/1');
    if (sourceFails) throw new ApiError(404, '来源已不可访问。');
    return { answer_id: 'answer-one', citation: textCitation };
  });
  fixture.app.openAnswers(['doc-one']);
  fixture.get('answer-question').value = '问题';
  fixture.get('answer-form').dispatch('submit');
  await settleAnswer();
  assert.equal(fixture.get('answer-text').textContent, textAnswer.answer);
  assert.equal(fixture.get('answer-text').children.length, 0, 'model HTML remains literal text');
  fixture.get('answer-citations').querySelector('button').dispatch('click');
  await settleAnswer();
  assert.equal(fixture.get('source-content').hidden, false);
  assert.equal(fixture.get('source-quote').textContent, '合成证据');
  assert.match(fixture.get('source-metadata').textContent, /rev-one/u);
  sourceFails = true;
  fixture.get('answer-citations').querySelector('button').dispatch('click');
  await settleAnswer();
  assert.equal(fixture.get('source-content').hidden, true);
  assert.equal(fixture.get('source-quote').textContent, '');
  assert.match(fixture.get('source-error').textContent, /不可访问/u);
});

test('question form prevents duplicate submission and scope changes suppress the pending result', async () => {
  const fixture = appFixture('ingestion');
  fixture.app.enableAnswers();
  let deliver;
  let calls = 0;
  fixture.app.setApi(() => { calls++; return new Promise(resolve => { deliver = resolve; }); });
  fixture.app.openAnswers(['doc-one']);
  fixture.get('answer-question').value = '问题';
  fixture.get('answer-form').dispatch('submit');
  fixture.get('answer-form').dispatch('submit');
  assert.equal(calls, 1);
  assert.equal(fixture.get('answer-submit').disabled, true);
  assert.match(fixture.get('answer-status').textContent, /正在检索/u);
  fixture.get('answer-all').dispatch('click');
  deliver(textAnswer);
  await settleAnswer();
  assert.equal(fixture.get('answer-result').hidden, true);
  assert.equal(fixture.get('answer-text').textContent, '');
  assert.match(fixture.get('answer-scope-label').textContent, /全部/u);
});

test('parsed terminal poll rereads the authorized row so indexing becomes available without manual list refresh', async () => {
  const fixture = appFixture('ingestion');
  const preserved = editUnsaved(fixture);
  const next = task('ingestion', 'parsed');
  const calls = [];
  fixture.app.setApi(async path => {
    calls.push(path);
    if (path === '/v1/ingestions/ingestion-one') return next;
    if (path.startsWith('/v1/management/documents?')) return {
      items: [row('ingestion', next, { can_index: true })], total: 1, total_pages: 1,
    };
    throw new Error(`unexpected route ${path}`);
  });
  await fixture.app.loadTask();
  assert.equal(calls.length, 2);
  assert.equal(fixture.app.state.items[0].can_index, true);
  assert.match(fixture.get('detail-task-controls').textContent, /建立索引/u);
  preserved();
});

test('row question entry uses service capability instead of legacy can_answer placeholder, without changing its value', () => {
  const fixture = appFixture('indexing', task('indexing', 'indexed'), { active_revision_id: 'rev-one', index_publication_id: 'publication-one', can_answer: false });
  fixture.app.enableAnswers();
  fixture.app.renderRows();
  const ask = fixture.get('document-rows').querySelectorAll('button').find(button => button.textContent === '提问');
  assert.ok(ask, 'real published Java rows still carry the legacy false placeholder');
  ask.dispatch('click');
  assert.equal(fixture.get('view-answers').hidden, false);
  assert.match(fixture.get('answer-scope-label').textContent, /所选 1 份/u);
  assert.equal(fixture.app.state.items[0].can_answer, false, 'UI must not manufacture server eligibility');
});

test('all-library empty scope explains absence of published documents instead of telling user they forgot selection', async () => {
  const fixture = appFixture('ingestion');
  fixture.app.enableAnswers();
  fixture.app.setApi(async () => ({ answer_id: 'answer-one', status: 'abstained', answer: '没有足够证据。', reason: 'empty_scope', citations: [] }));
  fixture.app.openAnswers();
  fixture.get('answer-question').value = '问题';
  fixture.get('answer-form').dispatch('submit');
  await settleAnswer();
  assert.match(fixture.get('answer-reason').textContent, /没有可访问的已发布资料/u);
});

test('image upload dialog states visual priority and includes PNG/JPEG without hiding text', () => {
  const fixture = appFixture('ingestion');
  fixture.app.enableImages('ocr'); fixture.app.enableImages('visual');
  fixture.get('upload').dispatch('click');
  assert.match(fixture.get('upload-file').accept, /\.png/);
  assert.match(fixture.get('upload-file').accept, /\.pdf/);
  assert.match(fixture.document.root.textContent, /图片按原图视觉处理/);
});

test('an existing visual citation still opens its checked original after only visual generation is disabled', async () => {
  const fixture = appFixture('indexing');
  fixture.app.enableAnswers(); fixture.app.enableImages('visual');
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const citation = { number: 1, kind: 'image_region', document_id: 'doc-one', revision_id: 'rev-one',
    source_sha256: hash, parser_revision: 'java-image-visual-v1:synthetic', filename: 'synthetic.png',
    media_type: 'image/png', width: 400, height: 200, bbox: [0, 0, 1, 1], coordinate_system: 'normalized_xyxy',
    model_revision: 'synthetic-model', policy_revision: 'synthetic-policy', source_url: '/v1/visual-sources/a/1', content_url: '/v1/visual-sources/a/1/content' };
  const calls = [];
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/v1/visual-answers') return { answer_id: 'a', status: 'answered', answer: 'A blue circle.', reason: null, citations: [citation] };
    if (path === '/v1/config') return { capabilities: ['management', 'answers', 'sources', 'visual_sources'] };
    if (path.startsWith('/v1/management/documents?')) return { items: fixture.app.state.items, total: 1, total_pages: 1 };
    if (path.startsWith('/v1/management/')) return { items: [] };
    if (path === citation.source_url) return { answer_id: 'a', citation };
    if (path === citation.content_url) return new Blob([bytes], { type: 'image/png' });
    assert.fail(`unexpected fixture path ${path}`);
  });
  fixture.app.openAnswers(['doc-one']);
  fixture.get('answer-mode').value = 'visual'; fixture.get('answer-mode').dispatch('change');
  fixture.get('answer-question').value = 'What is visible?'; fixture.get('answer-form').dispatch('submit');
  await settleAnswer();
  assert.equal(fixture.app.answerSession.value.phase, 'answered');
  await fixture.app.refreshModelCapabilities();
  assert.equal(fixture.get('answer-submit').disabled, true);
  fixture.get('answer-form').dispatch('submit');
  await settleAnswer();
  assert.equal(calls.filter(call => call.path === '/v1/visual-answers').length, 1);
  fixture.get('answer-citations').querySelector('button').dispatch('click');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fixture.app.answerSession.value.sourcePhase, 'ready');
  assert.equal(fixture.get('source-image-panel').hidden, false);
  assert.ok(fixture.get('source-image-panel').querySelector('img').src.startsWith('blob:'));
  assert.equal(fixture.app.answerSession.value.source.source_sha256, hash);
  assert.equal(calls.filter(call => call.path === citation.source_url).length, 1);
  assert.equal(calls.filter(call => call.path === citation.content_url && call.options.binary === true).length, 1);
  fixture.app.showView('documents');
  assert.equal(fixture.get('source-image-panel').hidden, true);
  assert.equal(fixture.app.answerSession.value.source, null);
});

test('real app visual mode posts complete scope and displays original image without text locators', async () => {
  const fixture = appFixture('indexing');
  fixture.app.enableAnswers(); fixture.app.enableImages('visual');
  const bytes = new Uint8Array([1, 2, 3]);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const citation = { number: 1, kind: 'image_region', document_id: 'doc-one', revision_id: 'rev-one',
    source_sha256: hash, parser_revision: 'java-image-visual-v1:synthetic', filename: 'synthetic.png',
    media_type: 'image/png', width: 400, height: 200, bbox: [0, 0, 1, 1], coordinate_system: 'normalized_xyxy',
    model_revision: 'synthetic-model', policy_revision: 'synthetic-policy', source_url: '/v1/visual-sources/a/1', content_url: '/v1/visual-sources/a/1/content' };
  const calls = [];
  fixture.app.setApi(async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('answers')) return { answer_id: 'a', status: 'answered', answer: 'A blue circle.', reason: null, citations: [citation] };
    if (path.endsWith('/content')) return new Blob([bytes], { type: 'image/png' });
    return { answer_id: 'a', citation };
  });
  fixture.app.openAnswers(['doc-one', 'other-document']);
  fixture.get('answer-mode').value = 'visual'; fixture.get('answer-mode').dispatch('change');
  fixture.get('answer-question').value = 'What is visible?'; fixture.get('answer-form').dispatch('submit');
  await settleAnswer();
  assert.equal(calls[0].path, '/v1/visual-answers');
  assert.deepEqual(calls[0].options.body.document_ids, ['doc-one', 'other-document']);
  fixture.get('answer-citations').querySelector('button').dispatch('click');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fixture.get('source-image-panel').hidden, false);
  assert.equal(fixture.get('source-image-panel').querySelector('img').width, 400);
  assert.doesNotMatch(fixture.get('source-metadata').textContent, /页码|字符区间|摘录 SHA/);
  fixture.app.showView('documents');
  assert.equal(fixture.get('source-image-panel').hidden, true);
  assert.equal(fixture.get('source-image-panel').children.length, 0);
  fixture.get('answer-mode').value = 'text'; fixture.get('answer-mode').dispatch('change');
  assert.equal(fixture.get('answer-text').textContent, '');
});

test('media upload selection keeps MP4 interpretation explicit', () => {
  const fixture = appFixture('ingestion'); fixture.app.enableMedia();
  fixture.get('upload').dispatch('click');
  const kind = fixture.get('upload-kind'), file = fixture.get('upload-file');
  assert.deepEqual(kind.options.map(option => option.value), ['document', 'audio', 'video']);
  kind.value = 'audio'; kind.dispatch('change'); assert.match(file.accept, /\.wav/); assert.match(file.accept, /\.mp4/);
  kind.value = 'video'; kind.dispatch('change'); assert.match(file.accept, /\.mov/); assert.doesNotMatch(file.accept, /\.wav/);
});

test('audio source plays the cited interval and leaving answers releases the player', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableMedia();
  const bytes = new Uint8Array([1, 2, 3]);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  const citation = { number: 1, kind: 'audio_span', document_id: 'doc-one', revision_id: 'rev-one', source_sha256: hash,
    parser_revision: 'synthetic-audio-v1', filename: 'synthetic.wav', media_type: 'audio/wav', start_ms: 1500, end_ms: 2500,
    quote: 'Synthetic transcript.', quote_sha256: hash, text_origin: 'machine_asr', time_precision: 'server_chunk',
    source_url: '/v1/audio-sources/a/1', content_url: '/v1/audio-sources/a/1/content' };
  const calls = [];
  fixture.app.setApi(async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith('answers')) return { answer_id: 'a', status: 'answered', answer: 'Synthetic answer.', reason: null, citations: [citation] };
    if (path.endsWith('/content')) return new Blob([bytes], { type: 'audio/wav' });
    return { answer_id: 'a', citation };
  });
  fixture.app.openAnswers(['doc-one', 'unpublished']);
  assert.equal(fixture.get('answer-mode').value, 'audio');
  fixture.get('answer-question').value = 'Question?'; fixture.get('answer-form').dispatch('submit'); await settleAnswer();
  assert.deepEqual(calls[0].options.body.document_ids, ['doc-one', 'unpublished']);
  fixture.get('answer-citations').querySelector('button').dispatch('click'); await new Promise(resolve => setTimeout(resolve, 20));
  const panel = fixture.get('source-media-panel'), player = panel.querySelector('audio'); assert.ok(player);
  assert.doesNotMatch(fixture.get('source-metadata').textContent, /页码|字符区间/);
  player.dispatch('loadedmetadata'); assert.equal(player.currentTime, 1.5);
  panel.querySelectorAll('button').find(button => button.textContent === '播放此引用片段').dispatch('click'); await settleAnswer(); assert.equal(player.paused, false);
  player.currentTime = 2.5; player.dispatch('timeupdate'); assert.equal(player.paused, true);
  fixture.app.showView('documents'); assert.equal(player.src, ''); assert.equal(player.loaded, true); assert.equal(panel.hidden, true);
});

function chooseQueryFile(fixture, name, kind = 'image', bytes = new Uint8Array([0, 1, 128, 254, 255])) {
  fixture.get('answer-attachment-kind').value = kind;
  fixture.get('answer-attachment-kind').dispatch('change');
  fixture.get('answer-attachment-files').files = [new File([bytes], name)];
  fixture.get('answer-attachment-files').dispatch('change');
}

test('query attachments are capability-gated, use explicit media kinds, and keep invalid additions atomic', () => {
  const fixture = appFixture('ingestion'); fixture.app.enableAnswers(); fixture.app.openAnswers();
  assert.equal(fixture.get('answer-attachment-files').disabled, true);
  assert.match(fixture.get('answer-attachment-help').textContent, /未启用/u);
  fixture.app.enableAttachments();
  assert.equal(fixture.get('answer-attachment-files').disabled, false);
  chooseQueryFile(fixture, '<query>.png');
  chooseQueryFile(fixture, 'voice.mp4', 'audio');
  chooseQueryFile(fixture, 'movie.webm', 'video');
  assert.equal(fixture.get('answer-attachment-list').children.length, 3);
  assert.match(fixture.get('answer-attachment-list').textContent, /<query>\.png/u);
  assert.match(fixture.get('answer-attachment-list').textContent, /音频/u);
  chooseQueryFile(fixture, 'extra.png');
  assert.equal(fixture.get('answer-attachment-list').children.length, 3);
  assert.match(fixture.get('answer-attachment-error').textContent, /最多3/u);
  fixture.get('answer-attachment-list').querySelector('button').dispatch('click');
  assert.equal(fixture.get('answer-attachment-list').children.length, 2);
  fixture.get('answer-attachment-clear').dispatch('click');
  assert.equal(fixture.get('answer-attachment-list').children.length, 0);
});

test('actual form submits three query files once, renders preparation and opens only library citations', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableAnswers(); fixture.app.enableAttachments();
  fixture.app.openAnswers(['doc-one', 'unpublished']);
  chooseQueryFile(fixture, 'query.png'); chooseQueryFile(fixture, 'voice.wav', 'audio'); chooseQueryFile(fixture, 'clip.mp4', 'video');
  const calls = [];
  fixture.app.setApi(async (path, options) => {
    calls.push({ path, options });
    if (path === '/v1/attachment-answers') return { mode: 'text', result: textAnswer,
      query_attachments: ['image', 'audio', 'video'].map((media_kind, ordinal) => ({ ordinal, media_kind, status: 'prepared', visual_sampled: media_kind === 'video', reason: null })) };
    assert.equal(path, textCitation.source_url);
    return { answer_id: 'answer-one', citation: textCitation };
  });
  fixture.get('answer-question').value = ' 原问题\n保持 ';
  fixture.get('answer-form').dispatch('submit'); fixture.get('answer-form').dispatch('submit');
  assert.equal(fixture.get('answer-submit').disabled, true);
  await settleAnswer();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/v1/attachment-answers');
  assert.equal(calls[0].options.body.question, ' 原问题\n保持 ');
  assert.deepEqual(calls[0].options.body.document_ids, ['doc-one', 'unpublished']);
  assert.deepEqual(calls[0].options.body.attachments.map(item => item.media_type), ['image/png', 'audio/wav', 'video/mp4']);
  assert.match(fixture.get('answer-attachment-status').textContent, /query\.png.*已处理/u);
  assert.match(fixture.get('answer-attachment-status').textContent, /采样/u);
  assert.equal(fixture.get('answer-citations').children.length, 1);
  fixture.get('answer-citations').querySelector('button').dispatch('click'); await settleAnswer();
  assert.equal(fixture.get('source-quote').textContent, '合成证据');
  fixture.get('answer-attachment-list').querySelector('button').dispatch('click');
  assert.equal(fixture.get('answer-result').hidden, true); assert.equal(fixture.get('source-content').hidden, true);
});

test('query attachment read is invalidated on scope change, and leaving answers releases all selections', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableAnswers(); fixture.app.enableAttachments(); fixture.app.openAnswers(['doc-one']);
  let deliver, calls = 0;
  const file = new File([new Uint8Array([1, 2, 3])], 'query.png');
  file.arrayBuffer = () => new Promise(resolve => { deliver = resolve; });
  fixture.get('answer-attachment-files').files = [file]; fixture.get('answer-attachment-files').dispatch('change');
  fixture.app.setApi(async () => { calls++; return textAnswer; });
  fixture.get('answer-question').value = '问题'; fixture.get('answer-form').dispatch('submit');
  fixture.get('answer-all').dispatch('click'); deliver(new Uint8Array([1, 2, 3]).buffer); await settleAnswer();
  assert.equal(calls, 0); assert.equal(fixture.get('answer-result').hidden, true);
  fixture.app.showView('documents'); fixture.app.showView('answers');
  assert.equal(fixture.get('answer-attachment-list').children.length, 0);
  chooseQueryFile(fixture, 'new.png'); fixture.app.resetContext({ identity: true });
  assert.equal(fixture.get('answer-attachment-list').children.length, 0);
});

test('attachment preparation failure has per-file feedback and remains a refusal without citations', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableAnswers(); fixture.app.enableAttachments(); fixture.app.openAnswers();
  chooseQueryFile(fixture, 'long.wav', 'audio');
  fixture.app.setApi(async () => ({ mode: 'text', result: { answer_id: 'a', status: 'abstained', answer: '无法完成本次回答。', reason: 'query_text_limit', citations: [] },
    query_attachments: [{ ordinal: 0, media_kind: 'audio', status: 'failed', visual_sampled: false, reason: 'query_text_limit' }] }));
  fixture.get('answer-question').value = '问题'; fixture.get('answer-form').dispatch('submit'); await settleAnswer();
  assert.match(fixture.get('answer-attachment-status').textContent, /long\.wav.*未完成/u);
  assert.match(fixture.get('answer-attachment-status').textContent, /query_text_limit/u);
  assert.equal(fixture.get('answer-citations').children.length, 0);
});

function summaryData(type = 'document') {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]), hash = createHash('sha256').update(bytes).digest('hex');
  const text = '合成原文', kind = { document: 'text', image: 'image', audio: 'audio_transcript', video: 'video_transcript' }[type];
  const timed = ['audio', 'video'].includes(type), time = timed ? { start_us: 1_500_000, end_us: 2_500_000 } : null;
  const item = { active_revision_id: 'rev-one', index_publication_id: 'publication-one', filename: `synthetic.${{ document: 'pdf', image: 'png', audio: 'wav', video: 'mp4' }[type]}`,
    document_type: type, media_info: { mime_type: { document: 'application/pdf', image: 'image/png', audio: 'audio/wav', video: 'video/mp4' }[type], size_bytes: bytes.length, sha256: hash } };
  const reference = { ordinal: 1, evidence_id: 'evidence-one', kind, sha256: type === 'image' ? hash : createHash('sha256').update(text).digest('hex'), time, source_url: '/v1/synopsis-sources/synopsis-one/1/1' };
  const synopsis = { synopsis_id: 'synopsis-one', document_id: 'doc-one', publication_id: item.index_publication_id, revision_id: item.active_revision_id, source_sha256: hash,
    input_fingerprint: 'c'.repeat(64), model_revision: 'synthetic-model', policy_revision: 'synthetic-policy', status: 'available', entries: ['overview', 'topic', 'term', ...(timed ? ['timeline'] : [])].map((section, index) => ({ ordinal: index + 1, section, text: '<script>合成摘要</script>', interval: section === 'timeline' ? time : null,
      evidence: [{ ...reference, source_url: `/v1/synopsis-sources/synopsis-one/${index + 1}/1` }] })) };
  const locator = type === 'document' ? { type: 'page', page: 2, start_code_point: 0, end_code_point: 4, width: null, height: null, regions: [] }
    : type === 'image' ? { type: 'image', width: 2, height: 2 } : { type: type === 'audio' ? 'audio_span' : 'video_transcript', span_id: 'span-one', span_ordinal: 0, ...time };
  const source = { synopsis_id: 'synopsis-one', entry_ordinal: 1, source_ordinal: 1, evidence_id: reference.evidence_id, kind, sha256: reference.sha256, filename: item.filename,
    media_type: item.media_info.mime_type, text: type === 'image' ? null : text, proof_origin: type === 'document' ? 'original_text' : type === 'image' ? 'machine_vlm' : 'machine_asr', time_precision: timed ? 'server_chunk' : null,
    locator, content_url: reference.source_url + '/content', frame_url: null };
  return { item, synopsis, source, bytes };
}

test('detail synopsis explains capability and publication requirements without starting generation', () => {
  const fixture = appFixture('ingestion');
  assert.match(fixture.get('detail-synopsis').textContent, /未启用/u);
  fixture.app.enableSynopsis();
  assert.match(fixture.get('detail-synopsis').textContent, /索引/u);
  assert.equal(fixture.get('synopsis-create'), null);
});

test('existing synopsis renders all sections as literal text and opens four original types without changing detail drafts', async () => {
  for (const type of ['document', 'image', 'audio', 'video']) {
    const data = summaryData(type), calls = [];
    const fixture = appFixture('indexing', task('indexing', 'indexed'), { ...data.item, can_edit: false });
    const saved = editUnsaved(fixture);
    fixture.app.setApi(async (path, options) => {
      calls.push({ path, options });
      return path.endsWith('/synopsis') ? data.synopsis : path.endsWith('/content') ? new Blob([data.bytes], { type: data.source.media_type }) : data.source;
    });
    fixture.app.enableSynopsis(); await settleAnswer(); saved();
    assert.match(fixture.get('detail-synopsis').textContent, /概览/u); assert.match(fixture.get('detail-synopsis').textContent, /主题/u); assert.match(fixture.get('detail-synopsis').textContent, /术语/u);
    assert.equal(fixture.get('synopsis-create').disabled, true);
    assert.equal(fixture.get('detail-synopsis').querySelectorAll('script').length, 0);
    fixture.get('detail-synopsis').querySelectorAll('button').find(node => node.textContent === '查看依据 1').dispatch('click');
    await settleAnswer(); saved();
    const panel = fixture.get('synopsis-source');
    assert.match(panel.textContent, /打开原文件/u); assert.match(panel.textContent, /下载原文件/u);
    if (type === 'document') { assert.ok(panel.querySelector('object')); assert.match(panel.textContent, /第 2 页/u); }
    else if (type === 'image') assert.ok(panel.querySelector('img'));
    else {
      const player = panel.querySelector(type); assert.ok(player); player.dispatch('loadedmetadata'); assert.equal(player.currentTime, 1.5);
      panel.querySelectorAll('button').find(node => node.textContent === '播放此来源片段').dispatch('click'); await settleAnswer(); assert.equal(player.paused, false);
      player.currentTime = 2.5; player.dispatch('timeupdate'); assert.equal(player.paused, true);
      fixture.app.setConfirm(() => true); fixture.app.showView('answers'); assert.equal(player.src, ''); assert.equal(player.loaded, true);
    }
    assert.equal(calls.some(call => call.options.method === 'POST'), false);
  }
});

test('synopsis creation requires explicit dialog action, then task progress and refresh retain the edit form', async () => {
  const data = summaryData(), fixture = appFixture('indexing', task('indexing', 'indexed'), data.item); const saved = editUnsaved(fixture);
  let posts = 0, available = false;
  const receipt = state => ({ task_id: 'synopsis-one', document_id: 'doc-one', publication_id: 'publication-one', state, error_code: null,
    created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z' });
  fixture.app.setApi(async (path, options) => {
    if (options.method === 'POST') { posts++; return receipt('queued'); }
    if (path.startsWith('/v1/synopsis-tasks/')) { available = true; return receipt('available'); }
    if (!available) throw new ApiError(404, '当前无可读摘要。');
    return data.synopsis;
  });
  fixture.app.enableSynopsis(); await settleAnswer();
  fixture.get('synopsis-create').dispatch('click'); assert.equal(posts, 0); assert.equal(fixture.get('edit-dialog').open, true);
  assert.match(fixture.get('dialog-description').textContent, /模型/u);
  fixture.get('dialog-form').dispatch('submit'); fixture.get('dialog-form').dispatch('submit'); await settleAnswer();
  assert.equal(posts, 1); assert.match(fixture.get('detail-synopsis').textContent, /等待处理/u); saved();
  await fixture.app.synopsisSession.refresh(); saved(); assert.match(fixture.get('detail-synopsis').textContent, /合成摘要/u);
  assert.equal(fixture.app.state.items[0].index_status, 'indexed');
});

test('leaving a detail invalidates pending synopsis and next file cannot receive old summary', async () => {
  const data = summaryData(), fixture = appFixture('indexing', task('indexing', 'indexed'), data.item); let deliver;
  fixture.app.setApi(() => new Promise(resolve => { deliver = resolve; }));
  fixture.app.enableSynopsis(); fixture.app.closeDetailPanel(); deliver(data.synopsis); await settleAnswer();
  assert.equal(fixture.app.synopsisSession.value.phase, 'idle'); assert.equal(fixture.get('detail-synopsis'), null);
});

test('real app opens the saved PDF at the cited page and removes it when leaving answers', async () => {
  const fixture = appFixture('indexing');
  fixture.app.enableAnswers(); fixture.app.enableOriginals();
  const bytes = new TextEncoder().encode('%PDF synthetic protocol fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const citation = { ...textCitation, filename: 'synthetic.pdf', page: 2,
    parser_revision: `java-pdf-ocr-v1:${'a'.repeat(64)}`, source_sha256: hash };
  fixture.app.setApi(async path => {
    if (path === '/v1/answers') return { ...textAnswer, citations: [citation] };
    if (path === citation.source_url) return { answer_id: 'answer-one', citation };
    if (path.endsWith('/original')) return { document_id: citation.document_id, revision_id: citation.revision_id,
      filename: citation.filename, document_type: 'document', media_type: 'application/pdf', source_sha256: hash,
      size_bytes: bytes.length, content_url: '/v1/documents/doc-one/revisions/rev-one/content' };
    assert.equal(path, '/v1/documents/doc-one/revisions/rev-one/content');
    return new Blob([bytes], { type: 'application/pdf' });
  });
  fixture.app.openAnswers(['doc-one']);
  fixture.get('answer-question').value = '问题'; fixture.get('answer-form').dispatch('submit'); await settleAnswer();
  fixture.get('answer-citations').querySelector('button').dispatch('click');
  await new Promise(resolve => setTimeout(resolve, 25));
  const panel = fixture.get('source-pdf-panel');
  assert.ok(panel); assert.equal(panel.hidden, false);
  assert.match(panel.querySelector('object').data, /^blob:.*#page=2$/u);
  const links = panel.querySelectorAll('a');
  assert.match(links[0].href, /#page=2$/u); assert.equal(links[1].download, 'synthetic.pdf');
  assert.match(panel.textContent, /逐页OCR|机器OCR/u);
  fixture.app.showView('documents');
  assert.equal(panel.hidden, true); assert.equal(panel.children.length, 0);
});

test('real upload dialog only advertises scanned PDF processing when server capability is enabled', () => {
  const fixture = appFixture('ingestion');
  fixture.get('upload').dispatch('click');
  assert.doesNotMatch(fixture.get('edit-dialog').textContent, /逐页OCR/u);
  fixture.get('dialog-cancel').dispatch('click'); fixture.app.enablePdfOcr();
  fixture.get('upload').dispatch('click');
  assert.match(fixture.get('edit-dialog').textContent, /逐页OCR/u);
});


function tagSuggestions(data) {
  return { document_id: data.synopsis.document_id, publication_id: data.item.index_publication_id, revision_id: data.item.active_revision_id,
    source_sha256: data.item.media_info.sha256, synopsis_id: data.synopsis.synopsis_id, input_fingerprint: data.synopsis.input_fingerprint,
    model_revision: data.synopsis.model_revision, synopsis_policy_revision: data.synopsis.policy_revision,
    policy_revision: 'java-synopsis-tags-v1', suggestion_fingerprint: 'd'.repeat(64), existing_tags: ['已保存标签'], can_apply: true,
    candidates: [{ ordinal: 1, tag: '太阳能' }, { ordinal: 2, tag: '<b>设备维护</b>' }] };
}

test('summary tag suggestions require selection and preserve detail drafts before merging', async () => {
  const data = summaryData(), fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  const suggestions = tagSuggestions(data), calls = [];
  let applied = false;
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    if (path.endsWith('/synopsis')) return data.synopsis;
    if (path.endsWith('/tag-suggestions')) return { ...suggestions, existing_tags: applied ? ['已保存标签', '期间新增', '太阳能'] : suggestions.existing_tags };
    if (path.endsWith('/tag-suggestions/apply')) {
      applied = true;
      return { ...fixture.app.state.items[0], tags: ['已保存标签', '期间新增', '太阳能'] };
    }
    if (path.startsWith('/v1/management/documents?')) return { items: [{ ...fixture.app.state.items[0], tags: ['已保存标签', '期间新增', '太阳能'] }], total: 1, total_pages: 1 };
    return { items: [] };
  });
  fixture.app.enableSynopsis(); fixture.app.enableTagSuggestions(); await settleAnswer();
  assert.ok(fixture.get('tag-suggestions-load'), 'current saved synopsis exposes tag suggestions');
  fixture.get('tag-suggestions-load').dispatch('click'); await settleAnswer();
  assert.equal(fixture.get('tag-suggestions-apply').disabled, true);
  assert.equal(calls.some(call => call.options.method === 'POST'), false);
  assert.equal(fixture.get('detail-tag-suggestions').querySelectorAll('b').length, 0);
  const check = fixture.get('tag-suggestion-1'); check.checked = true; check.dispatch('change');
  const saved = editUnsaved(fixture);
  fixture.get('tag-suggestions-apply').dispatch('click'); await settleAnswer(); saved();
  assert.equal(calls.some(call => call.options.method === 'POST'), false);
  assert.match(fixture.get('tag-suggestions-error').textContent, /草稿|尚未保存/u);
  fixture.get('detail-name').value = fixture.app.state.detail.display_name;
  fixture.get('detail-tags').value = fixture.app.state.detail.tags.join('，');
  fixture.get('tag-suggestions-apply').dispatch('click'); await settleAnswer();
  const writes = calls.filter(call => call.options.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/v1/documents/doc-one/tag-suggestions/apply');
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].options.body)), { suggestion_fingerprint: 'd'.repeat(64), ordinals: [1] });
  assert.ok(calls.some(call => call.path === '/v1/management/tags'));
  assert.match(fixture.get('detail-tags').value, /期间新增/u);
  assert.match(fixture.get('detail-tags').value, /太阳能/u);
});

test('tag suggestion reads are discarded after leaving the current detail', async () => {
  const data = summaryData(), fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  let deliver;
  fixture.app.setApi((path) => path.endsWith('/synopsis') ? Promise.resolve(data.synopsis) : new Promise(resolve => { deliver = resolve; }));
  fixture.app.enableSynopsis(); fixture.app.enableTagSuggestions(); await settleAnswer();
  assert.ok(fixture.get('tag-suggestions-load'));
  fixture.get('tag-suggestions-load').dispatch('click');
  fixture.app.closeDetailPanel(); deliver(tagSuggestions(data)); await settleAnswer();
  assert.equal(fixture.get('detail-tag-suggestions'), null);
  assert.equal(fixture.app.state.detail, null);
});

function voiceReply(bytes, transcript = '原识别问题\n尾部编号731-42') {
  return { transcript, transcript_sha256: createHash('sha256').update(transcript).digest('hex'),
    source_sha256: createHash('sha256').update(bytes).digest('hex'), duration_ms: 2500,
    decoder_revision: 'fixture-decoder', model_revision: 'fixture-asr', compiler_revision: 'fixture-compiler', policy_revision: 'java-voice-question-v1' };
}

function chooseVoiceFile(fixture, file) {
  fixture.get('answer-voice-file').files = [file]; fixture.get('answer-voice-file').dispatch('change');
}

test('voice input preserves manual question until review, then asks exact scope and reads only library source', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableAnswers(); fixture.app.openAnswers(['doc-one', 'unpublished']);
  assert.ok(fixture.get('answer-voice-file'), 'voice question control must exist');
  assert.equal(fixture.get('answer-voice-file').disabled, true); fixture.app.enableVoice();
  assert.equal(fixture.get('answer-voice-file').disabled, false);
  const bytes = new Uint8Array([0, 1, 42, 128, 255]), calls = [];
  fixture.get('answer-question').value = '手工草稿';
  fixture.app.setApi(async (path, options) => {
    calls.push({ path, options });
    if (path === '/v1/voice-questions') return voiceReply(bytes);
    if (path === '/v1/answers') return textAnswer;
    assert.equal(path, textCitation.source_url); return { answer_id: 'answer-one', citation: textCitation };
  });
  chooseVoiceFile(fixture, new File([bytes], '<voice>.wav'));
  fixture.get('answer-voice-transcribe').dispatch('click'); fixture.get('answer-voice-transcribe').dispatch('click');
  await settleAnswer();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/voice-questions');
  assert.deepEqual(Object.keys(calls[0].options.body).sort(), ['content_base64', 'filename', 'media_type']);
  assert.equal(calls[0].options.body.media_type, 'audio/wav'); assert.equal(calls[0].options.body.content_base64, Buffer.from(bytes).toString('base64'));
  assert.equal(fixture.get('answer-question').value, '手工草稿');
  assert.equal(fixture.get('answer-voice-text').value, '原识别问题\n尾部编号731-42');
  fixture.get('answer-voice-text').value = '已核对问题 731-42？'; fixture.get('answer-voice-text').dispatch('input');
  fixture.get('answer-voice-use').dispatch('click');
  assert.equal(fixture.get('answer-question').value, '已核对问题 731-42？'); assert.equal(calls.length, 1);
  assert.equal(fixture.get('answer-attachment-list').children.length, 0, 'voice is not added as retrieval attachment');
  fixture.get('answer-form').dispatch('submit'); await settleAnswer();
  assert.equal(calls[1].path, '/v1/answers'); assert.equal(calls[1].options.body.question, '已核对问题 731-42？');
  assert.deepEqual(Array.from(calls[1].options.body.document_ids), ['doc-one', 'unpublished']);
  fixture.get('answer-citations').querySelector('button').dispatch('click'); await settleAnswer();
  assert.equal(fixture.get('source-quote').textContent, '合成证据');
});

test('voice read cancellation and late transcription cannot change the current question or scope', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableAnswers(); fixture.app.enableVoice(); fixture.app.openAnswers(['doc-one']);
  assert.ok(fixture.get('answer-voice-file'), 'voice input must be present');
  const bytes = new Uint8Array([1, 2, 3]); let deliverRead, deliverResponse, calls = 0;
  const file = new File([bytes], 'voice.wav'); file.arrayBuffer = () => new Promise(resolve => { deliverRead = resolve; });
  fixture.app.setApi(() => { calls++; return new Promise(resolve => { deliverResponse = resolve; }); });
  chooseVoiceFile(fixture, file); fixture.get('answer-voice-transcribe').dispatch('click');
  fixture.get('answer-all').dispatch('click'); deliverRead(bytes.buffer); await settleAnswer(); assert.equal(calls, 0);
  chooseVoiceFile(fixture, new File([bytes], 'new.wav')); fixture.get('answer-voice-transcribe').dispatch('click');
  await settleAnswer(); assert.equal(calls, 1);
  fixture.app.showView('documents'); fixture.app.showView('answers');
  fixture.get('answer-question').value = '之后输入的新问题'; deliverResponse(voiceReply(bytes)); await settleAnswer();
  assert.equal(fixture.get('answer-question').value, '之后输入的新问题');
  assert.equal(fixture.get('answer-voice-preview').hidden, true);
  assert.equal(fixture.get('answer-voice-transcribe').disabled, true);
});

test('invalid voice file changes and a new evidence mode discard the unconfirmed preview', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableAnswers(); fixture.app.enableVoice(); fixture.app.enableImages('visual'); fixture.app.openAnswers(['doc-one']);
  const bytes = new Uint8Array([3, 4, 5]); let calls = 0;
  fixture.get('answer-question').value = '保留的手工问题';
  fixture.app.setApi(async () => { calls++; return voiceReply(bytes); });
  chooseVoiceFile(fixture, new File([bytes], 'one.wav')); fixture.get('answer-voice-transcribe').dispatch('click'); await settleAnswer();
  assert.equal(fixture.get('answer-voice-preview').hidden, false);
  fixture.get('answer-voice-file').files = []; fixture.get('answer-voice-file').dispatch('change');
  assert.equal(fixture.get('answer-voice-preview').hidden, true); assert.equal(fixture.get('answer-voice-use').disabled, true);
  assert.match(fixture.get('answer-voice-error').textContent, /一个语音/u);
  chooseVoiceFile(fixture, new File([bytes], 'two.wav')); fixture.get('answer-voice-transcribe').dispatch('click'); await settleAnswer();
  fixture.get('answer-mode').value = 'visual'; fixture.get('answer-mode').dispatch('change');
  assert.equal(fixture.get('answer-mode').value, 'visual'); assert.equal(fixture.get('answer-voice-preview').hidden, true);
  assert.equal(fixture.get('answer-question').value, '保留的手工问题'); assert.equal(calls, 2);
});

function imageVectorReply(row, status = 'missing') {
  return { status, document_id: row.document_id, publication_id: row.index_publication_id, source_revision_id: row.active_revision_id,
    source_sha256: row.media_info.sha256, profile_fingerprint: 'b'.repeat(64), model_revision: 'java-image-embedding-v1:fixture', dimensions: 4,
    vector_generation_id: status === 'available' ? 'generation-one' : null, manifest_sha256: status === 'available' ? 'c'.repeat(64) : null };
}

test('saved image vector is read without model calls and explicit build preserves detail drafts', async () => {
  const data = summaryData('image'), calls = [];
  const fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  const saved = editUnsaved(fixture), originalForm = fixture.get('detail-form');
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return imageVectorReply(fixture.app.state.items[0], options.method === 'POST' ? 'available' : 'missing'); });
  fixture.app.enableImageVectors(); await settleAnswer();
  assert.ok(fixture.get('detail-image-vector'), 'image vector panel must exist');
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/documents/doc-one/image-vector');
  assert.equal(calls[0].options.method, undefined); saved();
  assert.match(fixture.get('detail-image-vector').textContent, /将调用/u);
  fixture.get('image-vector-build').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 2); assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.body, undefined);
  assert.match(fixture.get('detail-image-vector').textContent, /已就绪/u);
  assert.equal(fixture.get('detail-form'), originalForm); saved();
  assert.equal(fixture.get('image-vector-build'), null);
});

test('image vector build respects reader permission and leaving invalidates its late receipt', async () => {
  const data = summaryData('image');
  const reader = appFixture('indexing', task('indexing', 'indexed'), { ...data.item, can_edit: false });
  reader.app.setApi(async () => imageVectorReply(reader.app.state.items[0])); reader.app.enableImageVectors(); await settleAnswer();
  assert.ok(reader.get('detail-image-vector'), 'reader image vector panel must exist');
  assert.equal(reader.get('image-vector-build').disabled, true);
  let resolveBuild; const gate = { promise: new Promise(resolve => { resolveBuild = resolve; }), resolve: value => resolveBuild(value) };
  const fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  let posted = 0, signal;
  fixture.app.setApi(async (_path, options) => { if (options.method === 'POST') { posted++; signal = options.signal; return gate.promise; } return imageVectorReply(fixture.app.state.items[0]); });
  fixture.app.enableImageVectors(); await settleAnswer(); fixture.get('image-vector-build').dispatch('click'); fixture.get('image-vector-build').dispatch('click');
  assert.equal(posted, 1); fixture.app.showView('settings'); assert.equal(signal.aborted, true);
  gate.resolve(imageVectorReply(fixture.app.state.items[0], 'available')); await settleAnswer();
  assert.equal(fixture.app.vectorSession.value.phase, 'idle'); assert.equal(fixture.app.vectorSession.value.vector, null);
});

test('stopping image vector waiting preserves an unknown server outcome until explicit refresh', async () => {
  const data = summaryData('image'), fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  let deliver, signal, posts = 0, reads = 0;
  fixture.app.setApi(async (_path, options) => {
    if (options.method === 'POST') { posts++; signal = options.signal; return new Promise(resolve => { deliver = resolve; }); }
    reads++; return imageVectorReply(fixture.app.state.items[0], reads > 1 ? 'available' : 'missing');
  });
  fixture.app.enableImageVectors(); await settleAnswer(); fixture.get('image-vector-build').dispatch('click');
  fixture.get('detail-image-vector').querySelectorAll('button').find(node => node.textContent === '停止等待').dispatch('click');
  assert.equal(signal.aborted, true); assert.equal(posts, 1); assert.equal(reads, 1);
  assert.match(fixture.get('detail-image-vector').textContent, /服务器可能仍在处理/u);
  assert.doesNotMatch(fixture.get('detail-image-vector').textContent, /尚未建立/u);
  assert.equal(fixture.get('image-vector-build'), null);
  fixture.get('image-vector-refresh').dispatch('click'); await settleAnswer();
  assert.equal(posts, 1); assert.equal(reads, 2); assert.match(fixture.get('detail-image-vector').textContent, /已就绪/u);
  deliver(imageVectorReply(fixture.app.state.items[0], 'available')); await settleAnswer();
  assert.equal(fixture.app.vectorSession.value.phase, 'ready'); assert.equal(posts, 1);
});

function audioVectorReply(row, status = 'missing') {
  return { status, document_id: row.document_id, publication_id: row.index_publication_id, source_revision_id: row.active_revision_id,
    source_sha256: row.media_info.sha256, profile_fingerprint: 'b'.repeat(64), model_revision: 'java-audio-embedding-v1:fixture', dimensions: 4,
    vector_generation_id: status === 'available' ? 'generation-one' : null, manifest_sha256: status === 'available' ? 'c'.repeat(64) : null };
}

test('saved audio vector is read without model calls and explicit build preserves detail drafts', async () => {
  const data = summaryData('audio'), calls = [];
  const fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  const saved = editUnsaved(fixture), originalForm = fixture.get('detail-form');
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return audioVectorReply(fixture.app.state.items[0], options.method === 'POST' ? 'available' : 'missing'); });
  fixture.app.enableAudioVectors(); await settleAnswer();
  assert.ok(fixture.get('detail-audio-vector'), 'audio vector panel must exist');
  fixture.app.enableImageVectors(); await settleAnswer();
  assert.equal(fixture.get('detail-image-vector').hidden, true);
  assert.equal(fixture.get('detail-audio-vector').hidden, false);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/documents/doc-one/audio-vector');
  assert.equal(calls[0].options.method, undefined); saved();
  assert.match(fixture.get('detail-audio-vector').textContent, /将调用/u);
  fixture.get('audio-vector-build').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 2); assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.body, undefined);
  assert.match(fixture.get('detail-audio-vector').textContent, /已就绪/u);
  assert.equal(fixture.get('detail-form'), originalForm); saved();
  assert.equal(fixture.get('audio-vector-build'), null);
});

test('audio vector build respects reader permission and leaving invalidates its late receipt', async () => {
  const data = summaryData('audio');
  const reader = appFixture('indexing', task('indexing', 'indexed'), { ...data.item, can_edit: false });
  reader.app.setApi(async () => audioVectorReply(reader.app.state.items[0])); reader.app.enableAudioVectors(); await settleAnswer();
  assert.ok(reader.get('detail-audio-vector'), 'reader audio vector panel must exist');
  assert.equal(reader.get('audio-vector-build').disabled, true);
  let resolveBuild; const gate = { promise: new Promise(resolve => { resolveBuild = resolve; }), resolve: value => resolveBuild(value) };
  const fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  let posted = 0, signal;
  fixture.app.setApi(async (_path, options) => { if (options.method === 'POST') { posted++; signal = options.signal; return gate.promise; } return audioVectorReply(fixture.app.state.items[0]); });
  fixture.app.enableAudioVectors(); await settleAnswer(); fixture.get('audio-vector-build').dispatch('click'); fixture.get('audio-vector-build').dispatch('click');
  assert.equal(posted, 1); fixture.app.showView('settings'); assert.equal(signal.aborted, true);
  gate.resolve(audioVectorReply(fixture.app.state.items[0], 'available')); await settleAnswer();
  assert.equal(fixture.app.audioVectorSession.value.phase, 'idle'); assert.equal(fixture.app.audioVectorSession.value.vector, null);
});

test('stopping audio vector waiting preserves an unknown server outcome until explicit refresh', async () => {
  const data = summaryData('audio'), fixture = appFixture('indexing', task('indexing', 'indexed'), data.item);
  let deliver, signal, posts = 0, reads = 0;
  fixture.app.setApi(async (_path, options) => {
    if (options.method === 'POST') { posts++; signal = options.signal; return new Promise(resolve => { deliver = resolve; }); }
    reads++; return audioVectorReply(fixture.app.state.items[0], reads > 1 ? 'available' : 'missing');
  });
  fixture.app.enableAudioVectors(); await settleAnswer(); fixture.get('audio-vector-build').dispatch('click');
  fixture.get('detail-audio-vector').querySelectorAll('button').find(node => node.textContent === '停止等待').dispatch('click');
  assert.equal(signal.aborted, true); assert.equal(posts, 1); assert.equal(reads, 1);
  assert.match(fixture.get('detail-audio-vector').textContent, /服务器可能仍在处理/u);
  assert.doesNotMatch(fixture.get('detail-audio-vector').textContent, /尚未建立/u);
  assert.equal(fixture.get('audio-vector-build'), null);
  fixture.get('audio-vector-refresh').dispatch('click'); await settleAnswer();
  assert.equal(posts, 1); assert.equal(reads, 2); assert.match(fixture.get('detail-audio-vector').textContent, /已就绪/u);
  deliver(audioVectorReply(fixture.app.state.items[0], 'available')); await settleAnswer();
  assert.equal(fixture.app.audioVectorSession.value.phase, 'ready'); assert.equal(posts, 1);
});

function soundIndexReply(item, status = 'missing') {
  return { status, document_id: item.document_id, source_revision_id: 'source-sound-one', source_sha256: item.media_info.sha256,
    profile_fingerprint: 'b'.repeat(64), model_revision: 'sound-v1', embedding_model_revision: 'sound-embedding-v1', dimensions: 4,
    publication_id: status === 'available' ? 'sound-publication' : null, generation_id: status === 'available' ? 'sound-generation' : null,
    manifest_sha256: status === 'available' ? 'c'.repeat(64) : null, span_count: status === 'available' ? 3 : 0 };
}

test('sound index accepts a saved unindexed audio and preserves the actual detail form on explicit build', async () => {
  const data = summaryData('audio'), fixture = appFixture('ingestion', task('ingestion', 'failed'), { ...data.item,
    active_revision_id: null, registered_revision_id: 'source-sound-one', index_publication_id: null, index_status: 'not_indexed', status: 'ready', latest_job: null, latest_index_job: null });
  const saved = editUnsaved(fixture), form = fixture.get('detail-form'), calls = [];
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return soundIndexReply(fixture.app.state.items[0], options.method === 'POST' ? 'available' : 'missing'); });
  fixture.app.enableSound(); await settleAnswer();
  assert.ok(fixture.get('detail-sound-index'), 'genuine original must have an independent sound panel');
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/documents/doc-one/sound-index');
  assert.match(fixture.get('detail-sound-index').textContent, /全部.*窗口|全部.*分段/u); saved();
  fixture.get('sound-index-build').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 2); assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.body, undefined);
  assert.match(fixture.get('detail-sound-index').textContent, /已就绪/u); assert.equal(fixture.get('detail-form'), form); saved();
});

test('standalone sound publication never opens speech vector or synopsis paths through its generic indexed row', async () => {
  const data = summaryData('audio'), fixture = appFixture('ingestion', task('ingestion', 'failed'), { ...data.item,
    active_revision_id: 'source-sound-one', registered_revision_id: 'source-sound-one', index_publication_id: 'sound-publication',
    latest_job: null, latest_index_job: null, index_status: 'indexed', status: 'parsed' });
  const calls = [];
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return soundIndexReply(fixture.app.state.items[0], 'available'); });
  fixture.app.enableAudioVectors(); fixture.app.enableSynopsis(); fixture.app.enableSound(); await settleAnswer();
  assert.deepEqual(calls.map(call => call.path), ['/v1/documents/doc-one/sound-index']);
  assert.equal(fixture.get('detail-audio-vector').hidden, true);
  assert.equal(fixture.get('synopsis-create'), null);
  assert.match(fixture.get('detail-synopsis').textContent, /声音资料.*摘要/u);
});

test('pure sound upload is an explicit separate choice while old audio remains transcription', () => {
  const fixture = appFixture('ingestion'); fixture.app.enableMedia(); fixture.app.enableSound(); fixture.get('upload').dispatch('click');
  const choices = fixture.get('upload-kind').options.map(option => [option.value, option.textContent]);
  assert.ok(choices.some(([value, label]) => value === 'sound' && label.includes('声音')));
  assert.ok(choices.some(([value]) => value === 'audio'));
  fixture.get('upload-kind').value = 'sound'; fixture.get('upload-kind').dispatch('change');
  assert.match(fixture.get('upload-file').accept, /\.wav/u); assert.doesNotMatch(fixture.get('upload-file').accept, /\.mov/u);
});

test('actual sound upload saves one original then rereads the authorized row and opens details without an ASR task', async () => {
  const fixture = appFixture('ingestion'); fixture.app.enableSound();
  const file = new File([Uint8Array.of(0, 255, 128)], '原声音 + 完整.wav');
  const sourceSha = createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
  const item = { ...fixture.app.state.items[0], document_id: 'sound-uploaded', filename: file.name, document_type: 'audio',
    status: 'ready', index_status: 'not_indexed', active_revision_id: null, registered_revision_id: 'source-sound-one',
    latest_job: null, latest_index_job: null, media_info: { mime_type: 'audio/wav', size_bytes: file.size, sha256: sourceSha } };
  const calls = [];
  fixture.app.setApi(async (path, options) => {
    calls.push({ path, options });
    if (path === '/v1/sound-documents') return { document_id: item.document_id, source_revision_id: item.registered_revision_id, source_sha256: sourceSha, size_bytes: file.size };
    if (path.startsWith('/v1/management/documents?')) return { items: [item], total: 1, total_pages: 1 };
    if (path.endsWith('/sound-index')) return soundIndexReply(item);
    if (path === '/v1/management/folders' || path === '/v1/management/tags') return { items: [] };
    assert.fail(`unexpected upload follow-up ${path}`);
  });
  fixture.get('upload').dispatch('click'); fixture.get('upload-kind').value = 'sound'; fixture.get('upload-kind').dispatch('change');
  assert.equal(fixture.get('dialog-submit').textContent, '保存原声音资料');
  fixture.get('upload-file').files = [file]; fixture.get('dialog-form').dispatch('submit');
  await settleAnswer();
  assert.equal(calls[0].path, '/v1/sound-documents'); assert.equal(calls[0].options.file, file); assert.equal(calls[0].options.uploadKind, 'sound');
  assert.equal(fixture.app.state.task, null); assert.equal(fixture.app.state.indexTask, null);
  assert.equal(fixture.app.state.detail.document_id, 'sound-uploaded'); assert.equal(fixture.get('details').open, true);
  assert.equal(fixture.get('view-documents').hidden, false);
  assert.match(fixture.get('operation-feedback').textContent, /原声音资料已保存/u);
  assert.ok(calls.some(call => call.path === '/v1/documents/sound-uploaded/sound-index' && call.options.method === undefined));
  assert.equal(calls.filter(call => call.options?.method === 'POST').length, 1);
});

test('sound answer uses the complete scope and plays audio with sound facts rather than ASR quote', async () => {
  const fixture = appFixture('indexing'); fixture.app.enableSound();
  fixture.app.openAnswers(['doc-one', 'unpublished']);
  assert.equal(fixture.get('answer-mode').value, 'sound');
  const bytes = new Uint8Array([7, 8, 9]), sourceSha = createHash('sha256').update(bytes).digest('hex');
  const facts = ['末段有高频提示音。'], factsSha = createHash('sha256').update(JSON.stringify(facts)).digest('hex');
  const citation = { number: 1, kind: 'sound_span', document_id: 'doc-one', revision_id: 'source-one', source_sha256: sourceSha,
    publication_id: 'sound-publication', profile_fingerprint: 'b'.repeat(64), decoder_revision: 'pcm-v1', pcm_sha256: 'd'.repeat(64),
    filename: 'sound.wav', media_type: 'audio/wav', start_sample: 24000, end_sample: 40000, sample_rate: 16000, start_ms: 1500, end_ms: 2500,
    facts, facts_sha256: factsSha, analysis_model_revision: 'sound-v1', policy_revision: 'java-sound-answer-v1', time_precision: 'server_window',
    source_url: '/v1/sound-sources/sound-answer/1', content_url: '/v1/sound-sources/sound-answer/1/content' };
  const calls = []; fixture.app.setApi(async (path, options) => {
    calls.push({ path, options }); if (path.endsWith('answers')) return { answer_id: 'sound-answer', status: 'answered', answer: facts[0],
      reason_code: null, citations: [citation], policy_revision: 'java-sound-answer-v1' };
    if (path.endsWith('/content')) return new Blob([bytes], { type: 'audio/wav' });
    return { answer_id: 'sound-answer', citation };
  });
  fixture.get('answer-question').value = '末段有什么声音？'; fixture.get('answer-form').dispatch('submit'); await settleAnswer();
  assert.equal(calls[0].path, '/v1/sound-answers'); assert.deepEqual(calls[0].options.body.document_ids, ['doc-one', 'unpublished']);
  fixture.get('answer-citations').querySelector('button').dispatch('click'); await new Promise(resolve => setTimeout(resolve, 20));
  const panel = fixture.get('source-media-panel'), player = panel.querySelector('audio'); assert.ok(player); assert.equal(panel.querySelector('video'), null);
  assert.match(panel.textContent, /声音模型判断/u); assert.doesNotMatch(panel.textContent, /音频转录/u);
  assert.equal(fixture.get('source-quote').textContent, facts[0]); assert.match(fixture.get('source-metadata').textContent, /声音模型/u);
  player.dispatch('loadedmetadata'); assert.equal(player.currentTime, 1.5);
  panel.querySelectorAll('button').find(button => button.textContent === '播放此引用片段').dispatch('click'); await settleAnswer();
  player.currentTime = 2.5; player.dispatch('timeupdate'); assert.equal(player.paused, true);
  fixture.app.showView('documents'); assert.equal(player.src, ''); assert.equal(panel.hidden, true);
});

function videoAvIndexReply(item, status = 'missing') {
  return { status, document_id: item.document_id, source_revision_id: item.registered_revision_id ?? item.active_revision_id,
    source_sha256: item.media_info.sha256, profile_fingerprint: 'b'.repeat(64), model_revision: 'av-model-v1', embedding_model_revision: 'av-embed-v1',
    dimensions: 4, publication_id: status === 'available' ? 'av-publication' : null, generation_id: status === 'available' ? 'av-publication' : null,
    manifest_sha256: status === 'available' ? 'c'.repeat(64) : null, window_count: status === 'available' ? 3 : 0,
    video_window_count: status === 'available' ? 2 : 0, audio_window_count: status === 'available' ? 3 : 0 };
}

test('actual video AV detail builds complete original media while preserving the unsaved form', async () => {
  const data = summaryData('video'), fixture = appFixture('ingestion', task('ingestion', 'failed'), { ...data.item,
    active_revision_id: null, registered_revision_id: 'source-av-one', index_publication_id: null, index_status: 'not_indexed', status: 'ready', latest_job: null, latest_index_job: null });
  const saved = editUnsaved(fixture), form = fixture.get('detail-form'), calls = [];
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return videoAvIndexReply(fixture.app.state.items[0], options.method === 'POST' ? 'available' : 'missing'); });
  fixture.app.enableVideoAv(); await settleAnswer();
  assert.deepEqual(calls.map(call => call.path), ['/v1/documents/doc-one/video-av-index']);
  assert.match(fixture.get('detail-video-av-index').textContent, /完整连续画面.*原声/u); saved();
  fixture.get('video-av-index-build').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 2); assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.body, undefined);
  assert.match(fixture.get('detail-video-av-index').textContent, /2个含画面.*3个含声音/u); assert.equal(fixture.get('detail-form'), form); saved();
});

test('standalone video AV indexed row exposes independent index without opening the old synopsis', async () => {
  const data = summaryData('video'), fixture = appFixture('ingestion', task('ingestion', 'failed'), { ...data.item,
    active_revision_id: 'source-av-one', registered_revision_id: 'source-av-one', index_publication_id: 'av-publication',
    latest_job: null, latest_index_job: null, index_status: 'indexed', status: 'parsed' });
  const calls = [];
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return videoAvIndexReply(fixture.app.state.items[0], 'available'); });
  fixture.app.enableSynopsis(); fixture.app.enableVideoAv(); await settleAnswer();
  assert.deepEqual(calls.map(call => call.path), ['/v1/documents/doc-one/video-av-index']);
  assert.equal(fixture.get('synopsis-create'), null); assert.match(fixture.get('detail-synopsis').textContent, /原视频资料.*摘要/u);
});

test('actual video AV raw upload opens the saved original and creates no ASR task', async () => {
  const fixture = appFixture('ingestion'); fixture.app.enableVideoAv();
  const file = new File([Uint8Array.of(0, 255, 128)], '原片 + 完整.mp4');
  const sourceSha = createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
  const item = { ...fixture.app.state.items[0], document_id: 'av-uploaded', filename: file.name, document_type: 'video',
    status: 'ready', index_status: 'not_indexed', active_revision_id: null, registered_revision_id: 'source-av-one',
    latest_job: null, latest_index_job: null, media_info: { mime_type: 'video/mp4', size_bytes: file.size, sha256: sourceSha } };
  const calls = [];
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/v1/video-av-documents') return { document_id: item.document_id, source_revision_id: item.registered_revision_id, source_sha256: sourceSha, size_bytes: file.size };
    if (path.startsWith('/v1/management/documents?')) return { items: [item], total: 1, total_pages: 1 };
    if (path === '/v1/documents/av-uploaded/video-av-index') return videoAvIndexReply(item);
    if (path === '/v1/management/folders' || path === '/v1/management/tags') return { items: [] };
    throw new Error(`Unexpected AV path: ${path}`);
  });
  fixture.get('upload').dispatch('click');
  const choices = fixture.get('upload-kind').options.map(option => option.value); assert.ok(choices.includes('video-av'));
  fixture.get('upload-kind').value = 'video-av'; fixture.get('upload-kind').dispatch('change');
  assert.equal(fixture.get('dialog-submit').textContent, '保存原视频资料'); assert.match(fixture.get('upload-file').accept, /\.mov/u);
  fixture.get('upload-file').files = [file]; fixture.get('dialog-form').dispatch('submit'); await settleAnswer();
  assert.equal(calls[0].path, '/v1/video-av-documents'); assert.equal(calls[0].options.file, file);
  assert.equal(calls[0].options.uploadKind, 'video-av'); assert.equal(fixture.app.state.detail.document_id, 'av-uploaded');
  assert.equal(fixture.app.state.task, null); assert.equal(fixture.app.state.indexTask, null); assert.equal(item.latest_job, null);
});

test('actual AV question renders joint facts and plays the checked original at the server window', async () => {
  const fixture = appFixture('ingestion'); fixture.app.enableVideoAv();
  const facts = [{ id: '1'.repeat(64), text: '杯子是红色。', requirement: 'VISUAL', visual_contribution: true, audio_contribution: false },
    { id: '2'.repeat(64), text: '有持续提示音。', requirement: 'AUDIO', visual_contribution: false, audio_contribution: true }];
  const original = new Blob(['synthetic-original-video'], { type: 'video/mp4' });
  const sourceSha = createHash('sha256').update(new Uint8Array(await original.arrayBuffer())).digest('hex');
  const citation = { number: 1, kind: 'video_av_window', mode: 'JOINT', document_id: 'doc-one', revision_id: 'source-av-one', source_sha256: sourceSha,
    publication_id: 'av-publication', profile_fingerprint: 'b'.repeat(64), decoder_revision: 'av-decoder-v1', filename: 'motion.mp4', media_type: 'video/mp4',
    epoch: { pts: '32000', time_base_num: '1', time_base_den: '16000', ticks_per_second: '16000' },
    window: { id: 'window-one', ordinal: 1, start_tick: '32000', end_tick: '48000', start_ms: 2000, end_ms: 3000,
      video: { clip_sha256: 'd'.repeat(64), frame_count: 8, frames_manifest_sha256: 'e'.repeat(64), first_local_tick: '0', end_local_tick: '16000' },
      audio: { pcm_sha256: 'f'.repeat(64), wav_sha256: '0'.repeat(64), start_sample: '32000', end_sample: '48000', sample_rate: 16000 } },
    facts, facts_sha256: createHash('sha256').update(JSON.stringify(facts)).digest('hex'), analysis_model_revision: 'av-model-v1', policy_revision: 'java-video-av-answer-v1',
    time_precision: 'server_window', source_url: '/v1/video-av-sources/answer-av/1', content_url: '/v1/video-av-sources/answer-av/1/content' };
  const calls = [];
  fixture.app.setApi(async (path, options = {}) => { calls.push({ path, options }); return path.endsWith('/content') ? original : path === citation.source_url
    ? { answer_id: 'answer-av', citation } : { answer_id: 'answer-av', status: 'answered', mode: 'JOINT', answer: facts.map(fact => fact.text).join('\n'), reason_code: null, citations: [citation], policy_revision: citation.policy_revision }; });
  fixture.app.openAnswers(['doc-one', 'unindexed']); fixture.get('answer-mode').value = 'video-av-joint'; fixture.get('answer-mode').dispatch('change');
  fixture.get('answer-question').value = '完整原问题'; fixture.get('answer-form').dispatch('submit'); await settleAnswer();
  assert.equal(calls[0].path, '/v1/video-av-answers'); assert.deepEqual(Array.from(calls[0].options.body.document_ids), ['doc-one', 'unindexed']);
  assert.equal(calls[0].options.body.mode, 'JOINT'); assert.equal(fixture.get('answer-attachment-files').disabled, true);
  assert.match(fixture.get('answer-citations').textContent, /0:02\.000.*0:03\.000/u);
  await fixture.app.answerSession.readSource(1); await settleAnswer();
  const player = fixture.get('source-media-panel').querySelector('video'); assert.ok(player); player.dispatch('loadedmetadata'); assert.equal(player.currentTime, 2);
  assert.match(fixture.get('source-quote').textContent, /杯子是红色.*提示音/su); assert.match(fixture.get('source-metadata').textContent, /8个实际连续帧/u);
  fixture.app.navigate('documents'); assert.equal(player.paused, true); assert.equal(player.src, '');
});

// 0019: actual app functions, existing DOM harness, complete raw-video query receipts.
const videoQueryRefusal = (body, prepared = true) => ({ mode: body.mode,
  result: { answer_id: 'answer-reference', status: 'abstained', mode: body.mode, answer: '库内资料不足以回答完整问题。',
    reason_code: prepared ? 'no_evidence' : 'empty_scope', citations: [], policy_revision: 'java-video-av-answer-v1' },
  query_attachments: body.attachments.map((item, ordinal) => ({ ordinal, media_kind: 'video', used_mode: body.mode,
    source_sha256: createHash('sha256').update(Buffer.from(item.content_base64, 'base64')).digest('hex'),
    compiler_revision: 'java-video-av-decoder-v1:pinned', content_sha256: prepared ? 'a'.repeat(64) : null,
    window_count: prepared ? 3 : null, visual_window_count: prepared ? 2 : null, audio_window_count: prepared ? 3 : null,
    audio_present: prepared ? true : null, status: prepared ? 'prepared' : 'not_prepared' })) });
async function settleVideoQuery(fixture) {
  for (let count = 0; count < 100 && fixture.app.answerSession.value.phase === 'loading'; count++) await new Promise(resolve => setImmediate(resolve));
  assert.notEqual(fixture.app.answerSession.value.phase, 'loading');
}

test('actual AV reference controls require the independent capability and preserve the complete selected scope', async () => {
  const fixture = appFixture('ingestion'); fixture.app.enableVideoAv(); fixture.app.enableAttachments(); fixture.app.openAnswers(['doc-one', 'missing-index']);
  fixture.get('answer-mode').value = 'video-av-joint'; fixture.get('answer-mode').dispatch('change');
  assert.equal(fixture.get('answer-attachment-files').disabled, true);
  fixture.app.enableVideoAvQueries(); assert.equal(fixture.get('answer-attachment-files').disabled, false);
  assert.equal(fixture.get('answer-attachment-kind').value, 'video'); assert.equal(fixture.get('answer-attachment-kind').disabled, true);
  assert.equal(fixture.get('answer-attachment-files').accept, '.mp4,.mov,.webm,.mkv');
  assert.match(fixture.get('answer-attachment-help').textContent, /原声|连续/u); assert.match(fixture.get('answer-attachment-help').textContent, /缺音轨/u);
  chooseQueryFile(fixture, 'first.mp4', 'video'); chooseQueryFile(fixture, 'tail.webm', 'video');
  fixture.get('answer-question').value = '  完整问题\n尾部  '; fixture.get('answer-question').dispatch('input');
  const calls = []; fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return videoQueryRefusal(options.body); });
  fixture.get('answer-form').dispatch('submit'); fixture.get('answer-form').dispatch('submit'); await settleVideoQuery(fixture);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/video-av-query-answers');
  assert.deepEqual(Array.from(calls[0].options.body.document_ids), ['doc-one', 'missing-index']);
  assert.equal(calls[0].options.body.question, '  完整问题\n尾部  '); assert.equal(calls[0].options.body.mode, 'JOINT');
  assert.equal(calls[0].options.body.attachments.length, 2); assert.equal(fixture.get('answer-question').value, '  完整问题\n尾部  ');
  assert.match(fixture.get('answer-attachment-status').textContent, /first.mp4.*3.*tail.webm.*3/su);
  assert.equal(fixture.get('answer-citations').children.length, 0); assert.equal(fixture.get('answer-attachment-list').children.length, 2);
  fixture.app.navigate('documents'); assert.equal(fixture.get('answer-attachment-list').children.length, 0);
});

test('actual AV reference empty selection keeps not-prepared inputs visible without a partial-success notice', async () => {
  const fixture = appFixture('ingestion'); fixture.app.enableVideoAv(); fixture.app.enableVideoAvQueries(); fixture.app.openAnswers([]);
  fixture.get('answer-mode').value = 'video-av-audio'; fixture.get('answer-mode').dispatch('change'); chooseQueryFile(fixture, '<original>.mp4', 'video');
  fixture.get('answer-question').value = '完整问题'; let body;
  fixture.app.setApi(async (_path, options) => { body = options.body; return videoQueryRefusal(body, false); });
  fixture.get('answer-form').dispatch('submit'); await settleVideoQuery(fixture);
  assert.deepEqual(Array.from(body.document_ids), []); assert.equal(fixture.app.answerSession.value.phase, 'abstained');
  assert.match(fixture.get('answer-attachment-status').textContent, /<original>.mp4.*未完成/u);
  assert.doesNotMatch(fixture.get('answer-attachment-status').textContent, /undefined|已处理|采样/u);
  assert.equal(fixture.get('answer-attachment-list').children.length, 1);
});

test('actual AV reference invalidates file reads on mode, question, scope, identity, removal and cancellation', async () => {
  for (const action of ['mode', 'question', 'scope', 'identity', 'remove', 'cancel']) {
    const fixture = appFixture('ingestion'); fixture.app.enableVideoAv(); fixture.app.enableVideoAvQueries(); fixture.app.openAnswers(['doc-one']);
    fixture.get('answer-mode').value = 'video-av-joint'; fixture.get('answer-mode').dispatch('change');
    let release, calls = 0; const original = new File(['complete original'], 'reference.mp4');
    original.arrayBuffer = () => new Promise(resolve => { release = resolve; });
    fixture.get('answer-attachment-files').files = [original]; fixture.get('answer-attachment-files').dispatch('change');
    fixture.app.setApi(async () => { calls++; }); fixture.get('answer-question').value = '旧问题'; fixture.get('answer-form').dispatch('submit');
    assert.equal(fixture.app.answerSession.value.phase, 'loading');
    if (action === 'mode') { fixture.get('answer-mode').value = 'video-av-visual'; fixture.get('answer-mode').dispatch('change'); }
    else if (action === 'question') { fixture.get('answer-question').value = '新问题'; fixture.get('answer-question').dispatch('input'); }
    else if (action === 'scope') fixture.app.openAnswers([]);
    else if (action === 'identity') fixture.app.resetContext({ identity: true });
    else if (action === 'remove') fixture.get('answer-attachment-list').querySelector('button').dispatch('click');
    else fixture.get('answer-cancel').dispatch('click');
    release(new TextEncoder().encode('complete original').buffer); await settleAnswer();
    assert.equal(calls, 0, action); assert.equal(fixture.app.answerSession.value.phase, 'idle', action);
    if (action === 'question') assert.equal(fixture.get('answer-question').value, '新问题');
    if (action === 'identity') assert.equal(fixture.get('answer-attachment-list').children.length, 0);
  }
});

const cleanupReceipt = (id = 'doc-one', status = 'pending') => ({document_id:id,cleanup_id:'cleanup-one',status:status==='completed'?'deleted':'deleting',cleanup_status:status,requested_at:'2026-10-03T00:00:00Z',updated_at:'2026-10-03T00:00:00Z',completed_at:status==='completed'?'2026-10-03T00:01:00Z':null,error_code:status==='blocked'?'cleanup_blocked':null,
  resources:['database_payload','database_file','managed_backups','managed_temporaries','remote_inventory','remote_logical_rows','remote_write_terminal','remote_physical_storage','restore_barrier'].map(kind=>({kind,status:status==='completed'?'completed':'pending'}))});

test('cleanup detail explicitly confirms, protects dirty draft and keeps accepted records after disappearance', async () => {
  const fixture=appFixture('ingestion',task('ingestion','parsed'));const calls=[];fixture.app.enableCleanup();
  fixture.app.setApi(async(path,options)=>{calls.push({path,options});if(path.endsWith('/cleanup'))return cleanupReceipt();if(path.startsWith('/v1/management/documents?'))return {items:[],total:0,total_pages:0};return {items:[]};});
  assert.equal(fixture.get('detail-cleanup').disabled,false);assert.equal(fixture.get('cleanup-records').hidden,false);
  const draft=fixture.get('detail-name');draft.value='未保存草稿';fixture.get('detail-cleanup').dispatch('click');assert.equal(fixture.get('edit-dialog').open,false);assert.equal(calls.length,0);assert.equal(draft.value,'未保存草稿');
  fixture.app.setConfirm(()=>true);fixture.get('detail-cleanup').dispatch('click');assert.equal(fixture.get('edit-dialog').open,true);assert.equal(calls.length,0);fixture.get('dialog-cancel').dispatch('click');assert.equal(calls.length,0);assert.equal(draft.value,'未保存草稿');
  fixture.get('detail-cleanup').dispatch('click');fixture.get('dialog-form').dispatch('submit');await settleAnswer();
  assert.equal(calls.filter(call=>call.options?.method==='POST').length,1);assert.equal(calls[0].options.body,undefined);
  assert.equal(fixture.app.state.detail,null);assert.equal(fixture.app.state.mutating,false);assert.match(fixture.get('cleanup-items').textContent,/待完成/u);assert.doesNotMatch(fixture.get('feedback-items').textContent,/已完成/u);
});
test('cleanup batch sends the captured complete selection and exposes each independent disposition', async () => {
  const fixture=appFixture('ingestion',task('ingestion','parsed'));fixture.app.enableCleanup();fixture.app.state.items.push({...fixture.app.state.items[0],document_id:'doc-reader',can_edit:false,latest_job:null,latest_index_job:null});fixture.app.state.selected.add('doc-one');fixture.app.state.selected.add('doc-reader');fixture.app.renderControls();const calls=[];
  fixture.app.setApi(async(path,options)=>{calls.push({path,options});if(path==='/v1/management/document-cleanups')return {items:[{document_id:'doc-one',status:'accepted',cleanup:cleanupReceipt(),error_code:null},{document_id:'doc-reader',status:'not_found',cleanup:null,error_code:'not_found'}],total:2};if(path.startsWith('/v1/management/documents?'))return {items:[],total:0,total_pages:0};return {items:[]};});
  fixture.get('batch-cleanup').dispatch('click');assert.match(fixture.get('dialog-description').textContent,/doc-one、doc-reader/u);fixture.get('dialog-form').dispatch('submit');await settleAnswer();
  assert.equal(calls[0].options.body.document_ids.join(','),'doc-one,doc-reader');assert.match(fixture.get('feedback-items').textContent,/待完成/u);assert.match(fixture.get('feedback-items').textContent,/无管理权限/u);assert.equal(fixture.app.state.selected.size,0);
});
test('cleanup unknown state remains refreshable after row loss and identity reset rejects a late receipt',async()=>{
  const fixture=appFixture('ingestion',task('ingestion','parsed'));fixture.app.enableCleanup();fixture.app.setApi(async()=>{throw new ApiError(504,'timeout');});fixture.get('detail-cleanup').dispatch('click');fixture.get('dialog-form').dispatch('submit');await settleAnswer();assert.match(fixture.get('cleanup-items').textContent,/结果未知/u);assert.equal(fixture.app.state.mutating,false);
  fixture.app.setApi(async()=>{throw new ApiError(404,'not found');});fixture.get('cleanup-items').querySelector('button').dispatch('click');await settleAnswer();assert.match(fixture.get('cleanup-items').textContent,/结果未知/u);assert.doesNotMatch(fixture.get('cleanup-items').textContent,/已完成/u);
  fixture.app.cleanupSession.close();let finish;fixture.app.setApi(()=>new Promise(resolve=>{finish=resolve;}));const pending=fixture.app.cleanupSession.requestOne('doc-one');fixture.app.resetContext({identity:true});finish(cleanupReceipt('doc-one','completed'));await pending;assert.equal(fixture.app.cleanupSession.value.records.length,0);assert.doesNotMatch(fixture.get('cleanup-items').textContent,/已完成/u);
});
test('cleanup readers and missing capability cannot create controls while records read does not lose a draft',async()=>{
  const reader=appFixture('ingestion',task('ingestion','parsed'),{can_edit:false});assert.equal(reader.get('detail-cleanup').hidden,true);reader.app.enableCleanup();assert.equal(reader.get('detail-cleanup').disabled,true);
  const fixture=appFixture('ingestion',task('ingestion','parsed'));fixture.app.enableCleanup();const draft=fixture.get('detail-name');draft.value='保持草稿';fixture.app.setApi(async()=>({items:[cleanupReceipt('removed-one','blocked')],total:1,page:1,page_size:20}));fixture.get('cleanup-refresh').dispatch('click');await settleAnswer();assert.equal(fixture.get('detail-name'),draft);assert.equal(draft.value,'保持草稿');assert.match(fixture.get('cleanup-items').textContent,/受阻/u);assert.equal(fixture.app.state.mutating,false);
});

// Incremental append-only cases for ui-tests/task-detail.test.mjs; reuse its existing fixture.
function retrievalScopeFixture() {
  const fixture = appFixture('ingestion', task('ingestion', 'parsed'));
  fixture.app.configureModelSetupOnly();
  fixture.app.enableModelSetup();
  fixture.app.closeDetailPanel(); fixture.app.openDetail('doc-one');
  return fixture;
}

function retrievalScopeQuestion(fixture) {
  fixture.get('answer-question').value = '完整预算问题';
  fixture.get('answer-question').dispatch('input');
  fixture.get('retrieval-count').value = '5';
  fixture.get('retrieval-rerank').value = 'false';
}

function retrievalScopeEmpty(count) {
  return { test_id: '00000000-0000-0000-0000-000000000003', configuration_version: 1,
    status: 'empty', reason: count ? 'no_matches' : 'empty_scope', scope_count: count,
    score_kind: 'rrf', matches: [] };
}

test('retrieval-only row opens its exact unpublished scope without generating or automatically testing', async () => {
  const fixture = retrievalScopeFixture(), calls = [];
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return retrievalScopeEmpty(1); });
  assert.equal(fixture.app.state.items[0].active_revision_id, null);
  assert.equal(fixture.app.state.items[0].can_answer, false);
  const scope = fixture.get('document-rows').querySelectorAll('button')
    .find(node => node.dataset.answerDocument === 'doc-one');
  assert.ok(scope, 'retrieval_test alone must expose the document scope entry');
  assert.equal(scope.textContent, '测试召回');
  assert.equal(scope.disabled, false);
  scope.dispatch('click');
  assert.equal(fixture.get('view-answers').hidden, false);
  assert.match(fixture.get('answer-scope-label').textContent, /仅所选 1 份/u);
  assert.equal(calls.length, 0, 'choosing a scope must not send any request');
  retrievalScopeQuestion(fixture);
  assert.equal(fixture.get('answer-question').disabled, false);
  assert.equal(fixture.get('retrieval-run').disabled, false);
  assert.equal(fixture.get('answer-submit').disabled, true);
  assert.match(fixture.get('answer-availability').textContent, /召回/u);
  assert.match(fixture.get('answer-availability').textContent, /不生成/u);
  fixture.get('answer-form').dispatch('submit');
  assert.equal(calls.length, 0, 'disabled answering remains independently guarded');
  fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/retrieval-tests');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), {
    question: '完整预算问题', document_ids: ['doc-one'], top_k: 5, rerank: false });
  assert.equal(fixture.app.retrievalSession.value.phase, 'ready');
  assert.equal(fixture.get('retrieval-continue').disabled, true);
});

test('retrieval-only batch keeps every selected ID and explicit all-scope switching discards a late fixed result', async () => {
  const fixture = retrievalScopeFixture(), calls = [];
  const unpublished = row('ingestion', task('ingestion', 'processing', {
    task_id: 'ingestion-unpublished', document_id: 'doc-unpublished', revision_id: 'rev-unpublished' }),
  { display_name: '未发布的尾项' });
  fixture.app.state.items.push(unpublished);
  fixture.app.state.select('doc-one', true); fixture.app.state.select('doc-unpublished', true);
  fixture.app.renderRows(); fixture.app.renderControls();
  let deliver, fixedSignal;
  fixture.app.setApi(async (path, options) => {
    calls.push({ path, options });
    assert.equal(path, '/v1/retrieval-tests');
    if (calls.length === 1) throw new ApiError(409, '完整所选范围尚未全部发布。');
    if (calls.length === 2) {
      fixedSignal = options.signal;
      return new Promise(resolve => { deliver = resolve; });
    }
    return retrievalScopeEmpty(2);
  });
  assert.equal(fixture.get('batch-ask').hidden, false);
  assert.equal(fixture.get('batch-ask').disabled, false);
  assert.equal(fixture.get('batch-ask').textContent, '在选中资料中测试召回');
  fixture.get('batch-ask').dispatch('click'); retrievalScopeQuestion(fixture);
  assert.equal(calls.length, 0);
  fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 1, 'unpublished selection must not be filtered or retried');
  assert.deepEqual(Array.from(calls[0].options.body.document_ids), ['doc-one', 'doc-unpublished']);
  assert.equal(fixture.app.retrievalSession.value.phase, 'error');
  assert.match(fixture.get('retrieval-error').textContent, /完整所选范围/u);
  assert.match(fixture.get('answer-scope-label').textContent, /仅所选 2 份/u);
  fixture.get('retrieval-run').dispatch('click');
  assert.equal(calls.length, 2);
  assert.deepEqual(Array.from(calls[1].options.body.document_ids), ['doc-one', 'doc-unpublished']);
  const all = fixture.get('answer-all');
  assert.equal(all.hidden, false); assert.equal(all.disabled, false);
  assert.equal(all.textContent, '测试全库召回');
  all.dispatch('click');
  assert.equal(calls.length, 2, 'expanding scope also requires a separate explicit test action');
  assert.equal(fixedSignal.aborted, true);
  assert.match(fixture.get('answer-scope-label').textContent, /全部/u);
  deliver(retrievalScopeEmpty(2)); await settleAnswer();
  assert.equal(fixture.app.retrievalSession.value.result, null);
  assert.equal(fixture.get('retrieval-matches').children.length, 0);
  assert.equal(fixture.get('answer-question').value, '完整预算问题');
  assert.equal(fixture.get('answer-submit').disabled, true);
  fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 3);
  assert.equal(Object.hasOwn(calls[2].options.body, 'document_ids'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2].options.body)), {
    question: '完整预算问题', top_k: 5, rerank: false });
});

test('retrieval-only detail scope respects dirty-draft cancellation and then captures only that document', async () => {
  const fixture = retrievalScopeFixture(), calls = [];
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return retrievalScopeEmpty(1); });
  fixture.get('answer-question').value = '保留完整问题';
  const preserved = editUnsaved(fixture);
  let confirmations = 0;
  fixture.app.setConfirm(() => { confirmations++; return false; });
  const scope = fixture.get('detail-task-controls').querySelectorAll('button')
    .find(node => node.textContent === '在本资料中测试召回');
  assert.ok(scope, 'retrieval_test alone must expose the current detail scope entry');
  assert.equal(scope.disabled, false);
  const previousScope = fixture.get('answer-scope-label').textContent;
  scope.dispatch('click');
  assert.equal(confirmations, 1); preserved();
  assert.equal(fixture.get('details').open, true);
  assert.equal(fixture.app.state.detail.document_id, 'doc-one');
  assert.equal(fixture.get('view-answers').hidden, true);
  assert.equal(fixture.get('answer-scope-label').textContent, previousScope);
  assert.equal(fixture.get('answer-question').value, '保留完整问题');
  assert.equal(calls.length, 0);
  fixture.app.setConfirm(() => true); scope.dispatch('click');
  assert.equal(fixture.get('details').open, false); assert.equal(fixture.app.state.detail, null);
  assert.equal(fixture.get('view-answers').hidden, false); assert.equal(calls.length, 0);
  assert.equal(fixture.get('answer-question').value, '保留完整问题');
  fixture.get('retrieval-count').value = '5'; fixture.get('retrieval-rerank').value = 'false';
  fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/retrieval-tests');
  assert.deepEqual(Array.from(calls[0].options.body.document_ids), ['doc-one']);
  assert.equal(calls[0].options.body.question, '保留完整问题');
});

test('text retrieval remains the chosen mode when only visual answering is available', async () => {
  const fixture = retrievalScopeFixture(), calls = [];
  fixture.app.enableImages('visual');
  fixture.app.setApi(async (path, options) => { calls.push({ path, options }); return retrievalScopeEmpty(1); });
  assert.equal(fixture.get('answer-mode').value, 'text');
  fixture.app.openAnswers(['doc-one']);
  assert.equal(fixture.get('answer-mode').value, 'text', 'opening a scope must not replace usable text retrieval with visual answering');
  retrievalScopeQuestion(fixture);
  assert.equal(fixture.get('answer-mode-visual').disabled, false);
  assert.equal(fixture.get('answer-question').disabled, false);
  assert.equal(fixture.get('retrieval-run').disabled, false);
  assert.equal(fixture.get('answer-submit').disabled, true);
  fixture.get('answer-form').dispatch('submit'); assert.equal(calls.length, 0);
  fixture.get('retrieval-run').dispatch('click'); await settleAnswer();
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/retrieval-tests');
  assert.deepEqual(Array.from(calls[0].options.body.document_ids), ['doc-one']);
  assert.equal(fixture.get('retrieval-continue').disabled, true);
});

// Append-only reindex DOM cases; the separate fixture seam enables only a capability.
function reindexFixture(stateName = 'indexed', changes = {}) {
  return appFixture('indexing', task('indexing', stateName, { task_id: stateName === 'indexed' ? 'index-old' : 'index-rebuild' }), {
    active_revision_id: 'rev-one', index_publication_id: 'publication-old', can_reindex: true, ...changes,
  });
}
function reindexEntry(fixture, detail = false) {
  return fixture.get(detail ? 'detail-task-controls' : 'document-rows').querySelectorAll('button')
    .find(node => node.textContent === '重建文本索引');
}
function reindexPage(fixture, change = {}) {
  return { items: [{ ...fixture.app.state.items[0], ...change }], total: 1, total_pages: 1 };
}

test('reindex row and detail retain task access and create one confirmed JSON job while old publication stays active', async () => {
  const fixture = reindexFixture(), calls = [];
  fixture.app.enableReindex();
  const control = reindexEntry(fixture), detail = reindexEntry(fixture, true);
  assert.ok(control, 'server-authorized published row must expose reindex'); assert.ok(detail);
  assert.ok(fixture.get('document-rows').querySelectorAll('button').some(node => node.textContent === '索引任务'));
  assert.equal(control.disabled, false); assert.equal(detail.disabled, false);
  const next = task('indexing', 'queued', { task_id: 'index-rebuild' });
  let deliver;
  fixture.app.setApi(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/v1/documents/doc-one/reindex') return new Promise(resolve => { deliver = resolve; });
    if (path.startsWith('/v1/management/documents?')) return reindexPage(fixture, { latest_index_job: next, index_status: 'queued', can_reindex: false });
    throw new Error(`unexpected reindex route ${path}`);
  });
  control.dispatch('click');
  assert.equal(fixture.get('edit-dialog').open, true);
  assert.match(fixture.get('dialog-description').textContent, /嵌入模型.*Milvus/u);
  assert.match(fixture.get('dialog-description').textContent, /费用/u);
  assert.match(fixture.get('dialog-description').textContent, /旧.*继续/u);
  assert.equal(calls.length, 0);
  fixture.get('dialog-cancel').dispatch('click'); assert.equal(calls.length, 0);
  detail.dispatch('click'); fixture.get('dialog-form').dispatch('submit'); fixture.get('dialog-form').dispatch('submit');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), { base_publication_id: 'publication-old' });
  assert.equal(fixture.app.state.items[0].index_publication_id, 'publication-old');
  deliver(next); await settleMutation(fixture);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(fixture.app.state.indexTask.task_id, 'index-rebuild');
  assert.equal(fixture.app.state.items[0].active_revision_id, 'rev-one');
  assert.equal(fixture.app.state.items[0].index_publication_id, 'publication-old');
  assert.match(fixture.get('task-boundary').textContent, /旧.*继续/u);
});

test('reindex requires all capabilities and actual server eligibility rather than raw type or can edit alone', () => {
  const noCapability = reindexFixture();
  assert.equal(reindexEntry(noCapability), undefined);
  for (const changes of [
    { can_reindex: false }, { can_reindex: 'true' }, { synthetic_fixture: true },
    { active_revision_id: null }, { index_publication_id: null },
    { latest_job: null, document_type: 'audio', registered_revision_id: 'raw-sound' },
    { latest_job: null, document_type: 'video', registered_revision_id: 'raw-video-av' },
    { document_type: 'image', can_reindex: false }, { document_type: 'audio', can_reindex: false },
  ]) {
    const fixture = reindexFixture('indexed', changes); fixture.app.enableReindex();
    assert.equal(reindexEntry(fixture), undefined, JSON.stringify(changes));
    assert.equal(reindexEntry(fixture, true), undefined, JSON.stringify(changes));
  }
  const busy = reindexFixture('processing'); busy.app.enableReindex();
  assert.equal(reindexEntry(busy), undefined);
});

test('reindex confirmation refuses changed publication or server eligibility without sending a replacement request', async () => {
  for (const change of [{ index_publication_id: 'publication-replaced' }, { can_reindex: false }, { latest_job: task('ingestion', 'parsed', { revision_id: 'rev-new' }) }]) {
    const fixture = reindexFixture(); fixture.app.enableReindex(); let calls = 0;
    fixture.app.setApi(async () => { calls++; throw new Error('stale confirmation dispatched'); });
    const control = reindexEntry(fixture); assert.ok(control); control.dispatch('click');
    Object.assign(fixture.app.state.items[0], change);
    fixture.get('dialog-form').dispatch('submit'); await settleAnswer();
    assert.equal(calls, 0); assert.match(fixture.get('dialog-error').textContent, /变化|刷新/u);
  }
});

for (const terminal of ['failed', 'cancelled']) {
  test(`reindex ${terminal} keeps old publication and editable draft without claiming it was unpublished`, async () => {
    const fixture = reindexFixture('processing'); fixture.app.enableReindex(); const preserved = editUnsaved(fixture);
    const next = task('indexing', terminal, { task_id: 'index-rebuild' });
    const calls = [];
    fixture.app.setApi(async path => {
      calls.push(path);
      if (path === '/v1/indexings/index-rebuild') return next;
      if (path.startsWith('/v1/management/documents?')) return reindexPage(fixture, { latest_index_job: next, index_status: terminal });
      throw new Error(`unexpected terminal refresh route ${path}`);
    });
    await fixture.app.loadTask();
    assert.equal(calls.length, 2); assert.ok(calls[1].startsWith('/v1/management/documents?'));
    assert.equal(fixture.app.state.items[0].index_publication_id, 'publication-old');
    assert.equal(fixture.app.state.items[0].active_revision_id, 'rev-one');
    assert.match(fixture.get('task-boundary').textContent, /旧.*继续/u);
    assert.match(statusText(fixture), /已索引/u); preserved();
  });
}

test('reindex same-revision success trusts refreshed publication and clears stale results while preserving question scope and draft', async () => {
  const fixture = reindexFixture('processing'); fixture.app.enableReindex(); fixture.app.enableAnswers(); fixture.app.enableModelSetup();
  fixture.app.openAnswers(['doc-one', 'doc-tail']); fixture.get('answer-question').value = '保留完整问题';
  fixture.app.setApi(async () => ({ answer_id: 'answer-old', status: 'abstained', answer: '没有足够证据。', reason: 'no_evidence', citations: [] }));
  await fixture.app.answerSession.ask('保留完整问题', ['doc-one', 'doc-tail'], 'text');
  assert.ok(fixture.app.answerSession.value.result);
  fixture.app.showView('documents'); fixture.app.openDetail('doc-one'); const preserved = editUnsaved(fixture);
  const next = task('indexing', 'indexed', { task_id: 'index-rebuild', can_cancel: false });
  let publish;
  fixture.app.setApi(async path => {
    if (path === '/v1/indexings/index-rebuild') return next;
    if (path.startsWith('/v1/management/documents?')) return new Promise(resolve => { publish = resolve; });
    throw new Error(`unexpected publication route ${path}`);
  });
  const pending = fixture.app.loadTask(); await settleAnswer();
  assert.equal(fixture.app.state.items[0].index_publication_id, 'publication-old', 'task receipt is not publication authority');
  assert.ok(fixture.app.answerSession.value.result);
  publish(reindexPage(fixture, { latest_index_job: next, index_status: 'indexed', index_publication_id: 'publication-new' })); await pending;
  assert.equal(fixture.app.state.items[0].active_revision_id, 'rev-one');
  assert.equal(fixture.app.state.items[0].index_publication_id, 'publication-new');
  assert.equal(fixture.app.answerSession.value.result, null);
  assert.equal(fixture.app.retrievalSession.value.result, null);
  assert.equal(fixture.get('answer-question').value, '保留完整问题');
  assert.match(fixture.get('answer-scope-label').textContent, /仅所选 2 份/u);
  assert.match(fixture.get('answer-error').textContent, /重新/u); preserved();
});

test('reindex unknown request outcome keeps old publication and requires explicit refresh without automatic retry', async () => {
  const fixture = reindexFixture(); fixture.app.enableReindex(); let calls = 0;
  fixture.app.setApi(async () => { calls++; throw new ApiError(504, '请求超时。'); });
  const control = reindexEntry(fixture); assert.ok(control); control.dispatch('click');
  fixture.get('dialog-form').dispatch('submit'); await settleMutation(fixture);
  assert.equal(calls, 1); assert.equal(fixture.app.state.items[0].index_publication_id, 'publication-old');
  assert.match(fixture.get('dialog-error').textContent, /刷新/u);
  assert.match(fixture.get('dialog-error').textContent, /自动重试/u);
});

// Append-only normal flows: verified vector receipts narrow UI eligibility without new reads.
for (const kind of ['image', 'audio']) {
  test(`${kind} vector availability narrows reindex controls without changing server eligibility or detail drafts`, async () => {
    const data = summaryData(kind), calls = [];
    const fixture = appFixture('indexing', task('indexing', 'indexed'), { ...data.item, can_reindex: true });
    const originalRow = fixture.app.state.items[0], originalForm = fixture.get('detail-form');
    const saved = editUnsaved(fixture);
    const reply = kind === 'image' ? imageVectorReply : audioVectorReply;
    const vectorPath = `/v1/documents/doc-one/${kind}-vector`;
    let deliver;
    fixture.app.setApi(async (path, options = {}) => {
      calls.push({ path, options });
      assert.equal(path, vectorPath, 'vector state changes must not issue a management read or a reindex request');
      if (options.method === 'POST') return new Promise(resolve => { deliver = resolve; });
      return reply(originalRow, 'missing');
    });
    fixture.app.enableReindex();
    fixture.app[kind === 'image' ? 'enableImageVectors' : 'enableAudioVectors']();
    await settleAnswer();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, undefined);
    const oldRowControl = reindexEntry(fixture), oldDetailControl = reindexEntry(fixture, true);
    assert.ok(oldRowControl, 'a current server-authorized row must initially offer reindex');
    assert.ok(oldDetailControl, 'the same current detail must initially offer reindex');
    saved();

    fixture.get(`${kind}-vector-build`).dispatch('click');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.body, undefined);
    oldRowControl.dispatch('click');
    assert.equal(fixture.get('edit-dialog').open, true, 'confirmation may already be open while an explicit vector build finishes');
    deliver(reply(originalRow, 'available')); await settleAnswer();

    const session = fixture.app[kind === 'image' ? 'vectorSession' : 'audioVectorSession'];
    assert.equal(session.value.phase, 'ready');
    assert.equal(session.value.vector.status, 'available');
    assert.equal(session.matches(originalRow), true, 'the real Session must validate this exact document and publication');
    assert.match(fixture.get(`detail-${kind}-vector`).textContent, /已就绪/u);
    assert.equal(fixture.app.state.items[0], originalRow, 'a receipt must not replace the authorized server row');
    assert.equal(fixture.app.state.items[0].can_reindex, true, 'the local guard must not fabricate a new server can_reindex value');
    assert.equal(fixture.app.state.items[0].active_revision_id, data.item.active_revision_id);
    assert.equal(fixture.app.state.items[0].index_publication_id, data.item.index_publication_id);
    const nextRowControl = reindexEntry(fixture), nextDetailControl = reindexEntry(fixture, true);
    assert.ok(!nextRowControl || nextRowControl.disabled, 'available matching vector must narrow the row entry immediately');
    assert.ok(!nextDetailControl || nextDetailControl.disabled, 'available matching vector must narrow the detail entry immediately');
    assert.match(fixture.get(`detail-${kind}-vector`).textContent, /暂不支持重建文本索引.*刷新资料核对状态/u);
    assert.equal(fixture.get('detail-form'), originalForm); saved();

    fixture.get('dialog-form').dispatch('submit'); await settleAnswer();
    assert.equal(calls.length, 2, 'a previously captured confirmation must not submit a now-ineligible rebuild');
    assert.match(fixture.get('dialog-error').textContent, /变化.*刷新/u);
    fixture.get('dialog-cancel').dispatch('click');
    oldDetailControl.dispatch('click'); await settleAnswer();
    assert.equal(fixture.get('edit-dialog').open, false, 'a previously captured detail button must not reopen reindex confirmation');
    assert.equal(calls.length, 2, 'the entire flow remains one vector GET and one explicit vector POST');
    assert.equal(fixture.get('detail-form'), originalForm); saved();
  });
}

// New receipt-preserving reindex flows; the prior no-capability cases remain unchanged.
function receiptReindexFixture(kind) {
  const data = summaryData(kind);
  const fixture = appFixture('indexing', task('indexing', 'indexed', { task_id: 'index-old' }), {
    ...data.item, can_reindex: true,
  });
  fixture.app.enableReindex(); fixture.app.setReceiptReindexCapability(true);
  const path = `/v1/documents/doc-one/${kind}-vector`;
  const reply = kind === 'image' ? imageVectorReply : audioVectorReply;
  const enable = () => fixture.app[kind === 'image' ? 'enableImageVectors' : 'enableAudioVectors']();
  const session = () => fixture.app[kind === 'image' ? 'vectorSession' : 'audioVectorSession'];
  return { fixture, data, path, reply, enable, session };
}

async function receiptReindexOldAnswer(fixture) {
  fixture.app.enableAnswers(); fixture.app.enableModelSetup();
  fixture.app.openAnswers(['doc-one', 'doc-tail']);
  fixture.get('answer-question').value = '保留完整媒体问题';
  fixture.app.setApi(async path => {
    if (path === '/v1/answers') return textAnswer;
    assert.equal(path, '/v1/sources/answer-one/1');
    return { answer_id: textAnswer.answer_id, citation: textCitation };
  });
  fixture.get('answer-form').dispatch('submit'); await settleAnswer();
  assert.equal(fixture.app.answerSession.value.result.answer_id, textAnswer.answer_id);
  fixture.get('answer-citations').querySelector('button').dispatch('click'); await settleAnswer();
  assert.equal(fixture.get('source-quote').textContent, textCitation.quote);
  fixture.app.showView('documents'); fixture.app.openDetail('doc-one');
  return fixture.app.answerSession.value.result;
}

for (const kind of ['image', 'audio']) {
  test(`receipt reindex ${kind} available vector retains row and detail entries and confirms one text-only rebuild request`, async () => {
    const { fixture, data, path, reply, enable, session } = receiptReindexFixture(kind);
    const calls = [], oldRow = fixture.app.state.items[0], originalForm = fixture.get('detail-form');
    const saved = editUnsaved(fixture);
    const next = task('indexing', 'queued', { task_id: 'index-rebuild' });
    let deliver;
    fixture.app.setApi(async (route, options = {}) => {
      calls.push({ route, options });
      if (route === path) { assert.equal(options.method, undefined); return reply(oldRow, 'available'); }
      if (route === '/v1/documents/doc-one/reindex') return new Promise(resolve => { deliver = resolve; });
      if (route.startsWith('/v1/management/documents?')) return reindexPage(fixture, { latest_index_job: next, index_status: 'queued', can_reindex: false });
      throw new Error(`unexpected receipt reindex route ${route}`);
    });
    enable(); await settleAnswer();
    assert.equal(session().value.vector.status, 'available'); assert.equal(session().matches(oldRow), true);
    const control = reindexEntry(fixture), detail = reindexEntry(fixture, true);
    assert.ok(control, 'new capability and authorized current receipt must allow the row action');
    assert.ok(detail, 'new capability must allow the same detail action');
    assert.equal(control.disabled, false); assert.equal(detail.disabled, false);
    assert.doesNotMatch(fixture.get(`detail-${kind}-vector`).textContent, /暂不支持重建文本索引/u);
    control.dispatch('click');
    const description = fixture.get('dialog-description').textContent;
    assert.match(description, /嵌入模型.*Milvus/u); assert.match(description, /费用/u);
    assert.match(description, /核对|核验/u); assert.match(description, /复用|继续使用/u);
    assert.match(description, /图片.*音频.*向量|媒体向量/u);
    assert.match(description, /不会重新生成|不重新生成/u);
    assert.match(description, /不会重新解析.*转录.*替换原文件/u);
    fixture.get('dialog-cancel').dispatch('click'); assert.equal(calls.length, 1);
    detail.dispatch('click'); fixture.get('dialog-form').dispatch('submit'); fixture.get('dialog-form').dispatch('submit');
    assert.equal(calls.length, 2); assert.equal(calls[1].route, '/v1/documents/doc-one/reindex');
    assert.equal(calls[1].options.method, 'POST');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1].options.body)), { base_publication_id: data.item.index_publication_id });
    assert.equal(fixture.app.state.items[0].index_publication_id, data.item.index_publication_id);
    assert.equal(fixture.get('detail-form'), originalForm); saved();
    deliver(next); await settleMutation(fixture);
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
    assert.equal(calls.filter(call => call.route === path).length, 1, 'navigation must not create an extra media request');
    assert.equal(fixture.app.state.items[0].index_publication_id, data.item.index_publication_id);
    assert.equal(fixture.app.state.indexTask.task_id, 'index-rebuild');
    assert.match(fixture.get('task-boundary').textContent, /旧.*继续/u); saved();
  });

  test(`receipt reindex ${kind} new publication rereads inherited vector and rejects the old delayed receipt without discarding drafts`, async () => {
    const { fixture, data, path, reply, enable, session } = receiptReindexFixture(kind);
    const oldAnswer = await receiptReindexOldAnswer(fixture);
    const calls = [], oldRow = fixture.app.state.items[0], saved = editUnsaved(fixture);
    const originalForm = fixture.get('detail-form');
    const completed = task('indexing', 'indexed', { task_id: 'index-rebuild', can_cancel: false });
    let oldReply, oldSignal, publish, vectorReads = 0;
    fixture.app.setApi(async (route, options = {}) => {
      calls.push({ route, options });
      if (route === path) {
        assert.equal(options.method, undefined); vectorReads++;
        if (vectorReads === 2) { oldSignal = options.signal; return new Promise(resolve => { oldReply = resolve; }); }
        return reply(fixture.app.state.items[0], 'available');
      }
      if (route === '/v1/indexings/index-rebuild') return completed;
      if (route.startsWith('/v1/management/documents?')) return new Promise(resolve => { publish = resolve; });
      throw new Error(`unexpected receipt publication route ${route}`);
    });
    enable(); await settleAnswer();
    const generation = session().value.vector.vector_generation_id;
    fixture.get(`${kind}-vector-refresh`).dispatch('click');
    assert.equal(vectorReads, 2); assert.equal(session().value.phase, 'loading');
    fixture.app.watchTask(task('indexing', 'processing', { task_id: 'index-rebuild' }), 'indexing');
    const pending = fixture.app.loadTask(); await settleAnswer();
    assert.equal(typeof publish, 'function');
    assert.equal(fixture.app.state.items[0].index_publication_id, data.item.index_publication_id);
    assert.equal(fixture.app.answerSession.value.result, oldAnswer, 'task completion cannot invalidate current sources before authorized publication read');
    assert.equal(vectorReads, 2, 'same base must not create another vector GET while its existing refresh is pending');
    publish(reindexPage(fixture, { latest_index_job: completed, index_status: 'indexed', index_publication_id: 'publication-new' }));
    await pending; await settleAnswer();
    assert.equal(vectorReads, 3, 'one ordinary GET must validate the new base association');
    assert.equal(oldSignal.aborted, true);
    assert.equal(session().value.phase, 'ready');
    assert.equal(session().value.vector.publication_id, 'publication-new');
    assert.equal(session().value.vector.vector_generation_id, generation, 'inheritance may retain the exact old physical generation');
    assert.equal(session().matches(fixture.app.state.items[0]), true);
    assert.equal(fixture.app.answerSession.value.result, null); assert.equal(fixture.app.retrievalSession.value.result, null);
    oldReply({ ...reply(oldRow, 'available'), vector_generation_id: 'late-old-generation' }); await settleAnswer();
    assert.equal(session().value.vector.publication_id, 'publication-new');
    assert.equal(session().value.vector.vector_generation_id, generation);
    assert.equal(fixture.app.state.items[0].active_revision_id, data.item.active_revision_id);
    assert.equal(fixture.get('answer-question').value, '保留完整媒体问题');
    assert.match(fixture.get('answer-scope-label').textContent, /仅所选 2 份/u);
    assert.match(fixture.get('answer-error').textContent, /重新/u);
    assert.equal(fixture.get('detail-form'), originalForm); saved();
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
  });

  for (const terminal of ['failed', 'cancelled']) {
    test(`receipt reindex ${kind} ${terminal} retains the old vector and source while preserving the editable detail`, async () => {
      const { fixture, data, path, reply, enable, session } = receiptReindexFixture(kind);
      const oldAnswer = await receiptReindexOldAnswer(fixture), calls = [];
      const oldRow = fixture.app.state.items[0], originalForm = fixture.get('detail-form'), saved = editUnsaved(fixture);
      const finished = task('indexing', terminal, { task_id: 'index-rebuild' });
      fixture.app.setApi(async (route, options = {}) => {
        calls.push({ route, options });
        if (route === path) { assert.equal(options.method, undefined); return reply(fixture.app.state.items[0], 'available'); }
        if (route === '/v1/indexings/index-rebuild') return finished;
        if (route.startsWith('/v1/management/documents?')) return reindexPage(fixture, { latest_index_job: finished, index_status: terminal });
        if (route === '/v1/sources/answer-one/1') return { answer_id: textAnswer.answer_id, citation: textCitation };
        throw new Error(`unexpected receipt terminal route ${route}`);
      });
      enable(); await settleAnswer();
      assert.equal(session().value.vector.status, 'available');
      const oldGeneration = session().value.vector.vector_generation_id;
      fixture.app.watchTask(task('indexing', 'processing', { task_id: 'index-rebuild' }), 'indexing');
      await fixture.app.loadTask(); await settleAnswer();
      assert.equal(fixture.app.state.items[0].index_publication_id, oldRow.index_publication_id);
      assert.equal(fixture.app.state.items[0].active_revision_id, data.item.active_revision_id);
      assert.equal(fixture.app.answerSession.value.result, oldAnswer);
      assert.equal(session().value.phase, 'ready', 'an unsuccessful new job must not hide the still-published vector');
      assert.equal(session().value.vector.publication_id, oldRow.index_publication_id);
      assert.equal(session().value.vector.vector_generation_id, oldGeneration);
      assert.match(fixture.get(`detail-${kind}-vector`).textContent, /已就绪/u);
      assert.doesNotMatch(fixture.get(`detail-${kind}-vector`).textContent, /请先完成.*索引/u);
      assert.match(fixture.get('task-boundary').textContent, /旧.*继续/u);
      await fixture.app.answerSession.readSource(1);
      assert.equal(fixture.get('source-quote').textContent, textCitation.quote, 'the old current answer source remains readable');
      assert.equal(calls.filter(call => call.route === '/v1/sources/answer-one/1').length, 1);
      assert.equal(calls.filter(call => call.options.method === 'POST').length, 0);
      assert.equal(fixture.get('detail-form'), originalForm); saved();
      assert.equal(fixture.get('answer-question').value, '保留完整媒体问题');
      assert.match(fixture.get('answer-scope-label').textContent, /仅所选 2 份/u);
    });
  }

  test(`receipt reindex ${kind} confirmation rechecks capability and server eligibility without fabricating a new row`, async () => {
    const { fixture, path, reply, enable } = receiptReindexFixture(kind);
    const calls = [], originalRow = fixture.app.state.items[0], saved = editUnsaved(fixture);
    fixture.app.setApi(async (route, options = {}) => {
      calls.push({ route, options }); assert.equal(route, path); assert.equal(options.method, undefined);
      return reply(originalRow, 'available');
    });
    enable(); await settleAnswer();
    const initial = reindexEntry(fixture, true); assert.ok(initial); initial.dispatch('click');
    assert.equal(fixture.get('edit-dialog').open, true);
    fixture.app.setReceiptReindexCapability(false);
    fixture.get('dialog-form').dispatch('submit'); await settleAnswer();
    assert.equal(calls.length, 1); assert.match(fixture.get('dialog-error').textContent, /变化.*刷新/u);
    assert.equal(fixture.app.state.items[0], originalRow); assert.equal(originalRow.can_reindex, true);
    fixture.get('dialog-cancel').dispatch('click');
    initial.dispatch('click'); assert.equal(fixture.get('edit-dialog').open, false);
    fixture.app.setReceiptReindexCapability(true);
    const restored = reindexEntry(fixture, true); assert.ok(restored); restored.dispatch('click');
    originalRow.can_reindex = false; // Simulate the currently authorized row changing, never a local receipt inference.
    fixture.get('dialog-form').dispatch('submit'); await settleAnswer();
    assert.equal(calls.length, 1); assert.match(fixture.get('dialog-error').textContent, /变化.*刷新/u);
    assert.equal(fixture.app.state.items[0], originalRow); assert.equal(originalRow.can_reindex, false);
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 0); saved();
  });
}
