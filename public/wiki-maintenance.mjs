import { ApiError, documentDownloadOnly } from './api.mjs';
import { batchFeedback, parseTags, checkedTask, checkedIndexTask, taskPending, taskLabel, indexTaskLabel, canStartIndexing, documentStatusLabel } from './workbench-state.mjs';
import { CleanupSession, cleanupEnabled, cleanupLabel, cleanupResourceLabel } from './document-cleanup.mjs';
import { DocumentOriginalSession } from './document-originals.mjs';
import { DocumentReplacementSession, replacementsEnabled, replacementLabel, replacementAccept } from './document-replacements.mjs';
import { SynopsisSession, synopsisEnabled, canGenerateSynopsis } from './file-synopsis.mjs';
import { TagSuggestionSession, tagSuggestionsEnabled, canReadTagSuggestions } from './tag-suggestions.mjs';
import { ImageVectorSession, imageVectorsEnabled, canReadImageVector } from './image-vectors.mjs';
import { AudioVectorSession, audioVectorsEnabled, canReadAudioVector } from './audio-vectors.mjs';
import { SoundIndexSession, soundEnabled, canReadSoundIndex } from './sound-library.mjs';
import { VideoAvIndexSession, videoAvEnabled, canReadVideoAvIndex } from './video-av.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const safeError = error => error instanceof ApiError ? error.message : '操作未完成，请刷新状态后核对。';
const invalid = () => new ApiError(502, '资料或任务状态不一致，请刷新后核对。');
const cap = (config, name) => config?.capabilities?.includes(name) === true;
const typeLabels = { document: '文档', image: '图片', audio: '音频', video: '视频' };
const vectorOptions = config => ({ allowPublishedDuringReindex: cap(config, 'text_reindex_with_vectors') });

export function maintenanceCanReindex(config, item) {
  return ['text_index', 'indexings', 'text_reindex'].every(name => cap(config, name)) && item?.can_reindex === true
    && item.status === 'parsed' && item.synthetic_fixture === false && item.latest_job?.state === 'parsed'
    && idValid(item.active_revision_id) && item.active_revision_id === item.latest_job.revision_id
    && idValid(item.index_publication_id) && !taskPending(item.latest_index_job);
}

/** Recover only server-owned latest tasks. This is not an invented task history. */
export function restoredMaintenanceTasks(rows) {
  return rows.flatMap(row => [['ingestion', row.latest_job], ['indexing', row.latest_index_job]].flatMap(([kind, value]) => {
    if (!value) return [];
    const task = kind === 'indexing' ? checkedIndexTask(value) : checkedTask(value);
    if (task.document_id !== row.document_id) throw invalid();
    return [{ kind, task, document: row }];
  }));
}

// Admission progress is not an index job: it has no invented task id or retry action.
const automaticIndexRows = rows => rows.filter(row => ['pending', 'dispatching', 'failed'].includes(row.auto_index?.state));
const automaticIndexPending = row => ['pending', 'dispatching'].includes(row.auto_index?.state);
const automaticIndexLabel = row => row.auto_index.state === 'failed' ? '索引未完成'
  : row.auto_index.state === 'dispatching' ? '正在准备索引'
  : ['queued', 'processing'].includes(row.status) ? '等待解析完成后索引' : '等待索引';
const automaticIndexFailures = new Map([
  ['text_configuration_required', '请先完成并应用模型配置，再到资料维护中处理。'],
  ['indexing_unavailable', '当前索引模型不可用，请检查模型配置后到资料维护中处理。'],
  ['media_text_configuration_mismatch', '媒体与文字模型配置不一致，请检查模型配置。'],
  ['parsing_incomplete', '原文件尚未解析成功，请先在任务菜单检查解析结果。'],
  ['indexing_interrupted', '索引处理已中断，请到资料维护中检查处理状态。'],
]);
const automaticIndexFailure = code => automaticIndexFailures.get(code) ?? '索引准备未完成，请到资料维护中检查处理状态。';

/** Native maintenance Module; transport and validated media Sessions remain the existing adapters. */
export function mountWikiMaintenance({ container, document, window, api, config, route, navigate, notify = () => {}, confirm = async () => false }) {
  let alive = true, serial = 0, controller = null, timer = null, busy = false, loading = false, error = '', feedback = '';
  let items = [], folders = [], tags = [], total = 0, totalPages = 0, detail = null, initializedDetail = false;
  let page = 1, pageSize = 20, filters = { q: '', type: '', status: '', tag: '', folder_id: '', sort: 'updated_desc' }, taskFilter = 'all';
  const selected = new Set(), unknownTasks = new Set(), panelMarkup = new WeakMap();
  const $ = name => document.getElementById(name);
  const put = (name, html) => { const node = $(name); if (node && panelMarkup.get(node) !== html) { node.innerHTML = html; panelMarkup.set(node, html); } };
  const setTimer = (fn, delay) => window.setTimeout ? window.setTimeout(fn, delay) : setTimeout(fn, delay);
  const clearTimer = value => window.clearTimeout ? window.clearTimeout(value) : clearTimeout(value);
  const sessions = [];
  const onChange = () => { if (alive && initializedDetail) renderPanels(); };
  const options = { onChange, setTimer, clearTimer, onAuthenticationFailure: () => { error = '会话已失效，请重新登录。'; renderStatus(); } };
  const original = new DocumentOriginalSession(api, options);
  const replacement = new DocumentReplacementSession(api, { ...options, onPublished: () => { if (alive) load({ preserveForm: true }); } });
  const synopsis = new SynopsisSession(api, options), suggestions = new TagSuggestionSession(api, options);
  const cleanup = new CleanupSession(api, { ...options, onChange: () => { if (alive) renderCleanup(); } });
  const media = [
    { key: 'image', title: '原图向量', enabled: imageVectorsEnabled, canRead: canReadImageVector, session: new ImageVectorSession(api, options), field: 'vector' },
    { key: 'audio', title: '原声向量', enabled: audioVectorsEnabled, canRead: canReadAudioVector, session: new AudioVectorSession(api, options), field: 'vector' },
    { key: 'sound', title: '声音理解索引', enabled: soundEnabled, canRead: canReadSoundIndex, session: new SoundIndexSession(api, options), field: 'index' },
    { key: 'video', title: '原视频音画索引', enabled: videoAvEnabled, canRead: canReadVideoAvIndex, session: new VideoAvIndexSession(api, options), field: 'index' },
  ];
  sessions.push(original, replacement, synopsis, suggestions, cleanup, ...media.map(item => item.session));
  const action = (name, label, disabled = false, extra = '') => `<button type="button" class="button secondary" data-maintenance-action="${name}" ${disabled || busy ? 'disabled' : ''} ${extra}>${e(label)}</button>`;
  const field = (label, body) => `<div class="field"><label>${label}${body}</label></div>`;
  const select = (name, values, value = '', extra = '') => `<select id="${name}" ${extra}>${values.map(([key, label]) => `<option value="${e(key)}" ${key === value ? 'selected' : ''}>${e(label)}</option>`).join('')}</select>`;
  const folderSelect = (name, value = '', empty = '未分类') => select(name, [['', empty], ...folders.map(folder => [folder.folder_id, folder.name])], value ?? '');
  const notice = text => text ? `<p class="notice error" role="alert">${e(text)}</p>` : '';
  const header = (title, controls = '') => `<div class="page-heading"><div><h1 id="maint-heading">${e(title)}</h1></div><div class="actions">${controls}</div></div>`;
  const panel = (title, body) => `<section class="panel settings-section"><div class="panel-header"><h2>${e(title)}</h2></div><div class="panel-body">${body}</div></section>`;
  function renderStatus() {
    const node = $('maint-status'); if (node) node.innerHTML = notice(error) + (feedback ? `<p class="notice" role="status">${e(feedback)}</p>` : '');
  }
  function pagination() {
    return `<div class="pagination maintenance-actions"><span>${total ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, total)} / ${total}</span>${action('previous', '上一页', loading || page <= 1)}${action('next', '下一页', loading || page >= totalPages)}${select('maint-size', [['20', '20 条'], ['50', '50 条'], ['100', '100 条']], String(pageSize), 'aria-label="每页条数"')}</div>`;
  }
  function renderList() {
    const toolbar = `<a class="button secondary" href="#/directories">目录管理</a><a class="button secondary" href="#/tasks">处理任务</a><a class="button primary" href="#/sources">导入资料</a>${action('refresh', '刷新', loading)}`;
    const filter = `<form id="maint-filter" class="panel panel-body"><div class="form-grid maintenance-filters">${field('搜索资料', `<input id="maint-q" type="search" maxlength="200" value="${e(filters.q)}">`)}${field('类型', select('maint-type', [['', '全部类型'], ...Object.entries(typeLabels)], filters.type))}${field('处理状态', select('maint-state', [['', '全部状态'], ['queued', '等待解析'], ['processing', '正在解析'], ['parsed', '已解析'], ['failed', '解析失败'], ['cancelled', '已取消']], filters.status))}${field('目录', folderSelect('maint-filter-folder', filters.folder_id, '全部目录'))}${field('标签', select('maint-filter-tag', [['', '全部标签'], ...tags.map(tag => [tag, tag])], filters.tag))}${field('排序', select('maint-sort', [['updated_desc', '最近更新'], ['updated_asc', '最早更新'], ['name_asc', '名称正序'], ['name_desc', '名称倒序']], filters.sort))}</div><div class="form-actions"><button class="button primary" ${busy ? 'disabled' : ''}>筛选</button>${action('reset', '重置')}</div></form>`;
    const rows = items.map(item => `<tr><td><input type="checkbox" data-maintenance-select="${e(item.document_id)}" aria-label="选择 ${e(item.display_name)}" ${selected.has(item.document_id) ? 'checked' : ''}></td><td><a class="text-link" href="#/documents/${e(item.document_id)}">${e(item.display_name)}</a><div>${e(item.filename)}</div></td><td>${e(typeLabels[item.document_type] ?? item.document_type)}</td><td>${e(documentStatusLabel(item))}</td><td>${e(item.folder_name ?? folders.find(folder => folder.folder_id === item.folder_id)?.name ?? '未分类')}</td><td>${(item.tags ?? []).map(tag => `<span class="badge gray">${e(tag)}</span>`).join(' ')}</td><td><a class="text-link" href="#/documents/${e(item.document_id)}">查看详情</a>${cleanupEnabled(config) ? action('cleanup-row', '删除并清理', false, `data-document-id="${e(item.document_id)}"`) : ''}</td></tr>`).join('');
    container.innerHTML = header('资料维护', toolbar) + '<div id="maint-status"></div>' + filter
      + `<div id="maint-batch"></div><section class="panel maintenance-table"><table class="data-table"><thead><tr><th><input id="maint-select-page" type="checkbox" aria-label="选择当前页" ${items.length && selected.size === items.length ? 'checked' : ''}></th><th>资料</th><th>类型</th><th>处理状态</th><th>目录</th><th>标签</th><th>操作</th></tr></thead><tbody>${rows || `<tr><td colspan="7">${loading ? '正在读取资料…' : '暂无符合条件的资料'}</td></tr>`}</tbody></table></section>${pagination()}<div id="maint-cleanups"></div>`;
    renderStatus(); renderBatch(); renderCleanup();
  }
  function renderBatch() {
    const node = $('maint-batch'); if (!node || route.id) return;
    node.innerHTML = selected.size ? `<section class="panel panel-body"><strong>已选 ${selected.size} 项 · 当前页</strong><div class="form-grid">${cap(config, 'batch_move') ? field('移入目录', folderSelect('maint-batch-folder')) : ''}${cap(config, 'batch_tag') ? field('添加标签', '<input id="maint-batch-tags" maxlength="1000">') : ''}</div><div class="form-actions">${cap(config, 'batch_move') ? action('batch-move', '移动') : ''}${cap(config, 'batch_tag') ? action('batch-tag', '添加标签') : ''}${cap(config, 'batch_text_reindex') ? action('batch-reindex', '重建文本索引') : ''}${cleanupEnabled(config) ? action('batch-cleanup', '删除并清理所选资料') : ''}${action('clear-selection', '取消选择')}</div></section>` : '';
  }
  function renderTasks() {
    const all = restoredMaintenanceTasks(items), entries = all.filter(entry => (taskFilter === 'all' || entry.kind === taskFilter) && (!route.id || entry.task.task_id === route.id));
    const automatic = !route.id && taskFilter !== 'ingestion' ? automaticIndexRows(items).map(row => `<article class="panel panel-body"><div class="panel-header"><h2><a class="text-link" href="#/documents/${e(row.document_id)}">${e(row.display_name ?? row.filename)}</a></h2><span class="badge ${automaticIndexPending(row) ? 'amber' : 'gray'}">${e(automaticIndexLabel(row))}</span></div><p>自动索引</p>${row.auto_index.state === 'failed' ? notice(automaticIndexFailure(row.auto_index.error_code)) : ''}</article>`).join('') : '';
    const list = entries.map(({ task, kind, document: row }) => `<article class="panel panel-body"><div class="panel-header"><h2><a class="text-link" href="#/documents/${e(row.document_id)}">${e(row.display_name ?? row.filename)}</a></h2><span class="badge ${taskPending(task) ? 'amber' : 'gray'}">${e(kind === 'indexing' ? indexTaskLabel(task.state) : task.state === 'parsed' ? '解析完成' : taskLabel(task.state))}</span></div><p>${kind === 'indexing' ? '索引' : '解析'} · 第 ${task.attempt} 次尝试</p><p>任务编号：${e(task.task_id)}</p>${task.error_code ? notice(`失败原因：${task.error_code}`) : ''}${unknownTasks.has(task.task_id) ? notice('上次操作结果待核对，请先刷新任务。') : ''}<div class="form-actions">${action('task-refresh', '刷新任务', false, `data-kind="${kind}" data-task-id="${e(task.task_id)}"`)}${task.can_cancel ? action('task-cancel', '取消任务', unknownTasks.has(task.task_id), `data-kind="${kind}" data-task-id="${e(task.task_id)}"`) : ''}${task.can_retry ? action('task-retry', '重试任务', unknownTasks.has(task.task_id), `data-kind="${kind}" data-task-id="${e(task.task_id)}"`) : ''}</div></article>`).join('');
    container.innerHTML = header('处理任务', `<a class="button secondary" href="#/documents">资料维护</a>${action('refresh', '刷新', loading)}`) + '<div id="maint-status"></div>'
      + `<div class="maintenance-actions"><span>最新任务 · 当前资料页</span>${select('maint-task-filter', [['all', '全部任务'], ['ingestion', '解析'], ['indexing', '索引']], taskFilter, 'aria-label="任务类型"')}</div>${automatic + list || '<section class="panel panel-body">暂无任务</section>'}${route.id ? '<a class="text-link" href="#/tasks">返回任务列表</a>' : pagination()}`;
    renderStatus();
  }
  function renderDirectories() {
    const list = folders.map(folder => `<form id="maint-folder-${e(folder.folder_id)}" data-maintenance-folder="${e(folder.folder_id)}" class="panel panel-body"><div class="form-grid">${field('目录名称', `<input id="maint-folder-name-${e(folder.folder_id)}" value="${e(folder.name)}" maxlength="100" required>`)}</div><div class="form-actions"><button class="button secondary" ${busy ? 'disabled' : ''}>保存名称</button>${action('folder-delete', '删除空目录', false, `data-folder-id="${e(folder.folder_id)}"`)}</div></form>`).join('');
    container.innerHTML = header('目录管理', '<a class="button secondary" href="#/documents">资料维护</a>') + '<div id="maint-status"></div>'
      + `<form id="maint-folder-create" class="panel panel-body"><div class="form-grid">${field('新目录名称', '<input id="maint-folder-new" maxlength="100" required>')}</div><div class="form-actions"><button class="button primary" ${busy ? 'disabled' : ''}>新建目录</button></div></form>${list || '<p>暂无目录</p>'}`; renderStatus();
  }
  function renderDetail() {
    if (!detail) { container.innerHTML = header('资料详情', '<a class="text-link" href="#/documents">返回资料维护</a>') + '<div id="maint-status"></div>'; renderStatus(); return; }
    container.innerHTML = header(detail.display_name ?? detail.filename, `<a class="button secondary" href="#/documents">返回资料维护</a><a class="button secondary" href="#/tasks">处理任务</a>${cleanupEnabled(config) ? action('cleanup', '删除并清理资料') : ''}`) + '<div id="maint-status"></div>'
      + panel('整理信息', `<form id="maint-edit"><div class="form-grid">${field('显示名称', `<input id="maint-name" value="${e(detail.display_name)}" maxlength="255" required>`)}${field('目录', folderSelect('maint-folder', detail.folder_id))}${field('手工标签', `<textarea id="maint-tags" maxlength="1000">${e((detail.tags ?? []).join('，'))}</textarea>`)}</div><div class="form-actions"><button class="button primary" ${busy || !cap(config, 'metadata') ? 'disabled' : ''}>保存整理信息</button></div></form>`)
      + '<div id="maint-evidence"></div><div id="maint-original"></div><div id="maint-replacement"></div><div id="maint-synopsis"></div><div id="maint-suggestions"></div><div id="maint-media"></div><div id="maint-cleanups"></div>';
    initializedDetail = true; renderPanels(); renderStatus(); renderCleanup();
  }
  function renderPanels() {
    if (!alive || !initializedDetail || !detail) return;
    const item = detail;
    const heading = $('maint-heading'); if (heading) heading.textContent = item.display_name ?? item.filename;
    $('maint-evidence').innerHTML = panel('处理与索引', `<p>${e(documentStatusLabel(item))}</p><dl class="metadata"><dt>原文件</dt><dd>${e(item.filename)}</dd><dt>当前版本</dt><dd>${e(item.active_revision_id ?? item.latest_job?.revision_id ?? item.registered_revision_id ?? '尚未解析')}</dd></dl><div class="form-actions">${action('refresh', '刷新状态')}${canStartIndexing(config, item) ? action('index', '建立索引') : ''}${maintenanceCanReindex(config, item) ? action('reindex', '重建文本索引', unknownTasks.has(item.document_id)) : ''}</div>`);
    const o = original.value;
    $('maint-original').innerHTML = !cap(config, 'document_originals') ? '' : panel('原始文件', `${action('original', o.phase === 'loading' ? '正在核对原件…' : '读取同版本原件', o.phase === 'loading')}${notice(o.error ? safeError(o.error) : '')}${o.original ? `<div class="form-actions"><a class="button secondary" href="${e(o.original.url)}" download="${e(o.original.filename)}">下载原件</a>${!o.original.downloadOnly ? `<a class="button secondary" href="${e(o.original.url)}" target="_blank" rel="noopener noreferrer">打开原件</a>` : ''}</div>${o.original.text != null ? `<pre class="source-excerpt">${e(o.original.text)}</pre>` : ''}` : ''}`);
    const r = replacement.value, ready = r.phase === 'ready', value = r.replacement;
    put('maint-replacement', !replacementsEnabled(config) ? '' : panel('更新原文件', `<p>${e(replacementLabel(value))}${['uploading', 'indexing', 'loading'].includes(r.phase) ? ' · 正在处理' : ''}</p>${notice(r.error ? safeError(r.error) : '')}<div class="form-actions">${action('replacement-refresh', '刷新新版本状态', ['uploading', 'indexing', 'loading'].includes(r.phase))}${value?.can_index ? action('replacement-index', '建立新版本索引', !ready) : ''}</div>${value?.can_upload ? `<form id="maint-replace"><div class="field"><label for="maint-replace-file">选择新原文件</label><input id="maint-replace-file" type="file" accept="${e(replacementAccept(item.document_type))}" required></div><button class="button secondary" ${!ready || busy ? 'disabled' : ''}>上传新版本</button></form>` : ''}${value?.filename ? `<p>${e(value.filename)} · ${e(value.candidate_revision_id)}</p>` : ''}`));
    renderSynopsis(); renderMedia();
  }
  function renderSynopsis() {
    const s = synopsis.value, has = synopsisEnabled(config) && canGenerateSynopsis(detail);
    const entries = s.synopsis?.entries.map(entry => `<section><h3>${e({ overview: '概览', topic: '主题', term: '术语', timeline: '时间线' }[entry.section])}</h3><p>${e(entry.text)}</p>${entry.evidence.map(reference => action('synopsis-source', `依据 ${reference.ordinal}`, s.sourcePhase === 'loading', `data-entry="${entry.ordinal}" data-source="${reference.ordinal}"`)).join('')}</section>`).join('') ?? '';
    const source = s.source;
    const excerpt = source ? `<section class="panel panel-body"><h3>摘要原始依据</h3><p>${e(source.filename)}</p>${source.text ? `<pre class="source-excerpt">${e(source.text)}</pre>` : ''}<a class="button secondary" href="${e(source.originalUrl)}" download="${e(source.filename)}">下载同版本原件</a>${!documentDownloadOnly(source.media_type) ? `<a class="button secondary" href="${e(source.originalUrl)}" target="_blank" rel="noopener noreferrer">打开原件</a>` : ''}${source.locator.start_us != null ? `<p>${source.locator.start_us / 1000000}–${source.locator.end_us / 1000000} 秒</p>` : ''}${source.frameUrl ? `<img class="source-image" src="${e(source.frameUrl)}" alt="服务器定位的原始帧">` : ''}</section>` : '';
    $('maint-synopsis').innerHTML = !synopsisEnabled(config) ? '' : panel('文件摘要', has ? `<div class="form-actions">${action('synopsis-create', '生成摘要', ['loading', 'creating', 'processing'].includes(s.phase))}${action('synopsis-refresh', '刷新摘要', ['loading', 'creating'].includes(s.phase))}</div><p role="status">${e({ loading: '读取中', creating: '正在创建摘要任务', processing: '正在生成摘要', ready: '摘要已就绪', unavailable: '暂无可用摘要', error: '摘要未完成' }[s.phase] ?? '')}${s.task?.error_code ? ` · ${e(s.task.error_code)}` : ''}</p>${notice(s.error ? safeError(s.error) : '')}${entries}${notice(s.sourceError ? safeError(s.sourceError) : '')}${excerpt}` : '<p>资料索引完成后可生成摘要。</p>');
    const t = suggestions.value, possible = tagSuggestionsEnabled(config) && canReadTagSuggestions(detail, s.synopsis);
    if (t.suggestions && !suggestions.matches(detail, s.synopsis)) { suggestions.close(); return; }
    $('maint-suggestions').innerHTML = !possible ? '' : panel('建议标签', `${action('tags-read', '读取建议标签', ['loading', 'saving'].includes(t.phase))}${notice(t.error ? safeError(t.error) : '')}<div>${(t.suggestions?.candidates ?? []).map(candidate => `<label class="badge gray"><input type="checkbox" data-maintenance-suggestion="${candidate.ordinal}" ${t.selected.includes(candidate.ordinal) ? 'checked' : ''} ${t.suggestions.existing_tags.includes(candidate.tag) || t.phase !== 'ready' ? 'disabled' : ''}>${e(candidate.tag)}</label>`).join(' ')}</div>${t.suggestions ? action('tags-apply', '添加选中标签', !t.selected.length || t.phase !== 'ready') : ''}`);
  }
  function renderMedia() {
    $('maint-media').innerHTML = media.filter(entry => entry.enabled(config) && entry.canRead(detail, vectorOptions(config))).map(entry => {
      const value = entry.session.value, status = value[entry.field]?.status, pending = ['loading', 'building'].includes(value.phase);
      return panel(entry.title, `<p role="status">${e(value.phase === 'building' ? '正在建立' : value.phase === 'loading' ? '读取中' : status === 'available' ? '已就绪' : status === 'missing' ? '尚未建立' : '请读取状态')}</p>${notice(value.error ? safeError(value.error) : '')}<div class="form-actions">${action('media-refresh', '刷新状态', pending, `data-key="${entry.key}"`)}${status === 'missing' ? action('media-build', `建立${entry.title}`, pending || value.phase !== 'ready', `data-key="${entry.key}"`) : ''}${value.phase === 'building' ? action('media-stop', '停止本地等待', false, `data-key="${entry.key}"`) : ''}</div>`);
    }).join('');
  }
  function renderCleanup() {
    const node = $('maint-cleanups'); if (!alive || !node || !cleanupEnabled(config)) return;
    const value = cleanup.value;
    node.innerHTML = panel('清理记录', `${action('cleanup-records', '读取清理记录', value.phase === 'reading' || value.phase === 'requesting')}${notice(value.error ? safeError(value.error) : '')}${value.records.map(item => `<div><p>${e(item.document_id)} · ${e(cleanupLabel(item))}${item.error_code ? ` · ${e(item.error_code)}` : ''}</p>${item.error_code === 'cleanup_wiki_content_retained' ? '<p>关联知识页内容仍保留，尚未完成全部内容清理。请核对关联知识页，再按需在知识页回收站中彻底删除。</p>' : ''}${item.resources.length ? `<details><summary>查看清理阶段</summary><ul>${item.resources.map(resource => `<li>${e(cleanupResourceLabel(resource))}</li>`).join('')}</ul></details>` : ''}${action('cleanup-refresh', '刷新此项', false, `data-document-id="${e(item.document_id)}"`)}${item.cleanup_status === 'not_requested' ? action('cleanup-resume', '继续清理', false, `data-document-id="${e(item.document_id)}"`) : ''}</div>`).join('')}${value.total > value.pageSize ? `<div class="form-actions">${action('cleanup-previous', '上一页记录', value.page <= 1)}${action('cleanup-next', '下一页记录', value.page * value.pageSize >= value.total)}</div>` : ''}`);
  }
  function render() {
    if (!alive) return;
    if (route.view === 'directories') renderDirectories();
    else if (route.view === 'tasks') renderTasks();
    else if (route.id) renderDetail(); else renderList();
  }
  function checkedPage(value) {
    if (!value || !Array.isArray(value.items) || !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.total_pages) || value.total_pages < 0
      || value.items.some(item => !idValid(item.document_id)) || new Set(value.items.map(item => item.document_id)).size !== value.items.length) throw invalid();
    restoredMaintenanceTasks(value.items); return value;
  }
  function query(number = page, size = pageSize, search = filters) {
    return `/v1/management/documents?${new URLSearchParams(Object.entries({ page: number, page_size: size, ...search }).filter(([, value]) => value !== ''))}`;
  }
  async function findRow(signal) {
    let expectedTotal, seen = new Set();
    for (let number = 1; ; number++) {
      const result = checkedPage(await api(query(number, 100, { sort: 'updated_desc' }), { signal }));
      if (expectedTotal !== undefined && expectedTotal !== result.total) throw invalid();
      expectedTotal = result.total;
      for (const item of result.items) { if (seen.has(item.document_id)) throw invalid(); seen.add(item.document_id); }
      const found = route.view === 'tasks' ? result.items.find(item => [item.latest_job?.task_id, item.latest_index_job?.task_id].includes(route.id)) : result.items.find(item => item.document_id === route.id);
      if (found) return { items: [found], total: 1, total_pages: 1 };
      if (seen.size >= result.total) throw new ApiError(404, '资料或最新任务不存在，请返回列表刷新。');
      if (!result.items.length) throw invalid();
    }
  }
  async function load({ preserveForm = false } = {}) {
    if (!alive) return;
    clearTimer(timer); timer = null; controller?.abort(); controller = new AbortController(); const signal = controller.signal, token = ++serial;
    loading = true; error = '';
    if (!initializedDetail) render();
    try {
      if (route.view === 'directories') {
        const result = await api('/v1/management/folders', { signal }); if (!Array.isArray(result?.items)) throw invalid();
        if (alive && token === serial) folders = result.items;
      } else {
        const result = route.id ? await findRow(signal) : checkedPage(await api(query(), { signal }));
        if (!alive || token !== serial) return;
        items = result.items; total = result.total; totalPages = result.total_pages;
        for (const id of selected) if (!items.some(item => item.document_id === id)) selected.delete(id);
        if (route.view !== 'tasks') {
          const [directoryResult, tagResult] = await Promise.all([api('/v1/management/folders', { signal }), api('/v1/management/tags', { signal })]);
          if (!alive || token !== serial) return;
          if (!Array.isArray(directoryResult?.items) || !Array.isArray(tagResult?.items)) throw invalid();
          folders = directoryResult.items; tags = tagResult.items;
        }
        if (route.id && route.view === 'documents') { detail = items[0]; if (original.value.phase !== 'idle' && !original.matches(detail)) original.close(); }
      }
      if (!alive || token !== serial) return;
      loading = false;
      if (preserveForm && initializedDetail) { renderPanels(); renderStatus(); } else render();
      if (detail) await openPanels();
      schedule();
      return true;
    } catch (failure) { if (alive && token === serial) { error = safeError(failure); loading = false; renderStatus(); if (!initializedDetail) render(); } }
  }
  async function openPanels() {
    const work = [];
    if (replacementsEnabled(config) && !replacement.matches(detail)) work.push(replacement.open(detail));
    if (synopsisEnabled(config) && canGenerateSynopsis(detail) && !synopsis.matches(detail)) work.push(synopsis.open(detail));
    for (const entry of media) if (entry.enabled(config) && entry.canRead(detail, vectorOptions(config)) && !entry.session.matches(detail)) work.push(entry.session.open(detail, vectorOptions(config)));
    await Promise.all(work);
  }
  function schedule() {
    clearTimer(timer); timer = null;
    if (alive && !busy && (items.some(automaticIndexPending) || restoredMaintenanceTasks(items).some(entry => taskPending(entry.task)))) timer = setTimer(() => { timer = null; return pollTasks(); }, 1500);
  }
  function replaceTask(before, kind, value, actionName) {
    const next = kind === 'indexing' ? checkedIndexTask(value) : checkedTask(value);
    if (next.task_id !== before.task_id || next.document_id !== before.document_id || next.revision_id !== before.revision_id
      || next.attempt < before.attempt || (actionName && next.attempt !== before.attempt + (actionName === 'retry' ? 1 : 0))
      || (next.attempt === before.attempt && (!taskPending(before) && next.state !== before.state || before.state === 'processing' && next.state === 'queued'))) throw invalid();
    const field = kind === 'indexing' ? 'latest_index_job' : 'latest_job';
    items = items.map(item => item.document_id === next.document_id ? { ...item, [field]: next, [kind === 'indexing' ? 'index_status' : 'status']: next.state } : item);
    if (detail?.document_id === next.document_id) detail = items.find(item => item.document_id === next.document_id);
    unknownTasks.delete(next.task_id); return next;
  }
  async function readTask(entry, token = serial) {
    const next = await api(`/v1/${entry.kind === 'indexing' ? 'indexings' : 'ingestions'}/${encodeURIComponent(entry.task.task_id)}`, { signal: controller?.signal });
    if (!alive || token !== serial) return null;
    return replaceTask(entry.task, entry.kind, next);
  }
  async function pollTasks() {
    if (!alive || busy) return;
    if (items.some(automaticIndexPending)) { await load({ preserveForm: true }); return; }
    const token = serial;
    try {
      let terminal = false;
      for (const entry of restoredMaintenanceTasks(items).filter(item => taskPending(item.task))) {
        const next = await readTask(entry, token); if (!alive || token !== serial) return; if (next && !taskPending(next)) terminal = true;
      }
      if (terminal) await load({ preserveForm: true });
      else { if (initializedDetail) renderPanels(); else render(); schedule(); }
    } catch (failure) { if (alive && token === serial) { error = safeError(failure); renderStatus(); } }
  }
  async function mutation(fn, done) {
    if (!alive || busy) return;
    busy = true; error = ''; clearTimer(timer); timer = null; controller?.abort(); controller = null; const token = ++serial;
    const disabled = new Map([...container.querySelectorAll('button,input,select,textarea')].map(node => [node, node.disabled]));
    for (const node of disabled.keys()) node.disabled = true;
    try {
      const result = await fn(); if (!alive || token !== serial) return;
      if (done) await done(result);
    } catch (failure) { if (alive && token === serial) error = safeError(failure); }
    finally {
      busy = false;
      for (const [node, value] of disabled) if (container.contains(node)) node.disabled = value;
      if (alive) { if (initializedDetail) renderPanels(); else render(); renderStatus(); schedule(); }
    }
  }
  function checkedTags(value, required = false) {
    const values = parseTags(value);
    if (values.length > 20 || required && !values.length || values.some(tag => [...tag].length > 40 || /[\u0000-\u001f\u007f-\u009f]/u.test(tag))) throw new ApiError(422, '标签最多 20 个，每个不超过 40 字。');
    return values;
  }
  async function indexDocument() {
    const row = detail, rebuilding = maintenanceCanReindex(config, row);
    if ((!canStartIndexing(config, row) && !rebuilding) || unknownTasks.has(row.document_id)) return;
    await mutation(async () => {
      unknownTasks.add(row.document_id);
      const result = await api(`/v1/documents/${row.document_id}/${rebuilding ? 'reindex' : 'index'}`, { method: 'POST', ...(rebuilding ? { body: { base_publication_id: row.index_publication_id } } : {}) });
      const task = checkedIndexTask(result);
      if (task.document_id !== row.document_id || task.revision_id !== (row.active_revision_id ?? row.latest_job?.revision_id) || task.attempt !== 1 || task.task_id === row.latest_index_job?.task_id) throw invalid();
      return task;
    }, task => { feedback = '索引任务已创建。'; notify(feedback); navigate(`#/tasks/${encodeURIComponent(task.task_id)}`); });
  }
  async function batch(name) {
    const ids = [...selected]; if (!ids.length) return;
    if (!['move', 'tag', 'cleanup', 'reindex'].includes(name) || name === 'move' && !cap(config, 'batch_move') || name === 'tag' && !cap(config, 'batch_tag')) return;
    if (name === 'cleanup') { await doCleanup(ids); return; }
    const body = { action: name, document_ids: ids };
    if (name === 'move') body.folder_id = $('maint-batch-folder').value || null;
    if (name === 'tag') body.tags = checkedTags($('maint-batch-tags').value, true);
    if (name === 'reindex') {
      if (!cap(config, 'batch_text_reindex')) return;
      const rows = items.filter(item => selected.has(item.document_id) && maintenanceCanReindex(config, item) && !unknownTasks.has(item.document_id));
      if (!rows.length) { error = '选中资料暂不能重建索引，请核对资料状态。'; renderStatus(); return; }
      body.document_ids = rows.map(item => item.document_id); body.base_publication_ids = Object.fromEntries(rows.map(item => [item.document_id, item.index_publication_id]));
    }
    await mutation(async () => {
      if (name === 'reindex') body.document_ids.forEach(id => unknownTasks.add(id));
      return api('/v1/management/document-actions', { method: 'POST', body });
    }, async result => {
      const results = name === 'reindex' ? body.document_ids.map(id => {
        const matches = result?.items?.filter(item => item.document_id === id) ?? [];
        const value = matches.length === 1 ? matches[0] : null;
        return value && typeof value.ok === 'boolean' && (!value.ok || value.receipt?.status === 'queued' && value.receipt.document_id === id)
          ? value : { document_id: id, ok: false, detail: '创建回执待核对，请刷新任务。' };
      }) : result?.items;
      const report = batchFeedback(body.document_ids, results);
      for (const item of report.items) if (item.ok) selected.delete(item.document_id);
      feedback = `${report.succeeded} 项${name === 'reindex' ? '已创建任务' : '已完成'}，${report.failed} 项未完成${ids.length !== body.document_ids.length ? `，${ids.length - body.document_ids.length} 项不符合重建条件` : ''}。`;
      await load();
    });
  }
  async function doCleanup(ids, fromRecord = false) {
    if (!cleanupEnabled(config) || !ids.length) return;
    const names = ids.map(id => { const item = detail?.document_id === id ? detail : items.find(item => item.document_id === id); return item?.display_name ?? item?.filename ?? id; }).join('、');
    if (!await confirm(`删除并清理这 ${ids.length} 份资料（${names}）？资料将从知识库撤下，原文件和索引进入清理流程，无法从本应用恢复。已有知识页不会自动删除，其来源可能失效。`)) return;
    await mutation(() => ids.length === 1 ? cleanup.requestOne(ids[0]) : cleanup.requestBatch(ids), async result => {
      if (!result) return;
      const entries = ids.length === 1 ? [{ document_id: result.document_id, status: 'accepted' }] : result.items;
      const count = entries.filter(item => item.status === 'accepted').length;
      feedback = `${count} 项已受理，${entries.length - count} 项未受理。`;
      if (route.id && count && !fromRecord) navigate('#/documents'); else { selected.clear(); await load({ preserveForm: true }); }
    });
  }
  async function click(event) {
    const node = event.target.closest?.('[data-maintenance-action]'); if (!node || !container.contains(node)) return;
    event.preventDefault(); event.stopPropagation?.(); if (!alive || busy) return;
    const data = node.dataset, name = data.maintenanceAction;
    try {
      if (name === 'refresh') { if (await load({ preserveForm: true })) { unknownTasks.clear(); if (initializedDetail) renderPanels(); else render(); } }
      else if (name === 'previous' && page > 1 || name === 'next' && page < totalPages) { page += name === 'next' ? 1 : -1; selected.clear(); await load(); }
      else if (name === 'reset') { filters = { q: '', type: '', status: '', tag: '', folder_id: '', sort: 'updated_desc' }; page = 1; selected.clear(); await load(); }
      else if (name === 'clear-selection') { selected.clear(); renderList(); }
      else if (name.startsWith('batch-')) await batch(name.slice(6));
      else if (name === 'index' || name === 'reindex') await indexDocument();
      else if (name === 'cleanup') await doCleanup([detail.document_id]);
      else if (name === 'cleanup-row' && items.some(item => item.document_id === data.documentId)) await doCleanup([data.documentId]);
      else if (name === 'cleanup-resume') await doCleanup([data.documentId], true);
      else if (name === 'cleanup-records') await cleanup.loadPage();
      else if (name === 'cleanup-previous' || name === 'cleanup-next') await cleanup.loadPage(cleanup.value.page + (name === 'cleanup-next' ? 1 : -1));
      else if (name === 'cleanup-refresh') await cleanup.load(data.documentId);
      else if (name === 'original' && cap(config, 'document_originals')) await original.open(detail);
      else if (name === 'replacement-refresh' && replacementsEnabled(config)) await replacement.open(detail);
      else if (name === 'replacement-index' && replacementsEnabled(config)) await replacement.index(detail);
      else if (name === 'synopsis-create' && synopsisEnabled(config)) await synopsis.create(detail);
      else if (name === 'synopsis-refresh' && synopsisEnabled(config)) await synopsis.refresh();
      else if (name === 'synopsis-source' && synopsisEnabled(config)) await synopsis.readSource(Number(data.entry), Number(data.source));
      else if (name === 'tags-read' && tagSuggestionsEnabled(config)) await suggestions.load(detail, synopsis.value.synopsis);
      else if (name === 'tags-apply' && tagSuggestionsEnabled(config)) {
        if (JSON.stringify(checkedTags($('maint-tags').value)) !== JSON.stringify(detail.tags ?? [])) throw new ApiError(409, '请先保存手工标签，再添加建议标签。');
        await mutation(() => suggestions.apply(detail, synopsis.value.synopsis), async result => { if (result) { detail = { ...detail, tags: result.tags }; feedback = '已添加选中标签。'; const input = $('maint-tags'); if (input) input.value = detail.tags.join('，'); } });
      }
      else if (name.startsWith('media-')) {
        const entry = media.find(item => item.key === data.key); if (!entry || !entry.enabled(config) || !entry.canRead(detail, vectorOptions(config))) return;
        if (name === 'media-build') await entry.session.build(detail);
        if (name === 'media-refresh') await entry.session.open(detail, vectorOptions(config));
        if (name === 'media-stop') entry.session.stop ? entry.session.stop() : entry.session.close();
      } else if (name.startsWith('task-')) {
        const entry = restoredMaintenanceTasks(items).find(item => item.kind === data.kind && item.task.task_id === data.taskId); if (!entry) return;
        if (name === 'task-refresh') { await readTask(entry); if (initializedDetail) renderPanels(); else render(); schedule(); }
        else {
          const operation = name === 'task-cancel' ? 'cancel' : name === 'task-retry' ? 'retry' : null;
          if (!operation || !cap(config, entry.kind === 'indexing' ? 'indexings' : 'ingestions') || !entry.task[operation === 'cancel' ? 'can_cancel' : 'can_retry'] || unknownTasks.has(entry.task.task_id)) return;
          await mutation(async () => {
            unknownTasks.add(entry.task.task_id);
            const result = await api(`/v1/${entry.kind === 'indexing' ? 'indexings' : 'ingestions'}/${encodeURIComponent(entry.task.task_id)}/${operation}`, { method: 'POST' });
            return replaceTask(entry.task, entry.kind, result, operation);
          }, () => { feedback = operation === 'cancel' ? '任务已取消。' : '已提交一次重试。'; });
        }
      } else if (name === 'folder-delete' && cap(config, 'folders') && folders.some(folder => folder.folder_id === data.folderId) && await confirm('删除这个空目录？目录中的资料不会删除；非空目录无法删除。')) {
        await mutation(() => api(`/v1/management/folders/${encodeURIComponent(data.folderId)}`, { method: 'DELETE' }), () => load());
      }
    } catch (failure) { error = safeError(failure); renderStatus(); }
  }
  async function submit(event) {
    const form = event.target; if (!form.id?.startsWith('maint-')) return;
    event.preventDefault(); event.stopPropagation?.(); if (!alive || busy) return;
    try {
      if (form.id === 'maint-filter') {
        filters = { q: $('maint-q').value.trim(), type: $('maint-type').value, status: $('maint-state').value, folder_id: $('maint-filter-folder').value, tag: $('maint-filter-tag').value, sort: $('maint-sort').value || 'updated_desc' }; page = 1; selected.clear(); await load();
      } else if (form.id === 'maint-edit' && detail && cap(config, 'metadata')) {
        const body = { display_name: $('maint-name').value.trim(), folder_id: $('maint-folder').value || null, tags: checkedTags($('maint-tags').value) };
        if (!body.display_name || body.display_name.length > 255) throw new ApiError(422, '请填写有效的显示名称。');
        await mutation(() => api(`/v1/management/documents/${encodeURIComponent(detail.document_id)}`, { method: 'PATCH', body }), async () => { feedback = '整理信息已保存。'; await load({ preserveForm: true }); });
      } else if (form.id === 'maint-replace' && replacementsEnabled(config)) {
        const file = $('maint-replace-file').files?.[0]; if (!file || !await confirm('上传这个新原文件版本？新版本完成索引后才会替换当前可用版本。')) return;
        await replacement.upload(detail, file);
      } else if (form.id === 'maint-folder-create' && cap(config, 'folders')) {
        const name = $('maint-folder-new').value.trim(); if (!name) return;
        await mutation(() => api('/v1/management/folders', { method: 'POST', body: { name } }), () => load());
      } else if (cap(config, 'folders') && form.dataset?.maintenanceFolder && folders.some(folder => folder.folder_id === form.dataset.maintenanceFolder)) {
        const id = form.dataset.maintenanceFolder, name = $(`maint-folder-name-${id}`).value.trim(); if (!name) return;
        await mutation(() => api(`/v1/management/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }), () => load());
      }
    } catch (failure) { error = safeError(failure); renderStatus(); }
  }
  function change(event) {
    event.stopPropagation?.(); if (!alive || busy) return; const node = event.target;
    if (node.id === 'maint-select-page') { selected.clear(); if (node.checked) items.forEach(item => selected.add(item.document_id)); renderList(); }
    else if (node.dataset?.maintenanceSelect && items.some(item => item.document_id === node.dataset.maintenanceSelect)) { if (node.checked) selected.add(node.dataset.maintenanceSelect); else selected.delete(node.dataset.maintenanceSelect); renderBatch(); }
    else if (node.id === 'maint-size') { pageSize = Number(node.value); if (![20, 50, 100].includes(pageSize)) pageSize = 20; page = 1; selected.clear(); load(); }
    else if (node.id === 'maint-task-filter') { taskFilter = node.value; renderTasks(); }
    else if (node.dataset?.maintenanceSuggestion) suggestions.select(Number(node.dataset.maintenanceSuggestion), node.checked);
  }
  container.addEventListener('click', click); container.addEventListener('submit', submit); container.addEventListener('change', change);
  const ready = load();
  return { ready, destroy() {
    alive = false; serial++; controller?.abort(); clearTimer(timer); timer = null;
    container.removeEventListener('click', click); container.removeEventListener('submit', submit); container.removeEventListener('change', change);
    for (const session of sessions) session.close();
    for (const player of container.querySelectorAll('audio,video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  } };
}
