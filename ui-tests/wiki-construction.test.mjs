import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { mountWikiConstruction } from '../public/wiki-construction.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const source = number => ({ document_id: `doc-${number}`, publication_id: `pub-${number}`, source_revision_id: `rev-${number}`, filename: `source-${number}.txt`, display_name: `资料 ${number}`, relative_path: `目录/source-${number}.txt` });
const snapshot = (id, excerpt = '合成资料正文') => ({ publication_id: id, revision_id: id, source_sha256: 'a'.repeat(64), text_characters: 2000, part_count: 2, excerpt, truncated: true });
const changes = { page_id: 'p1', version: 3, title: '示例知识页', can_refresh: true, sources: [{ document_id: 'doc-1', display_name: '资料一', status: 'updated', before: snapshot('pub-old'), after: snapshot('pub-new') }] };
function fixture(route = { view: 'build', id: 'b1' }, overrides = {}) {
  const listeners = {}, nodes = new Map(), calls = [], notices = [], navigations = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', disabled: false }); return nodes.get(id); };
  const wiki = {
    listBatchSources: async (id, { offset, limit, ...filters }) => { calls.push(['sources', id, offset, filters]); return { batch_id: id, offset, limit, total: 51, folders: [{ path: '目录', count: 51 }], items: Array.from({ length: 51 }, (_, i) => source(i + 1)).slice(offset, offset + limit) }; },
    createProposal: async command => { calls.push(['create', command]); return { id: 'proposal-1' }; },
    listMaintenance: async ({ offset, limit, kind }) => { calls.push(['maintenance', kind, offset]); return { offset, limit, total: 1, counts: { parse_failed: 1, index_failed: 0, empty_text: 0, duplicate_source: 0, stale_knowledge: 0 }, items: [{ id: 'todo', kind: 'parse_failed', target_type: 'document', target_id: 'doc-1', title: '<script>资料名</script>', error_code: 'parser_failed' }] }; },
    getSourceChanges: async id => { calls.push(['changes', id]); return changes; },
    refreshProposal: async (id, command) => { calls.push(['refresh', id, command]); return { id: 'proposal-2' }; },
    ...overrides,
  };
  const container = { innerHTML: '', addEventListener: (name, callback) => { listeners[name] = callback; }, removeEventListener: (name, callback) => { if (listeners[name] === callback) delete listeners[name]; } };
  const workflow = mountWikiConstruction({ container, document: { getElementById: node }, wiki, route, navigate: path => navigations.push(path), notify: text => notices.push(text) });
  return { workflow, container, calls, notices, navigations, nodes, node, listeners,
    click: name => listeners.click({ target: { closest: () => ({ dataset: { constructionAction: name } }) }, preventDefault() {} }),
    filter: kind => listeners.click({ target: { closest: () => ({ dataset: { constructionKind: kind } }) }, preventDefault() {} }),
    change: (id, value) => listeners.change({ target: { id, value } }),
    input: (id, value) => listeners.input({ target: { id, value } }),
    choose: (id, checked = true) => listeners.change({ target: { dataset: { constructionSource: id }, checked } }),
    submit: id => listeners.submit({ target: { id }, preventDefault() {} }),
  };
}

test('batch construction only reads published source pages and selection binds exact publications', async t => {
  const f = fixture(); t.after(() => f.workflow.destroy()); await f.workflow.ready;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'sources');
  assert.match(f.container.innerHTML, /找到 51 份可编译资料/u);
  assert.match(f.container.innerHTML, /href="#\/imports\/b1"/u);
  f.choose('doc-2'); f.input('construction-title', '综合主题'); f.change('construction-kind', 'overview'); f.change('construction-method', 'model');
  await f.click('next'); assert.equal(f.calls[1][2], 50);
  assert.match(f.container.innerHTML, /已选 1 \/ 50/u); assert.match(f.container.innerHTML, /value="综合主题"/u);
  f.choose('doc-51'); await f.submit('construction-build');
  assert.deepEqual(f.calls.find(call => call[0] === 'create')[1], { page_id: null, base_version: 0, title: '综合主题', kind: 'overview', generation_method: 'model', document_ids: ['doc-2', 'doc-51'], source_versions: [{ document_id: 'doc-2', publication_id: 'pub-2' }, { document_id: 'doc-51', publication_id: 'pub-51' }] });
  assert.deepEqual(f.navigations, ['#/review/proposal-1']);
});

test('selection limit is atomic, filters stay server-side and switching pages does not auto select', async t => {
  const f = fixture(); t.after(() => f.workflow.destroy()); await f.workflow.ready; await f.click('select-page');
  assert.equal(f.workflow.state.selected.size, 50); await f.click('next'); f.choose('doc-51');
  assert.equal(f.workflow.state.selected.size, 50); assert.match(f.notices.at(-1), /50/u);
  await f.click('clear-selection'); assert.equal(f.workflow.state.selected.size, 0);
  f.change('construction-folder', '目录'); await tick();
  assert.equal(f.calls.at(-1)[2], 0); assert.equal(f.calls.at(-1)[3].folder, '目录');
  f.node('construction-query').value = 'source-1'; await f.submit('construction-search');
  assert.equal(f.calls.at(-1)[3].q, 'source-1'); assert.equal(f.workflow.state.selected.size, 0);
});

test('changed publications visible on a later read require a new explicit selection', async t => {
  let newer = false;
  const f = fixture(undefined, { listBatchSources: async (id, { offset, limit }) => ({ batch_id: id, offset, limit, total: 1, folders: [], items: [{ ...source(1), publication_id: newer ? 'new-pub' : 'pub-1' }] }) });
  t.after(() => f.workflow.destroy()); await f.workflow.ready; f.choose('doc-1'); newer = true; await f.click('refresh');
  assert.equal(f.workflow.state.selected.size, 0); assert.match(f.notices.at(-1), /版本已变化/u);
});

test('submission is single flight and ambiguous errors do not resend the model request', async t => {
  let reject, requests = 0;
  const f = fixture(undefined, { createProposal: () => { requests++; return new Promise((resolve, fail) => { reject = fail; }); } });
  t.after(() => f.workflow.destroy()); await f.workflow.ready; f.choose('doc-1'); f.input('construction-title', '标题');
  const pending = f.submit('construction-build'); await f.submit('construction-build'); assert.equal(requests, 1);
  reject(new ApiError(504, '请求超时')); await pending; await f.submit('construction-build');
  assert.equal(requests, 1); assert.equal(f.workflow.state.writeUnknown, true); assert.match(f.container.innerHTML, /提交结果待核对/u);
});

test('maintenance is read-only, shows safe reasons and links to existing detail workflows', async t => {
  const f = fixture({ view: 'quality' }); t.after(() => f.workflow.destroy()); await f.workflow.ready;
  assert.deepEqual(f.calls, [['maintenance', 'all', 0]]);
  assert.match(f.container.innerHTML, /&lt;script&gt;资料名&lt;\/script&gt;/u); assert.doesNotMatch(f.container.innerHTML, /<script>/u);
  assert.match(f.container.innerHTML, /href="#\/documents\/doc-1"/u); assert.match(f.container.innerHTML, /原文件相同/u);
  await f.filter('index_failed'); assert.deepEqual(f.calls.at(-1), ['maintenance', 'index_failed', 0]);
  assert.equal(f.navigations.length, 0);
});

test('knowledge updates use the server stale category rather than guessing from the current page', async t => {
  const f = fixture({ view: 'knowledge-updates' }); t.after(() => f.workflow.destroy()); await f.workflow.ready;
  assert.deepEqual(f.calls, [['maintenance', 'stale_knowledge', 0]]);
});

test('source comparison labels bounded excerpts and refresh sends both base and publication snapshot', async t => {
  const f = fixture({ view: 'knowledge-updates', id: 'p1' }); t.after(() => f.workflow.destroy()); await f.workflow.ready;
  assert.match(f.container.innerHTML, /对比原文摘录/u); assert.match(f.container.innerHTML, /部分摘录/u); assert.match(f.container.innerHTML, /href="#\/knowledge\/p1\/3"/u);
  assert.equal(f.calls.length, 1); f.change('construction-method', 'model'); await f.submit('construction-refresh');
  assert.deepEqual(f.calls[1], ['refresh', 'p1', { base_version: 3, generation_method: 'model', source_versions: [{ document_id: 'doc-1', publication_id: 'pub-new' }] }]);
  assert.deepEqual(f.navigations, ['#/review/proposal-2']);
});

test('unavailable sources cannot be silently dropped to refresh a knowledge page', async t => {
  const f = fixture({ view: 'knowledge-updates', id: 'p1' }, { getSourceChanges: async () => ({ ...changes, can_refresh: false, sources: [{ ...changes.sources[0], status: 'unavailable', after: null }] }) });
  t.after(() => f.workflow.destroy()); await f.workflow.ready; await f.submit('construction-refresh');
  assert.match(f.container.innerHTML, /部分来源不可用/u); assert.doesNotMatch(f.container.innerHTML, /id="construction-refresh"/u); assert.equal(f.calls.length, 0);
});

test('a late read after leaving cannot replace the next route and listeners are removed', async () => {
  let resolve, signal;
  const f = fixture({ view: 'quality' }, { listMaintenance: options => { signal = options.signal; return new Promise(done => { resolve = done; }); } });
  f.workflow.destroy(); assert.equal(signal.aborted, true); f.container.innerHTML = '新页面';
  resolve({ offset: 0, limit: 20, total: 0, items: [], counts: {} }); await f.workflow.ready;
  assert.equal(f.container.innerHTML, '新页面'); assert.deepEqual(f.listeners, {});
});

test('malformed pages fail visibly rather than claiming a complete empty collection', async t => {
  const f = fixture(undefined, { listBatchSources: async () => ({ batch_id: 'another', offset: 0, limit: 50, total: 0, items: [], folders: [] }) });
  t.after(() => f.workflow.destroy()); await f.workflow.ready;
  assert.match(f.container.innerHTML, /数据与预期不一致/u); assert.doesNotMatch(f.container.innerHTML, /找到 0 份/u);
});

test('a version conflict drops selections from other pages that this page cannot re-check', async t => {
  let version = 'pub-1';
  const f = fixture(undefined, {
    listBatchSources: async (id, { offset, limit }) => { const all = Array.from({ length: 51 }, (_, i) => ({ ...source(i + 1), ...(i === 0 ? { publication_id: version } : {}) })); return { batch_id: id, offset, limit, total: 51, folders: [], items: all.slice(offset, offset + limit) }; },
    createProposal: async command => { f.calls.push(['create', command]); if (command.source_versions.some(item => item.document_id === 'doc-1' && item.publication_id !== version)) throw new ApiError(409, '所选来源版本已改变，请刷新来源后再生成提案。'); return { id: 'proposal-1' }; },
  });
  t.after(() => f.workflow.destroy()); await f.workflow.ready;
  f.choose('doc-1'); f.input('construction-title', '主题'); await f.click('next'); f.choose('doc-51');
  version = 'pub-1b'; await f.submit('construction-build');
  assert.equal(f.workflow.state.writeUnknown, false); assert.deepEqual([...f.workflow.state.selected.keys()], ['doc-51']);
  assert.match(f.notices.at(-1), /已取消 1 份不在当前页/u); assert.match(f.container.innerHTML, /所选来源版本已改变/u);
  await f.click('prev'); f.choose('doc-1'); await f.submit('construction-build');
  assert.equal(f.calls.at(-1)[1].source_versions.find(item => item.document_id === 'doc-1').publication_id, 'pub-1b');
  assert.deepEqual(f.navigations, ['#/review/proposal-1']);
});

test('a list that shrank below the current page shows its last page instead of an empty range', async t => {
  let total = 51;
  const f = fixture(undefined, { listBatchSources: async (id, { offset, limit }) => { f.calls.push(['sources', id, offset]); const all = Array.from({ length: total }, (_, i) => source(i + 1)); return { batch_id: id, offset, limit, total, folders: [], items: all.slice(offset, offset + limit) }; } });
  t.after(() => f.workflow.destroy()); await f.workflow.ready; await f.click('next'); total = 40; await f.click('refresh');
  assert.equal(f.workflow.state.offset, 0); assert.equal(f.calls.at(-1)[2], 0);
  assert.match(f.container.innerHTML, /1–40 \/ 40/u); assert.doesNotMatch(f.container.innerHTML, /51–50/u);
});

test('counts from the server are rendered only as non-negative integers', async t => {
  const hostile = '<img src=x onerror=alert(1)>';
  const f = fixture({ view: 'knowledge-updates', id: 'p1' }, { getSourceChanges: async () => ({ ...changes, sources: [{ ...changes.sources[0], after: { ...changes.sources[0].after, part_count: hostile, text_characters: hostile } }] }) });
  t.after(() => f.workflow.destroy()); await f.workflow.ready;
  assert.doesNotMatch(f.container.innerHTML, /<img/u); assert.match(f.container.innerHTML, /0 个片段 · 0 字符/u);
  const b = fixture(undefined, { listBatchSources: async (id, { offset, limit }) => ({ batch_id: id, offset, limit, total: 1, folders: [{ path: '目录', count: hostile }], items: [source(1)] }) });
  t.after(() => b.workflow.destroy()); await b.workflow.ready;
  assert.doesNotMatch(b.container.innerHTML, /<img/u); assert.match(b.container.innerHTML, /目录（0）/u);
});
