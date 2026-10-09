import { sources, pages, proposals, searchCatalog, createExampleAnswer, escapeHtml, parseRoute } from './wiki-preview-data.mjs';

// Deliberately isolated presentation preview: no API clients, fetch, model or credentials.
const e = escapeHtml;
const storageKey = 'ai-knowledge:wiki-preview:v1';
const defaults = { method: 'hybrid', ranking: 'rerank', topK: 5, thresholdEnabled: false, threshold: 0.5 };
function readSaved() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  } catch { return {}; }
}
const saved = readSaved();
const state = {
  query: '', sourceKind: 'all', pageType: 'all', turns: [], question: '',
  pendingFiles: [], imports: Array.isArray(saved.imports) ? saved.imports.filter(x => x && typeof x.name === 'string' && typeof x.size === 'string') : [],
  drafts: Array.isArray(saved.drafts) ? saved.drafts.filter(x => x && typeof x.id === 'string' && typeof x.title === 'string' && typeof x.text === 'string') : [],
  decisions: saved.decisions && typeof saved.decisions === 'object' && !Array.isArray(saved.decisions) ? saved.decisions : {},
  settings: { ...defaults, ...(saved.settings && typeof saved.settings === 'object' ? saved.settings : {}) },
  reviewId: proposals[0]?.id, graphId: pages[0]?.id,
};
const content = document.querySelector('#content');
let toastTimer;
function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ imports: state.imports, drafts: state.drafts, decisions: state.decisions, settings: state.settings }));
    return true;
  } catch { notify('浏览器未允许保存；本次修改仍可预览，刷新后可能丢失。'); return false; }
}
const icons = {
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-3-2H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 3-2h4V4Z"/>',
  home: '<path d="m3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7"/>',
  file: '<path d="M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8M8 17h6"/>',
  chat: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8M8 12h5"/>',
  graph: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m11 7-5 9m7-9 5 9M7 18h10"/>',
  review: '<path d="M9 4H5v17h14V4h-4M9 3h6v4H9V3Zm-1 11 3 3 5-6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/>',
  audio: '<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  link: '<path d="m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
};
function icon(name, cls = '') { return `<svg class="${e(cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`; }
const typeNames = { pdf: 'PDF', video: '视频', audio: '音频', image: '图片', text: '文档' };
function fileIcon(kind) { return `<span class="file-icon ${e(kind)}">${icon(['video', 'audio', 'image'].includes(kind) ? kind : 'file')}</span>`; }
function sourceLink(id, number) {
  const source = sources.find(x => x.id === id);
  return source ? `<a class="source-ref" href="#/sources/${e(id)}" title="查看示例来源：${e(source.title)}">${number ? `[${number}]` : e(source.title)}</a>` : '';
}
function sourceMini(source) {
  return `<a class="source-mini" href="#/sources/${e(source.id)}">${fileIcon(source.kind)}<span class="file-meta"><strong>${e(source.title)}</strong><span>${typeNames[source.kind]} · ${e(source.updated)}</span></span>${icon('chevron')}</a>`;
}
function heading(eyebrow, title, subtitle, actions = '') {
  return `<div class="page-heading"><div class="heading-copy"><div class="eyebrow">${e(eyebrow)}</div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
const nav = [
  ['home', 'home', '知识总览'], ['knowledge', 'book', '知识页'], ['sources', 'file', '原始资料'],
  ['ask', 'chat', '知识问答'], ['graph', 'graph', '知识关系'], ['review', 'review', '更新审阅'],
];
function renderFrame(route) {
  const pending = proposals.filter(p => !state.decisions[p.id]).length;
  document.querySelector('#sidebar').innerHTML = `
    <a class="brand" href="#/home"><span class="brand-mark">${icon('book')}</span><span><strong class="workspace-name">知序</strong><span class="workspace-caption">让资料成为知识</span></span></a>
    <div class="nav-section-label">团队知识空间 <span class="badge gray">预览</span></div>
    <nav aria-label="主导航">${nav.map(([id, glyph, label]) => `<a href="#/${id}" class="nav-item ${route.view === id ? 'active' : ''}" ${route.view === id ? 'aria-current="page"' : ''}>${icon(glyph)}<span>${label}</span>${id === 'review' && pending ? `<span class="nav-count">${pending}</span>` : ''}</a>`).join('')}<a class="nav-item mobile-settings ${route.view === 'settings' ? 'active' : ''}" href="#/settings">${icon('settings')}<span>空间设置</span></a></nav>
    <div class="nav-section-label">常用知识</div><div class="sidebar-pages">${pages.slice(0, 3).map(p => `<a class="page-link" href="#/knowledge/${e(p.id)}"><span class="page-dot"></span>${e(p.title)}</a>`).join('')}</div>
    <div class="sidebar-bottom"><a class="nav-item ${route.view === 'settings' ? 'active' : ''}" href="#/settings">${icon('settings')}<span>空间设置</span></a><div class="workspace-account"><span class="user-avatar">知</span><span><strong>团队共享空间</strong><span class="workspace-caption"><i class="connection-dot"></i>本地交互预览</span></span></div></div>`;
  const label = nav.find(x => x[0] === route.view)?.[2] || '空间设置';
  const entity = route.view === 'knowledge' ? pages.find(p => p.id === route.id) || state.drafts.find(p => p.id === route.id) : sources.find(s => s.id === route.id);
  document.querySelector('#topbar').innerHTML = `<div class="breadcrumbs"><a href="#/home">团队知识空间</a>${icon('chevron')}<a href="#/${e(route.view)}">${label}</a>${entity ? `${icon('chevron')}<span>${e(entity.title)}</span>` : ''}</div><div class="topbar-actions"><button class="icon-button" data-action="search" title="查找知识或资料" aria-label="查找知识或资料">${icon('search')}</button><span class="user-avatar small">林</span></div>`;
  document.title = `${entity?.title || label} · 知序`;
}
function renderHome() {
  return `${heading('YOUR KNOWLEDGE, CONNECTED', '从资料，到彼此关联的知识。', '把散落的文档、讲解与记录，整理成可以阅读、提问和持续维护的知识。', `<button class="button primary" data-action="import">${icon('plus')}导入资料</button>`)}
    <div class="stats-row"><a class="stat" href="#/knowledge"><span>知识页</span><strong>${pages.length + state.drafts.length}<small>篇</small></strong><span>按主题沉淀，而非堆叠文件</span></a><a class="stat" href="#/sources"><span>原始资料</span><strong>${sources.length}<small>份</small></strong><span>文档、视频、音频与图片</span></a><a class="stat" href="#/review"><span>待你确认</span><strong>${proposals.filter(p => !state.decisions[p.id]).length}<small>项</small></strong><span>知识更新先审阅，再采纳</span></a></div>
    <div class="overview-layout"><div class="main-column">
      <form class="ask-launch" id="home-question"><div class="eyebrow">从一个问题开始</div><label for="home-input">想了解什么？</label><textarea id="home-input" name="question" rows="2" placeholder="例如：哪些资料提到了灯塔？分别讲了什么？"></textarea><footer><span class="muted">示例问答 · 可查看来源与查找过程</span><button class="button primary small" type="submit">提问 ${icon('arrow')}</button></footer></form>
      <div class="question-chips"><button class="question-chip" data-ask="有哪些文件包含灯塔，这个讲了啥">查找提到灯塔的文件 ${icon('arrow')}</button><button class="question-chip" data-ask="灯塔设备怎么开机？">文档和视频一起看 ${icon('arrow')}</button></div>
      <div class="section-heading"><h2>从主题开始探索</h2><a class="text-link" href="#/knowledge">全部知识页 ${icon('arrow')}</a></div>
      <div class="topic-grid">${pages.slice(0, 4).map((p, index) => `<a class="topic-card" href="#/knowledge/${e(p.id)}"><div class="topic-meta"><span class="topic-icon">${icon(index === 0 ? 'graph' : index === 2 ? 'review' : 'book')}</span><span class="badge gray">${e(p.type)}</span></div><h3>${e(p.title)}</h3><p>${e(p.summary)}</p><div class="topic-footer"><span>${p.sourceIds.length} 份原始来源</span>${icon('arrow')}</div></a>`).join('')}</div>
    </div><aside class="side-column">
      <section class="panel"><div class="panel-header"><h2>知识如何生长</h2><span class="badge green">预览流程</span></div><div class="panel-body"><ol class="activity-list"><li class="activity-item"><span class="activity-marker">1</span><div class="activity-body"><strong>保留原始资料</strong><p>原文、页码和时间片段，始终可回看。</p></div></li><li class="activity-item"><span class="activity-marker">2</span><div class="activity-body"><strong>编织成知识页</strong><p>围绕主题组织，而不是逐个文件孤立总结。</p></div></li><li class="activity-item"><span class="activity-marker">3</span><div class="activity-body"><strong>提问与持续更新</strong><p>回答有来源，变更可审阅，知识可积累。</p></div></li></ol></div></section>
      <section class="panel"><div class="panel-header"><h2>最近资料</h2><a class="text-link" href="#/sources">查看全部</a></div>${sources.slice(0, 3).map(sourceMini).join('')}</section>
      <a class="review-callout" href="#/review">${icon('review')}<span><strong>让你决定知识如何更新</strong><span>查看示例变更与前后差异</span></span>${icon('arrow')}</a>
    </aside></div>`;
}
function searchForm(placeholder) {
  return `<form class="search-field" id="catalog-search">${icon('search')}<input name="query" value="${e(state.query)}" placeholder="${e(placeholder)}" aria-label="${e(placeholder)}"><button class="button small secondary" type="submit">查找</button></form>`;
}
function renderKnowledge(id) {
  if (id === 'new') return renderDraftForm();
  const draft = state.drafts.find(p => p.id === id);
  if (draft) return `${heading('LOCAL DRAFT', draft.title, '仅保存在当前浏览器的草稿，未经原文核验，尚未写入后端。', '<a class="button secondary" href="#/knowledge">返回知识页</a>')}<article class="article-paper"><span class="badge amber">本地草稿</span><div class="article-body"><p class="preserve-lines">${e(draft.text)}</p></div><div class="article-footer">${(draft.sourceIds || []).map(x => sourceLink(x)).join(' ')}</div></article>`;
  if (id) {
    const page = pages.find(p => p.id === id);
    if (!page) return missing('知识页');
    const accepted = proposals.filter(p => p.pageId === id && state.decisions[p.id] === 'accepted');
    return `${heading('KNOWLEDGE PAGE', page.title, page.summary, `<button class="button primary" data-ask="${page.id.startsWith('device-') ? '灯塔设备怎么开机？' : page.id === 'cedar-budget' ? '青榆灯塔项目预算是多少？' : '青榆灯塔项目是什么？'}">${icon('chat')}围绕此页提问</button>`)}
    <div class="article-layout"><article class="article-paper"><div class="article-header"><span class="badge green">${e(page.type)}</span><span>${page.sourceIds.length} 份来源</span><span>示例更新于 ${e(page.updated)}</span></div><div class="notice">此页是合成知识页样稿；生产版本将由原始资料编译，并保留来源版本。</div><div class="article-body">${page.sections.map(section => `<section><h2>${e(section.heading)}</h2><p class="preserve-lines">${e(section.text)}</p><div class="provenance">${section.sourceIds.map(x => sourceLink(x)).join(' ')}</div></section>`).join('')}${accepted.map(p => `<section class="accepted-preview"><span class="badge amber">本地采纳预览</span><h2>${e(p.title)}</h2><p>${e(p.after)}</p>${sourceLink(p.sourceId)}</section>`).join('')}</div><div class="article-footer">${icon('link')}知识页用于组织理解；事实依据请回看右侧原始资料。</div></article>
    <aside class="side-column"><section class="panel"><div class="panel-header"><h2>原始来源</h2><span class="badge gray">${page.sourceIds.length}</span></div>${page.sourceIds.map(id => sources.find(x => x.id === id)).filter(Boolean).map(sourceMini).join('')}</section><section class="panel"><div class="panel-header"><h2>相关知识</h2></div><div class="panel-body">${page.relatedIds.map(id => pages.find(p => p.id === id)).filter(Boolean).map(p => `<a class="related-item" href="#/knowledge/${e(p.id)}">${icon('book')}<span>${e(p.title)}</span>${icon('chevron')}</a>`).join('')}</div></section><a class="text-link" href="#/graph">${icon('graph')}在知识关系中查看</a></aside></div>`;
  }
  const found = searchCatalog(state.query).pages.filter(p => state.pageType === 'all' || p.type === state.pageType);
  const drafts = state.drafts.filter(p => !state.query || p.title.includes(state.query));
  return `${heading('KNOWLEDGE', '知识页', '按主题组织的知识，每个结论都能回到它的原始来源。', '<a class="button primary" href="#/knowledge/new">'+icon('plus')+'新建草稿</a>')}
    <div class="toolbar">${searchForm('搜索知识页标题或内容')}<select class="filter-select" id="page-type" aria-label="知识页类型">${['all', ...new Set(pages.map(p => p.type))].map(type => `<option value="${e(type)}" ${state.pageType === type ? 'selected' : ''}>${type === 'all' ? '所有类型' : e(type)}</option>`).join('')}</select></div><div class="result-count">${found.length + drafts.length} 篇知识页 · 合成示例与本地草稿</div>
    <div class="topic-grid knowledge-grid">${found.map(p => `<a class="topic-card" href="#/knowledge/${e(p.id)}"><div class="topic-meta"><span class="topic-icon">${icon('book')}</span><span class="badge gray">${e(p.type)}</span></div><h3>${e(p.title)}</h3><p>${e(p.summary)}</p><div class="topic-footer"><span>${p.sourceIds.length} 份来源 · ${e(p.updated)}</span>${icon('arrow')}</div></a>`).join('')}${drafts.map(p => `<a class="topic-card" href="#/knowledge/${e(p.id)}"><span class="badge amber">本地草稿</span><h3>${e(p.title)}</h3><p>${e(p.text.slice(0, 100))}</p><div class="topic-footer"><span>未写入后端</span>${icon('arrow')}</div></a>`).join('')}</div>${!found.length && !drafts.length ? empty('没有匹配的知识页', '可以换个词搜索，或从原始资料开始查找。') : ''}`;
}
function renderDraftForm() {
  return `${heading('NEW KNOWLEDGE', '新建知识草稿', '先记录你的理解；确认前端方案后，再接入知识编译和版本管理。')}<form id="draft-form" class="article-paper"><div class="field"><label for="draft-title">标题</label><input id="draft-title" name="title" required placeholder="给这个主题一个清楚的名字"></div><div class="field"><label for="draft-text">正文</label><textarea id="draft-text" name="text" rows="12" required placeholder="记录概览、关键概念与待核对的问题…"></textarea></div><p class="notice">仅保存到当前浏览器，不上传、不同步，也不作为问答证据。</p><div class="actions"><button class="button primary" type="submit">保存本地草稿</button><a class="button secondary" href="#/knowledge">取消</a></div></form>`;
}
function renderSources(id) {
  if (id) return renderSourceDetail(id);
  const filtered = searchCatalog(state.query).sources.filter(s => state.sourceKind === 'all' || s.kind === state.sourceKind);
  return `${heading('SOURCES', '原始资料', '资料是依据，知识页是组织。两者关联，但不相互替代。', `<button class="button primary" data-action="import">${icon('upload')}导入资料</button>`)}
    <div class="toolbar">${searchForm('搜索文件名或示例全文')}<select id="source-kind" class="filter-select" aria-label="资料类型">${Object.entries({ all: '所有类型', ...typeNames }).map(([key, name]) => `<option value="${key}" ${state.sourceKind === key ? 'selected' : ''}>${name}</option>`).join('')}</select></div>
    <div class="result-count">找到 ${filtered.length} 份示例资料${state.query ? ` · 关键词「${e(state.query)}」` : ''}<span>文件级展示，不把重复片段当成不同文件</span></div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>资料名称</th><th>类型</th><th>关联知识</th><th>示例状态</th><th>更新时间</th></tr></thead><tbody>${filtered.map(s => `<tr><td><a class="table-title" href="#/sources/${e(s.id)}">${fileIcon(s.kind)}<span><strong class="row-title">${e(s.title)}</strong><span class="row-subtitle">${e(s.folder)} · ${e(s.size)}</span></span></a></td><td><span class="tag">${typeNames[s.kind]}</span></td><td>${s.wikiIds.length} 个知识页</td><td><span class="badge ${s.status === 'ready' ? 'green' : 'amber'}">${s.status === 'ready' ? '已关联' : '待审阅'}</span></td><td>${e(s.updated)}</td></tr>`).join('')}</tbody></table></div>${!filtered.length ? empty('没有找到匹配文件', '本页仅对合成示例进行本地关键词查找，尚未连接真实资料库。') : ''}
    ${state.imports.length ? `<section class="panel imported-preview"><div class="panel-header"><h2>本地待导入清单</h2><span class="badge amber">尚未上传 / 未解析</span></div>${state.imports.map(f => `<div class="source-mini">${fileIcon('text')}<div class="file-meta"><strong>${e(f.name)}</strong><span>${e(f.size)} · 仅文件名记录，未保留文件内容</span></div></div>`).join('')}</section>` : ''}`;
}
function renderSourceDetail(id) {
  const source = sources.find(s => s.id === id);
  if (!source) return missing('原始资料');
  const isMedia = ['audio', 'video', 'image'].includes(source.kind);
  return `${heading('SOURCE READER', source.title, '独立资料阅读页 · 合成原文片段，不是线上文件的实际内容', '<a class="button secondary" href="#/sources">返回资料列表</a>')}
    <div class="source-layout article-layout"><article class="article-paper"><div class="source-tabs"><span class="tab active">${isMedia ? '转录 / 内容样稿' : '原文样稿'}</span><span class="muted">${typeNames[source.kind]} · ${e(source.size)}</span></div>${isMedia ? `<div class="video-placeholder">${icon(source.kind)}<strong>${source.kind === 'video' ? '视频与时间片段' : source.kind === 'audio' ? '音频与转录片段' : '图片与文字内容'}</strong><p>这里预留原始${typeNames[source.kind]}阅读区域。当前只有文字样稿，没有伪造播放器或原图。</p><span class="badge amber">实际媒体与定位待后端接入</span></div>` : ''}<div class="document-sheet"><div class="eyebrow">SYNTHETIC SOURCE · 合成来源</div><h2>${e(source.title)}</h2>${source.content.map(block => `<section class="document-line"><div class="locator">${icon(isMedia ? 'clock' : 'file')}${e(block.locator)}</div><p class="preserve-lines">${e(block.text)}</p></section>`).join('')}</div></article>
    <aside class="side-column"><section class="panel"><div class="panel-header"><h2>资料信息</h2></div><div class="panel-body"><dl class="meta-list"><dt>分类</dt><dd>${e(source.folder)}</dd><dt>文件类型</dt><dd>${typeNames[source.kind]}</dd><dt>示例日期</dt><dd>${e(source.updated)}</dd><dt>来源标识</dt><dd>${e(source.id)}</dd></dl><p class="notice">生产接入后，此处使用后端返回的原文件版本、页码 / 时间和 SHA 校验结果。当前不伪造版本校验。</p></div></section><section class="panel"><div class="panel-header"><h2>支撑的知识页</h2></div><div class="panel-body">${source.wikiIds.map(id => pages.find(p => p.id === id)).filter(Boolean).map(p => `<a class="related-item" href="#/knowledge/${e(p.id)}">${icon('book')}<span>${e(p.title)}</span>${icon('chevron')}</a>`).join('')}</div></section><button class="button secondary" data-ask="${e(source.title)}讲了什么？">${icon('chat')}了解相关内容</button></aside></div>`;
}
function empty(title, detail) { return `<div class="empty-state">${icon('search')}<h3>${e(title)}</h3><p>${e(detail)}</p></div>`; }
function missing(type) { return heading('NOT FOUND', `找不到这份${type}`, '链接可能已失效，或它不在本次预览中。', '<a class="button secondary" href="#/home">返回总览</a>'); }
function renderAsk() {
  const current = state.turns.at(-1);
  const sourceIds = current?.answer.sourceIds || [];
  return `${heading('ASK YOUR KNOWLEDGE', '知识问答', '先弄清你在找什么，再组织答案；找到的资料和使用的依据分开展示。', '<button class="button secondary" data-action="new-chat">'+icon('plus')+'新问题</button>')}
    <div class="chat-layout"><div class="main-column"><div class="chat-thread">${!state.turns.length ? `<div class="chat-empty"><span class="topic-icon">${icon('chat')}</span><h2>从一个问题，找到相关知识。</h2><p>可以找文件、了解一个主题，或查看文档与视频中的操作方法。</p><div class="suggestion-grid"><button class="suggestion" data-ask="有哪些文件包含灯塔，这个讲了啥"><strong>查找文件</strong><span>哪些资料提到了灯塔？</span>${icon('arrow')}</button><button class="suggestion" data-ask="灯塔设备怎么开机？"><strong>了解操作</strong><span>文档和教程视频一起看</span>${icon('arrow')}</button><button class="suggestion" data-ask="青榆灯塔项目的预算是多少？"><strong>核对事实</strong><span>项目预算是多少？</span>${icon('arrow')}</button></div><p class="notice">当前为固定示例演示，不进行真实检索或生成；其他问题将明确提示未接入后端。</p></div>` : state.turns.map((turn, index) => renderTurn(turn, index)).join('')}</div>
    <form class="composer" id="question-form"><label class="sr-only" for="question">你的问题</label><textarea id="question" name="question" rows="3" placeholder="问一个问题，或描述你想找的资料…">${e(state.question)}</textarea><div class="composer-footer"><span>${icon('book')}示例知识空间 <span class="badge gray">本地演示</span></span><button class="button primary" type="submit">发送 ${icon('arrow')}</button></div></form><p class="composer-note">这版先确认交互。真实检索、模型综合、会话记忆与原件播放，待后端接入后验收。</p></div>
    <aside class="side-column"><section class="panel"><div class="panel-header"><h2>本次相关来源</h2><span class="badge gray">${sourceIds.length}</span></div>${sourceIds.length ? sourceIds.map((id, index) => { const source = sources.find(s => s.id === id); return source ? `<a class="source-result" href="#/sources/${e(id)}"><span class="source-number">${index + 1}</span><div><strong>${e(source.title)}</strong><span>${typeNames[source.kind]} · 示例来源</span><p>${e(source.summary)}</p></div>${icon('chevron')}</a>` : ''; }).join('') : '<div class="panel-body"><p class="muted">提出示例问题后，这里会按文件列出相关资料，并可进入独立阅读页。</p></div>'}</section>${current?.answer.pageIds?.length ? `<section class="panel"><div class="panel-header"><h2>关联知识页</h2></div><div class="panel-body">${current.answer.pageIds.map(id => pages.find(p => p.id === id)).filter(Boolean).map(p => `<a class="related-item" href="#/knowledge/${e(p.id)}">${icon('book')}<span>${e(p.title)}</span>${icon('chevron')}</a>`).join('')}</div></section>` : ''}</aside></div>`;
}
function renderTurn(turn, index) {
  const answer = turn.answer;
  return `<article class="conversation-item"><div class="chat-user"><span class="user-avatar small">你</span><p>${e(turn.question)}</p></div><div class="answer-block"><div class="answer-label">${icon('book')}<strong>知序</strong><span class="badge ${answer.kind === 'answer' ? 'green' : 'amber'}">${answer.kind === 'answer' ? '示例回答' : '未接后端'}</span></div><details class="retrieval-steps"><summary>${icon('search')}${e(answer.intent)} · 查看演示过程</summary><p class="notice">以下为固定交互样例，不是后台执行日志。</p>${answer.steps.map((step, i) => `<div class="step"><span class="step-number">${i + 1}</span><div><strong>${e(step.label)}</strong><p>${e(step.detail)}</p></div></div>`).join('')}</details><h3 class="question-summary">${e(answer.summary)}</h3>${answer.paragraphs.map(p => `<p class="answer-paragraph">${e(p.text)} ${(p.sourceIds || []).map(id => sourceLink(id, answer.sourceIds.indexOf(id) + 1)).join(' ')}</p>`).join('')}${answer.kind === 'answer' ? `<div class="answer-footer"><span class="muted">合成示例 · 仅作页面确认</span><button class="button small secondary" data-save-answer="${index}">${icon('plus')}存为知识草稿</button></div>` : ''}</div></article>`;
}
function submitQuestion(question) {
  const cleaned = question.trim();
  if (!cleaned) { notify('请先输入一个问题。'); return; }
  state.turns.push({ question: cleaned, answer: createExampleAnswer(cleaned) });
  state.question = '';
  state.query = '';
  if (location.hash === '#/ask') render(); else location.hash = '#/ask';
}
const graphPositions = [[400, 205], [180, 90], [635, 90], [625, 315], [185, 325], [405, 55]];
function renderGraph() {
  const selected = pages.find(p => p.id === state.graphId) || pages[0];
  return `${heading('CONNECTED KNOWLEDGE', '知识关系', '查看主题之间如何关联，以及它们共同引用了哪些资料。')}
    <div class="graph-layout"><section class="graph-board"><div class="graph-legend"><span class="badge green">知识页</span><span class="muted">连线表示样稿中的知识关联 · 节点可打开知识页</span></div><svg class="graph-svg" viewBox="0 0 800 430" role="group" aria-label="示例知识关系图；下方提供相同的可点击知识列表"><g class="graph-edges">${pages.flatMap((p, i) => p.relatedIds.map(id => { const j = pages.findIndex(x => x.id === id); if (j < 0 || j <= i) return ''; const a = graphPositions[i % graphPositions.length], b = graphPositions[j % graphPositions.length]; return `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; })).join('')}</g>${pages.map((p, i) => { const xy = graphPositions[i % graphPositions.length]; return `<a href="#/knowledge/${e(p.id)}" aria-label="打开${e(p.title)}"><g class="graph-node ${selected.id === p.id ? 'selected' : ''}" transform="translate(${xy[0]},${xy[1]})"><circle r="${i ? 26 : 34}"/><text text-anchor="middle" dy="5">${i + 1}</text><text class="graph-node-label" text-anchor="middle" dy="58">${e(p.title)}</text></g></a>`; }).join('')}</svg><div class="graph-node-list">${pages.map((p, i) => `<button class="graph-node-button ${state.graphId === p.id ? 'active' : ''}" data-graph="${e(p.id)}"><span>${i + 1}</span>${e(p.title)}</button>`).join('')}</div></section>
    <aside class="graph-detail panel"><div class="panel-header"><h2>选中的知识</h2></div><div class="panel-body"><span class="badge green">${e(selected.type)}</span><h2>${e(selected.title)}</h2><p>${e(selected.summary)}</p><a class="button primary" href="#/knowledge/${e(selected.id)}">打开知识页 ${icon('arrow')}</a><div class="section-heading"><h3>原始来源</h3></div>${selected.sourceIds.map(id => sources.find(s => s.id === id)).filter(Boolean).map(sourceMini).join('')}</div></aside></div>`;
}
function renderReview() {
  const selected = proposals.find(p => p.id === state.reviewId) || proposals[0];
  const decision = state.decisions[selected?.id];
  return `${heading('REVIEW CHANGES', '更新审阅', '资料发生变化时，先查看影响与差异，再决定如何更新知识。')}
    <p class="notice">以下是预设变更样例。采纳仅更新本地预览，暂不采纳仅标记为已处理；不会改动真实知识库。</p>
    <div class="review-layout"><section class="review-list">${proposals.map(p => `<button class="review-item ${selected.id === p.id ? 'active' : ''}" data-review="${e(p.id)}"><span class="badge ${state.decisions[p.id] ? 'gray' : 'amber'}">${state.decisions[p.id] === 'accepted' ? '本地已采纳' : state.decisions[p.id] === 'dismissed' ? '暂不采纳' : '待确认'}</span><strong>${e(p.title)}</strong><p>${e(p.reason)}</p>${icon('chevron')}</button>`).join('')}</section><article class="panel diff-panel"><div class="panel-header"><h2>${e(selected.title)}</h2></div><div class="panel-body"><p>${e(selected.reason)}</p><div class="provenance">建议依据 ${sourceLink(selected.sourceId)}</div><div class="diff-before"><div class="eyebrow">原有内容 · 示例</div><p>${e(selected.before)}</p></div><div class="diff-after"><div class="eyebrow">建议更新 · 示例</div><p>${e(selected.after)}</p></div><div class="review-actions">${decision ? `<span class="review-resolved">${icon('check')}${decision === 'accepted' ? '已在本地预览中采纳' : '本地已标记暂不采纳'}</span><button class="button secondary" data-action="undo-review">撤销此决定</button>` : '<button class="button primary" data-action="accept-review">采纳到本地预览</button><button class="button secondary" data-action="dismiss-review">暂不采纳</button>'}<a class="text-link" href="#/knowledge/${e(selected.pageId)}">查看知识页 ${icon('arrow')}</a></div></div></article></div>`;
}
function renderSettings() {
  const s = state.settings;
  return `${heading('WORKSPACE SETTINGS', '空间设置', '检索参数保持可见、可解释；模型与数据接入等你确认后再实现。')}
    <form id="settings-form" class="settings-section panel"><div class="panel-header"><h2>检索设置</h2><span class="badge amber">仅保存预览配置</span></div><div class="panel-body"><p class="settings-note">这些参数用于确认设置界面，不会改变本预览的固定答案，也不会保存到线上服务。</p><div class="form-grid"><div class="field"><label for="search-method">检索方式</label><select name="method" id="search-method">${Object.entries({ hybrid: '混合检索 · 关键词 + 语义', vector: '向量检索 · 语义匹配', full_text: '全文检索 · 关键词匹配' }).map(([value, title]) => `<option value="${value}" ${s.method === value ? 'selected' : ''}>${title}</option>`).join('')}</select><small>根据问题和资料特点，选择候选资料的查找方式。</small></div><div class="field"><label for="ranking">排序策略</label><select name="ranking" id="ranking"><option value="rerank" ${s.ranking === 'rerank' ? 'selected' : ''}>Rerank 模型排序</option><option value="weighted" ${s.ranking === 'weighted' ? 'selected' : ''}>权重融合排序</option></select><small>先召回候选，再决定哪些片段进入回答。</small></div><div class="field"><label for="top-k">Top K · 最多采用的片段数</label><input id="top-k" name="topK" type="number" min="1" max="100" step="1" value="${e(s.topK)}" required><small>片段数不等于文件数，也不表示完整列出所有文件。</small></div><div class="field"><label class="toggle-row" for="threshold-enabled"><input type="checkbox" id="threshold-enabled" name="thresholdEnabled" ${s.thresholdEnabled ? 'checked' : ''}>启用相关性阈值</label><input id="threshold" name="threshold" type="number" min="0" max="1" step="0.01" value="${e(s.threshold)}" ${s.thresholdEnabled ? '' : 'disabled'} aria-label="相关性阈值"><small>只在对应评分方式下解释；不是事实可信度或回答置信度。</small></div></div><div class="actions"><button class="button primary" type="submit">保存预览设置</button><button class="button secondary" type="button" data-action="reset-settings">恢复默认</button></div></div></form>
    <section class="settings-section panel"><div class="panel-header"><h2>模型与后端连接</h2><span class="badge gray">待前端确认后接入</span></div><div class="panel-body"><dl class="meta-list"><dt>生成模型</dt><dd>复用现有 OpenAI 兼容接口</dd><dt>嵌入 / 重排</dt><dd>沿用现有配置与检索设置，不在此创建新密钥</dd><dt>Wiki 编译与版本</dt><dd>尚未实现；需新增后端知识页 / 关系 / 审阅合同</dd><dt>来源读取</dt><dd>计划复用已校验的原文页码、音视频时间与版本</dd></dl></div></section><section class="settings-section panel"><div class="panel-header"><h2>预览数据</h2></div><div class="panel-body"><p class="muted">清空此浏览器的预览草稿、导入文件名、审阅决定与设置，不影响现有业务页面或真实资料。</p><button class="button secondary" data-action="reset-preview">清空本地预览修改</button></div></section>`;
}
function render(focus = false) {
  const route = parseRoute(location.hash);
  renderFrame(route);
  content.innerHTML = route.view === 'home' ? renderHome() : route.view === 'knowledge' ? renderKnowledge(route.id) : route.view === 'sources' ? renderSources(route.id) : route.view === 'ask' ? renderAsk() : route.view === 'graph' ? renderGraph() : route.view === 'review' ? renderReview() : renderSettings();
  if (focus) { content.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
function saveDraft(title, text, sourceIds = []) {
  const id = `draft-${crypto.randomUUID()}`;
  state.drafts.push({ id, title, text, sourceIds });
  persist();
  location.hash = `#/knowledge/${id}`;
  notify('已生成本地草稿；尚未核验，也未写入后端。');
}
document.addEventListener('submit', event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !['home-question', 'question-form', 'catalog-search', 'settings-form', 'draft-form'].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'home-question' || form.id === 'question-form') submitQuestion(String(data.get('question') || ''));
  if (form.id === 'catalog-search') { state.query = String(data.get('query') || '').trim(); render(); }
  if (form.id === 'draft-form') {
    const title = String(data.get('title') || '').trim(), text = String(data.get('text') || '').trim();
    if (!title || !text) { notify('请填写标题和正文。'); return; }
    saveDraft(title, text);
  }
  if (form.id === 'settings-form') {
    state.settings = { method: data.get('method'), ranking: data.get('ranking'), topK: Number(data.get('topK')), thresholdEnabled: data.has('thresholdEnabled'), threshold: Number(data.get('threshold') ?? state.settings.threshold) };
    if (persist()) notify('预览设置已保存到此浏览器；不会影响真实检索。');
  }
});
document.addEventListener('input', event => { if (event.target.id === 'question') state.question = event.target.value; });
document.addEventListener('change', event => {
  const target = event.target;
  if (target.id === 'source-kind') { state.sourceKind = target.value; render(); }
  if (target.id === 'page-type') { state.pageType = target.value; render(); }
  if (target.id === 'threshold-enabled') document.querySelector('#threshold').disabled = !target.checked;
  if (target.id === 'preview-files') {
    state.pendingFiles = Array.from(target.files || []).map(file => ({ name: file.name, size: file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / 1024 / 1024).toFixed(1)} MB` }));
    document.querySelector('#upload-list').innerHTML = state.pendingFiles.map(f => `<div class="source-mini">${fileIcon('text')}<span class="file-meta"><strong>${e(f.name)}</strong><span>${e(f.size)} · 不上传文件</span></span></div>`).join('');
    document.querySelector('#confirm-import').disabled = state.pendingFiles.length === 0;
  }
});
document.addEventListener('click', event => {
  const element = event.target.closest('[data-action], [data-ask], [data-save-answer], [data-graph], [data-review]');
  if (!element) return;
  if (element.hasAttribute('data-ask')) { submitQuestion(element.dataset.ask); return; }
  if (element.hasAttribute('data-save-answer')) {
    const turn = state.turns[Number(element.dataset.saveAnswer)];
    if (turn?.answer.kind === 'answer') saveDraft(turn.question, [turn.answer.summary, ...turn.answer.paragraphs.map(p => p.text)].join('\n\n'), turn.answer.sourceIds);
    return;
  }
  if (element.hasAttribute('data-graph')) { state.graphId = element.dataset.graph; render(); return; }
  if (element.hasAttribute('data-review')) { state.reviewId = element.dataset.review; render(); return; }
  const action = element.dataset.action;
  if (action === 'search') { location.hash = '#/knowledge'; requestAnimationFrame(() => document.querySelector('#catalog-search input')?.focus()); }
  if (action === 'import') document.querySelector('#import-dialog').showModal();
  if (action === 'close-import') document.querySelector('#import-dialog').close();
  if (action === 'confirm-import' && state.pendingFiles.length) {
    state.imports.push(...state.pendingFiles);
    persist(); state.pendingFiles = [];
    document.querySelector('#preview-files').value = '';
    document.querySelector('#upload-list').textContent = '';
    document.querySelector('#confirm-import').disabled = true;
    document.querySelector('#import-dialog').close();
    if (location.hash === '#/sources') render(); else location.hash = '#/sources';
    notify('已加入本地预览清单。未上传、未解析、未调用模型。');
  }
  if (action === 'new-chat') { state.turns = []; state.question = ''; render(); document.querySelector('#question')?.focus(); }
  if (['accept-review', 'dismiss-review', 'undo-review'].includes(action)) {
    if (action === 'undo-review') delete state.decisions[state.reviewId];
    else state.decisions[state.reviewId] = action === 'accept-review' ? 'accepted' : 'dismissed';
    persist(); render(); notify('仅更新本地审阅状态，未改动真实知识库。');
  }
  if (action === 'reset-settings') { state.settings = { ...defaults }; persist(); render(); notify('已恢复预览默认设置。'); }
  if (action === 'reset-preview' && window.confirm('仅清空此浏览器的预览修改？本地草稿、导入清单和审阅决定将删除，真实资料不受影响。')) {
    state.imports = []; state.drafts = []; state.decisions = {}; state.settings = { ...defaults }; state.turns = []; state.question = '';
    persist(); render(); notify('已清空本地预览修改；真实资料未改变。');
  }
});
window.addEventListener('hashchange', () => render(true));
render();
