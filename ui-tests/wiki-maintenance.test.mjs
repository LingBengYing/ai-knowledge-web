import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { mountWikiMaintenance, restoredMaintenanceTasks, maintenanceCanReindex } from '../public/wiki-maintenance.mjs';

const job = (id, state = 'parsed') => ({ task_id: id, document_id: 'doc', revision_id: 'rev', state, attempt: 1, error_code: null, can_cancel: state === 'processing', can_retry: false });
const row = () => ({ document_id: 'doc', filename: 'source.txt', display_name: '资料名称', document_type: 'document', status: 'parsed', synthetic_fixture: false, can_edit: true, can_index: false, can_reindex: true, active_revision_id: 'rev', index_publication_id: 'pub', tags: [], folder_id: null, latest_job: job('parse'), latest_index_job: job('index', 'indexed') });
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(route, overrides = {}, config = { capabilities: ['metadata', 'folders', 'batch_move', 'batch_tag', 'text_index', 'indexings', 'text_reindex', 'batch_text_reindex', 'ingestions'] }) {
  const calls = [], listeners = {}, nodes = new Map(), timers = new Map(); let timerId = 0;
  const container = { innerHTML: '', addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; }, querySelectorAll: () => [], contains: () => true };
  const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, files: [], innerHTML: '', disabled: false }); return nodes.get(id); };
  const api = async (path, options = {}) => {
    calls.push([path, options]);
    if (overrides.api) return overrides.api(path, options);
    if (path.startsWith('/v1/management/documents?')) return { items: [row()], total: 1, total_pages: 1 };
    if (path === '/v1/management/folders') return { items: [{ folder_id: 'folder', name: '手册', document_count: 1 }] };
    if (path === '/v1/management/tags') return { items: ['说明'] };
    if (path === '/v1/management/documents/doc') return row();
    throw new Error('Unexpected path');
  };
  const win = { setTimeout: fn => { const key = ++timerId; timers.set(key, fn); return key; }, clearTimeout: key => timers.delete(key) };
  const changes = [], notices = [], confirmations = [];
  const mounted = mountWikiMaintenance({ container, document: { getElementById: node }, window: win, api, route, config,
    navigate: value => changes.push(value), notify: value => notices.push(value), confirm: async message => { confirmations.push(message); return overrides.confirm !== false; } });
  return { mounted, calls, nodes, timers, changes, notices, confirmations, html: () => container.innerHTML,
    submit: async id => { await listeners.submit?.({ target: { id }, preventDefault() {} }); await tick(); },
    click: async (action, extra = {}) => { await listeners.click?.({ target: { closest: () => ({ dataset: { maintenanceAction: action, ...extra } }) }, preventDefault() {} }); await tick(); },
    change: (id, extra = {}) => listeners.change?.({ target: { id, ...node(id), ...extra } }), node };
}

test('restores real current parsing and indexing tasks with exact document identity', () => {
  assert.deepEqual(restoredMaintenanceTasks([row()]).map(item => [item.kind, item.task.task_id]), [['ingestion', 'parse'], ['indexing', 'index']]);
  assert.throws(() => restoredMaintenanceTasks([{ ...row(), latest_job: { ...job('parse'), document_id: 'other' } }]));
  assert.equal(maintenanceCanReindex({ capabilities: ['text_index', 'indexings', 'text_reindex'] }, row()), true);
  assert.equal(maintenanceCanReindex({ capabilities: ['text_index', 'indexings', 'text_reindex'] }, { ...row(), latest_index_job: job('pending', 'processing') }), false);
});
test('completed parsing task does not contradict the separately published indexing task', async () => {
  const f = fixture({ view: 'tasks' }); await f.mounted.ready;
  assert.match(f.html(), /解析完成/u); assert.match(f.html(), /已索引/u);
  assert.doesNotMatch(f.html(), /已解析 · 未索引/u);
  assert.deepEqual(restoredMaintenanceTasks([row()]).map(entry => entry.task.state), ['parsed', 'indexed']);
  assert.ok(f.calls.every(([, options]) => !options.method || options.method === 'GET'));
  f.mounted.destroy();
});
test('management has native filtering pagination and links, entering never writes', async () => {
  const f = fixture({ view: 'documents' }); await f.mounted.ready;
  assert.match(f.html(), /资料名称/u); assert.match(f.html(), /#\/documents\/doc/u);
  assert.match(f.html(), /maint-filter/u); assert.match(f.html(), /目录管理/u);
  assert.doesNotMatch(f.html(), /classic|iframe/u);
  assert.ok(f.calls.every(([, options]) => !options.method || options.method === 'GET'));
  f.node('maint-q').value = '灯塔'; await f.submit('maint-filter');
  assert.ok(f.calls.some(([path]) => new URL(path, 'http://local').searchParams.get('q') === '灯塔'));
  f.mounted.destroy();
});
test('tasks restore from server rows and cancel only selected task without automatic retry', async () => {
  let saved = { ...row(), latest_job: job('parse', 'processing') };
  const f = fixture({ view: 'tasks' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) return { items: [saved], total: 1, total_pages: 1 };
    if (path === '/v1/ingestions/parse/cancel') { saved = { ...saved, latest_job: { ...job('parse', 'cancelled'), can_retry: true } }; return saved.latest_job; }
    throw new Error('Unexpected path');
  } }); await f.mounted.ready;
  assert.match(f.html(), /正在解析/u); assert.match(f.html(), /最新任务/u); assert.ok(f.timers.size);
  await f.click('task-cancel', { kind: 'ingestion', taskId: 'parse' });
  assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 1);
  assert.match(f.html(), /已取消/u); f.mounted.destroy(); assert.equal(f.timers.size, 0);
});
test('tasks recover automatic indexing admission and follow real server publication without client writes', async () => {
  let saved = { ...row(), index_publication_id: null, latest_index_job: null, auto_index: { state: 'pending', task_id: null, error_code: null } };
  const f = fixture({ view: 'tasks' }, { api: async path => {
    assert.match(path, /^\/v1\/management\/documents\?/u);
    return { items: [saved], total: 1, total_pages: 1 };
  } }); await f.mounted.ready;
  const poll = async () => { const [key, callback] = f.timers.entries().next().value; f.timers.delete(key); await callback(); await tick(); };
  assert.match(f.html(), /等待索引/u); assert.match(f.html(), /自动索引/u); assert.equal(f.timers.size, 1);
  saved = { ...saved, auto_index: { ...saved.auto_index, state: 'dispatching' } }; await poll();
  assert.match(f.html(), /正在准备索引/u);
  saved = { ...saved, auto_index: { state: 'submitted', task_id: 'index', error_code: null }, latest_index_job: job('index', 'processing') }; await poll();
  assert.match(f.html(), /任务编号：index/u); assert.doesNotMatch(f.html(), /自动索引|正在准备索引/u);
  saved = { ...saved, latest_index_job: job('index', 'indexed'), index_publication_id: 'pub' }; await f.click('refresh');
  assert.match(f.html(), /已索引/u); assert.equal(f.timers.size, 0);
  assert.ok(f.calls.every(([, options]) => !options.method || options.method === 'GET'));
  f.mounted.destroy();
});
test('automatic index failure uses fixed safe guidance and never creates retry or fake task controls', async () => {
  let code = 'text_configuration_required';
  const f = fixture({ view: 'tasks' }, { api: async () => ({ items: [{ ...row(), latest_job: null, latest_index_job: null, auto_index: { state: 'failed', task_id: null, error_code: code } }], total: 1, total_pages: 1 }) });
  await f.mounted.ready;
  assert.match(f.html(), /索引未完成/u); assert.match(f.html(), /请先完成并应用模型配置/u);
  assert.doesNotMatch(f.html(), /任务编号|第 \d+ 次|task-retry|task-cancel/u); assert.equal(f.timers.size, 0);
  code = 'untrusted-provider-private-message'; await f.click('refresh');
  assert.match(f.html(), /请到资料维护中检查处理状态/u); assert.doesNotMatch(f.html(), /untrusted-provider|text_configuration_required/u);
  assert.ok(f.calls.every(([, options]) => !options.method || options.method === 'GET')); f.mounted.destroy();
});
test('automatic index polling is aborted on disposal and a failed read is not automatically retried', async () => {
  const pending = { ...row(), latest_job: null, latest_index_job: null, auto_index: { state: 'pending', task_id: null, error_code: null } };
  let reads = 0, release, signal;
  const f = fixture({ view: 'tasks' }, { api: async (_path, options) => {
    if (++reads === 1) return { items: [pending], total: 1, total_pages: 1 };
    signal = options.signal; return new Promise(resolve => { release = resolve; });
  } }); await f.mounted.ready;
  assert.equal(f.timers.size, 1);
  const [key, callback] = f.timers.entries().next().value; f.timers.delete(key); const request = callback(); await tick();
  const before = f.html(); f.mounted.destroy(); assert.equal(signal.aborted, true);
  release({ items: [row()], total: 1, total_pages: 1 }); await request; await tick();
  assert.equal(f.html(), before); assert.equal(f.timers.size, 0);
  let failedReads = 0;
  const g = fixture({ view: 'tasks' }, { api: async () => {
    if (++failedReads > 1) throw new ApiError(503, '任务状态暂不可读');
    return { items: [pending], total: 1, total_pages: 1 };
  } }); await g.mounted.ready;
  const [nextKey, next] = g.timers.entries().next().value; g.timers.delete(nextKey); await next(); await tick();
  assert.equal(g.timers.size, 0); assert.match(g.node('maint-status').innerHTML, /任务状态暂不可读/u); assert.equal(failedReads, 2); g.mounted.destroy();
});
test('detail preserves unsaved metadata when read-only session refreshes and saves only metadata', async () => {
  let saved = row();
  const f = fixture({ view: 'documents', id: 'doc' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) return { items: [saved], total: 1, total_pages: 1 };
    if (path === '/v1/management/documents/doc' && options.method === 'PATCH') { saved = { ...saved, ...options.body }; return saved; }
    return { items: [] };
  } }); await f.mounted.ready;
  assert.match(f.html(), /maint-edit/u); assert.match(f.node('maint-evidence').innerHTML, /重建文本索引/u);
  f.node('maint-name').value = '整理后的名称'; f.node('maint-tags').value = '说明，指南'; f.node('maint-folder').value = 'folder';
  await f.click('refresh');
  assert.equal(f.node('maint-name').value, '整理后的名称'); assert.equal(f.node('maint-tags').value, '说明，指南');
  await f.submit('maint-edit');
  const write = f.calls.find(([path, options]) => path === '/v1/management/documents/doc' && options.method === 'PATCH');
  assert.deepEqual(write[1].body, { display_name: '整理后的名称', folder_id: 'folder', tags: ['说明', '指南'] });
  assert.equal(f.node('maint-heading').textContent, '整理后的名称');
  assert.ok(!f.calls.some(([path]) => path.endsWith('/reindex'))); f.mounted.destroy();
});
test('disposing before a read completes discards it', async () => {
  let release;
  const f = fixture({ view: 'tasks' }, { api: () => new Promise(resolve => { release = resolve; }) });
  f.mounted.destroy(); const before = f.html(); release({ items: [row()], total: 1, total_pages: 1 }); await f.mounted.ready;
  assert.equal(f.html(), before); assert.equal(f.timers.size, 0);
});

test('task retry is capability gated, exactly once, and binds the incremented attempt', async () => {
  const failed = { ...job('parse', 'failed'), error_code: 'parser_failed', can_retry: true };
  const replies = async (path, options = {}) => path.startsWith('/v1/management/documents?') ? { items: [{ ...row(), latest_job: failed }], total: 1, total_pages: 1 }
    : { ...job('parse', 'queued'), attempt: 2, can_cancel: true };
  const f = fixture({ view: 'tasks' }, { api: replies }); await f.mounted.ready;
  await f.click('task-retry', { kind: 'ingestion', taskId: 'parse' }); await f.click('task-retry', { kind: 'ingestion', taskId: 'parse' });
  assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 1); assert.match(f.html(), /第 2 次尝试/u); f.mounted.destroy();
  const disabled = fixture({ view: 'tasks' }, { api: replies }, { capabilities: [] }); await disabled.mounted.ready;
  await disabled.click('task-retry', { kind: 'ingestion', taskId: 'parse' });
  assert.equal(disabled.calls.filter(([, options]) => options.method === 'POST').length, 0); disabled.mounted.destroy();
});

test('batch operations send only selected current-page identities; successful reindex needs a receipt', async () => {
  const f = fixture({ view: 'documents' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) return { items: [row()], total: 1, total_pages: 1 };
    if (path === '/v1/management/document-actions') return { items: [{ document_id: 'doc', ok: true, receipt: { status: 'queued', document_id: 'other' } }] };
    return { items: [] };
  } }); await f.mounted.ready;
  f.change('selected', { checked: true, dataset: { maintenanceSelect: 'doc' } });
  await f.click('batch-reindex');
  const write = f.calls.find(([, options]) => options.method === 'POST');
  assert.deepEqual(write[1].body, { action: 'reindex', document_ids: ['doc'], base_publication_ids: { doc: 'pub' } });
  assert.match(f.node('maint-status').innerHTML, /0 项已创建任务，1 项未完成/u); f.mounted.destroy();
});

test('reindex ambiguous failure stays blocked until successful refresh, never automatically retries', async () => {
  let listFailure = false;
  const f = fixture({ view: 'documents', id: 'doc' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) { if (listFailure) throw new ApiError(503, '状态暂不可读'); return { items: [row()], total: 1, total_pages: 1 }; }
    if (path.endsWith('/reindex')) { listFailure = true; throw new ApiError(502, '请求结果未知'); }
    return { items: [] };
  } }); await f.mounted.ready; await f.click('reindex'); await f.click('refresh'); await f.click('reindex');
  assert.equal(f.calls.filter(([path]) => path.endsWith('/reindex')).length, 1); f.mounted.destroy();
});

test('replacement action preserves old publication and only posts when explicitly submitted', async () => {
  const replacement = { document_id: 'doc', base_revision_id: 'rev', base_publication_id: 'pub', candidate_revision_id: null, pipeline: 'corpus', state: 'none', filename: null, document_type: 'document', media_type: null, source_sha256: null, size_bytes: null, ingestion_task: null, index_task: null, can_upload: true, can_index: false, publication_id: null };
  const f = fixture({ view: 'documents', id: 'doc' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) return { items: [row()], total: 1, total_pages: 1 };
    if (path.startsWith('/v1/documents/doc/replacement')) return options.method === 'POST' ? { ...replacement, candidate_revision_id: 'newrev', state: 'parsed', filename: 'new.docx', media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', source_sha256: 'a'.repeat(64), size_bytes: 5, can_index: true, ingestion_task: { ...job('replacement'), revision_id: 'newrev' } } : replacement;
    return { items: [] };
  } }, { capabilities: ['document_replacements'] }); await f.mounted.ready;
  assert.match(f.node('maint-replacement').innerHTML, /\.docx/u); assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 0);
  f.node('maint-replace-file').files = [new File(['12345'], 'new.docx')]; await f.submit('maint-replace');
  assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 1);
  assert.match(f.node('maint-replacement').innerHTML, /新版本待索引/u); assert.match(f.node('maint-evidence').innerHTML, /<dd>rev<\/dd>/u);
  f.mounted.destroy();
});

test('cleanup cancellation sends nothing and plain rendering escapes untrusted metadata', async () => {
  const f = fixture({ view: 'documents', id: 'doc' }, { confirm: false, api: async path => path.startsWith('/v1/management/documents?') ? { items: [{ ...row(), display_name: '<img onerror="run()">' }], total: 1, total_pages: 1 } : { items: [] } }, { capabilities: ['document_cleanup'] });
  await f.mounted.ready; await f.click('cleanup');
  assert.doesNotMatch(f.html(), /<img/u); assert.match(f.html(), /&lt;img/u); assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 0); f.mounted.destroy();
});

test('document cleanup is visible on rows and detail only with real capability and confirms actual impact', async () => {
  const enabled = { capabilities: ['document_cleanup'] };
  for (const route of [{ view: 'documents' }, { view: 'documents', id: 'doc' }]) {
    const f = fixture(route, { confirm: false }, enabled); await f.mounted.ready;
    assert.match(f.html(), /删除并清理/u);
    const action = route.id ? 'cleanup' : 'cleanup-row';
    assert.match(f.html(), new RegExp(`data-maintenance-action="${action}"`, 'u'));
    await f.click(action, { documentId: 'doc' });
    assert.match(f.confirmations[0], /原文件.*索引/u);
    assert.match(f.confirmations[0], /无法.*恢复/u);
    assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 0);
    f.mounted.destroy();
  }
  const disabled = fixture({ view: 'documents' }, {}, { capabilities: [] }); await disabled.mounted.ready;
  assert.doesNotMatch(disabled.html(), /data-maintenance-action="cleanup-row"/u);
  await disabled.click('cleanup-row', { documentId: 'doc' });
  assert.equal(disabled.confirmations.length, 0); assert.equal(disabled.calls.filter(([, options]) => options.method === 'POST').length, 0);
  disabled.mounted.destroy();
});

test('cleanup records distinguish logical withdrawal from blocked physical storage', async () => {
  const kinds = ['database_payload', 'database_file', 'managed_backups', 'managed_temporaries', 'remote_inventory', 'remote_logical_rows', 'remote_write_terminal', 'remote_physical_storage', 'restore_barrier'];
  const record = { document_id: 'doc', cleanup_id: 'cleanup-one', status: 'deleting', cleanup_status: 'blocked', requested_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z', completed_at: null, error_code: 'physical_cleanup_required', resources: kinds.map(kind => ({ kind, status: kind === 'remote_physical_storage' ? 'blocked' : 'completed' })) };
  const f = fixture({ view: 'documents' }, { api: async path => path.startsWith('/v1/management/document-cleanups?') ? { items: [record], total: 1, page: 1, page_size: 20 } : { items: [row()], total: 1, total_pages: 1 } }, { capabilities: ['document_cleanup'] });
  await f.mounted.ready; await f.click('cleanup-records');
  const html = f.node('maint-cleanups').innerHTML;
  assert.match(html, /已撤下，清理受阻，尚未完成/u);
  assert.match(html, /远端逻辑记录.*已完成/u); assert.match(html, /远端物理存储.*受阻/u);
  assert.doesNotMatch(html, /受控清理已完成|物理擦除完成/u);
  f.mounted.destroy();
});

test('row cleanup explicitly submits once and shows accepted withdrawal without claiming completed cleanup', async () => {
  const kinds = ['database_payload', 'database_file', 'managed_backups', 'managed_temporaries', 'remote_inventory', 'remote_logical_rows', 'remote_write_terminal', 'remote_physical_storage', 'restore_barrier'];
  const record = { document_id: 'doc', cleanup_id: 'cleanup-one', status: 'deleting', cleanup_status: 'pending', requested_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z', completed_at: null, error_code: null, resources: kinds.map(kind => ({ kind, status: 'pending' })) };
  let removed = false;
  const f = fixture({ view: 'documents' }, { api: async (path, options) => {
    if (path === '/v1/documents/doc/cleanup' && options.method === 'POST') { removed = true; return record; }
    return { items: removed ? [] : [row()], total: removed ? 0 : 1, total_pages: removed ? 0 : 1 };
  } }, { capabilities: ['document_cleanup'] });
  await f.mounted.ready; await f.click('cleanup-row', { documentId: 'doc' });
  const writes = f.calls.filter(([, options]) => options.method === 'POST');
  assert.equal(writes.length, 1); assert.equal(writes[0][0], '/v1/documents/doc/cleanup'); assert.equal(writes[0][1].body, undefined);
  assert.match(f.node('maint-status').innerHTML, /1 项已受理/u);
  assert.match(f.node('maint-cleanups').innerHTML, /已撤下，清理待完成/u);
  assert.doesNotMatch(f.node('maint-cleanups').innerHTML, /受控清理已完成/u);
  assert.doesNotMatch(f.html(), /data-maintenance-action="cleanup-row"/u);
  f.mounted.destroy();
});

test('retained Wiki content cleanup reason stays neutral and does not automatically remove knowledge pages', async () => {
  const kinds = ['database_payload', 'database_file', 'managed_backups', 'managed_temporaries', 'remote_inventory', 'remote_logical_rows', 'remote_write_terminal', 'remote_physical_storage', 'restore_barrier'];
  const record = { document_id: 'doc', cleanup_id: 'cleanup-one', status: 'deleting', cleanup_status: 'blocked', requested_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z', completed_at: null, error_code: 'cleanup_wiki_content_retained', resources: kinds.map(kind => ({ kind, status: kind === 'database_payload' ? 'blocked' : 'pending' })) };
  const f = fixture({ view: 'documents' }, { api: async path => path.startsWith('/v1/management/document-cleanups?') ? { items: [record], total: 1, page: 1, page_size: 20 } : { items: [row()], total: 1, total_pages: 1 } }, { capabilities: ['document_cleanup'] });
  await f.mounted.ready; await f.click('cleanup-records');
  const html = f.node('maint-cleanups').innerHTML;
  assert.match(html, /关联知识页内容仍保留，尚未完成全部内容清理/u);
  assert.match(html, /知识页.*彻底删除/u);
  assert.doesNotMatch(html, /原始资料已清理|原文件已全部|受控清理已完成/u);
  assert.equal(f.calls.filter(([, options]) => ['POST', 'DELETE'].includes(options.method)).length, 0);
  f.mounted.destroy();
});

test('original image vector panel reuses full receipt validation and explicit one-shot build', async () => {
  const image = { ...row(), document_type: 'image', filename: 'synthetic.png', index_status: 'indexed', media_info: { mime_type: 'image/png', sha256: 'a'.repeat(64), size_bytes: 128 } };
  const vector = status => ({ status, document_id: 'doc', publication_id: 'pub', source_revision_id: 'rev', source_sha256: 'a'.repeat(64), profile_fingerprint: 'b'.repeat(64), model_revision: 'synthetic-model', dimensions: 4, vector_generation_id: status === 'available' ? 'generation' : null, manifest_sha256: status === 'available' ? 'c'.repeat(64) : null });
  const f = fixture({ view: 'documents', id: 'doc' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) return { items: [image], total: 1, total_pages: 1 };
    if (path.endsWith('/image-vector')) return vector(options.method === 'POST' ? 'available' : 'missing');
    return { items: [] };
  } }, { capabilities: ['image_vector_retrieval', 'visual_answers', 'visual_sources'] }); await f.mounted.ready;
  assert.match(f.node('maint-media').innerHTML, /建立原图向量/u); assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 0);
  await f.click('media-build', { key: 'image' }); await f.click('media-build', { key: 'image' });
  assert.match(f.node('maint-media').innerHTML, /已就绪/u); assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 1); f.mounted.destroy();
});

test('summary and suggested tags are native, read-only until clicks, and preserve manual tag drafts', async () => {
  let current = { ...row(), media_info: { mime_type: 'text/plain', sha256: 'a'.repeat(64), size_bytes: 128 } };
  const summary = { synopsis_id: 'synopsis', document_id: 'doc', publication_id: 'pub', revision_id: 'rev', source_sha256: 'a'.repeat(64), input_fingerprint: 'b'.repeat(64), model_revision: 'model', policy_revision: 'policy', status: 'available', entries: ['overview','topic','term'].map((section, index) => ({ ordinal: index + 1, section, text: '<script>原始摘要内容</script>', interval: null, evidence: [{ ordinal: 1, evidence_id: `e${index}`, kind: 'text', sha256: 'c'.repeat(64), time: null, source_url: `/v1/synopsis-sources/synopsis/${index + 1}/1` }] })) };
  const suggestions = { document_id: 'doc', publication_id: 'pub', revision_id: 'rev', source_sha256: 'a'.repeat(64), synopsis_id: 'synopsis', input_fingerprint: 'b'.repeat(64), model_revision: 'model', synopsis_policy_revision: 'policy', can_apply: true, policy_revision: 'java-synopsis-tags-v1', suggestion_fingerprint: 'd'.repeat(64), existing_tags: [], candidates: [{ ordinal: 1, tag: '灯塔' }] };
  const f = fixture({ view: 'documents', id: 'doc' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) return { items: [current], total: 1, total_pages: 1 };
    if (path.endsWith('/synopsis')) return summary;
    if (path.endsWith('/tag-suggestions')) return suggestions;
    if (path.endsWith('/tag-suggestions/apply')) { current = { ...current, tags: ['灯塔'] }; return current; }
    return { items: [] };
  } }, { capabilities: ['file_synopsis', 'synopsis_sources', 'tag_suggestions'] }); await f.mounted.ready;
  assert.match(f.node('maint-synopsis').innerHTML, /&lt;script&gt;原始摘要内容/u);
  assert.doesNotMatch(f.node('maint-synopsis').innerHTML, /<script>/u);
  assert.ok(!f.calls.some(([, options]) => options.method === 'POST'));
  await f.click('tags-read'); f.change('suggestion', { checked: true, dataset: { maintenanceSuggestion: '1' } });
  f.node('maint-tags').value = '尚未保存'; await f.click('tags-apply');
  assert.match(f.node('maint-status').innerHTML, /请先保存手工标签/u); assert.ok(!f.calls.some(([, options]) => options.method === 'POST'));
  f.node('maint-tags').value = ''; await f.click('tags-apply');
  assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 1); assert.equal(f.node('maint-tags').value, '灯塔'); f.mounted.destroy();
});

for (const kind of ['audio', 'sound', 'video']) test(`native ${kind} specialized index retains the existing receipt protocol and never autobuilds`, async () => {
  const isVideo = kind === 'video', isVector = kind === 'audio';
  const current = { ...row(), document_type: isVideo ? 'video' : 'audio', filename: isVideo ? 'synthetic.mp4' : 'synthetic.wav', index_status: 'indexed', media_info: { mime_type: isVideo ? 'video/mp4' : 'audio/wav', sha256: 'a'.repeat(64), size_bytes: 128 } };
  const pathSuffix = { audio: 'audio-vector', sound: 'sound-index', video: 'video-av-index' }[kind];
  const capabilities = { audio: ['audio_vector_retrieval', 'audio_answers', 'audio_sources'], sound: ['sound_upload', 'sound_index', 'sound_answers', 'sound_sources', 'sound_query_attachments'], video: ['video_av_upload', 'video_av_index', 'video_av_answers', 'video_av_sources'] }[kind];
  const receipt = available => ({ status: available ? 'available' : 'missing', document_id: 'doc', source_revision_id: 'rev', source_sha256: 'a'.repeat(64), profile_fingerprint: 'b'.repeat(64), model_revision: 'model', dimensions: 4, manifest_sha256: available ? 'c'.repeat(64) : null,
    ...(isVector ? { publication_id: 'pub', vector_generation_id: available ? 'generation' : null }
      : { embedding_model_revision: 'embedding-model', publication_id: available ? 'publication' : null, generation_id: available ? 'publication' : null, ...(isVideo ? { window_count: available ? 1 : 0, video_window_count: available ? 1 : 0, audio_window_count: 0 } : { span_count: available ? 1 : 0 }) }) });
  const f = fixture({ view: 'documents', id: 'doc' }, { api: async (path, options = {}) => {
    if (path.startsWith('/v1/management/documents?')) return { items: [current], total: 1, total_pages: 1 };
    if (path.endsWith(`/${pathSuffix}`)) return receipt(options.method === 'POST');
    return { items: [] };
  } }, { capabilities }); await f.mounted.ready;
  assert.match(f.node('maint-media').innerHTML, /尚未建立/u); assert.ok(!f.calls.some(([, options]) => options.method === 'POST'));
  await f.click('media-build', { key: kind }); await f.click('media-build', { key: kind });
  assert.match(f.node('maint-media').innerHTML, /已就绪/u); assert.equal(f.calls.filter(([, options]) => options.method === 'POST').length, 1); f.mounted.destroy();
});
