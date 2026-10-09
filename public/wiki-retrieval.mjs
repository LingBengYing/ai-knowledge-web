import { ApiError, DOCUMENT_FORMATS, documentExtension, documentDownloadOnly } from './api.mjs';
import { RetrievalSession, retrievalEnabled } from './retrieval-tests.mjs';
import { RetrievalSettingsSession, retrievalSettingsEnabled, retrievalSettingsSummary, retrievalThresholdHelp, retrievalScoreLabel } from './retrieval-settings.mjs';
import { DocumentOriginalSession } from './document-originals.mjs';
import { PdfPreviewSession } from './pdf-preview.mjs';

const e = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const fieldNames = ['method', 'ranking', 'dense-weight', 'top-k', 'threshold-enabled', 'threshold'];
const defaultDraft = { search_method: 'hybrid', ranking_mode: 'rerank', dense_weight: 0.5, top_k: 5, score_threshold_enabled: false, score_threshold: 0.5 };
const locationLabel = match => documentDownloadOnly(DOCUMENT_FORMATS[documentExtension(match.filename)]) || documentExtension(match.filename) === 'mdx'
  ? '解析文本' : `第 ${match.page} 页`;
const errorMessage = error => error?.status === 401 ? '会话已失效，请重新连接后测试。'
  : error?.status === 422 ? '请核对问题和临时检索参数后重新测试。'
    : error?.status === 429 ? '服务正在处理其他请求，请稍后手动测试。'
      : '本次召回测试未完成，请核对服务状态后手动测试。';
const button = (action, label, attrs = '') => `<button type="button" class="button secondary" data-retrieval-action="${action}" ${attrs}>${label}</button>`;

/** Native retrieval workspace; production modules own request and source validation. */
export function mountWikiRetrieval({ container, document, window = globalThis, api, config, notify = () => {} }) {
  if (!container || typeof api !== 'function') throw new TypeError('A retrieval container and API are required');
  let destroyed = false, sourceSequence = 0, sourceController = null, sourceMatch = null, sourceError = '', settingsVersion = null;
  const $ = suffix => container.querySelector(`#wiki-retrieval-${suffix}`);
  const available = retrievalEnabled(config);
  const onAuthenticationFailure = () => notify('会话已失效，请重新连接。', true);
  container.innerHTML = `<div class="page-heading"><div class="heading-copy"><h1>召回测试</h1></div><div class="actions"><a class="button secondary" href="#/settings">检索设置</a></div></div>
    <section class="panel"><div class="panel-body"><form id="wiki-retrieval-form">
      <div class="field"><label for="wiki-retrieval-question">查询内容</label><textarea id="wiki-retrieval-question" rows="4" placeholder="输入想查找的内容" required></textarea></div>
      <details class="settings-help"><summary>检索参数</summary><p id="wiki-retrieval-global"></p>
        <label><input id="wiki-retrieval-override" type="checkbox"> 仅本次使用自定义参数</label>
        <div id="wiki-retrieval-fields" class="form-grid" hidden>
          <div class="field"><label for="wiki-retrieval-method">检索方式</label><select id="wiki-retrieval-method"><option value="hybrid">混合检索</option><option value="vector">向量检索</option><option value="full_text">全文检索</option></select></div>
          <div class="field"><label for="wiki-retrieval-ranking">排序策略</label><select id="wiki-retrieval-ranking"><option value="rerank">Rerank 模型</option><option value="weighted">权重 / 原检索分</option></select></div>
          <div class="field" id="wiki-retrieval-weight-field"><label for="wiki-retrieval-dense-weight">语义权重（0–1）</label><input id="wiki-retrieval-dense-weight" type="number" min="0" max="1" step="0.01" required><span id="wiki-retrieval-weight-label"></span></div>
          <div class="field"><label for="wiki-retrieval-top-k">Top K · 召回片段数</label><input id="wiki-retrieval-top-k" type="number" min="1" max="20" step="1" required></div>
          <div class="field"><label for="wiki-retrieval-threshold-enabled"><input id="wiki-retrieval-threshold-enabled" type="checkbox"> 启用相关性阈值</label><input id="wiki-retrieval-threshold" type="number" step="any" aria-label="相关性阈值" required></div>
        </div><p id="wiki-retrieval-threshold-help"></p><p>检索已发布的文字与 OCR 片段；不生成回答，不包含视频候选。普通综合问答另含视频文字。</p>
        ${button('refresh-settings', '重新读取配置', 'id="wiki-retrieval-refresh-settings"')}
      </details>
      <p id="wiki-retrieval-error" class="notice error" role="alert" hidden></p>
      <div class="form-actions"><button class="button primary" id="wiki-retrieval-run" type="submit">开始测试</button>${button('stop', '停止等待', 'id="wiki-retrieval-stop" hidden')}<span class="badge gray">组织共享全库</span></div>
    </form></div></section>
    <section class="panel model-projection" aria-live="polite"><div class="panel-header"><h2>召回结果</h2><span id="wiki-retrieval-status"></span></div><div class="panel-body"><details id="wiki-retrieval-diagnostics" class="settings-help" hidden><summary>本次参数与记录</summary><p id="wiki-retrieval-effective"></p><p id="wiki-retrieval-test-id" class="provenance"></p></details><div id="wiki-retrieval-results"></div></div></section>
    <section id="wiki-retrieval-original" class="article-paper model-projection" aria-live="polite" hidden></section>`;

  const settings = new RetrievalSettingsSession(api, { onChange: () => render(), onAuthenticationFailure });
  const retrieval = new RetrievalSession(api, { onChange: () => render(), onAuthenticationFailure });
  const original = new DocumentOriginalSession(api, { onChange: () => renderOriginal(), onAuthenticationFailure, objectUrls: window.URL ?? URL });
  const pdf = new PdfPreviewSession({ onChange: value => {
    if (destroyed) return;
    const status = $('pdf-status');
    if (status) status.textContent = value.phase === 'loading' ? '正在显示原 PDF…' : value.phase === 'ready' ? `第 ${value.page} / ${value.pages} 页` : value.error ?? '';
  } });

  function fillFields(saved) {
    for (const [suffix, key] of [['method', 'search_method'], ['ranking', 'ranking_mode'], ['dense-weight', 'dense_weight'], ['top-k', 'top_k'], ['threshold', 'score_threshold']]) $(suffix).value = String(saved[key]);
    $('threshold-enabled').checked = saved.score_threshold_enabled;
  }
  function draft() {
    const number = suffix => $(suffix).value.trim() === '' ? NaN : Number($(suffix).value);
    return { search_method: $('method').value, ranking_mode: $('ranking').value, dense_weight: number('dense-weight'), top_k: number('top-k'), score_threshold_enabled: $('threshold-enabled').checked === true, score_threshold: number('threshold') };
  }
  function render() {
    if (destroyed) return;
    const value = retrieval.value, busy = value.phase === 'loading', saved = settings.value.settings;
    if (saved && settingsVersion !== saved.version) { fillFields(saved); settingsVersion = saved.version; }
    const override = $('override').checked === true;
    const canOverride = available && retrievalSettingsEnabled(config) && !!saved && settings.value.phase !== 'loading';
    $('question').disabled = !available;
    $('override').disabled = !canOverride || busy;
    $('run').disabled = !available || busy || !$('question').value.trim() || override && !canOverride;
    $('run').textContent = busy ? '正在检索…' : '开始测试';
    $('stop').hidden = !busy;
    $('fields').hidden = !override;
    $('refresh-settings').hidden = !retrievalSettingsEnabled(config);
    $('refresh-settings').disabled = busy || settings.value.phase === 'loading';
    for (const name of fieldNames) $(name).disabled = !canOverride || !override || busy;
    const current = draft(), weighted = current.search_method === 'hybrid' && current.ranking_mode === 'weighted';
    $('weight-field').hidden = !weighted;
    $('dense-weight').disabled ||= !weighted;
    $('threshold').disabled ||= !current.score_threshold_enabled;
    $('weight-label').textContent = Number.isFinite(current.dense_weight) ? `关键词权重 ${Number((1 - current.dense_weight).toFixed(4))}` : '';
    $('threshold-help').textContent = retrievalThresholdHelp(override ? current : saved ?? defaultDraft);
    $('global').textContent = settings.value.phase === 'loading' ? '正在读取检索配置…' : saved ? `配置版本 ${saved.version} · ${retrievalSettingsSummary(saved)}`
      : settings.value.error ? '检索配置读取失败；仍可使用服务器默认参数测试。' : '使用服务器当前检索参数。';
    const error = !available ? '当前服务未启用召回测试。' : value.error ? errorMessage(value.error) : '';
    $('error').textContent = error; $('error').hidden = !error;
    $('status').textContent = busy ? '正在检索…' : value.result ? `全库 ${value.result.scope_count} 份资料 · ${value.result.matches.length} 个片段` : '';
    $('diagnostics').hidden = !value.result;
    $('effective').textContent = value.result ? `${value.command?.retrieval_settings ? '临时参数（未保存）' : '本次实际参数'} · 检索版本 ${value.result.effective_settings.version} · ${retrievalSettingsSummary(value.result.effective_settings)}` : '';
    $('test-id').textContent = value.result ? `测试编号 ${value.result.test_id} · 模型配置版本 ${value.result.configuration_version}` : '';
    $('results').innerHTML = value.result?.matches.length ? value.result.matches.map(match => `<article class="knowledge-body task-status"><h3>${match.rank}. ${e(match.filename)} · ${e(locationLabel(match))}</h3><div class="preserve-lines">${e(match.text)}</div>
      <div class="status-line"><span class="badge gray">${e(retrievalScoreLabel(value.result.score_kind))} ${e(match.retrieval_score)}</span><span class="badge gray">${match.rerank_score === null ? '未重排' : `原始重排分 ${e(match.rerank_score)}`}</span></div>
      <details class="settings-help"><summary>片段位置与版本</summary><p class="provenance">版本 ${e(match.revision_id)} · Unicode 码点 ${match.start}–${match.end}</p><p>分值用于排序，不是事实置信度。</p></details>
      <div class="form-actions">${button('original', '核对同版本原文件', `data-rank="${match.rank}" ${config?.capabilities?.includes('document_originals') ? '' : 'disabled'}`)}<a class="button secondary" href="#/sources/${e(match.document_id)}">查看资料</a></div></article>`).join('')
      : `<div class="empty-state"><h3>${busy ? '正在查找相关片段…' : value.error ? '本次测试未完成' : value.result ? value.result.reason === 'empty_scope' ? '还没有可检索的已发布资料' : '没有找到匹配片段' : '输入内容，查看命中的原文片段'}</h3></div>`;
  }

  function clearSource() {
    sourceSequence++; sourceController?.abort(); sourceController = null; sourceMatch = null; sourceError = '';
    pdf.close(); original.close();
  }
  function invalidate() { clearSource(); retrieval.invalidate(); }
  function renderOriginal() {
    if (destroyed) return;
    const panel = $('original'), value = original.value;
    panel.hidden = !sourceMatch && !sourceError;
    if (panel.hidden) { panel.innerHTML = ''; return; }
    if (sourceError || value.phase === 'error') { panel.innerHTML = `<p class="notice error" role="alert">${e(sourceError || '同版本原文件核对失败，未打开其他文件。')}</p>`; return; }
    if (!value.original) { panel.innerHTML = '<p>正在核对同版本原文件…</p>'; return; }
    const file = value.original;
    const open = file.media_type === 'application/pdf' ? `${file.url}#page=${sourceMatch.page}` : file.url;
    panel.innerHTML = `<div class="page-heading"><h2>${e(file.filename)}</h2>${button('close-original', '关闭')}</div><div class="form-actions">${file.downloadOnly ? '' : `<a class="button secondary" href="${e(open)}" target="_blank" rel="noopener noreferrer">打开原文件</a>`}<a class="button secondary" href="${e(file.url)}" download="${e(file.filename)}">下载原文件</a></div>
      ${file.media_type === 'application/pdf' ? '<p id="wiki-retrieval-pdf-status"></p><canvas id="wiki-retrieval-pdf-canvas" class="reader-canvas" aria-label="引用所在的 PDF 页面"></canvas>'
        : file.text !== null ? `<pre class="preserve-lines">${e(file.text)}</pre>` : file.document_type === 'image' ? `<img class="source-reader-media" src="${e(file.url)}" alt="核对后的原图">` : ''}
      ${file.textError ? `<p class="notice">${e(file.textError)}</p>` : ''}
      <details class="settings-help"><summary>原文件校验</summary><p class="provenance">版本 ${e(file.revision_id)} · SHA-256 ${e(file.source_sha256)}</p></details>`;
    if (file.media_type === 'application/pdf') void pdf.open({ blob: file.blob, page: sourceMatch.page, canvas: $('pdf-canvas'), width: panel.clientWidth, pixelRatio: window.devicePixelRatio });
  }

  async function openOriginal(rank) {
    if (destroyed || !config?.capabilities?.includes('document_originals')) return;
    const match = retrieval.value.result?.matches.find(item => item.rank === rank);
    if (!match) return;
    clearSource(); sourceMatch = match; renderOriginal();
    const sequence = sourceSequence, controller = new AbortController(); sourceController = controller;
    try {
      const metadata = await api(`/v1/documents/${match.document_id}/original`, { signal: controller.signal });
      if (destroyed || sequence !== sourceSequence) return;
      if (metadata?.document_id !== match.document_id || metadata.revision_id !== match.revision_id || metadata.filename !== match.filename || metadata.source_sha256 !== match.source_sha256) {
        sourceError = '当前原文件与召回版本不一致，请重新测试。'; renderOriginal(); return;
      }
      await original.open({ document_id: metadata.document_id, active_revision_id: metadata.revision_id, filename: metadata.filename, document_type: metadata.document_type,
        media_info: { mime_type: metadata.media_type, sha256: metadata.source_sha256, size_bytes: metadata.size_bytes } });
    } catch (error) {
      if (destroyed || sequence !== sourceSequence) return;
      sourceError = '同版本原文件读取失败，请重新测试后核对。'; renderOriginal();
      if (error instanceof ApiError && error.status === 401) onAuthenticationFailure();
    } finally { if (sequence === sourceSequence) sourceController = null; }
  }

  async function onSubmit(event) {
    if (event.target.id !== 'wiki-retrieval-form') return;
    event.preventDefault(); event.stopPropagation?.();
    if (destroyed || !available || retrieval.value.phase === 'loading' || !$('question').value.trim()) return;
    if ($('override').checked && (!settings.value.settings || $('override').disabled)) return;
    clearSource();
    await retrieval.run($('question').value, null, $('override').checked ? draft() : undefined);
  }
  function onEdit(event) {
    if (destroyed || !event.target.id?.startsWith('wiki-retrieval-')) return;
    if (!['question', 'override', ...fieldNames].includes(event.target.id.slice('wiki-retrieval-'.length))) return;
    event.stopPropagation?.();
    if (event.target.id === 'wiki-retrieval-override' && !event.target.checked && settings.value.settings) fillFields(settings.value.settings);
    invalidate();
  }
  async function onClick(event) {
    const target = event.target.closest?.('[data-retrieval-action]');
    if (!target || destroyed || !container.contains(target)) return;
    const action = target.dataset.retrievalAction;
    event.stopPropagation?.();
    if (action === 'original') { event.preventDefault(); await openOriginal(Number(target.dataset.rank)); }
    else if (action === 'close-original') clearSource();
    else if (action === 'stop') { invalidate(); $('status').textContent = '已停止本地等待'; }
    else if (action === 'refresh-settings' && retrievalSettingsEnabled(config) && retrieval.value.phase !== 'loading') { invalidate(); $('override').checked = false; await settings.load(); }
  }
  const listeners = [['submit', onSubmit], ['input', onEdit], ['change', onEdit], ['click', onClick]];
  for (const [name, listener] of listeners) container.addEventListener(name, listener);
  fillFields(defaultDraft); render();
  const ready = retrievalSettingsEnabled(config) ? settings.load() : Promise.resolve(null);
  return { ready, destroy() {
    if (destroyed) return; destroyed = true;
    for (const [name, listener] of listeners) container.removeEventListener(name, listener);
    clearSource(); retrieval.close(); settings.close();
  } };
}
