import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../public/api.mjs';
import { createWikiWorkspaceApi } from '../public/wiki-workspace-api.mjs';
import { parseWorkspaceRoute, escapeHtml, filterKnowledge, commonSourceRelations, formatLocator, formatTimestamp, createWikiWorkspace } from '../public/wiki-workspace.mjs';

const page = (id, doc, revision = 'r1') => ({ page_id: id, version: 1, content: { title: id, kind: 'topic', sections: [{ body: '正文灯塔', sources: [{ document_id: doc, publication_id: 'pub', source_revision_id: revision }] }] } });
test('live workspace routes preserve version and server source identity', () => {
  assert.deepEqual(parseWorkspaceRoute('#/page-source/p1/3/s2'), { view: 'page-source', id: 'p1', version: 3, sourceId: 's2' });
  assert.equal(parseWorkspaceRoute('#/page-source/p1/0/s2').view, 'missing');
  assert.equal(parseWorkspaceRoute('#/knowledge/%3Cscript%3E').view, 'missing');
  assert.equal(parseWorkspaceRoute('#/answer-source/a1/24').ordinal, 24);
  assert.deepEqual(parseWorkspaceRoute('#/models'), { view: 'models' });
});
test('knowledge search examines content and kind, common-source graph uses exact revision', () => {
  const pages = [page('a', 'doc'), page('b', 'doc'), page('c', 'doc', 'r2'), page('d', 'different')];
  assert.equal(filterKnowledge(pages, '灯塔', 'topic').length, 4);
  assert.equal(filterKnowledge(pages, '灯塔', 'entity').length, 0);
  assert.deepEqual(commonSourceRelations(pages).map(edge => [edge.from, edge.to, edge.count]), [['a', 'b', 1]]);
});
test('source labels preserve typed precision and arbitrary text is escaped', () => {
  assert.match(formatLocator({ page: 3 }), /3/u);
  assert.match(formatLocator({ start_us: 1000000, end_us: 2500000 }), /1.*2.5/u);
  assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
test('live source module exposes an injectable workspace rather than static data', () => {
  assert.equal(typeof createWikiWorkspace, 'function');
});

test('server epoch milliseconds render in local date time; invalid values are unavailable', () => {
  const timestamp = new Date(2026, 9, 9, 15, 4, 5).getTime();
  assert.equal(formatTimestamp(timestamp), '2026-10-09 15:04:05');
  for (const value of [null, undefined, NaN, Infinity, -1, 1.5, '2026-10-09', String(timestamp), 8640000000000001]) {
    assert.equal(formatTimestamp(value), '时间不可用');
  }
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const agentRunId = '64ccaf3b-6801-4d68-8df6-c40ec575b318';
const agentResult = { answer_id: 'agent-answer', status: 'abstained', answer: '缺少完整资料。', reason: 'no_evidence', citations: [] };
const agentRun = (status = 'running') => ({ id: agentRunId, status, events: [{ sequence: 1, type: 'searching', message: '检索知识库' }], result: status === 'completed' ? agentResult : null, suggestions: status === 'completed' ? [{ title: '<b>补齐资料</b>', reason: '需要更新原文', document_ids: ['doc'] }] : [], error: null });
const source = { id: 's1', document_id: 'doc', publication_id: 'pub', source_revision_id: 'r1', source_sha256: 'a'.repeat(64), evidence_id: 'e1', evidence_sha256: 'b'.repeat(64), kind: 'text' };
const timestamp = new Date(2026, 9, 9, 15, 4, 5).getTime();
const knowledge = { page_id: 'p1', version: 1, source_state: 'current', created_at: timestamp, model_revision: 'extractive', policy_revision: 'wiki-v1', content: { title: '真实知识页', kind: 'topic', sections: [{ id: 'section', heading: '主题', body: '<script>正文灯塔</script>', sources: [source] }] } };
const draft = { id: 'd1', title: '草稿', body: '未核验的正文', version: 2, created_at: timestamp, updated_at: timestamp };
const proposal = { id: 'proposal', page_id: 'p1', base_version: 1, before: knowledge.content, after: knowledge.content, status: 'pending', generation_method: 'extractive', source_state: 'current', created_at: timestamp };
const settings = { version: 2, search_method: 'hybrid', ranking_mode: 'rerank', dense_weight: 0.5, top_k: 5, score_threshold_enabled: false, score_threshold: 0.5 };
function fixture(hash = '#/home', overrides = {}, config) {
  const nodes = new Map(), events = {}, windowEvents = {}, calls = [];
  const node = id => { if (!nodes.has(id)) { const listeners = {}; nodes.set(id, { innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', open: false, focus() {}, showModal() { this.open = true; }, close() { this.open = false; listeners.close?.(); }, addEventListener(name, callback) { listeners[name] = callback; }, dispatch(name) { listeners[name]?.({ preventDefault() {} }); } }); } return nodes.get(id); };
  const list = items => async ({ offset = 0, limit = 100 } = {}) => ({ items, offset, limit, total: items.length });
  const wiki = {
    request: async path => { calls.push(['request', path]); throw new Error('Unexpected request'); },
    allPages: async () => [knowledge], listCatalog: list([{ document_id: 'doc', filename: 'source.txt', kind: 'document', state: 'indexed', answerable: true }, { document_id: 'waiting', filename: 'pending.txt', kind: 'document', state: 'parsed', answerable: false }]),
    listProposals: list([proposal]), listDrafts: list([draft]), getPage: async () => knowledge, getPageVersion: async () => knowledge,
    getProposal: async () => proposal, getDraft: async () => draft, getSettings: async () => settings,
    getAgentConfig: async () => ({ enabled: false, engine: 'db-gpt', max_steps: 8 }),
    createDraft: async command => { calls.push(['createDraft', command]); return { ...command, id: 'new-draft', version: 1 }; },
    updateDraft: async (id, command) => { calls.push(['updateDraft', id, command]); return { ...command, id, version: command.version + 1 }; },
    deleteDraft: async (id, version) => { calls.push(['deleteDraft', id, version]); },
    getDocument: async id => ({ document_id: id, filename: 'source.txt', can_index: true, status: 'parsed', index_status: 'not_indexed' }),
    startIndexing: async id => { calls.push(['startIndexing', id]); return { task_id: 'index1', document_id: id, state: 'indexed' }; },
    createProposal: async command => { calls.push(['createProposal', command]); return proposal; },
    acceptProposal: async (id, version) => { calls.push(['acceptProposal', id, version]); return knowledge; },
    dismissProposal: async id => { calls.push(['dismissProposal', id]); return { ...proposal, status: 'dismissed' }; },
    saveSettings: async command => { calls.push(['saveSettings', command]); return { ...command, version: command.version + 1 }; },
    ...overrides,
  };
  const win = { location: { hash, hostname: '127.0.0.1' }, addEventListener: (name, callback) => { windowEvents[name] = callback; }, scrollTo() {}, confirm: () => { throw new Error('Browser-blocking confirm must not be used'); } };
  const doc = { title: '', getElementById: node, querySelectorAll: () => [], addEventListener: (name, callback) => { events[name] = callback; } };
  class Values { constructor(form) { this.values = form.values; } get(key) { return this.values.find(([name]) => name === key)?.[1] ?? null; } has(key) { return this.values.some(([name]) => name === key); } getAll(key) { return this.values.filter(([name]) => name === key).map(([, value]) => value); } }
  const workspace = createWikiWorkspace({ document: doc, window: win, wiki, config, FormData: Values });
  return { workspace, nodes, calls, win, events, html: () => node('content').innerHTML,
    go: async hash => { win.location.hash = hash; await workspace.load(); },
    submit: (id, values) => events.submit({ target: { id, values }, preventDefault() {} }),
    click: (action, other = {}) => events.click({ target: { closest: () => ({ dataset: { action, ...other } }) }, preventDefault() {} }),
  };
}

test('real workflow views render server data, known versions and no fake terminal controls', async () => {
  const f = fixture(); await f.workspace.start();
  assert.match(f.html(), /href="#\/sources"><span>原始资料<\/span><strong>2<small>份<\/small>/u);
  for (const [route, expected] of [['#/knowledge', '真实知识页'], ['#/knowledge/p1', '版本 1'], ['#/sources', 'source.txt'], ['#/compile', '生成待审阅提案'], ['#/drafts', '未核验的正文'], ['#/drafts/d1', '版本 2'], ['#/ask', 'id="question-form"'], ['#/graph', '共同来源关系'], ['#/review', 'review-status'], ['#/review/proposal', '采纳并生成知识页版本'], ['#/settings', '配置版本 2']]) {
    await f.go(route); assert.match(f.html(), new RegExp(expected, 'u'), route);
  }
  await f.go('#/knowledge/p1'); assert.match(f.html(), /&lt;script&gt;正文灯塔/u); assert.match(f.html(), /#\/page-source\/p1\/1\/s1/u);
  assert.doesNotMatch(f.html(), /<script>/u);
  f.workspace.close();
});

test('disabled Agent preserves one ordinary knowledge answer while enabled Agent never silently falls back', async () => {
  let classic = 0, creates = 0;
  const old = fixture('#/ask', { request: async path => { assert.equal(path, '/v1/knowledge-answers'); classic++; return agentResult; } });
  await old.workspace.start(); old.submit('question-form', [['question', '旧问答']]); await tick();
  assert.equal(classic, 1); assert.equal(old.workspace.state.turns[0].result.answer_id, 'agent-answer'); old.workspace.close();
  const enabled = fixture('#/ask', { getAgentConfig: async () => ({ enabled: true, engine: 'db-gpt', max_steps: 8 }),
    createAgentRun: async () => { creates++; throw new Error('private model trace'); }, request: async () => { classic++; return agentResult; } });
  await enabled.workspace.start(); enabled.submit('question-form', [['question', '新任务']]); await tick();
  assert.equal(creates, 1); assert.equal(classic, 1); assert.doesNotMatch(enabled.nodes.get('chat-turns').innerHTML, /private model trace/u);
  assert.match(enabled.nodes.get('chat-turns').innerHTML, /任务状态未能确认/u); enabled.workspace.close();
});

test('Agent question displays real progress, protects duplicate writes and separates maintenance suggestions', async () => {
  let finish; const calls = [];
  const f = fixture('#/ask', { getAgentConfig: async () => ({ enabled: true, engine: 'db-gpt', max_steps: 8 }),
    createAgentRun: command => { calls.push(['create', command]); return new Promise(resolve => { finish = resolve; }); },
    getAgentRun: async id => { calls.push(['get', id]); return agentRun('completed'); } });
  await f.workspace.start(); f.submit('question-form', [['question', '整理相关资料']]); f.submit('question-form', [['question', '重复']]); await tick();
  assert.equal(calls.length, 1); assert.match(calls[0][1].request_id, /^[a-f0-9-]{36}$/u);
  finish(agentRun()); await tick(); assert.match(f.nodes.get('chat-turns').innerHTML, /检索知识库/u);
  assert.match(f.nodes.get('chat-turns').innerHTML, /data-action="stop-agent"/u);
  f.events.input({ target: { id: 'question', value: '下一条草稿' } });
  await f.click('refresh-agent', { turn: '0' }); await tick();
  const html = f.nodes.get('chat-turns').innerHTML;
  assert.equal(f.workspace.state.question, '下一条草稿'); assert.equal(f.workspace.state.turns[0].pending, false);
  assert.match(html, /<details class="agent-progress agent-progress-complete"><summary>查阅过程 · 已完成<\/summary>/u);
  assert.doesNotMatch(html, /<details class="agent-progress agent-progress-complete" open/u);
  assert.match(html, /<li>检索知识库<\/li>/u);
  assert.match(html, /<details class="agent-suggestions"><summary>知识维护建议/u);
  assert.match(html, /&lt;b&gt;补齐资料&lt;\/b&gt;/u); assert.match(html, /data-action="save-answer"/u);
  assert.doesNotMatch(html, /<details class="agent-suggestions" open|data-action="accept-proposal"/u);
  await f.click('save-answer', { turn: '0' }); await tick();
  assert.equal(f.calls[0][0], 'createDraft'); assert.match(f.calls[0][1].body, /待核验回答记录：agent-answer/u); f.workspace.close();
});

test('Agent stop and leaving isolate late responses from the visible question', async () => {
  let finishRead, finishCancel;
  const f = fixture('#/ask', { getAgentConfig: async () => ({ enabled: true, engine: 'db-gpt', max_steps: 8 }), createAgentRun: async () => agentRun(),
    getAgentRun: () => new Promise(resolve => { finishRead = resolve; }), cancelAgentRun: () => new Promise(resolve => { finishCancel = resolve; }) });
  await f.workspace.start(); f.submit('question-form', [['question', '可停止任务']]); await tick();
  const reading = f.click('refresh-agent', { turn: '0' }); await tick();
  const cancel = f.click('stop-agent', { turn: '0' }); await tick();
  assert.match(f.nodes.get('chat-turns').innerHTML, /正在停止/u);
  finishRead(agentRun('completed')); await reading; assert.equal(f.workspace.state.turns[0].result, null);
  finishCancel(agentRun('cancelled')); await cancel; assert.match(f.nodes.get('chat-turns').innerHTML, /已取消/u);
  f.workspace.close();
  let finish;
  const late = fixture('#/ask', { getAgentConfig: async () => ({ enabled: true, engine: 'db-gpt', max_steps: 8 }), createAgentRun: () => new Promise(resolve => { finish = resolve; }) });
  await late.workspace.start(); late.submit('question-form', [['question', '离页任务']]); await tick(); await late.go('#/settings');
  finish(agentRun('completed')); await tick();
  assert.equal(late.workspace.state.turns[0].result, null); assert.equal(late.workspace.state.turns[0].pending, false);
  assert.match(late.html(), /空间设置/u); late.workspace.close();
});

test('workspace removes permanent development notes without hiding content, states or actions', async () => {
  const f = fixture(); await f.workspace.start();
  for (const route of ['#/home', '#/knowledge', '#/knowledge/p1', '#/sources', '#/compile', '#/drafts', '#/drafts/d1', '#/ask', '#/graph', '#/review', '#/review/proposal', '#/settings']) {
    await f.go(route);
    assert.doesNotMatch(f.html(), /class="eyebrow"|本轮验收|模型替身|完整知识页集合|服务器文件级统计|已完整读取|不冒充|不会用演示|composer-note|setting-caption/u, route);
    assert.match(f.html(), /<h1>/u, route);
  }
  assert.doesNotMatch(f.nodes.get('sidebar').innerHTML, /已接后端|服务器持久化/u);
  const document = readFileSync(new URL('../public/wiki-workspace.html', import.meta.url), 'utf8');
  assert.doesNotMatch(document, /environment-notice|本轮验收|模型替身|不只保存文件名/u);
  assert.match(document, /id="action-confirm-dialog"[^>]*aria-describedby="action-confirm-message"/u);
  await f.go('#/compile'); assert.match(f.html(), /value="waiting" disabled/u);
  await f.go('#/sources'); assert.match(f.html(), /已解析，尚未发布索引/u); assert.match(f.html(), /尚未发布/u);
  await f.go('#/knowledge/p1'); assert.match(f.html(), /#\/page-source\/p1\/1\/s1/u);
  await f.go('#/ask'); assert.match(f.html(), /id="question-form"/u); assert.match(f.html(), /发送/u);
  f.workspace.close();
});

test('retrieval help is a single optional disclosure and all editable labels remain visible', async () => {
  const f = fixture('#/settings'); await f.workspace.start();
  assert.match(f.html(), /<details class="settings-help"><summary>参数说明<\/summary>/u);
  assert.doesNotMatch(f.html(), /<details[^>]*\sopen/u);
  for (const label of ['检索方式', '排序策略', '语义权重', 'Top K', '启用相关性阈值']) assert.ok(f.html().includes(label));
  assert.match(f.html(), /id="threshold-help"/u);
  f.submit('settings-form', [['search_method', 'hybrid'], ['ranking_mode', 'rerank'], ['dense_weight', '0.6'], ['top_k', '7']]); await tick();
  assert.deepEqual(f.calls[0], ['saveSettings', { ...settings, dense_weight: 0.6, top_k: 7 }]);
  f.workspace.close();
});

test('draft and proposal actions persist exact server versions without local fake state', async () => {
  const f = fixture('#/drafts/d1'); await f.workspace.start();
  f.submit('draft-form', [['title', '更新草稿'], ['body', '新正文']]); await tick();
  assert.deepEqual(f.calls[0], ['updateDraft', 'd1', { title: '更新草稿', body: '新正文', version: 2 }]);
  await f.go('#/compile/p1'); f.submit('compile-form', [['title', '更新页'], ['kind', 'topic'], ['generation_method', 'extractive'], ['document_ids', 'doc']]); await tick();
  assert.deepEqual(f.calls.find(call => call[0] === 'createProposal')[1], { page_id: 'p1', base_version: 1, title: '更新页', kind: 'topic', document_ids: ['doc'], generation_method: 'extractive' });
  await f.go('#/review/proposal'); f.click('accept-proposal'); await tick();
  assert.deepEqual(f.calls.find(call => call[0] === 'acceptProposal'), ['acceptProposal', 'proposal', 1]);
  assert.equal(f.win.location.hash, '#/knowledge/p1'); f.workspace.close();
});

test('late page response cannot replace a newer settings route', async () => {
  let resolve;
  const slow = new Promise(done => { resolve = done; });
  const f = fixture('#/knowledge', { allPages: () => slow });
  const loading = f.workspace.load(); await tick();
  await f.go('#/settings'); assert.match(f.html(), /配置版本 2/u);
  resolve([knowledge]); await loading;
  assert.match(f.html(), /配置版本 2/u); assert.doesNotMatch(f.html(), /真实知识页/u); f.workspace.close();
});

test('missing source binding and reader metadata mismatches never read original bytes', async () => {
  let byteReads = 0;
  const f = fixture('#/page-source/p1/1/s1', { getSource: async () => ({ evidence_id: 'wrong', sha256: source.evidence_sha256, kind: 'text' }), sourceContent: async () => { byteReads++; } });
  await f.workspace.start(); assert.match(f.html(), /证据绑定不一致/u); assert.equal(byteReads, 0); f.workspace.close();
});

test('API failure stays an error without sample results or automatic retries', async () => {
  let reads = 0;
  const f = fixture('#/knowledge', { allPages: async () => { reads++; throw new Error('当前服务离线'); } });
  await f.workspace.start(); assert.equal(reads, 1); assert.match(f.html(), /当前服务离线/u); assert.doesNotMatch(f.html(), /真实知识页|青榆/u); f.workspace.close();
});

test('new-page proposal does not link to a reserved page until accepted', async () => {
  for (const status of ['pending', 'dismissed', 'accepted']) {
    const f = fixture('#/review/proposal', { getProposal: async () => ({ ...proposal, base_version: 0, before: null, status }) });
    await f.workspace.start();
    if (status === 'accepted') assert.match(f.html(), /href="#\/knowledge\/p1">查看知识页/u);
    else assert.doesNotMatch(f.html(), /href="#\/knowledge\/p1">查看知识页/u);
    f.workspace.close();
  }
  const existing = fixture('#/review/proposal'); await existing.workspace.start();
  assert.match(existing.html(), /href="#\/knowledge\/p1">查看知识页/u); existing.workspace.close();
});

test('page, proposal and draft views never expose raw server milliseconds', async () => {
  const f = fixture();
  for (const route of ['#/knowledge/p1', '#/drafts', '#/review']) {
    await f.go(route); assert.match(f.html(), /2026-10-09 15:04:05/u);
    assert.ok(!f.html().includes(String(timestamp)), route);
  }
  f.workspace.close();
});

test('model compilation submits directly once and blocks duplicate clicks while pending', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture('#/compile/p1', { createProposal: command => { f.calls.push(['createProposal', command]); return pending; } }); await f.workspace.start();
  const command = [['title', '模型编译'], ['kind', 'topic'], ['generation_method', 'model'], ['document_ids', 'doc']];
  f.submit('compile-form', command);
  assert.deepEqual(f.calls, [['createProposal', { page_id: 'p1', base_version: 1, title: '模型编译', kind: 'topic', generation_method: 'model', document_ids: ['doc'] }]]);
  assert.equal(f.nodes.get('action-confirm-dialog').open, false); assert.equal(f.workspace.state.busy, true);
  await f.submit('compile-form', command); await tick(); assert.equal(f.calls.length, 1);
  finish(proposal); await tick(); assert.equal(f.workspace.state.busy, false); assert.equal(f.win.location.hash, '#/review/proposal');
  assert.equal(f.calls.length, 1); f.workspace.close();
});

test('indexing submits directly once and blocks duplicate clicks while pending', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture('#/sources/doc', { startIndexing: id => { f.calls.push(['startIndexing', id]); return pending; } }); await f.workspace.start();
  f.click('index', { document: 'doc' });
  assert.deepEqual(f.calls, [['startIndexing', 'doc']]);
  assert.equal(f.nodes.get('action-confirm-dialog').open, false); assert.equal(f.workspace.state.busy, true);
  await f.click('index', { document: 'doc' }); await tick(); assert.equal(f.calls.length, 1);
  finish({ task_id: 'index1', document_id: 'doc', state: 'indexed' }); await tick();
  assert.equal(f.workspace.state.busy, false); assert.equal(f.win.location.hash, '#/sources');
  assert.equal(f.workspace.state.tasks[0].task.state, 'indexed'); assert.equal(f.calls.length, 1); f.workspace.close();
});

test('cancel, Escape and navigation abort unconfirmed draft deletion without writes', async () => {
  for (const cancel of ['button', 'escape', 'navigation']) {
    const f = fixture('#/drafts/d1'); await f.workspace.start();
    const pending = f.click('delete-draft');
    assert.match(f.nodes.get('action-confirm-message').textContent, /删除后无法从草稿箱恢复/u);
    if (cancel === 'button') f.click('cancel-operation');
    if (cancel === 'escape') f.nodes.get('action-confirm-dialog').dispatch('cancel');
    if (cancel === 'navigation') await f.go('#/knowledge');
    await pending; await tick(); assert.equal(f.calls.length, 0, cancel);
    assert.equal(f.nodes.get('action-confirm-dialog').open, false); f.workspace.close();
  }
});

test('draft deletion still requires one explicit page-dialog confirmation', async () => {
  const f = fixture('#/drafts/d1'); await f.workspace.start();
  const pending = f.click('delete-draft'); assert.equal(f.calls.length, 0);
  f.click('cancel-operation'); await pending; await tick(); assert.equal(f.calls.length, 0);
  const confirmed = f.click('delete-draft');
  assert.equal(f.nodes.get('action-confirm-dialog').open, true);
  f.click('confirm-operation'); f.click('confirm-operation'); await confirmed; await tick();
  assert.deepEqual(f.calls, [['deleteDraft', 'd1', 2]]); f.workspace.close();
});

test('upload dialog keeps file selection and explicit upload without fee remarks', () => {
  const document = readFileSync(new URL('../public/wiki-workspace.html', import.meta.url), 'utf8');
  assert.match(document, /id="workspace-files" type="file" multiple/u);
  assert.match(document, /data-action="confirm-import" disabled>确认上传并解析/u);
  assert.doesNotMatch(document, /费用|收费/u);
});

test('workspace model entry stays in the native interface, never links to classic settings', async () => {
  const f = fixture(); await f.workspace.start();
  assert.match(f.nodes.get('topbar').innerHTML, /href="#\/models"/u);
  assert.doesNotMatch(f.nodes.get('topbar').innerHTML, /classic\/#\/settings/u);
  await f.go('#/settings'); assert.match(f.html(), /href="#\/models"/u);
  assert.doesNotMatch(f.html(), /classic\/#\/settings/u); f.workspace.close();
});

const configuredModels = (version = 2, active = 2) => ({ version, active_version: active, state: version === active ? 'active' : 'draft', can_edit: false, provider: 'siliconflow', embedding: { provider: 'siliconflow', model: 'synthetic/embed', dimensions: 2, revision: 'fixture-v1', has_key: true }, rerank: { provider: 'siliconflow', model: 'synthetic/rerank', has_key: true }, generation: { provider: 'siliconflow', model: 'synthetic/generate', has_key: true }, projection: { configured: true, dimension: 2, can_test: true } });
function modelsFixture({ initial = configuredModels(), required = false, intercept } = {}) {
  let saved = structuredClone(initial), configReads = 0;
  const status = job => ({ target_version: saved.version, active_version: saved.active_version, required: saved.active_version !== saved.version && required, can_start: saved.active_version !== saved.version && required && !job, reason: null, total_documents: 2, job: job ?? null });
  const f = fixture('#/models', {
    config: async () => { configReads++; return { capabilities: ['model_configuration', 'model_index_rebuild'], auth_mode: 'session', workspace_id: 'shared' }; },
    request: async (path, options = {}) => {
      f.calls.push([path, options.method, options.body]);
      if (intercept) { const result = await intercept(path, options, { saved, setSaved: value => { saved = value; }, status }); if (result !== undefined) return result; }
      if (path === '/v1/model-configuration') {
        if (options.method === 'PUT') { const next = configuredModels(saved.version + 1, saved.active_version); for (const role of ['embedding', 'rerank', 'generation']) { const { api_key, ...fields } = options.body[role]; next[role] = { ...fields, has_key: !!api_key || saved[role].has_key }; } next.provider = next.generation.provider === 'deepseek' ? 'mixed' : 'siliconflow'; saved = next; }
        return saved;
      }
      if (path.endsWith('/test')) return { version: saved.version, role: options.body.role, status: 'passed', error_code: null };
      if (path.endsWith('/activate')) { saved = { ...saved, active_version: saved.version, state: 'active' }; return saved; }
      if (path.endsWith('/rebuild')) return status();
      throw new Error('Unexpected model request');
    },
  });
  return { ...f, configReads: () => configReads, edit: (id, value) => { const node = f.nodes.get(id); assert.ok(node, id); node.value = value; f.events[id.endsWith('-provider') ? 'change' : 'input']({ target: { id, value } }); } };
}

test('native model page reads safe configuration and renders three editable roles without implicit tests', async () => {
  const f = modelsFixture(); await f.workspace.start();
  assert.match(f.html(), /id="models-form"/u); assert.match(f.html(), /生成模型/u); assert.match(f.html(), /嵌入模型/u); assert.match(f.html(), /重排模型/u);
  assert.equal((f.html().match(/type="password"/gu) ?? []).length, 3);
  assert.deepEqual(f.calls.map(([path, method]) => [path, method]), [['/v1/model-configuration', 'GET'], ['/v1/model-configuration/rebuild', 'GET']]);
  assert.equal(f.nodes.get('model-generation-name').value, 'synthetic/generate');
  assert.equal(f.nodes.get('model-generation-name').disabled, false, 'shared organization does not restore can_edit role gating');
  assert.equal(f.nodes.get('model-embedding-dimensions').value, 2);
  for (const role of ['generation', 'embedding', 'rerank']) assert.equal(f.nodes.get(`model-${role}-key`).value, '');
  assert.equal(f.nodes.get('model-save').disabled, true); assert.equal(f.nodes.get('model-activate').disabled, true);
  f.workspace.close();
});

test('native models save exact CAS, clear write-only keys, test each role and apply the saved version', async () => {
  const f = modelsFixture(); await f.workspace.start();
  const html = f.html(); f.edit('model-generation-name', 'synthetic/new'); f.edit('model-generation-key', 'WRITE_ONLY_TEST_SECRET');
  assert.equal(f.html(), html, 'editing must not rerender the form or destroy its cursor/input');
  assert.equal(f.nodes.get('model-save').disabled, false); assert.equal(f.nodes.get('model-test-generation').disabled, true);
  await f.submit('models-form', []);
  const saved = f.calls.find(([, method]) => method === 'PUT'); assert.equal(saved[2].base_version, 2);
  assert.equal(saved[2].generation.api_key, 'WRITE_ONLY_TEST_SECRET'); assert.equal(Object.hasOwn(saved[2].embedding, 'api_key'), false);
  assert.equal(f.nodes.get('model-generation-key').value, ''); assert.doesNotMatch(JSON.stringify(f.workspace.state), /WRITE_ONLY_TEST_SECRET/u); assert.doesNotMatch(f.html(), /WRITE_ONLY_TEST_SECRET/u);
  for (const role of ['generation', 'embedding', 'rerank', 'projection']) { await f.click('model-test', { role }); assert.equal(f.nodes.get(`model-test-${role}-status`).textContent, '通过'); }
  assert.deepEqual(f.calls.filter(([path]) => path.endsWith('/test')).map(([, , body]) => body), ['generation', 'embedding', 'rerank', 'projection'].map(role => ({ version: 3, role })));
  f.workspace.state.turns.push({ question: '旧问题', result: {} });
  await f.click('model-activate');
  assert.deepEqual(f.calls.find(([path]) => path.endsWith('/activate'))[2], { version: 3 });
  assert.match(f.nodes.get('model-status').textContent, /已保存 3 · 已应用 3/u); assert.equal(f.configReads(), 2); assert.equal(f.workspace.state.turns.length, 0);
  assert.equal(f.nodes.get('action-confirm-dialog').open, false); f.workspace.close();
});

test('model provider change clears the previous key and requires a replacement before saving', async () => {
  const f = modelsFixture(); await f.workspace.start();
  f.edit('model-generation-key', 'WRITE_ONLY_TEST_SECRET'); f.edit('model-generation-provider', 'deepseek');
  assert.equal(f.nodes.get('model-generation-key').value, '');
  await f.submit('models-form', []); assert.equal(f.calls.some(([, method]) => method === 'PUT'), false);
  assert.match(f.nodes.get('model-error').textContent, /更换服务商后须填写/u);
  f.edit('model-generation-name', 'synthetic/deepseek'); f.edit('model-generation-key', 'REPLACEMENT_TEST_SECRET'); await f.submit('models-form', []);
  assert.equal(f.calls.find(([, method]) => method === 'PUT')[2].generation.provider, 'deepseek'); assert.equal(f.nodes.get('model-generation-key').value, ''); f.workspace.close();
});

test('native model testing is direct, single-flight and cannot alter a newer route', async () => {
  let finish;
  const f = modelsFixture({ intercept: (path, options) => path.endsWith('/test') ? new Promise(resolve => { finish = () => resolve({ version: 2, role: options.body.role, status: 'passed', error_code: null }); }) : undefined });
  await f.workspace.start(); const running = f.click('model-test', { role: 'generation' });
  assert.equal(f.calls.filter(([path]) => path.endsWith('/test')).length, 1); assert.equal(f.nodes.get('model-test-generation').disabled, true);
  await f.click('model-test', { role: 'generation' }); assert.equal(f.calls.filter(([path]) => path.endsWith('/test')).length, 1);
  await f.go('#/settings'); finish(); await running; assert.match(f.html(), /id="settings-form"/u); assert.doesNotMatch(f.html(), /id="models-form"/u); f.workspace.close();
});

test('unknown model save blocks resubmission until a successful configuration read and never echoes secrets', async () => {
  const f = modelsFixture({ intercept: (_path, options) => { if (options.method === 'PUT') throw Object.assign(new Error('WRITE_ONLY_TEST_SECRET upstream'), { status: 504 }); } });
  await f.workspace.start(); f.edit('model-generation-name', 'synthetic/new'); f.edit('model-generation-key', 'WRITE_ONLY_TEST_SECRET');
  await f.submit('models-form', []); assert.match(f.nodes.get('model-status').textContent, /结果待核对/u); assert.equal(f.nodes.get('model-save').disabled, true);
  assert.doesNotMatch(f.nodes.get('model-error').textContent, /WRITE_ONLY_TEST_SECRET/u);
  await f.submit('models-form', []); await f.click('model-activate'); assert.equal(f.calls.filter(([, method]) => method === 'PUT').length, 1);
  await f.click('model-refresh'); assert.match(f.nodes.get('model-status').textContent, /已保存 2 · 已应用 2/u); assert.equal(f.nodes.get('model-generation-key').value, ''); f.workspace.close();
});

test('required model rebuild directly submits exact version and confirms completion by rereading configuration', async () => {
  const f = modelsFixture({ initial: configuredModels(3, 2), required: true, intercept: (path, options, server) => {
    if (path.endsWith('/rebuild') && options.method === 'POST') {
      const job = { id: 'rebuild1', base_active_version: 2, target_version: 3, state: 'completed', total_documents: 2, completed_documents: 2, error_code: null, created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:01:00Z' };
      server.setSaved(configuredModels(3, 3)); return { ...server.status(), job };
    }
  } });
  await f.workspace.start(); assert.equal(f.nodes.get('model-activate').disabled, true); assert.equal(f.nodes.get('model-rebuild-panel').hidden, false); assert.equal(f.nodes.get('model-rebuild-start').disabled, false);
  await f.click('model-rebuild-start');
  assert.deepEqual(f.calls.find(([path, method]) => path.endsWith('/rebuild') && method === 'POST')[2], { version: 3 });
  assert.equal(f.calls.filter(([path, method]) => path === '/v1/model-configuration' && method === 'GET').length, 2);
  assert.match(f.nodes.get('model-rebuild-status').textContent, /已完成 · 2 \/ 2 份 · 已生效/u); assert.equal(f.configReads(), 2);
  assert.equal(f.nodes.get('action-confirm-dialog').open, false); f.workspace.close();
});

test('applying model capabilities updates the existing request client for video upload without page reload', async () => {
  const sharedConfig = { capabilities: ['model_configuration', 'model_index_rebuild', 'ingestions'], auth_mode: 'session', workspace_id: 'shared' }, requests = [];
  let saved = configuredModels(2, 1);
  const api = createApi(sharedConfig, () => 'member', async (path, options) => {
    requests.push([path, options]);
    if (path === '/v1/config') return Response.json({ ...sharedConfig, capabilities: [...sharedConfig.capabilities, 'video_upload'] });
    if (path === '/v1/model-configuration/activate') saved = configuredModels(2, 2);
    if (path === '/v1/model-configuration/rebuild') return Response.json({ target_version: 2, active_version: saved.active_version, required: false, can_start: false, reason: null, total_documents: 0, job: null });
    if (path.startsWith('/v1/documents?')) return Response.json({ task_id: 'uploaded', document_id: 'video-doc', state: 'parsed' });
    return Response.json(saved);
  });
  const f = fixture('#/models', createWikiWorkspaceApi({ api }), sharedConfig); await f.workspace.start();
  await f.click('model-activate');
  const file = new File(['synthetic-video-bytes'], 'fixture.mp4', { type: 'video/mp4' });
  f.events.change({ target: { id: 'workspace-files', files: [file] } });
  f.nodes.set('upload-kind', { value: 'video' });
  await f.click('confirm-import'); await tick();
  const upload = requests.find(([path]) => path.startsWith('/v1/documents?'));
  assert.ok(upload, 'the original createApi must see newly enabled video_upload');
  assert.equal(upload[1].body, file); assert.equal(upload[1].headers['Content-Type'], 'video/mp4');
  assert.equal(f.workspace.state.config, sharedConfig); assert.equal(sharedConfig.capabilities.includes('video_upload'), true);
  assert.equal(f.workspace.state.tasks[0].task.document_id, 'video-doc'); f.workspace.close();
});
