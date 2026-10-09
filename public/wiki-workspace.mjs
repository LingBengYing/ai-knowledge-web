import { createApi, DOCUMENT_ACCEPT, DOCUMENT_MIME_TYPES, documentTextPreview, documentDownloadOnly, safeOriginalBlob } from './api.mjs';
import { createWikiWorkspaceApi } from './wiki-workspace-api.mjs';
import { AnswerSession } from './answers.mjs';
import { KnowledgeAgentSession, agentProgressView } from './knowledge-agent.mjs';
import { DocumentOriginalSession } from './document-originals.mjs';
import { PdfPreviewSession } from './pdf-preview.mjs';
import { checkedRetrievalSettings, retrievalSettingsFields, retrievalThresholdHelp } from './retrieval-settings.mjs';
import { ModelConfigurationSession, modelConfigurationEnabled } from './model-configuration.mjs';
import { ModelRebuildSession, modelRebuildEnabled, modelRebuildPending, modelRebuildReason } from './model-rebuild.mjs';
import { documentStatusLabel, indexTaskLabel, taskPending } from './workbench-state.mjs';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const e = escapeHtml;
/** Server timestamps stay milliseconds; presentation uses the browser's local time zone. */
export function formatTimestamp(milliseconds) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return '时间不可用';
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return '时间不可用';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
const ident = /^[A-Za-z0-9_-]{1,128}$/u;
const positive = value => /^[1-9][0-9]*$/u.test(value ?? '') && Number.isSafeInteger(Number(value));
export function parseWorkspaceRoute(hash) {
  const pieces = String(hash || '#/home').replace(/^#\//u, '').split('/');
  const [view, id, third, fourth] = pieces;
  if (pieces.length > 4 || (id && !ident.test(id))) return { view: 'missing' };
  if (view === 'models' && pieces.length === 1) return { view };
  if (['retrieval', 'directories'].includes(view) && pieces.length === 1) return { view };
  if (['documents', 'tasks'].includes(view) && pieces.length <= 2) return { view, ...(id ? { id } : {}) };
  if (view === 'knowledge-deleted' && pieces.length === 1) return { view };
  if (['home', 'ask', 'settings', 'graph', 'compile'].includes(view) && pieces.length <= 2) return { view, ...(id ? { id } : {}) };
  if (['knowledge', 'sources', 'review', 'drafts'].includes(view) && pieces.length <= 2) return { view, ...(id ? { id } : {}) };
  if (view === 'knowledge' && positive(third) && pieces.length === 3) return { view, id, version: Number(third) };
  if (view === 'page-source' && id && positive(third) && ident.test(fourth ?? '') && pieces.length === 4) return { view, id, version: Number(third), sourceId: fourth };
  if (view === 'proposal-source' && id && ident.test(third ?? '') && pieces.length === 3) return { view, id, sourceId: third };
  if (view === 'answer-source' && id && positive(third) && pieces.length === 3) return { view, id, ordinal: Number(third) };
  return { view: 'missing' };
}
export function filterKnowledge(pages, query = '', kind = '') {
  const needle = query.trim().toLocaleLowerCase();
  return pages.filter(page => (!kind || kind === 'all' || page.content.kind === kind) && (!needle ||
    [page.content.title, ...page.content.sections.flatMap(section => [section.heading, section.body])].join('\n').toLocaleLowerCase().includes(needle)));
}
const pageSources = page => page.content.sections.flatMap(section => section.sources);
const pageDeleted = page => page?.state === 'deleted';
const sourceKey = source => JSON.stringify([source.document_id, source.publication_id, source.source_revision_id]);
export function commonSourceRelations(pages) {
  const entries = pages.filter(page => !pageDeleted(page)).map(page => ({ page, keys: new Set(pageSources(page).map(sourceKey)) }));
  const edges = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const shared = [...entries[i].keys].filter(key => entries[j].keys.has(key));
    if (shared.length) edges.push({ from: entries[i].page.page_id, to: entries[j].page.page_id, count: shared.length });
  }
  return edges;
}
export function formatLocator(locator = {}) {
  const textStart = locator.start_code_point ?? locator.start, textEnd = locator.end_code_point ?? locator.end;
  if (Number.isSafeInteger(locator.page) && DOCUMENT_MIME_TYPES.includes(locator.media_type) && locator.media_type !== 'application/pdf') return `解析文本${Number.isSafeInteger(textStart) ? ` · 字符 ${textStart}–${textEnd}` : ''}`;
  if (Number.isSafeInteger(locator.page)) return `第 ${locator.page} 页${Number.isSafeInteger(textStart) ? ` · 字符 ${textStart}–${textEnd}` : ''}`;
  const start = locator.start_us ?? (Number.isFinite(locator.start_ms) ? locator.start_ms * 1000 : null);
  const end = locator.end_us ?? (Number.isFinite(locator.end_ms) ? locator.end_ms * 1000 : null);
  return start !== null && end !== null ? `${start / 1e6}–${end / 1e6} 秒 · ${locator.time_precision ?? '服务器时间区间'}` : '服务器原始来源';
}
const kinds = { topic: '主题', entity: '实体', procedure: '操作指南', overview: '概览' };
const types = { document: '文档', image: '图片', audio: '音频', video: '视频' };
const modelRoles = ['generation', 'embedding', 'rerank'];
const modelRoleLabels = { generation: '生成模型', embedding: '嵌入模型', rerank: '重排模型' };
const modelBusy = value => ['loading', 'saving', 'testing', 'activating'].includes(value?.phase);
const statusText = state => ({ queued: '排队中', processing: '处理中', parsed: '已解析，尚未发布索引', indexed: '已建立索引', failed: '处理失败', cancelled: '已取消', not_indexed: '尚未索引', accepted: '已采纳', pending: '待审阅', dismissed: '已暂不采纳' })[state] ?? state ?? '未处理';
const svg = { book: '<path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v16h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4Zm8 1v16"/>', home: '<path d="m3 10 9-7 9 7v11H3Zm6 11v-8h6v8"/>', file: '<path d="M5 3h9l5 5v13H5Zm9 0v6h5M8 13h8M8 17h6"/>', chat: '<path d="M4 4h16v12H9l-5 4ZM8 8h8M8 12h5"/>', graph: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m11 7-5 9m7-9 5 9M7 18h10"/>', review: '<path d="M9 4H5v17h14V4h-4M9 3h6v4H9Zm-1 11 3 3 5-6"/>', settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', chevron: '<path d="m9 6 6 6-6 6"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>' };
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svg[name] ?? svg.file}</svg>`;
const heading = (eyebrow, title, detail, actions = '') => `<div class="page-heading"><div class="heading-copy"><h1>${e(title)}</h1></div><div class="actions">${actions}</div></div>`;
const empty = (title, detail = '') => `<div class="empty-state">${icon('book')}<h3>${e(title)}</h3></div>`;
const notice = (message, error = false) => `<p class="notice${error ? ' error' : ''}" ${error ? 'role="alert"' : ''}>${e(message)}</p>`;
const button = (action, label, primary = false, attrs = '') => `<button type="button" class="button ${primary ? 'primary' : 'secondary'}" data-action="${action}" ${attrs}>${e(label)}</button>`;

export function createWikiWorkspace({ document: doc = globalThis.document, window: win = globalThis.window, wiki: suppliedWiki, config: suppliedConfig, FormData: FormDataType = globalThis.FormData } = {}) {
  const $ = id => doc.getElementById(id);
  const state = { route: parseWorkspaceRoute(win.location.hash), pages: [], deletedPages: [], drafts: [], proposals: [], catalog: null, sourceDocuments: new Map(), query: '', pageKind: '', sourceKind: '', reviewStatus: 'pending', offset: 0, turns: [], question: '', pendingFiles: [], busy: false, loading: false, data: null, config: suppliedConfig, error: null, settings: null };
  let wiki = suppliedWiki, api = suppliedWiki?.request, epoch = 0, readController, pollTimer, toastTimer;
  const setPollTimer = win.setTimeout?.bind(win) ?? setTimeout, clearPollTimer = win.clearTimeout?.bind(win) ?? clearTimeout;
  let original, pdf, workflow, objectUrls = [], pendingConfirmation = null;
  let modelSession, rebuildSession, renderedModelVersion, modelLocalError = '';
  let activeQuestion = null, pendingQuestion = null, pendingPurge = false;
  let renderedChatContainer, renderedChatMarkup;
  const isCurrent = value => value === epoch;
  const notify = message => { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); };
  const errorMessage = error => error?.status === 401 ? '当前会话不可用，请在模型与管理入口连接后重试。' : error?.message ?? '请求未完成，请刷新读取后核对。';
  const linkPage = page => `#/knowledge/${page.page_id}`;
  const pageName = id => state.pages.find(page => page.page_id === id)?.content.title ?? id;
  const navigate = hash => { if (win.location.hash === hash) load(); else win.location.hash = hash; };
  function finishConfirmation(accepted) {
    const pending = pendingConfirmation;
    if (!pending) return;
    pendingConfirmation = null;
    $('action-confirm-dialog').close();
    pending.resolve(accepted && pending.epoch === epoch);
  }
  function confirmOperation(title, message) {
    if (pendingConfirmation || state.busy) return Promise.resolve(false);
    return new Promise(resolve => {
      pendingConfirmation = { resolve, epoch };
      $('action-confirm-title').textContent = title;
      $('action-confirm-message').textContent = message;
      $('action-confirm-dialog').showModal();
      $('action-confirm-cancel').focus();
    });
  }
  $('action-confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); finishConfirmation(false); });
  $('action-confirm-dialog').addEventListener('close', () => { if (!$('action-confirm-dialog').open) finishConfirmation(false); });
  function cleanup() {
    finishConfirmation(false);
    workflow?.destroy(); workflow = null;
    abandonQuestion();
    modelSession?.close(); rebuildSession?.close(); modelSession = null; rebuildSession = null; renderedModelVersion = undefined; modelLocalError = '';
    clearPollTimer(pollTimer); readController?.abort(); original?.close(); original = null; pdf?.close(); pdf = null;
    for (const media of doc.querySelectorAll?.('audio,video') ?? []) { media.pause?.(); media.removeAttribute?.('src'); media.load?.(); }
    objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls = [];
  }
  const blobUrl = blob => { const url = URL.createObjectURL(blob); objectUrls.push(url); return url; };
  function frame() {
    const view = state.route.view;
    const nav = [['home', 'home', '知识总览'], ['knowledge', 'book', '知识页'], ['sources', 'file', '原始资料'], ['ask', 'chat', '知识问答'], ['retrieval', 'search', '召回测试'], ['tasks', 'review', '处理任务'], ['graph', 'graph', '知识关系'], ['review', 'review', '更新审阅'], ['settings', 'settings', '空间设置']];
    const active = ['drafts', 'compile', 'page-source', 'knowledge-deleted'].includes(view) ? 'knowledge' : view === 'proposal-source' ? 'review' : view === 'answer-source' ? 'ask' : view === 'models' ? 'settings' : ['documents', 'directories'].includes(view) ? 'sources' : view;
    const label = ({ models: '模型设置', documents: '资料维护', directories: '目录管理' })[view] ?? nav.find(item => item[0] === active)?.[2] ?? '来源阅读';
    $('sidebar').innerHTML = `<a class="brand" href="#/home"><span class="brand-mark">${icon('book')}</span><span><strong class="workspace-name">知序</strong></span></a><div class="nav-section-label">团队知识空间</div><nav aria-label="主导航">${nav.map(([id, glyph, title]) => `<a class="nav-item ${active === id ? 'active' : ''}" href="#/${id}" ${active === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${title}</span></a>`).join('')}</nav><div class="nav-section-label">最近知识页</div><div class="sidebar-pages">${state.pages.slice(0, 4).map(page => `<a class="page-link" href="${linkPage(page)}">${icon('book')}<span>${e(page.content.title)}</span></a>`).join('')}</div><div class="sidebar-bottom"><div class="workspace-account"><span class="user-avatar">知</span><span><strong>团队共享空间</strong></span></div></div>`;
    $('topbar').innerHTML = `<div class="breadcrumbs"><a href="#/home">团队知识空间</a>${icon('chevron')}<span>${e(label)}</span></div><div class="topbar-actions"><a class="icon-button" href="#/knowledge" title="查找知识" aria-label="查找知识">${icon('search')}</a><a class="button small secondary" href="#/models">模型设置</a></div>`;
    doc.title = `${label} · 知序`;
  }
  const searchForm = placeholder => `<form class="search-field" id="catalog-search">${icon('search')}<input id="source-query" name="query" value="${e(state.query)}" placeholder="${e(placeholder)}" aria-label="${e(placeholder)}"><button class="button small secondary">查找</button></form>`;
  const pageCard = page => `<a class="topic-card" href="${linkPage(page)}"><div class="topic-meta"><span class="topic-icon">${icon('book')}</span><span class="badge ${page.source_state === 'stale' ? 'amber' : 'green'}">${e(kinds[page.content.kind])} · v${page.version}</span></div><h3>${e(page.content.title)}</h3><p>${e(page.content.sections[0]?.body?.slice(0, 130) ?? '')}</p><div class="topic-footer"><span>${new Set(pageSources(page).map(sourceKey)).size} 份来源${page.source_state === 'stale' ? ' · 来源已变化' : ''}</span>${icon('arrow')}</div></a>`;
  const sourceMini = source => `<a class="source-mini" href="#/sources/${e(source.document_id)}"><span class="file-icon">${icon('file')}</span><span class="file-meta"><strong>${e(source.display_name || source.filename)}</strong><span>${e(types[source.kind])} · ${source.answerable ? '已发布，可参与问答' : e(statusText(source.state))}</span></span>${icon('chevron')}</a>`;
  function home() {
    return `${heading('YOUR KNOWLEDGE, CONNECTED', '知识总览', '原始资料保留依据，知识页组织理解，更新由你审阅。', button('import', '导入资料', true))}<div class="stats-row"><a class="stat" href="#/knowledge"><span>知识页</span><strong>${state.pages.length}<small>篇</small></strong></a><a class="stat" href="#/sources"><span>原始资料</span><strong>${state.catalog.total}<small>份</small></strong></a><a class="stat" href="#/review"><span>待你确认</span><strong>${state.data.pendingTotal}<small>项</small></strong></a></div><div class="overview-layout"><div class="main-column"><form id="home-question" class="ask-launch"><label for="home-input">想了解什么？</label><textarea id="home-input" name="question" rows="2" placeholder="描述你想了解的主题、事实或操作步骤…" required></textarea><footer><button class="button primary small">提问 ${icon('arrow')}</button></footer></form><div class="section-heading"><h2>从主题开始探索</h2><a class="text-link" href="#/compile">从资料编译知识页 ${icon('arrow')}</a></div><div class="topic-grid">${state.pages.slice(0, 4).map(pageCard).join('')}</div>${!state.pages.length ? empty('还没有知识页', '导入并索引资料后，创建编译提案，审阅后即可成为知识页。') : ''}</div><aside class="side-column"><section class="panel"><div class="panel-header"><h2>最近资料</h2><a class="text-link" href="#/sources">查看全部</a></div>${state.catalog.items.slice(0, 4).map(sourceMini).join('') || empty('资料库为空')}</section><a class="review-callout" href="#/review">${icon('review')}<span><strong>更新审阅</strong></span>${icon('arrow')}</a><section class="panel"><div class="panel-body"><strong>草稿箱</strong><a class="text-link" href="#/drafts">查看草稿</a></div></section></aside></div>`;
  }
  function knowledge() {
    if (state.route.id) {
      const page = state.data, relations = commonSourceRelations(state.pages).filter(edge => edge.from === page.page_id || edge.to === page.page_id);
      const actions = pageDeleted(page) ? pageLifecycleButton(page) : `<a class="button primary" href="#/compile/${e(page.page_id)}">编译更新提案</a>${pageLifecycleButton(page)}`;
      return `${heading('KNOWLEDGE PAGE', page.content.title, '', actions)}<div class="article-layout"><article class="article-paper"><div class="article-header"><span class="badge green">${e(kinds[page.content.kind])}</span>${pageDeleted(page) ? '<span class="badge gray">已删除</span>' : ''}<span class="badge gray">版本 ${page.version}</span><time>${e(formatTimestamp(page.created_at))}</time><form class="version-form" id="version-form"><label for="version">查看版本</label><input id="version" name="version" type="number" min="1" value="${page.version}" required><button class="button small secondary">读取</button></form></div>${!pageDeleted(page) && page.source_state === 'stale' ? notice('来源已变化，请编译更新。') : ''}<div class="article-body knowledge-body">${sections(page.content, source => `#/page-source/${page.page_id}/${page.version}/${source.id}`)}</div></article><aside class="side-column"><section class="panel"><div class="panel-header"><h2>关联知识</h2></div><div class="panel-body">${relations.map(edge => { const id = edge.from === page.page_id ? edge.to : edge.from; return `<a class="related-item" href="#/knowledge/${e(id)}">${icon('book')}<span>${e(pageName(id))}</span><span>${edge.count} 份共同来源</span></a>`; }).join('') || '<p class="muted">暂无关联知识</p>'}</div></section><button class="button secondary" data-ask="${e(page.content.title)}讲了什么？">围绕此主题提问</button></aside></div>`;
    }
    const deleted = state.route.view === 'knowledge-deleted', all = deleted ? state.deletedPages : state.pages;
    const pages = filterKnowledge(all, state.query, state.pageKind);
    return `${heading('KNOWLEDGE', '知识页', '', '<a class="button primary" href="#/compile">从资料编译</a><a class="button secondary" href="#/drafts">草稿箱</a>')}<nav class="source-tabs" aria-label="知识页状态"><a class="tab ${deleted ? '' : 'active'}" href="#/knowledge" ${deleted ? '' : 'aria-current="page"'}>知识页</a><a class="tab ${deleted ? 'active' : ''}" href="#/knowledge-deleted" ${deleted ? 'aria-current="page"' : ''}>已删除</a></nav><div class="toolbar">${searchForm('搜索知识页标题或正文')}<select id="page-kind" class="filter-select" aria-label="知识页类型"><option value="">所有类型</option>${Object.entries(kinds).map(([key, label]) => `<option value="${key}" ${state.pageKind === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="result-count">${pages.length} / ${all.length} 篇</div><div class="topic-grid knowledge-grid">${pages.map(page => `<div class="knowledge-item">${pageCard(page)}<div class="knowledge-item-actions">${pageLifecycleButton(page)}</div></div>`).join('')}</div>${!pages.length ? empty(deleted ? '没有已删除的知识页' : '没有匹配的知识页') : ''}`;
  }
  function pageLifecycleButton(page) {
    const attrs = `data-page="${e(page.page_id)}" ${state.busy ? 'disabled' : ''}`;
    return pageDeleted(page) ? button('restore-page', '恢复知识页', false, attrs) + button('purge-page', '彻底删除', false, attrs)
      : button('delete-page', '删除知识页', false, attrs);
  }
  function sections(content, path) { return content.sections.map(section => `<section><h2>${e(section.heading)}</h2><p class="preserve-lines">${e(section.body)}</p><div class="provenance">${section.sources.map((source, i) => `<a class="source-ref" href="${path(source)}">原始来源 ${i + 1}${source.current === false ? '（已变化）' : ''}</a>`).join('')}</div></section>`).join(''); }
  function sources() {
    if (state.route.id) {
      const item = state.data.document;
      return `${heading('SOURCE READER', item.display_name || item.filename, '', '<a class="button secondary" href="#/sources">返回资料列表</a>')}<div class="article-layout"><article class="article-paper"><div class="status-line"><span id="source-processing-status" class="badge gray">${e(sourceStatus(item))}</span></div><div id="reader">${empty('正在核对原文件…')}</div></article><aside class="side-column"><section class="panel"><div class="panel-header"><h2>资料信息</h2></div><div class="panel-body reader-meta"><dl class="meta-list"><dt>原文件名</dt><dd>${e(item.filename)}</dd><dt>类型</dt><dd>${e(types[item.document_type])}</dd></dl>${button('refresh', '刷新处理状态')}<a class="button secondary" href="#/tasks">查看处理任务</a></div></section><button class="button secondary" data-ask="${e(item.display_name || item.filename)}讲了什么？">了解相关内容</button><a class="button secondary" href="#/documents/${e(item.document_id)}">整理 / 更新原文件</a></aside></div>`;
    }
    const cat = state.catalog;
    return `${heading('SOURCES', '原始资料', '', '<a class="button secondary" href="#/documents">资料维护</a><a class="button secondary" href="#/directories">目录管理</a>' + button('import', '导入资料', true))}<div class="toolbar">${searchForm('搜索文件名或正文')}<select id="source-kind" class="filter-select" aria-label="资料类型"><option value="">所有类型</option>${Object.entries(types).map(([key, value]) => `<option value="${key}" ${state.sourceKind === key ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="result-count">找到 ${cat.total} 份资料 · 当前显示 ${cat.items.length} 份</div><div class="table-wrap"><table class="data-table"><thead><tr><th>资料名称 / 匹配片段</th><th>类型</th><th>处理状态</th><th>可用于问答</th></tr></thead><tbody>${cat.items.map(item => `<tr><td><a class="table-title" href="#/sources/${e(item.document_id)}"><span class="file-icon">${icon('file')}</span><span><strong class="row-title">${e(item.display_name || item.filename)}</strong><span class="row-subtitle">${e(item.excerpt || item.filename)}</span></span></a></td><td>${e(types[item.kind])}</td><td>${e(sourceStatus(state.sourceDocuments.get(item.document_id), item.state))}</td><td><span class="badge ${item.answerable ? 'green' : 'amber'}">${item.answerable ? '已发布' : '尚未发布'}</span></td></tr>`).join('')}</tbody></table></div>${!cat.items.length ? empty('没有匹配资料') : ''}<div class="pagination">${button('prev-catalog', '上一页', false, cat.offset === 0 ? 'disabled' : '')}<span>${cat.total ? cat.offset + 1 : 0}–${cat.offset + cat.items.length} / ${cat.total}</span>${button('next-catalog', '下一页', false, cat.offset + cat.items.length >= cat.total ? 'disabled' : '')}</div>`;
  }
  function sourceStatus(item, fallback) {
    if (!item) return statusText(fallback);
    if (['queued', 'processing', 'failed', 'cancelled'].includes(item.status)) return documentStatusLabel(item);
    const prefix = item.status === 'parsed' ? '已解析 · ' : '';
    if (item.auto_index?.state === 'pending') return `${prefix}等待索引`;
    if (item.auto_index?.state === 'dispatching') return `${prefix}正在准备索引`;
    if (item.auto_index?.state === 'failed') return `${prefix}索引未完成`;
    if (item.status === 'parsed' && item.latest_index_job) return `${prefix}${indexTaskLabel(item.latest_index_job.state)}`;
    return documentStatusLabel(item);
  }
  function compile() {
    const existing = state.data.page, docs = state.data.catalog;
    if (pageDeleted(existing)) return `${heading('KNOWLEDGE PAGE', existing.content.title, '', `<a class="button secondary" href="${linkPage(existing)}">查看知识页</a>`)}${empty('知识页已删除，请先恢复')}`;
    const selected = new Set(existing ? pageSources(existing).map(source => source.document_id) : []);
    return `${heading('COMPILE KNOWLEDGE', existing ? `更新：${existing.content.title}` : '从原始资料编译知识页', '先选来源，生成提案；审阅采纳后才生成知识页版本。')}<form id="compile-form" class="article-paper"><div class="form-grid"><div class="field"><label for="compile-title">知识页标题</label><input id="compile-title" name="title" value="${e(existing?.content.title || '')}" required ></div><div class="field"><label for="compile-kind">页面类型</label><select id="compile-kind" name="kind">${Object.entries(kinds).map(([key, value]) => `<option value="${key}" ${existing?.content.kind === key ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label for="generation-method">编译方式</label><select id="generation-method" name="generation_method"><option value="extractive">原文摘编</option><option value="model">模型编译</option></select></div></div><h2>选择已发布来源</h2><div class="source-selection">${docs.map(item => `<label class="source-choice"><input type="checkbox" name="document_ids" value="${e(item.document_id)}" ${item.answerable ? '' : 'disabled'} ${selected.has(item.document_id) && item.answerable ? 'checked' : ''}><span>${e(item.display_name || item.filename)}<small>${e(types[item.kind])} · ${item.answerable ? '已发布' : e(statusText(item.state))}</small></span></label>`).join('') || empty('请先导入并索引资料')}</div><div class="form-actions"><button class="button primary" ${state.busy ? 'disabled' : ''}>${state.busy ? '正在编译…' : '生成待审阅提案'}</button><a class="button secondary" href="#/knowledge">返回知识页</a></div></form>`;
  }
  function drafts() {
    const draft = state.data;
    if (state.route.id) return `${heading('UNVERIFIED DRAFT', state.route.id === 'new' ? '新建知识草稿' : draft.title, '草稿保存在服务器，但尚未核验，不进入索引或问答证据。')}<form id="draft-form" class="article-paper"><div class="field"><label for="draft-title">标题</label><input id="draft-title" name="title" value="${e(draft?.title || '')}" required></div><div class="field"><label for="draft-body">草稿正文</label><textarea id="draft-body" name="body" rows="14" required>${e(draft?.body || '')}</textarea></div><div class="status-line"><span class="badge amber">未核验</span>${draft?.version ? `<span class="badge gray">版本 ${draft.version}</span>` : ''}</div><div class="form-actions"><button class="button primary" ${state.busy ? 'disabled' : ''}>保存草稿</button><a class="button secondary" href="#/drafts">返回草稿箱</a>${draft?.id ? button('delete-draft', '删除此草稿', false, state.busy ? 'disabled' : '') : ''}</div></form>`;
    return `${heading('DRAFTS', '草稿箱', '服务器保存、团队共享的未核验草稿；与已采纳的知识页分开。', '<a class="button primary" href="#/drafts/new">新建草稿</a>')}<div class="result-count">${state.drafts.length} 份草稿</div><div class="topic-grid">${state.drafts.map(item => `<a class="topic-card draft-card" href="#/drafts/${e(item.id)}"><span class="badge amber">未核验 · v${item.version}</span><h3>${e(item.title)}</h3><p>${e(item.body.slice(0, 140))}</p><div class="topic-footer">${e(formatTimestamp(item.updated_at))}</div></a>`).join('')}</div>${!state.drafts.length ? empty('草稿箱还是空的', '可以新建草稿，也可以将一次回答保存为待核验草稿。') : ''}`;
  }
  function answerBody(turn, index) {
    if (!turn.result) return '';
    return `<p class="preserve-lines answer-paragraph">${e(turn.result.answer)}</p>${turn.result.reason ? notice(`原因：${turn.result.reason}`) : ''}<div class="answer-reference-list">${turn.result.citations.map(citation => `<a href="#/answer-source/${turn.result.answer_id}/${citation.citation_id}">[${citation.citation_id}] ${e(citation.filename)} · ${e(formatLocator(citation))}</a>`).join('')}</div><details class="retrieval-steps"><summary>回答记录</summary><p>回答编号：${e(turn.result.answer_id)}</p><p>${turn.result.citations.length} 条引用；状态：${e(turn.result.status)}</p></details><div class="answer-footer">${button('save-answer', '存为草稿', false, `data-turn="${index}" ${state.busy ? 'disabled' : ''}`)}</div>`;
  }
  function agentProgress(turn, index) {
    if (!turn.agentPhase) return '';
    const run = turn.agentRun;
    const view = agentProgressView({ phase: turn.agentPhase, run });
    const terminal = ['completed', 'failed', 'cancelled'].includes(turn.agentPhase);
    const canAct = run?.status === 'running' && !terminal;
    const record = `<div class="agent-run-record">${run?.id ? `<p>任务编号：<code>${e(run.id)}</code></p>` : ''}${run?.error?.code ? `<p>失败原因：<code>${e(run.error.code)}</code></p>` : ''}</div>`;
    const timeline = view.entries.length ? `<ol class="agent-timeline">${view.entries.map(event => `<li${event.current ? ' aria-current="step"' : ''}>${e(event.label)}</li>`).join('')}</ol>` : '';
    if (terminal) return `<details class="agent-progress agent-progress-complete"><summary>查阅过程 · ${e(view.status)}</summary><p class="agent-outcome">${e(view.title)}</p><p class="agent-summary">${e(view.summary)}</p>${timeline}${record}</details>`;
    return `<section class="agent-progress agent-progress-live${view.active ? ' is-active' : ''}" aria-label="操作进度" data-current-stage="${e(view.entries.at(-1)?.type ?? 'waiting')}"><div class="agent-live-heading"><span class="agent-indicator" aria-hidden="true">${icon(view.entries.at(-1)?.type === 'searching' ? 'search' : 'book')}</span><div><div class="agent-status" role="status" aria-live="polite" aria-atomic="true">${e(view.title)}</div><p class="agent-description">${e(view.detail)}</p></div></div><details class="agent-progress-trace" open><summary>查阅过程</summary>${timeline}${record}</details>${canAct ? `<div class="agent-actions">${button('stop-agent', '停止', false, `data-turn="${index}" ${turn.agentPhase === 'cancelling' ? 'disabled' : ''}`)}${button('refresh-agent', '刷新状态', false, `data-turn="${index}" ${turn.agentPhase === 'cancelling' ? 'disabled' : ''}`)}</div>` : ''}</section>`;
  }
  function suggestions(turn) {
    const items = turn.result ? turn.agentRun?.suggestions : null;
    return items?.length ? `<details class="agent-suggestions"><summary>知识维护建议 · ${items.length} 项</summary>${items.map(item => `<section><h3>${e(item.title)}</h3><p class="preserve-lines">${e(item.reason)}</p><div class="agent-source-links">${item.document_ids.map((id, index) => `<a class="text-link" href="#/sources/${e(id)}">查看相关资料 ${index + 1}</a>`).join('')}</div></section>`).join('')}</details>` : '';
  }
  function chatTurns() {
    return state.turns.length ? state.turns.map((turn, index) => `<article class="conversation-item" data-chat-turn="${index}"><div class="chat-user"><span class="user-avatar small">你</span><p>${e(turn.question)}</p></div><div class="answer-block"><div class="answer-label">${icon('book')}<strong>知序</strong><span class="badge ${turn.result?.status === 'answered' ? 'green' : 'amber'}">${turn.pending ? '请求处理中' : turn.error ? '请求未完成' : turn.result?.status === 'answered' ? '资料综合回答' : turn.result ? '证据不足 / 拒答' : turn.agentPhase === 'cancelled' ? '已取消' : '等待核对'}</span></div>${agentProgress(turn, index)}${turn.error ? notice(turn.error, true) : turn.pending && !turn.agentPhase ? notice('正在生成回答…') : ''}${answerBody(turn, index)}${suggestions(turn)}</div></article>`).join('') : empty('有什么想了解的？');
  }
  const chatRecordKey = element => `${element.closest?.('[data-chat-turn]')?.dataset.chatTurn}:${element.className}`;
  const chatFocusKey = element => {
    if (!element) return null;
    const parentClass = element.tagName === 'SUMMARY' ? element.parentElement.className : null;
    const processSummary = parentClass === 'agent-progress-trace' || parentClass === 'agent-progress agent-progress-complete';
    return JSON.stringify([element.closest?.('[data-chat-turn]')?.dataset.chatTurn,
      element.tagName, element.dataset?.action, element.getAttribute?.('href'), processSummary ? 'agent-process' : parentClass]);
  };
  function updateChat() {
    if (state.route.view !== 'ask' || state.loading || state.error) return;
    const container = $('chat-turns'), markup = chatTurns();
    if (container !== renderedChatContainer || markup !== renderedChatMarkup) {
      const records = new Map([...(container.querySelectorAll?.('details') ?? [])].map(detail => [chatRecordKey(detail), detail.open]));
      const focused = container.contains?.(doc.activeElement) ? doc.activeElement : null;
      const focus = chatFocusKey(focused);
      const fallbackFocus = ['stop-agent', 'refresh-agent'].includes(focused?.dataset?.action)
        ? JSON.stringify([focused.closest?.('[data-chat-turn]')?.dataset.chatTurn, 'SUMMARY', null, null, 'agent-process']) : null;
      container.innerHTML = markup;
      for (const detail of container.querySelectorAll?.('details') ?? []) if (records.has(chatRecordKey(detail))) detail.open = records.get(chatRecordKey(detail));
      if (focus) {
        const controls = [...(container.querySelectorAll?.('button, a, summary') ?? [])];
        (controls.find(element => !element.disabled && chatFocusKey(element) === focus)
          ?? controls.find(element => chatFocusKey(element) === fallbackFocus))?.focus({ preventScroll: true });
      }
      renderedChatContainer = container; renderedChatMarkup = markup;
    }
    $('question-submit').disabled = state.turns.some(turn => turn.pending);
  }
  function ask() {
    return `${heading('ASK YOUR KNOWLEDGE', '知识问答', '', button('new-chat', '清空本页会话'))}<div class="chat-layout"><div class="main-column"><div class="chat-thread" id="chat-turns">${chatTurns()}</div><form class="composer" id="question-form"><label class="sr-only" for="question">你的问题</label><textarea id="question" name="question" rows="3" placeholder="描述你想了解的内容…" required>${e(state.question)}</textarea><div class="composer-footer"><a class="text-link" href="#/sources">${icon('file')}查找资料</a><button id="question-submit" class="button primary" ${state.turns.some(turn => turn.pending) ? 'disabled' : ''}>发送 ${icon('arrow')}</button></div></form></div></div>`;
  }
  function graph() {
    const edges = commonSourceRelations(state.pages);
    return `${heading('CONNECTED KNOWLEDGE', '知识关系', '连线只表示共同引用了同一份同版本原始资料，不是模型推测的语义关系。')}<div class="graph-layout"><section class="graph-board"><div class="graph-legend"><span class="badge green">共同来源关系</span><span class="muted">${state.pages.length} 篇 · ${edges.length} 组关系</span></div><div class="graph-connections">${edges.map(edge => `<div class="graph-connection"><a href="#/knowledge/${e(edge.from)}">${e(pageName(edge.from))}</a><span>${edge.count} 份同版本共同来源</span><a href="#/knowledge/${e(edge.to)}">${e(pageName(edge.to))}</a></div>`).join('') || empty('暂未形成共同来源关系', '当两篇知识页引用同一份同版本资料时，关系将自动显示。')}</div></section><aside class="panel"><div class="panel-header"><h2>全部知识页</h2></div><div class="panel-body">${state.pages.map(page => `<a class="related-item" href="${linkPage(page)}">${icon('book')}<span>${e(page.content.title)}</span></a>`).join('') || '<p class="muted">请先编译并采纳知识页。</p>'}</div></aside></div>`;
  }
  function review() {
    if (state.route.id) {
      const proposal = state.data;
      return `${heading('REVIEW CHANGES', proposal.after.title, `${statusText(proposal.status)} · ${proposal.generation_method === 'model' ? '模型编译' : '原文摘编'} · 基于版本 ${proposal.base_version}`, '<a class="button secondary" href="#/review">返回审阅列表</a>')}<article class="panel diff-panel"><div class="panel-body"><div class="status-line"><span class="badge amber">${e(statusText(proposal.status))}</span></div>${proposal.source_state === 'stale' ? notice('来源已变化，需重新编译。') : ''}<div class="diff-before"><h3>原内容</h3>${proposal.before ? sections(proposal.before, () => `#/knowledge/${proposal.page_id}/${proposal.base_version}`) : '<p>新知识页，无原有版本。</p>'}</div><div class="diff-after"><h3>建议内容</h3>${sections(proposal.after, source => `#/proposal-source/${proposal.id}/${source.id}`)}</div><div class="review-actions">${proposal.status === 'pending' ? `${button('accept-proposal', '采纳并生成知识页版本', true, state.busy || proposal.source_state === 'stale' ? 'disabled' : '')}${button('dismiss-proposal', '暂不采纳', false, state.busy ? 'disabled' : '')}` : `<span class="badge green">${e(statusText(proposal.status))}</span>`}${proposal.page_id && (proposal.base_version > 0 || proposal.status === 'accepted') ? `<a class="text-link" href="#/knowledge/${e(proposal.page_id)}">查看知识页</a>` : ''}</div></div></article>`;
    }
    return `${heading('REVIEW CHANGES', '更新审阅', '比较前后内容、核对来源，再决定是否生成新版本。', '<a class="button primary" href="#/compile">创建编译提案</a>')}<div class="toolbar"><label for="review-status">提案状态</label><select id="review-status" class="filter-select">${['pending', 'accepted', 'dismissed'].map(value => `<option value="${value}" ${state.reviewStatus === value ? 'selected' : ''}>${e(statusText(value))}</option>`).join('')}</select></div><div class="result-count">${state.proposals.length} 份${e(statusText(state.reviewStatus))}提案</div><div class="review-list">${state.proposals.map(proposal => `<a class="review-item" href="#/review/${e(proposal.id)}"><span class="badge ${proposal.status === 'pending' ? 'amber' : 'green'}">${e(statusText(proposal.status))}</span><strong>${e(proposal.after.title)}</strong><p>${proposal.generation_method === 'model' ? '模型编译' : '原文摘编'} · 基于版本 ${proposal.base_version} · ${e(formatTimestamp(proposal.created_at))}</p>${icon('chevron')}</a>`).join('')}</div>${!state.proposals.length ? empty('目前没有此状态的提案', '从资料创建编译提案后，会在此展示真实前后差异。') : ''}`;
  }
  function settings() {
    const s = state.settings;
    return `${heading('WORKSPACE SETTINGS', '空间设置', '设置保存到服务器并按版本更新，刷新后继续生效。')}<form id="settings-form" class="settings-section panel"><div class="panel-header"><h2>检索设置</h2><span class="badge green">配置版本 ${s.version}</span></div><div class="panel-body"><div class="form-grid"><div class="field"><label for="search-method">检索方式</label><select name="search_method" id="search-method">${Object.entries({ hybrid: '混合检索', vector: '向量检索', full_text: '全文检索' }).map(([key, label]) => `<option value="${key}" ${s.search_method === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="field"><label for="ranking-mode">排序策略</label><select name="ranking_mode" id="ranking-mode"><option value="rerank" ${s.ranking_mode === 'rerank' ? 'selected' : ''}>Rerank 模型</option><option value="weighted" ${s.ranking_mode === 'weighted' ? 'selected' : ''}>权重 / 原检索分</option></select></div><div class="field"><label for="dense-weight">语义权重（0–1）</label><input id="dense-weight" name="dense_weight" type="number" min="0" max="1" step="0.01" value="${s.dense_weight}" required></div><div class="field"><label for="top-k">Top K · 采用片段数</label><input id="top-k" name="top_k" type="number" min="1" max="20" step="1" value="${s.top_k}" required></div><div class="field"><label for="threshold-enabled"><input id="threshold-enabled" name="score_threshold_enabled" type="checkbox" ${s.score_threshold_enabled ? 'checked' : ''}> 启用相关性阈值</label><input name="score_threshold" id="score-threshold" type="number" step="any" value="${s.score_threshold}" ${s.score_threshold_enabled ? '' : 'disabled'} aria-label="相关性阈值"></div></div><details class="settings-help"><summary>参数说明</summary><p>关键词权重为 1 减语义权重。Top K 控制问答采用的片段数，不限制资料查找。</p><p id="threshold-help">${e(retrievalThresholdHelp(s))}</p></details><div class="form-actions"><button class="button primary" ${state.busy ? 'disabled' : ''}>保存</button>${button('refresh', '刷新')}</div></div></form><section class="settings-section panel"><div class="panel-header"><h2>模型与资料管理</h2></div><div class="panel-body"><a class="button primary" href="#/models">打开模型设置</a> <a class="button secondary" href="#/documents">打开资料维护</a></div></section>`;
  }
  function models() {
    const title = heading('', '模型设置', '', '<a class="button secondary" href="#/settings">检索设置</a>');
    if (!modelConfigurationEnabled(state.config)) return title + empty('当前服务未启用模型配置');
    return `${title}<div class="model-status-bar"><span id="model-status" class="badge gray"></span>${button('model-refresh', '刷新配置', false, 'id="model-refresh"')}${button('model-stop', '停止等待', false, 'id="model-stop" hidden')}</div><p id="model-error" class="notice error" role="alert" hidden></p><form id="models-form"><div class="model-role-grid">${modelRoles.map(role => `<section class="panel model-role model-role-${role}"><div class="panel-header"><h2>${modelRoleLabels[role]}</h2><div class="model-test-action"><span id="model-test-${role}-status" class="model-test-status"></span>${button('model-test', '测试连接', false, `id="model-test-${role}" data-role="${role}"`)}</div></div><div class="panel-body"><div class="form-grid"><div class="field"><label for="model-${role}-provider">服务商</label><select id="model-${role}-provider" name="${role}_provider"><option value="siliconflow">硅基流动</option>${role === 'generation' ? '<option value="deepseek">DeepSeek</option>' : ''}</select></div><div class="field"><label for="model-${role}-name">模型 ID</label><input id="model-${role}-name" name="${role}_model" required autocomplete="off" spellcheck="false"></div><div class="field model-key-field"><label for="model-${role}-key">API 密钥 <span id="model-${role}-key-status" class="model-key-status"></span></label><input id="model-${role}-key" name="${role}_api_key" type="password" autocomplete="new-password" spellcheck="false"></div>${role === 'embedding' ? '<div class="field"><label for="model-embedding-dimensions">向量维度</label><input id="model-embedding-dimensions" name="embedding_dimensions" type="number" min="2" max="8192" step="1" required></div><div class="field"><label for="model-embedding-revision">嵌入版本</label><input id="model-embedding-revision" name="embedding_revision" required autocomplete="off"></div>' : ''}</div></div></section>`).join('')}</div><div class="form-actions model-form-actions"><button type="submit" class="button primary" id="model-save">保存配置</button>${button('model-activate', '应用配置', false, 'id="model-activate"')}<a class="button secondary" href="#/sources">导入资料</a></div></form><section class="panel model-projection"><div class="panel-header"><h2>向量库</h2><div class="model-test-action"><span id="model-test-projection-status" class="model-test-status"></span>${button('model-test', '测试连接', false, 'id="model-test-projection" data-role="projection"')}</div></div><div class="panel-body"><span id="model-projection-status"></span></div></section><section class="panel model-rebuild" id="model-rebuild-panel" hidden><div class="panel-header"><h2>索引重建</h2>${button('model-rebuild-refresh', '刷新状态', false, 'id="model-rebuild-refresh"')}</div><div class="panel-body"><p id="model-rebuild-status"></p><p id="model-rebuild-error" class="notice error" role="alert" hidden></p>${button('model-rebuild-start', '重建索引并应用', true, 'id="model-rebuild-start"')}</div></section>`;
  }
  function clearModelSecrets() { for (const role of modelRoles) { const input = $(`model-${role}-key`); if (input) input.value = ''; } }
  function rebuildLocked() { return modelRebuildPending(rebuildSession?.value.status?.job) || ['starting', 'unknown'].includes(rebuildSession?.value.phase); }
  function modelDraft() {
    const draft = {};
    for (const role of modelRoles) {
      const key = $(`model-${role}-key`).value;
      draft[role] = { provider: $(`model-${role}-provider`).value, model: $(`model-${role}-name`).value, ...(key ? { api_key: key } : {}) };
    }
    draft.embedding.dimensions = Number($('model-embedding-dimensions').value);
    draft.embedding.revision = $('model-embedding-revision').value;
    return draft;
  }
  function updateModelControls() {
    if (state.route.view !== 'models' || state.loading || !modelSession || !modelConfigurationEnabled(state.config)) return;
    const value = modelSession.value, saved = value.configuration, rebuild = rebuildSession?.value, status = rebuild?.status, job = status?.job;
    const busy = modelBusy(value), blocked = state.busy || busy || value.phase === 'unknown' || rebuildLocked();
    const writable = !!saved && !blocked, ready = writable && !value.dirty && saved.state !== 'unconfigured';
    const currentRebuild = !!saved && status?.target_version === saved.version;
    const text = (id, content) => { const node = $(id); if (node) node.textContent = content; };
    text('model-status', busy ? ({ loading: '读取中…', saving: '保存中…', testing: '测试中…', activating: '应用中…' })[value.phase]
      : value.phase === 'unknown' ? '结果待核对，请刷新配置' : saved ? `已保存 ${saved.version ?? '无'} · 已应用 ${saved.active_version ?? '无'}${value.dirty ? ' · 未保存改动' : ''}` : '配置未读取');
    const failure = modelLocalError || value.error?.message || '';
    text('model-error', failure); $('model-error').hidden = !failure;
    $('model-refresh').disabled = busy || state.busy; $('model-stop').hidden = !busy;
    if (!value.dirty && (renderedModelVersion !== saved?.version || !saved)) {
      for (const role of modelRoles) { $(`model-${role}-name`).value = saved?.[role].model ?? ''; $(`model-${role}-provider`).value = saved?.[role].provider ?? 'siliconflow'; }
      $('model-embedding-dimensions').value = saved?.embedding.dimensions ?? '';
      $('model-embedding-revision').value = saved?.embedding.revision ?? '';
      renderedModelVersion = saved?.version;
    }
    for (const role of modelRoles) {
      const changed = $(`model-${role}-provider`).value !== (saved?.[role].provider ?? 'siliconflow');
      text(`model-${role}-key-status`, changed ? '请填写新服务商密钥' : saved?.[role].has_key ? '已配置' : '未配置');
      $(`model-${role}-key`).placeholder = !changed && saved?.[role].has_key ? '留空保留' : '输入 API 密钥';
      for (const suffix of ['provider', 'name', 'key']) $(`model-${role}-${suffix}`).disabled = !writable;
    }
    $('model-embedding-dimensions').disabled = !writable; $('model-embedding-revision').disabled = !writable;
    $('model-save').disabled = !writable || !value.dirty;
    $('model-activate').disabled = !ready || !saved.projection.configured || saved.active_version === saved.version || currentRebuild && status.required;
    for (const role of [...modelRoles, 'projection']) {
      $(`model-test-${role}`).disabled = !ready || role === 'projection' && !saved.projection.can_test;
      const result = value.tests[role];
      text(`model-test-${role}-status`, result ? result.status === 'passed' ? '通过' : `未通过 · ${result.error_code}` : '');
    }
    text('model-projection-status', saved?.projection.configured ? `已配置 · ${saved.projection.dimension ?? '—'} 维` : '未配置');
    const rebuilding = modelRebuildPending(job), rebuildBusy = ['loading', 'starting'].includes(rebuild?.phase);
    $('model-rebuild-panel').hidden = !rebuildSession || !status?.required && !job && !rebuild?.error && !rebuildBusy;
    $('model-rebuild-refresh').disabled = busy || state.busy || rebuildBusy;
    $('model-rebuild-start').hidden = !!status && !status.required;
    $('model-rebuild-start').disabled = !ready || !currentRebuild || !status.can_start || rebuild?.phase !== 'ready' || rebuilding;
    const labels = { queued: '排队中', running: '重建中', applying: '应用中', completed: '已完成', failed: '失败' };
    text('model-rebuild-status', rebuild?.phase === 'unknown' ? '结果待核对，请刷新状态' : rebuild?.phase === 'starting' ? '提交中…'
      : job ? `${labels[job.state]} · ${job.completed_documents} / ${job.total_documents} 份${job.state === 'completed' && saved?.active_version === job.target_version ? ' · 已生效' : ''}`
        : status?.required ? `需重建 ${status.total_documents} 份资料` : '正在读取状态…');
    const rebuildError = rebuild?.error?.message || (job?.state === 'failed' ? modelRebuildReason(job.error_code) : currentRebuild && status.required && !status.can_start && !rebuilding ? modelRebuildReason(status.reason) : '');
    text('model-rebuild-error', rebuildError); $('model-rebuild-error').hidden = !rebuildError;
  }
  async function refreshModelCapabilities(captured) {
    const next = await wiki.config();
    if (!isCurrent(captured)) return false;
    if (!Array.isArray(next?.capabilities) || next.auth_mode !== state.config.auth_mode || next.workspace_id !== state.config.workspace_id) throw new Error('工作区身份已变化，请重新打开页面。');
    state.config.capabilities = [...next.capabilities]; state.turns = []; state.pages = []; state.catalog = null;
    return true;
  }
  async function loadModels(captured) {
    if (!state.config) { const config = await wiki.config(); if (!isCurrent(captured)) return; state.config = config; }
    if (!modelConfigurationEnabled(state.config)) return;
    const authenticationFailure = () => { if (isCurrent(captured)) { modelLocalError = '当前会话不可用，请重新打开页面。'; updateModelControls(); } };
    const session = new ModelConfigurationSession(api, { onChange: () => { if (isCurrent(captured)) updateModelControls(); }, onClearSecrets: clearModelSecrets, onAuthenticationFailure: authenticationFailure, canWrite: () => !rebuildLocked() });
    modelSession = session;
    if (modelRebuildEnabled(state.config)) rebuildSession = new ModelRebuildSession(api, {
      onChange: () => { if (isCurrent(captured)) updateModelControls(); }, onAuthenticationFailure: authenticationFailure,
      onCompleted: async job => {
        if (!isCurrent(captured) || session.value.dirty) return false;
        const result = await session.load();
        if (!isCurrent(captured) || !result || result.active_version !== job.target_version) { if (isCurrent(captured)) modelLocalError = '重建已完成，配置尚待核对。'; return false; }
        try { return await refreshModelCapabilities(captured); } catch (error) { if (isCurrent(captured)) { modelLocalError = errorMessage(error); updateModelControls(); } return false; }
      },
    });
    const result = await session.load();
    if (isCurrent(captured) && result && result.state !== 'unconfigured') await rebuildSession?.load();
  }
  async function modelOperation(action, role) {
    if (state.route.view !== 'models' || !modelSession || state.busy || modelBusy(modelSession.value)) return;
    const captured = epoch, session = modelSession, rebuild = rebuildSession;
    state.busy = true; modelLocalError = ''; updateModelControls();
    try {
      let result;
      if (action === 'save') result = await session.save(modelDraft());
      if (action === 'test') result = await session.test(role);
      if (action === 'refresh') { renderedModelVersion = undefined; result = await session.load(); }
      if (action === 'activate') result = await session.activate();
      if (action === 'rebuild-refresh') await rebuild?.load();
      if (action === 'rebuild-start' && !session.value.dirty && session.value.phase !== 'unknown' && rebuild?.value.status?.target_version === session.value.configuration?.version) await rebuild.start(session.value.configuration.version);
      if (!isCurrent(captured)) return;
      if (result && ['save', 'activate', 'refresh'].includes(action)) {
        if (action === 'activate' || action === 'refresh' && result.active_version !== null) await refreshModelCapabilities(captured);
        if (isCurrent(captured) && result.state !== 'unconfigured') await rebuild?.load();
      }
    } catch (error) {
      if (isCurrent(captured)) { modelLocalError = errorMessage(error); if (error.errorCode === 'model_rebuild_required') await rebuild?.load(); }
    } finally { state.busy = false; if (isCurrent(captured)) updateModelControls(); }
  }
  function readerHeading() { return `${heading('ORIGINAL EVIDENCE', state.data?.metadata?.filename || '原始来源', '服务器校验来源身份、版本与定位；完整原文件通过 SHA 核对后显示。', button('back-reader', '返回上页'))}<article class="article-paper"><div id="reader">${empty('正在读取来源…')}</div></article>`; }
  function render() {
    frame();
    if (state.loading) { $('content').innerHTML = empty('正在加载…', '不会用演示数据替代真实结果。'); return; }
    if (state.error) { $('content').innerHTML = heading('REQUEST NOT COMPLETE', '未能完成此操作', '没有自动重试，请读取当前状态后再决定。') + notice(state.error, true) + button('refresh', '重新读取') + ' <a class="button secondary" href="#/models">连接与模型设置</a>'; return; }
    const views = { home, knowledge, 'knowledge-deleted': knowledge, sources, compile, drafts, ask, graph, review, settings, models, 'page-source': readerHeading, 'proposal-source': readerHeading, 'answer-source': readerHeading };
    $('content').innerHTML = (views[state.route.view] || (() => empty('找不到这个页面', '请从左侧导航重新进入。')))();
    if (state.route.view === 'models') updateModelControls();
  }
  async function completeList(method, options = {}, signal) {
    const items = []; let total;
    do { const page = await method({ ...options, offset: items.length, limit: 100, signal });
      if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 || (total !== undefined && total !== page.total) || (!page.items.length && items.length < page.total)) throw new Error('列表在读取时变化，请刷新后重新读取完整集合。');
      total = page.total; items.push(...page.items);
    } while (items.length < total);
    return items;
  }
  async function sourceDocuments(catalog, signal) {
    const wanted = new Set(catalog.items.map(item => item.document_id)), result = new Map(), seen = new Set();
    let total, count = 0;
    for (let page = 1; result.size < wanted.size; page++) {
      signal?.throwIfAborted();
      const response = await wiki.listDocuments({ page, page_size: 100, signal });
      if (!response || response.page !== page || response.page_size !== 100 || !Array.isArray(response.items)
        || response.items.length > 100 || !Number.isSafeInteger(response.total) || response.total < 0
        || total !== undefined && total !== response.total || count + response.items.length > response.total
        || !response.items.length && count < response.total) throw new Error('资料状态列表发生变化，请重新读取。');
      total = response.total; count += response.items.length;
      for (const item of response.items) {
        if (!ident.test(item?.document_id ?? '') || seen.has(item.document_id)) throw new Error('资料状态身份不一致，请重新读取。');
        seen.add(item.document_id); if (wanted.has(item.document_id)) result.set(item.document_id, item);
      }
      if (count >= total) break;
    }
    if (result.size !== wanted.size) throw new Error('资料状态已变化，请刷新资料列表。');
    return result;
  }
  async function load() {
    const currentEpoch = ++epoch; cleanup(); readController = new AbortController(); const signal = readController.signal;
    state.route = parseWorkspaceRoute(win.location.hash); state.loading = true; state.error = null; state.data = null; render();
    const route = state.route;
    if (route.view !== 'ask') pendingQuestion = null;
    try {
      if (['retrieval', 'documents', 'tasks', 'directories'].includes(route.view)) {
        const module = route.view === 'retrieval' ? await import('./wiki-retrieval.mjs') : await import('./wiki-maintenance.mjs');
        if (!isCurrent(currentEpoch)) return;
        state.loading = false;
        const mount = route.view === 'retrieval' ? module.mountWikiRetrieval : module.mountWikiMaintenance;
        workflow = mount({ container: $('content'), document: doc, window: win, api, config: state.config, route, navigate, notify, confirm: confirmOperation });
        await workflow.ready;
        return;
      }
      if (['home', 'knowledge', 'knowledge-deleted', 'graph'].includes(route.view)) { const pages = await wiki.allPages({ signal }); if (!isCurrent(currentEpoch)) return; state.pages = pages.filter(page => !pageDeleted(page)); }
      if (route.view === 'knowledge-deleted') { const pages = await wiki.allPages({ state: 'deleted', signal }); if (!isCurrent(currentEpoch)) return; state.deletedPages = pages.filter(pageDeleted); }
      let data;
      if (route.view === 'home') { const [catalog, pending] = await Promise.all([wiki.listCatalog({ limit: 5, signal }), wiki.listProposals({ status: 'pending', limit: 1, signal })]); if (!isCurrent(currentEpoch)) return; state.catalog = catalog; data = { pendingTotal: pending.total }; }
      if (route.view === 'knowledge' && route.id) data = route.version ? await wiki.getPageVersion(route.id, route.version, { signal }) : await wiki.getPage(route.id, { signal });
      if (route.view === 'sources') { if (route.id) data = { document: await wiki.getDocument(route.id, { signal }) }; else { const catalog = await wiki.listCatalog({ offset: state.offset, limit: 20, q: state.query, kind: state.sourceKind, signal }); const documents = await sourceDocuments(catalog, signal); if (!isCurrent(currentEpoch)) return; state.catalog = catalog; state.sourceDocuments = documents; } }
      if (route.view === 'compile') data = { page: route.id ? await wiki.getPage(route.id, { signal }) : null, catalog: await completeList(wiki.listCatalog, {}, signal) };
      if (route.view === 'drafts') { if (route.id) data = route.id === 'new' ? null : await wiki.getDraft(route.id, { signal }); else { const drafts = await completeList(wiki.listDrafts, {}, signal); if (!isCurrent(currentEpoch)) return; state.drafts = drafts; } }
      if (route.view === 'review') { if (route.id) data = await wiki.getProposal(route.id, { signal }); else { const proposals = await completeList(wiki.listProposals, { status: state.reviewStatus }, signal); if (!isCurrent(currentEpoch)) return; state.proposals = proposals; } }
      if (route.view === 'settings') { const settings = checkedRetrievalSettings(await wiki.getSettings({ signal })); if (!isCurrent(currentEpoch)) return; state.settings = settings; }
      if (route.view === 'models') await loadModels(currentEpoch);
      if (route.view === 'ask') { const config = await wiki.getAgentConfig({ signal }); if (!isCurrent(currentEpoch)) return; state.agentConfig = config; }
      if (['page-source', 'proposal-source'].includes(route.view)) {
        const owner = route.view === 'page-source' ? await wiki.getPageVersion(route.id, route.version, { signal }) : await wiki.getProposal(route.id, { signal });
        const source = (owner.content ?? owner.after).sections.flatMap(section => section.sources).find(item => item.id === route.sourceId);
        if (!source) throw new Error('此版本没有这条来源，不读取其他资料代替。');
        const context = route.view === 'page-source' ? { page_id: route.id, version: route.version, source_id: route.sourceId } : { proposal_id: route.id, source_id: route.sourceId };
        const metadata = await wiki.getSource(context, { signal });
        if (metadata.evidence_id !== source.evidence_id || metadata.sha256 !== source.evidence_sha256 || metadata.kind !== source.kind) throw new Error('来源与此知识页版本的证据绑定不一致，未显示其他内容代替。');
        data = { metadata, source, context };
      }
      if (route.view === 'answer-source') { const response = await wiki.getAnswerSource(route.id, route.ordinal, { signal }); data = { metadata: response.citation }; }
      if (!isCurrent(currentEpoch)) return;
      state.data = data; state.loading = false; render();
      if (route.view === 'sources' && route.id) await openOriginal(data.document, currentEpoch);
      if (['page-source', 'proposal-source'].includes(route.view)) await openWikiSource(data, currentEpoch, signal);
      if (route.view === 'answer-source') await openAnswerSource(data.metadata, currentEpoch, signal);
      if (route.view === 'sources') schedulePoll(currentEpoch);
      if (route.view === 'ask' && pendingQuestion) { const question = pendingQuestion; pendingQuestion = null; submitQuestion(question); }
    } catch (error) { if (isCurrent(currentEpoch) && error.name !== 'AbortError') { state.loading = false; state.error = errorMessage(error); render(); } }
  }
  function showReader({ metadata, url, blob, text, sourceText, frameUrl, page = 1 }) {
    const node = $('reader'); if (!node) return;
    const mime = metadata.media_type ?? metadata.mime_type;
    const locator = metadata.locator ?? metadata;
    const start = locator.start_us !== undefined ? locator.start_us / 1e6 : Number.isFinite(locator.start_ms) ? locator.start_ms / 1000 : 0;
    const end = locator.end_us !== undefined ? locator.end_us / 1e6 : Number.isFinite(locator.end_ms) ? locator.end_ms / 1000 : null;
    const openLink = documentDownloadOnly(mime) ? '' : `<a class="button secondary" href="${e(url)}" target="_blank" rel="noopener">打开原文件</a>`;
    node.innerHTML = `<div class="source-tabs"><span class="tab active">原文件</span><span class="muted">${e(formatLocator({ ...locator, media_type: mime }))}</span></div>${sourceText ? `<section class="document-line"><div class="locator">原文摘录</div><p class="preserve-lines">${e(sourceText)}</p></section>` : ''}${mime === 'application/pdf' ? '<p id="pdf-status" class="small-copy">正在渲染 PDF 原始页…</p><canvas id="reader-canvas" class="reader-canvas" aria-label="PDF 原始引用页"></canvas>' : mime?.startsWith('image/') ? `<img class="source-reader-media" src="${e(url)}" alt="${e(metadata.filename)}的原始图片">` : mime?.startsWith('audio/') || mime?.startsWith('video/') ? `<${mime.startsWith('audio/') ? 'audio' : 'video'} id="reader-media" class="source-reader-media" src="${e(url)}" controls preload="metadata"></${mime.startsWith('audio/') ? 'audio' : 'video'}>` : text !== null ? `<div class="document-sheet"><p class="preserve-lines">${e(text ?? '')}</p></div>` : ''}${frameUrl ? `<h3>引用原帧</h3><img class="source-reader-media" src="${e(frameUrl)}" alt="服务器引用原帧">` : ''}<div class="form-actions">${openLink}<a class="button secondary" href="${e(url)}" download="${e(metadata.filename)}">下载原文件</a></div>`;
    if (mime === 'application/pdf') {
      pdf = new PdfPreviewSession({ onChange: value => { const label = $('pdf-status'); if (label) label.textContent = value.phase === 'ready' ? `第 ${value.page} / ${value.pages} 页 · 同版本 PDF` : value.error ?? '正在渲染 PDF 原始页…'; } });
      pdf.open({ blob, page: locator.page ?? page, canvas: $('reader-canvas'), width: 720, pixelRatio: win.devicePixelRatio ?? 1 });
    }
    const media = $('reader-media');
    if (media) { media.addEventListener('loadedmetadata', () => { if (Number.isFinite(start) && start > 0) media.currentTime = start; }, { once: true }); if (end !== null) { let stopped = false; media.addEventListener('timeupdate', () => { if (!stopped && media.currentTime >= end) { stopped = true; media.pause(); } }); } }
  }
  async function openOriginal(item, captured) {
    original = new DocumentOriginalSession(api); const value = await original.open(item);
    if (!isCurrent(captured)) return;
    if (value.phase !== 'ready') { $('reader').innerHTML = notice(errorMessage(value.error), true); return; }
    showReader({ metadata: value.original, url: value.original.url, blob: value.original.blob, text: value.original.text });
  }
  async function openWikiSource(data, captured, signal) {
    const blob = await wiki.sourceContent(data.context, { signal, expectedSha256: data.source.source_sha256 });
    if (blob.type !== data.metadata.media_type) throw new Error('原文件类型与服务器引用不一致。');
    const frameBlob = data.metadata.frame_url ? await wiki.sourceFrame(data.context, { signal }) : null;
    const text = documentTextPreview(blob.type) ? await blob.text() : null;
    if (!isCurrent(captured)) return;
    showReader({ metadata: { ...data.metadata, locator: { ...data.metadata.locator, time_precision: data.metadata.time_precision } }, blob, url: blobUrl(safeOriginalBlob(blob)), frameUrl: frameBlob ? blobUrl(frameBlob) : null, text, sourceText: data.metadata.text });
  }
  async function openAnswerSource(citation, captured, signal) {
    const metadata = await wiki.getDocumentOriginal(citation.document_id, { signal });
    if (['document_id', 'revision_id', 'filename', 'media_type', 'source_sha256', 'content_url'].some(key => metadata[key] !== citation[key])) throw new Error('原文件版本已变化，不能拿新原件代替这次回答的引用。');
    const blob = await wiki.originalContent(metadata, { signal });
    const text = documentTextPreview(blob.type) ? await blob.text() : null; if (!isCurrent(captured)) return;
    showReader({ metadata: citation, blob, url: blobUrl(safeOriginalBlob(blob)), text, sourceText: citation.quote });
  }
  async function refreshSourceStatus(captured = epoch) {
    if (!isCurrent(captured) || state.route.view !== 'sources') return;
    try {
      const signal = readController.signal;
      if (state.route.id) {
        const document = await wiki.getDocument(state.route.id, { signal }); if (!isCurrent(captured)) return;
        state.data.document = document; $('source-processing-status').textContent = sourceStatus(document);
      } else {
        const catalog = await wiki.listCatalog({ offset: state.offset, limit: 20, q: state.query, kind: state.sourceKind, signal });
        const documents = await sourceDocuments(catalog, signal); if (!isCurrent(captured)) return;
        state.catalog = catalog; state.sourceDocuments = documents;
        const active = doc.activeElement, editing = active?.id === 'source-query';
        const draft = editing ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
        render();
        if (draft) { const input = $('source-query'); input.value = draft.value; input.focus(); input.setSelectionRange?.(draft.start, draft.end); }
      }
      schedulePoll(captured);
    } catch (error) { if (isCurrent(captured) && error.name !== 'AbortError') notify(`资料状态读取暂停：${errorMessage(error)}。可在处理任务中核对。`); }
  }
  function schedulePoll(captured) {
    clearPollTimer(pollTimer); pollTimer = null;
    const documents = state.route.id ? [state.data.document] : [...state.sourceDocuments.values()];
    if (documents.some(item => taskPending(item.latest_job) || taskPending(item.latest_index_job)
      || ['queued', 'processing'].includes(item.status) || ['queued', 'processing'].includes(item.index_status)
      || ['pending', 'dispatching'].includes(item.auto_index?.state))) pollTimer = setPollTimer(() => refreshSourceStatus(captured), 1500);
  }
  async function mutate(operation, success) {
    if (state.busy) return; state.busy = true; const captured = epoch;
    for (const node of doc.querySelectorAll?.('button[type="submit"],form .button.primary,[data-action="index"],[data-action="accept-proposal"],[data-action="dismiss-proposal"],[data-action="delete-draft"],[data-action="delete-page"],[data-action="restore-page"],[data-action="purge-page"],[data-action="confirm-import"]') ?? []) node.disabled = true;
    try { const value = await operation(); state.busy = false; if (isCurrent(captured)) await success(value); else notify('操作已完成；请回到对应列表读取最新结果。'); }
    catch (error) { state.busy = false; notify(`${errorMessage(error)}；没有自动重试。`); if (isCurrent(captured)) { for (const node of doc.querySelectorAll?.('form .button.primary,[data-action="index"],[data-action="accept-proposal"],[data-action="dismiss-proposal"],[data-action="delete-draft"],[data-action="delete-page"],[data-action="restore-page"],[data-action="purge-page"]') ?? []) node.disabled = false; } }
  }
  function abandonQuestion() {
    if (!activeQuestion) return;
    const { turn, session, kind } = activeQuestion;
    if (kind === 'agent') session.close(); else session.cancel();
    if (turn.pending) {
      turn.pending = false;
      turn.error = kind === 'agent' && turn.agentRun ? '已停止等待，可刷新任务状态。' : '已停止等待，后台处理状态尚未确认。';
      if (kind === 'agent') turn.agentPhase = 'paused';
    }
    activeQuestion = null;
  }
  function agentSession(turn) {
    const captured = epoch;
    const session = new KnowledgeAgentSession(wiki, { onChange: value => {
      if (!isCurrent(captured) || activeQuestion?.session !== session || !state.turns.includes(turn)) return;
      turn.agentPhase = value.phase; turn.agentRun = value.run;
      turn.pending = ['submitting', 'running', 'reading', 'cancelling'].includes(value.phase);
      turn.result = value.run?.result ?? null;
      turn.error = value.error ? errorMessage(value.error) : value.run?.error?.message ?? null;
      updateChat();
    } });
    activeQuestion = { turn, session, kind: 'agent' };
    return session;
  }
  async function agentAction(turn, action) {
    if (!turn?.agentRun || state.turns.some(other => other !== turn && other.pending)) return;
    const current = activeQuestion?.turn === turn && activeQuestion.kind === 'agent';
    const session = current ? activeQuestion.session : agentSession(turn);
    if (!current) {
      if (action === 'cancel') { await session.resume(turn.agentRun); if (activeQuestion?.session === session) await session.cancel(); }
      else await session.resume(turn.agentRun);
    } else if (action === 'cancel') await session.cancel(); else await session.refresh();
  }
  async function submitQuestion(question) {
    const cleaned = question.trim(); if (!cleaned || state.turns.some(turn => turn.pending)) return;
    if (state.route.view !== 'ask') { pendingQuestion = cleaned; state.question = cleaned; navigate('#/ask'); return; }
    if (state.loading || state.error || !state.agentConfig) return;
    abandonQuestion();
    const turn = { question: cleaned, pending: true, result: null, error: null };
    state.turns.push(turn); state.question = ''; render();
    if (state.agentConfig.enabled) { await agentSession(turn).start(cleaned); return; }
    const captured = epoch, session = new AnswerSession(api, { canReadOriginal: () => true });
    activeQuestion = { turn, session, kind: 'answer' };
    const result = await session.ask(cleaned, null, 'knowledge');
    if (!isCurrent(captured) || activeQuestion?.session !== session || !state.turns.includes(turn)) return;
    turn.pending = false; turn.result = result.result; turn.error = result.error ? errorMessage(result.error) : null;
    updateChat();
  }
  async function confirmImport() {
    const files = state.pendingFiles.slice(); if (!files.length || state.busy) return;
    const uploadKind = $('upload-kind').value;
    await mutate(async () => { for (const file of files) { await wiki.upload(file, { uploadKind }); state.pendingFiles = state.pendingFiles.filter(item => item !== file); } }, async () => { $('import-dialog').close(); $('workspace-files').value = ''; state.offset = 0; state.query = ''; navigate('#/sources'); notify('资料已提交，将自动解析并建立索引，可在“处理任务”查看进度。'); });
    updateUploadList();
  }
  function updateUploadList() { $('upload-list').innerHTML = state.pendingFiles.map(file => `<div class="upload-item"><strong>${e(file.name)}</strong><span>${(file.size / 1024).toFixed(1)} KiB · 待上传</span></div>`).join(''); $('confirm-import').disabled = !state.pendingFiles.length || state.busy; }
  function updateUploadAccept() { $('workspace-files').accept = ['audio', 'sound'].includes($('upload-kind').value) ? '.wav,.mp3,.flac,.ogg,.m4a,.mp4,.webm' : ['video', 'video-av'].includes($('upload-kind').value) ? '.mp4,.mov,.webm,.mkv' : `${DOCUMENT_ACCEPT},.png,.jpg,.jpeg`; }
  doc.addEventListener('submit', async event => {
    const form = event.target; if (!['home-question', 'question-form', 'catalog-search', 'compile-form', 'draft-form', 'settings-form', 'models-form', 'version-form'].includes(form.id)) return;
    event.preventDefault(); const values = new FormDataType(form);
    if (form.id === 'models-form') { await modelOperation('save'); return; }
    if (['home-question', 'question-form'].includes(form.id)) { submitQuestion(String(values.get('question') || '')); return; }
    if (form.id === 'catalog-search') { state.query = String(values.get('query') || '').trim(); state.offset = 0; load(); return; }
    if (form.id === 'version-form') { navigate(`#/knowledge/${state.route.id}/${Number(values.get('version'))}`); return; }
    if (form.id === 'compile-form') {
      const documentIds = values.getAll('document_ids'); if (!documentIds.length) { notify('请至少选择一份已发布来源。'); return; }
      const title = String(values.get('title') || '').trim();
      if (!title || [...title].length > 200) { notify('知识页标题须为 1–200 个 Unicode 字符。'); return; }
      const existing = state.data.page;
      if (pageDeleted(existing)) { notify('知识页已删除，请先恢复。'); return; }
      const generation = values.get('generation_method');
      mutate(() => wiki.createProposal({ page_id: existing?.page_id ?? null, base_version: existing?.version ?? 0, title, kind: values.get('kind'), document_ids: documentIds, generation_method: generation }), value => { navigate(`#/review/${value.id}`); notify('提案已保存到服务器，请审阅后采纳。'); }); return;
    }
    if (form.id === 'draft-form') {
      const body = { title: String(values.get('title')).trim(), body: String(values.get('body')).trim() }; const draft = state.data;
      if (!body.title || !body.body || [...body.title].length > 200 || [...body.body].length > 100000) { notify('标题须为 1–200 个字符，正文须为 1–100,000 个 Unicode 字符。'); return; }
      mutate(() => draft?.id ? wiki.updateDraft(draft.id, { ...body, version: draft.version }) : wiki.createDraft(body), value => { navigate(`#/drafts/${value.id}`); notify('草稿已保存到服务器；尚未核验、未发布。'); }); return;
    }
    if (form.id === 'settings-form') {
      try { const fields = retrievalSettingsFields({ search_method: values.get('search_method'), ranking_mode: values.get('ranking_mode'), dense_weight: Number(values.get('dense_weight')), top_k: Number(values.get('top_k')), score_threshold_enabled: values.has('score_threshold_enabled'), score_threshold: values.has('score_threshold') ? Number(values.get('score_threshold')) : state.settings.score_threshold });
        mutate(() => wiki.saveSettings({ version: state.settings.version, ...fields }), async result => { state.settings = checkedRetrievalSettings(result); await load(); notify('设置已保存，并从服务器重新读取。'); });
      } catch (error) { notify(errorMessage(error)); }
    }
  });
  doc.addEventListener('input', event => {
    if (event.target.id === 'question') state.question = event.target.value;
    if (state.route.view === 'models' && /^model-(generation|embedding|rerank)-(name|key|dimensions|revision)$/u.test(event.target.id)) { modelLocalError = ''; modelSession?.edit(); }
  });
  doc.addEventListener('change', event => {
    if (['retrieval', 'documents', 'tasks', 'directories'].includes(state.route.view)) return;
    const target = event.target;
    if (state.route.view === 'models' && /^model-(generation|embedding|rerank)-provider$/u.test(target.id)) { $(`model-${target.id.split('-')[1]}-key`).value = ''; modelLocalError = ''; modelSession?.edit(); }
    if (target.id === 'source-kind') { state.sourceKind = target.value; state.offset = 0; load(); }
    if (target.id === 'page-kind') { state.pageKind = target.value; render(); }
    if (target.id === 'review-status') { state.reviewStatus = target.value; load(); }
    if (target.id === 'workspace-files') { state.pendingFiles = Array.from(target.files); updateUploadList(); }
    if (target.id === 'upload-kind') { state.pendingFiles = []; $('workspace-files').value = ''; updateUploadList(); updateUploadAccept(); }
    if (target.id === 'threshold-enabled') $('score-threshold').disabled = !target.checked;
    if (['ranking-mode', 'search-method'].includes(target.id)) $('threshold-help').textContent = retrievalThresholdHelp({ ranking_mode: $('ranking-mode').value, search_method: $('search-method').value });
  });
  doc.addEventListener('click', async event => {
    const target = event.target.closest?.('[data-action],[data-ask]'); if (!target || target.disabled) return;
    if (target.dataset.ask) { state.question = target.dataset.ask; navigate('#/ask'); return; }
    const action = target.dataset.action;
    if (['retrieval', 'documents', 'tasks', 'directories'].includes(state.route.view) && !['confirm-operation', 'cancel-operation'].includes(action) && !(action === 'refresh' && state.error)) return;
    if (action === 'model-stop') { modelSession?.stop(); state.busy = false; updateModelControls(); return; }
    if (action?.startsWith('model-')) { await modelOperation(action.slice(6), target.dataset.role); return; }
    if (action === 'confirm-operation') { finishConfirmation(true); return; }
    if (action === 'cancel-operation') { finishConfirmation(false); return; }
    if (action === 'refresh') load();
    if (action === 'back-reader') { event.preventDefault(); const route = state.route; navigate(route.view === 'page-source' ? `#/knowledge/${route.id}/${route.version}` : route.view === 'proposal-source' ? `#/review/${route.id}` : '#/ask'); }
    if (action === 'import') { updateUploadAccept(); $('import-dialog').showModal(); }
    if (action === 'close-import') $('import-dialog').close();
    if (action === 'confirm-import') confirmImport();
    if (action === 'prev-catalog') { state.offset = Math.max(0, state.offset - 20); load(); }
    if (action === 'next-catalog') { state.offset += 20; load(); }
    if (action === 'purge-page') {
      if (state.busy || pendingConfirmation || pendingPurge) return;
      const pageId = target.dataset.page, captured = epoch;
      pendingPurge = true;
      try {
        const latest = await wiki.getPage(pageId, { signal: readController?.signal });
        if (!isCurrent(captured)) return;
        if (latest.page_id !== pageId || !pageDeleted(latest)) { notify('知识页已变化，只有已删除的知识页可以彻底删除，请刷新后核对。'); return; }
        if (!await confirmOperation('彻底删除知识页', `彻底删除“${latest.content.title}”及其所有历史版本和关联提案？操作无法恢复，不会删除原始文件或其索引。`)) return;
        await mutate(() => wiki.purgePage(pageId, latest.version, latest.lifecycle_version ?? 0), () => {
          state.pages = state.pages.filter(page => page.page_id !== pageId); state.deletedPages = state.deletedPages.filter(page => page.page_id !== pageId);
          navigate('#/knowledge-deleted'); notify('知识页已彻底删除，无法恢复；原始文件和索引保持不变。');
        });
      } catch (error) { if (isCurrent(captured)) notify(`${errorMessage(error)}；没有自动重试。`); }
      finally { pendingPurge = false; }
      return;
    }
    if (action === 'delete-page' || action === 'restore-page') {
      const pageId = target.dataset.page, removing = action === 'delete-page';
      if (removing && !await confirmOperation('删除知识页', '确认删除这篇知识页？删除后可恢复，不删除原始资料。')) return;
      await mutate(async () => {
        const latest = await wiki.getPage(pageId);
        return removing ? wiki.deletePage(pageId, latest.version, latest.lifecycle_version ?? 0) : wiki.restorePage(pageId, latest.version, latest.lifecycle_version ?? 0);
      }, async () => {
        state.pages = state.pages.filter(page => page.page_id !== pageId); state.deletedPages = state.deletedPages.filter(page => page.page_id !== pageId);
        navigate(removing ? '#/knowledge' : `#/knowledge/${pageId}`);
        notify(removing ? '知识页已删除，可在“已删除”中恢复。' : '知识页已恢复。');
      }); return;
    }
    if (action === 'stop-agent') { await agentAction(state.turns[Number(target.dataset.turn)], 'cancel'); return; }
    if (action === 'refresh-agent') { await agentAction(state.turns[Number(target.dataset.turn)], 'refresh'); return; }
    if (action === 'new-chat') { abandonQuestion(); state.turns = []; state.question = ''; render(); }
    if (action === 'save-answer') { const turn = state.turns[Number(target.dataset.turn)]; if (turn?.result) mutate(() => wiki.createDraft({ title: [...turn.question].slice(0, 200).join(''), body: `问题：${turn.question}\n\n${turn.result.answer}\n\n待核验回答记录：${turn.result.answer_id}\n${turn.result.citations.map(citation => `[${citation.citation_id}] ${citation.filename}`).join('\n')}` }), value => { navigate(`#/drafts/${value.id}`); notify('已保存未核验草稿，不作为问答证据。'); }); }
    if (action === 'delete-draft') {
      const draft = state.data;
      if (!await confirmOperation('确认删除草稿', '确认删除这份未核验草稿？此操作不会删除原始资料或知识页，删除后无法从草稿箱恢复。')) return;
      mutate(() => wiki.deleteDraft(draft.id, draft.version), () => { navigate('#/drafts'); notify('草稿已删除；没有影响原始资料。'); });
    }
    if (action === 'accept-proposal') { const proposal = state.data; mutate(() => wiki.acceptProposal(proposal.id, proposal.base_version), value => { navigate(`#/knowledge/${value.page_id || proposal.page_id}`); notify('已采纳并保存新知识页版本。'); }); }
    if (action === 'dismiss-proposal') { const proposal = state.data; mutate(() => wiki.dismissProposal(proposal.id), () => { load(); notify('提案已标记暂不采纳；需要修改请创建新提案。'); }); }
  });
  win.addEventListener('hashchange', () => { load(); win.scrollTo?.(0, 0); });
  win.addEventListener('beforeunload', cleanup);
  async function start() {
    try {
      if (!wiki) { const initial = createApi({}, () => 'owner'); state.config = await initial('/v1/config'); api = createApi(state.config, () => 'owner'); wiki = createWikiWorkspaceApi({ api }); }
      await load();
    } catch (error) { state.loading = false; state.error = errorMessage(error); render(); }
  }
  return { start, load, state, close: () => { epoch++; cleanup(); clearTimeout(toastTimer); } };
}

if (globalThis.document && globalThis.window) createWikiWorkspace().start();
