import { ApiError, escapeHtml as e } from './api.mjs';
import { failureReason } from './failure-reasons.mjs';

const idPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const validId = value => typeof value === 'string' && idPattern.test(value);
const kinds = { topic: '主题', entity: '实体', procedure: '操作指南', overview: '概览' };
const maintenanceLabels = Object.freeze({ parse_failed: '解析失败', index_failed: '索引失败', empty_text: '没有可用文字', duplicate_source: '原文件相同', stale_knowledge: '知识待更新' });
const invalid = () => new ApiError(502, '服务返回的数据与预期不一致，请刷新后重新读取。');
const action = (name, text, disabled = false, primary = false) => `<button id="construction-action-${name}" type="button" class="button ${primary ? 'primary' : 'secondary'}" data-construction-action="${name}" ${disabled ? 'disabled' : ''}>${e(text)}</button>`;
const heading = (title, actions = '') => `<div class="page-heading"><div class="heading-copy"><h1>${e(title)}</h1></div><div class="actions">${actions}</div></div>`;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const pagination = (page, busy) => `<div class="pagination">${action('prev', '上一页', busy || page.offset === 0)}<span>${page.total ? page.offset + 1 : 0}–${page.offset + page.items.length} / ${page.total}</span>${action('next', '下一页', busy || page.offset + page.items.length >= page.total)}</div>`;
const field = (id, label, value, extra = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" value="${e(value)}" ${extra}></div>`;
const method = value => `<div class="field"><label for="construction-method">编译方式</label><select id="construction-method"><option value="extractive" ${value === 'extractive' ? 'selected' : ''}>原文摘编</option><option value="model" ${value === 'model' ? 'selected' : ''}>模型编译</option></select></div>`;

function checkedPage(page, offset, limit) {
  if (!page || !Array.isArray(page.items) || page.offset !== offset || page.limit !== limit
    || !Number.isSafeInteger(page.total) || page.total < 0 || page.items.length > limit
    || page.items.length > Math.max(0, page.total - offset) || offset < page.total && page.items.length === 0) throw invalid();
  return page;
}

/** Explicit construction workflows; reads never compile, index, delete, or accept a proposal. */
export function mountWikiConstruction({ container, document: doc, wiki, route, navigate, notify }) {
  const state = { offset: 0, limit: route.view === 'build' ? 50 : 20, query: '', folder: '', kind: route.view === 'knowledge-updates' ? 'stale_knowledge' : 'all',
    selected: new Map(), title: '', pageKind: 'topic', generation: 'extractive', data: null, loading: true, busy: false, error: '', writeUnknown: false };
  let alive = true, epoch = 0, controller;
  const current = value => alive && value === epoch;
  const $ = id => doc.getElementById(id);
  const errorText = (error, fallback = '读取未完成，请刷新后核对。') => error instanceof ApiError ? error.message : fallback;
  const selectedCount = () => `${state.selected.size} / 50`;
  function sourcePicker() {
    const page = state.data, selected = state.selected;
    const folders = page.folders ?? [];
    const rows = page.items.map(item => `<label class="source-choice construction-source"><input type="checkbox" data-construction-source="${e(item.document_id)}" ${selected.has(item.document_id) ? 'checked' : ''} ${state.busy ? 'disabled' : ''}><span><strong>${e(item.display_name || item.filename)}</strong><span class="row-subtitle">${e(item.relative_path || item.filename)}</span></span><a class="text-link" href="#/sources/${e(item.document_id)}">查看资料</a></label>`).join('');
    return heading('将这批资料整理为知识页', action('refresh', '刷新来源', state.loading || state.busy) + `<a class="button secondary" href="#/imports/${e(route.id)}">返回导入批次</a>`)
      + `<div class="construction-layout"><section class="article-paper"><form id="construction-search" class="toolbar"><div class="search-field"><input id="construction-query" value="${e(state.query)}" placeholder="搜索文件名或路径" aria-label="搜索批次来源"><button class="button secondary" ${state.loading ? 'disabled' : ''}>查找</button></div><select id="construction-folder" class="filter-select" aria-label="选择来源文件夹"><option value="">全部文件夹</option>${folders.filter(folder => folder.path).map(folder => `<option value="${e(folder.path)}" ${state.folder === folder.path ? 'selected' : ''}>${e(folder.path)}（${count(folder.count)}）</option>`).join('')}</select></form><div class="construction-selection"><span>找到 ${page.total} 份可编译资料</span>${action('select-page', '选择本页', state.busy || !page.items.length)}${action('clear-selection', '清空选择', state.busy || !selected.size)}</div><div class="source-selection">${rows || '<div class="empty-state"><h3>没有符合条件的已发布资料</h3></div>'}</div>${pagination(page, state.loading || state.busy)}</section><aside class="side-column"><form id="construction-build" class="panel construction-form"><div class="panel-header"><h2>知识提案</h2><span id="construction-selected-count" class="badge green">已选 ${selectedCount()} 份</span></div><div class="panel-body">${field('construction-title', '知识页标题', state.title, 'required maxlength="200"')}
      <div class="field"><label for="construction-kind">页面类型</label><select id="construction-kind">${Object.entries(kinds).map(([key, label]) => `<option value="${key}" ${state.pageKind === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>${method(state.generation)}<button id="construction-submit" class="button primary" ${state.busy || !selected.size || state.writeUnknown ? 'disabled' : ''}>${state.busy ? '正在生成提案…' : '生成待审阅提案'}</button><a class="text-link" href="#/review">查看更新审阅</a></div></form></aside></div>`;
  }
  function todoList() {
    const page = state.data, updates = route.view === 'knowledge-updates';
    const tabs = `<nav class="source-tabs" aria-label="知识建设待办"><a class="tab ${updates ? 'active' : ''}" href="#/knowledge-updates">知识待更新</a><a class="tab ${updates ? '' : 'active'}" href="#/quality">资料质量</a></nav>`;
    const filter = updates ? '' : `<div class="batch-filters" role="group" aria-label="质量待办类型">${[['all', '全部'], ...Object.entries(maintenanceLabels)].map(([key, label]) => `<button class="button small ${state.kind === key ? 'primary' : 'secondary'}" data-construction-kind="${key}" aria-pressed="${state.kind === key}">${e(label)}（${key === 'all' ? Object.values(page.counts).reduce((sum, value) => sum + value, 0) : page.counts[key] ?? 0}）</button>`).join('')}</div>`;
    const rows = page.items.map(item => `<tr><td><a class="table-title" href="${item.target_type === 'page' ? `#/knowledge-updates/${e(item.target_id)}` : `#/documents/${e(item.target_id)}`}">${e(item.title)}</a></td><td>${e(maintenanceLabels[item.kind])}${item.error_code ? `<div class="muted">${e(failureReason(item.error_code))}</div>` : ''}</td><td class="maint-cell-actions">${item.target_type === 'page' ? `<a class="text-link" href="#/knowledge-updates/${e(item.target_id)}">查看来源变化</a>` : `<a class="text-link" href="#/documents/${e(item.target_id)}">检查资料</a>`}${item.related_document_id ? `<a class="text-link" href="#/sources/${e(item.related_document_id)}">对照相同原文件</a>` : ''}</td></tr>`).join('');
    return heading(updates ? '知识待更新' : '资料质量待办', action('refresh', '刷新') + '<a class="button secondary" href="#/knowledge">知识页</a>') + tabs + filter
      + `<div class="result-count">${page.total} 项待处理</div><div class="table-wrap maintenance-table"><table class="data-table"><thead><tr><th>资料 / 知识页</th><th>待办原因</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="3">当前没有此类待办。</td></tr>'}</tbody></table></div>${pagination(page, state.loading)}`;
  }
  function changes() {
    const data = state.data, status = { current: '来源未变化', updated: '已有新版本', unavailable: '当前来源不可用' };
    const excerpt = (value, label) => value ? `<section><h3>${label}</h3><div class="muted">${count(value.part_count)} 个片段 · ${count(value.text_characters)} 字符</div><p class="preserve-lines">${e(value.excerpt || '没有可展示的文字')}</p>${value.truncated ? '<span class="badge gray">部分摘录</span>' : ''}</section>` : `<section><h3>${label}</h3><p>当前资料未发布或已撤下</p></section>`;
    return heading(`更新：${data.title}`, action('refresh', '刷新来源', state.loading || state.busy) + `<a class="button secondary" href="#/knowledge/${e(data.page_id)}">查看知识页</a><a class="button secondary" href="#/knowledge-updates">返回待更新</a>`)
      + `<div class="article-paper"><div class="status-line"><span class="badge gray">知识页版本 ${data.version}</span><span class="badge ${data.can_refresh ? 'amber' : 'gray'}">${data.sources.filter(source => source.status === 'updated').length} 份来源有新版本</span></div><div class="construction-changes">${data.sources.map(source => `<section class="construction-change"><div class="panel-header"><h2>${e(source.display_name)}</h2><span class="badge ${source.status === 'updated' ? 'amber' : 'gray'}">${status[source.status]}</span></div><details><summary>对比原文摘录</summary><div class="construction-diff">${excerpt(source.before, '知识页原先采用的资料')}${excerpt(source.after, '当前已发布资料')}</div></details><div class="form-actions"><a class="text-link" href="#/sources/${e(source.document_id)}">查看资料</a><a class="text-link" href="#/knowledge/${e(data.page_id)}/${data.version}">查看原知识版本及完整来源</a></div></section>`).join('')}</div>${data.can_refresh ? `<form id="construction-refresh" class="construction-refresh">${method(state.generation)}<button class="button primary" ${state.busy || state.writeUnknown ? 'disabled' : ''}>${state.busy ? '正在生成提案…' : '生成更新提案'}</button></form>` : `<p class="notice">${data.sources.some(source => source.status === 'unavailable') ? '部分来源不可用，请先恢复或更新资料。' : '来源没有新版本，暂不需要更新。'}</p>`}</div>`;
  }
  function render() {
    if (!alive) return;
    const body = !state.data ? `<div class="empty-state"><h3>${state.loading ? '正在读取…' : '尚未读取完成'}</h3>${state.loading ? '' : action('refresh', '重新读取')}</div>`
      : route.view === 'build' ? sourcePicker() : route.id ? changes() : todoList();
    container.innerHTML = (state.error ? `<p class="notice error" role="alert">${e(state.error)}</p>` : '')
      + (state.writeUnknown ? '<p class="notice" role="status">提交结果待核对，请先到<a href="#/review">更新审阅</a>查看，避免重复生成。</p>' : '') + body;
  }
  async function load() {
    controller?.abort(); controller = new AbortController(); const captured = ++epoch;
    state.loading = true; state.error = ''; state.data = null; render();
    try {
      let data;
      if (route.view === 'build') {
        data = checkedPage(await wiki.listBatchSources(route.id, { offset: state.offset, limit: state.limit, q: state.query, folder: state.folder, signal: controller.signal }), state.offset, state.limit);
        if (data.batch_id !== route.id || !Array.isArray(data.folders) || data.items.some(item => !validId(item.document_id) || !validId(item.publication_id))) throw invalid();
      } else if (route.id) {
        data = await wiki.getSourceChanges(route.id, { signal: controller.signal });
        if (data?.page_id !== route.id || !Number.isSafeInteger(data.version) || data.version < 1 || !Array.isArray(data.sources)
          || data.sources.some(source => !validId(source.document_id) || !['current', 'updated', 'unavailable'].includes(source.status))) throw invalid();
      } else {
        data = checkedPage(await wiki.listMaintenance({ offset: state.offset, limit: state.limit, kind: state.kind, signal: controller.signal }), state.offset, state.limit);
        if (!data.counts || Object.values(data.counts).some(count => !Number.isSafeInteger(count) || count < 0)
          || data.items.some(item => !validId(item.target_id) || !['document', 'page'].includes(item.target_type) || !maintenanceLabels[item.kind] || item.related_document_id && !validId(item.related_document_id))) throw invalid();
      }
      if (!current(captured)) return;
      // The list shrank below the current page: show its last page instead of an empty one.
      if (state.offset > 0 && state.offset >= data.total) { state.offset = Math.max(0, Math.floor((data.total - 1) / state.limit) * state.limit); await load(); return; }
      state.data = data;
      if (route.view === 'build') {
        let changed = false;
        for (const item of data.items) { const selected = state.selected.get(item.document_id); if (selected && selected.publication_id !== item.publication_id) { state.selected.delete(item.document_id); changed = true; } }
        if (changed) notify('部分资料版本已变化，已取消其勾选，请重新核对。');
      }
    } catch (error) { if (current(captured) && error.name !== 'AbortError') state.error = errorText(error); }
    finally { if (current(captured)) { state.loading = false; render(); } }
  }
  async function submit(event) {
    if (!['construction-search', 'construction-build', 'construction-refresh'].includes(event.target.id)) return;
    event.preventDefault(); if (state.busy || state.loading || !alive) return;
    if (event.target.id === 'construction-search') { state.query = $('construction-query').value.trim(); state.offset = 0; await load(); return; }
    if (state.writeUnknown) return;
    const captured = epoch;
    if (route.view === 'build' && (!state.title.trim() || [...state.title.trim()].length > 200 || !state.selected.size || state.selected.size > 50)) { notify('请填写 1–200 字的知识页标题，并选择 1–50 份资料。'); return; }
    if (route.view !== 'build' && state.data?.can_refresh !== true) return;
    state.busy = true; state.error = ''; render();
    try {
      const command = route.view === 'build' ? { page_id: null, base_version: 0, title: state.title.trim(), kind: state.pageKind, generation_method: state.generation,
        document_ids: [...state.selected.keys()], source_versions: [...state.selected.values()].map(source => ({ document_id: source.document_id, publication_id: source.publication_id })) }
        : { base_version: state.data.version, generation_method: state.generation, source_versions: state.data.sources.map(source => ({ document_id: source.document_id, publication_id: source.after.publication_id })) };
      const result = route.view === 'build' ? await wiki.createProposal(command) : await wiki.refreshProposal(route.id, command);
      if (!validId(result?.id)) throw invalid();
      if (!current(captured)) return;
      navigate(`#/review/${result.id}`); notify('提案已生成，请审阅后采纳。');
    } catch (error) {
      if (!current(captured)) return;
      state.error = errorText(error, '提交结果未确认，请到更新审阅核对。');
      state.writeUnknown = !(error instanceof ApiError) || error.status === 0 || error.status >= 500;
      // A changed or withdrawn source: selections on other pages cannot be re-checked from here, so
      // they are dropped; 刷新来源 re-checks the ones on this page.
      if (route.view === 'build' && error instanceof ApiError && error.status === 409) {
        const visible = new Set(state.data?.items.map(item => item.document_id) ?? []);
        const hidden = [...state.selected.keys()].filter(id => !visible.has(id));
        hidden.forEach(id => state.selected.delete(id));
        if (hidden.length) notify(`已取消 ${hidden.length} 份不在当前页的资料的勾选，请刷新来源后重新核对。`);
      }
    } finally { if (current(captured)) { state.busy = false; render(); } }
  }
  async function click(event) {
    const target = event.target.closest?.('[data-construction-action], [data-construction-kind]'); if (!target) return;
    event.preventDefault(); if (state.busy || state.loading || !alive) return;
    const name = target.dataset.constructionAction;
    if (target.dataset.constructionKind) { state.kind = target.dataset.constructionKind; state.offset = 0; await load(); }
    else if (name === 'refresh') await load();
    else if (name === 'prev' || name === 'next') { state.offset = Math.max(0, state.offset + (name === 'prev' ? -state.limit : state.limit)); await load(); }
    else if (name === 'clear-selection') { state.selected.clear(); render(); }
    else if (name === 'select-page') {
      const combined = new Map(state.selected); for (const item of state.data.items) combined.set(item.document_id, item);
      if (combined.size > 50) { notify('一个知识提案最多选择 50 份来源，请按主题或文件夹分组。'); return; }
      state.selected = combined; render();
    }
  }
  function change(event) {
    const target = event.target; if (state.busy || !alive) return;
    if (target.dataset?.constructionSource) {
      const source = state.data?.items.find(item => item.document_id === target.dataset.constructionSource); if (!source) return;
      if (target.checked && !state.selected.has(source.document_id) && state.selected.size >= 50) { target.checked = false; notify('一个知识提案最多选择 50 份来源。'); return; }
      if (target.checked) state.selected.set(source.document_id, source); else state.selected.delete(source.document_id);
      const count = $('construction-selected-count'); if (count) count.textContent = `已选 ${selectedCount()} 份`;
      const button = $('construction-submit'); if (button) button.disabled = state.busy || !state.selected.size || state.writeUnknown;
      const clear = $('construction-action-clear-selection'); if (clear) clear.disabled = state.busy || !state.selected.size;
    }
    if (target.id === 'construction-folder') { state.folder = target.value; state.offset = 0; load(); }
    if (target.id === 'construction-kind') state.pageKind = target.value;
    if (target.id === 'construction-method') state.generation = target.value;
  }
  function input(event) { if (event.target.id === 'construction-title') state.title = event.target.value; }
  container.addEventListener('submit', submit); container.addEventListener('click', click); container.addEventListener('change', change); container.addEventListener('input', input);
  const ready = load();
  return { ready, state, destroy() { alive = false; epoch++; controller?.abort(); container.removeEventListener('submit', submit); container.removeEventListener('click', click); container.removeEventListener('change', change); container.removeEventListener('input', input); } };
}
