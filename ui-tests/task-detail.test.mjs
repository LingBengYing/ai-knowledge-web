import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createApi, ApiError, validateUpload } from '../public/api.mjs';
import * as stateModule from '../public/workbench-state.mjs';
import { showNotice } from '../public/notices.mjs';
import * as answerModule from '../public/answers.mjs';

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
  const context = vm.createContext({ ...dom, ...stateModule, ...answerModule, createApi, ApiError, validateUpload, showNotice,
    AbortController, URLSearchParams, setTimeout: () => 1, clearTimeout() {}, confirm: () => false });
  vm.runInContext(`${source}\nglobalThis.app = { state, openDetail, watchTask, loadTask, taskAction, resetContext, loadData,
    showView, navigate, closeDetailPanel, changeFilter, documentQuery, renderControls, renderRows, openAnswers, answerSession,
    setConfirm(value) { globalThis.confirm = value; },
    setApi(value) { api = value; }, configure() { connected = true; config = { capabilities: ['management', 'text_upload', 'ingestions', 'text_index', 'indexings'] }; },
    enableAnswers() { config.capabilities.push('answers','sources'); renderControls(); } };`, context);
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
