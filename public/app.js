import { ModelConfigurationSession, modelConfigurationEnabled } from './model-configuration.mjs';
import { ModelRebuildSession, modelRebuildEnabled, modelRebuildPending, modelRebuildReason } from './model-rebuild.mjs';
import { RetrievalSession, retrievalEnabled, matchCurrentOriginal } from './retrieval-tests.mjs';

import { CleanupSession, cleanupEnabled, canRequestCleanup, cleanupLabel } from './document-cleanup.mjs';
import { createApi, ApiError, validateUpload, validateReplacementUpload, imageUploadMode } from './api.mjs';
import { WorkbenchState, batchFeedback, parseTags, checkedTask, checkedIndexTask, taskPending, taskLabel, indexTaskLabel, canStartIndexing, documentStatusLabel } from './workbench-state.mjs';
import { showNotice } from './notices.mjs';
import { AnswerSession, answersEnabled, answerRequest } from './answers.mjs';
import { mediaModes, mediaQuote, timeLabel } from './media-sources.mjs';
import { DocumentOriginalSession } from './document-originals.mjs';
import { queryAttachmentsEnabled, attachmentAccept, checkedQueryAttachments } from './query-attachments.mjs';
import { SynopsisSession, synopsisEnabled, canGenerateSynopsis } from './file-synopsis.mjs';
import { TagSuggestionSession, tagSuggestionsEnabled, canReadTagSuggestions } from './tag-suggestions.mjs';
import { VoiceQuestionSession, voiceQuestionsEnabled } from './voice-question.mjs';
import { ImageVectorSession, imageVectorsEnabled, canReadImageVector } from './image-vectors.mjs';
import { AudioVectorSession, audioVectorsEnabled, canReadAudioVector } from './audio-vectors.mjs';
import { VideoAvIndexSession, videoAvEnabled, canReadVideoAvIndex, checkedVideoAvUpload, videoAvModes, videoAvQueryAttachmentsEnabled } from './video-av.mjs';
import { SoundIndexSession, soundEnabled, canReadSoundIndex, checkedSoundUpload } from './sound-library.mjs';
import { DocumentReplacementSession, replacementsEnabled, replacementLabel, replacementAccept } from './document-replacements.mjs';

const $ = id => document.getElementById(id);
const state = new WorkbenchState();
const controllers = new Map();
let config = null;
let principal = 'owner';
let api = createApi({}, () => principal);
let connected = false;
let folders = [];
let folderId = '';
let page = 1;
let total = 0;
let totalPages = 0;
let loading = false;
let searchTimer;
let dialogIntent = null;
let taskTimer;
let taskPollPaused = false;
let taskKind = 'ingestion';

// Workflow Navigation Module: view state stays separate from authorization and task state.
let currentView = 'documents';
let retrievalScope = null;
let retrievalScopeNames = [];
let answerEntry = 0;
let answerCapabilityRefresh = null;
let answerCapabilityError = null;
let detailSection = 'preview';
let detailSectionDocument = null;
let taskFilter = 'all';
let detailBaseline = null;
let filterSnapshot = null;
let answerScope = null;
let answerScopeNames = [];
let answerMode = 'knowledge';
let queryAttachments = [];
let queryAttachmentError = '';
const reindexNeedsRefresh = new Set();
const answerSession = new AnswerSession((path, options) => api(path, options), {
  onChange: () => renderAnswers(),
  onAuthenticationFailure: error => authenticationFailed(error),
  canReadImage: mode => mode === 'visual' ? connected && config?.capabilities?.includes('visual_sources') : config?.capabilities?.includes('source_image_content'),
  canUseAttachments: mode => connected && (mode === 'sound' ? soundEnabled(config) : queryAttachmentsEnabled(config)) && answersEnabled(config, mode),
  canUseVideoAvAttachments: () => connected && videoAvQueryAttachmentsEnabled(config),
  canReadOriginal: () => connected && config?.capabilities?.includes('document_originals'),
});
const voiceQuestionSession = new VoiceQuestionSession({
  request: (path, options) => api(path, options),
  canUseVoice: () => connected && voiceQuestionsEnabled(config) && answersEnabled(config, answerMode) && answerSession.value.phase !== 'loading',
  onChange: () => renderAnswerControls(),
  onAuthenticationFailure: error => authenticationFailed(error),
});
const originalSession = new DocumentOriginalSession((path, options) => api(path, options), {
  onChange: () => renderDetailOriginal(), onAuthenticationFailure: error => authenticationFailed(error),
});
const replacementSession = new DocumentReplacementSession((path, options) => api(path, options), {
  onChange: () => renderDetailReplacement(), onAuthenticationFailure: error => authenticationFailed(error),
  onPublished: value => {
    if (currentView === 'documents' && connected && state.detail?.document_id === value.document_id) {
      loadDocuments({ preserveDetail: true });
    }
  },
});
const synopsisSession = new SynopsisSession((path, options) => api(path, options), {
  onChange: () => { renderDetailSynopsis(); synchronizeTagSuggestions(); renderDetailTagSuggestions(); }, onAuthenticationFailure: error => authenticationFailed(error),
  setTimer: (callback, delay) => setTimeout(callback, delay), clearTimer: timer => clearTimeout(timer),
});

const tagSuggestionSession = new TagSuggestionSession((path, options) => api(path, options), {
  onChange: () => renderDetailTagSuggestions(), onAuthenticationFailure: error => authenticationFailed(error),
});

const cleanupSession = new CleanupSession((path, options) => api(path, options), {
  onChange: () => renderCleanupRecords(), onAuthenticationFailure: error => authenticationFailed(error),
});

const modelRoles = ['embedding', 'rerank', 'generation'];
const modelProviderLabels = { siliconflow: '硅基流动', deepseek: 'DeepSeek 官方' };
let renderedModelVersion;
let retrievalSourceSequence = 0;
let retrievalSourceMatch = null;
const modelSession = new ModelConfigurationSession((path, options) => api(path, options), {
  onChange: () => renderModelSettings(), onClearSecrets: clearModelSecrets,
  onAuthenticationFailure: error => authenticationFailed(error),
  canWrite: () => !modelRebuildLocked(),
});
const modelRebuildSession = new ModelRebuildSession((path, options) => api(path, options), {
  onChange: () => renderModelSettings(), onAuthenticationFailure: error => authenticationFailed(error),
  onCompleted: job => completeModelRebuild(job),
});
const retrievalSession = new RetrievalSession((path, options) => api(path, options), {
  onChange: () => renderRetrieval(), onAuthenticationFailure: error => authenticationFailed(error),
});

const retrievalOriginal = new DocumentOriginalSession((path, options) => api(path, options), {
  onChange: () => renderRetrievalOriginal(), onAuthenticationFailure: error => authenticationFailed(error),
});

function clearModelSecrets() {
  for (const role of modelRoles) { const input = $(`model-${role}-key`); if (input) input.value = ''; }
}

function modelRebuildLocked() {
  return modelRebuildEnabled(config) && (modelRebuildPending(modelRebuildSession.value.status?.job)
    || ['starting', 'unknown'].includes(modelRebuildSession.value.phase));
}

async function loadModelSettings() {
  const epoch = state.epoch;
  const result = await modelSession.load();
  if (result && epoch === state.epoch && connected && currentView === 'settings' && modelRebuildEnabled(config)) await modelRebuildSession.load();
  return epoch === state.epoch ? result : null;
}

async function completeModelRebuild(job) {
  const epoch = state.epoch;
  if (!connected || currentView !== 'settings' || modelSession.value.dirty) return false;
  try {
    const result = await modelSession.load();
    if (!result || epoch !== state.epoch || currentView !== 'settings' || result.active_version !== job.target_version) {
      if (epoch === state.epoch && currentView === 'settings') notice('model-rebuild-error', '批次已完成，尚未确认当前有效配置。请刷新批次状态核对。');
      return false;
    }
    await refreshModelCapabilities();
    if (epoch !== state.epoch || !connected || currentView !== 'settings') return false;
    answerSession.reset(); resetRetrieval();
    notice('answer-error', '新的嵌入配置与索引已应用，请重新测试召回或提问。当前问题与完整范围已保留。');
    renderModelRebuild();
    return true;
  } catch (error) {
    if (epoch === state.epoch && !authenticationFailed(error)) notice('model-rebuild-error', '批次结果尚未完成回读，请刷新批次状态核对。');
    return false;
  }
}

function modelIndexGuidance() {
  const saved = modelSession.value.configuration;
  if (!modelConfigurationEnabled(config)) return '';
  if (!saved) return '请在设置中读取模型状态；解析完成不等于已索引。';
  if (modelRebuildLocked()) return '索引重建期间继续使用旧配置和已发布资料。请等待批次结束后再导入或更改配置。';
  if (saved.state === 'unconfigured') return '尚未配置文字模型，请在设置中填写并保存三个角色。';
  if (!saved.projection.configured) return '模型可继续保存和测试。应用前请由服务管理员配置向量库，再点击“读取当前配置”。';
  if (saved.active_version === null) return '模型草稿尚未应用；应用后可导入资料并建立文字索引。';
  return '索引使用已应用版本；解析完成后仍须显式建立索引。模型目标变更可能需要另行重建。';
}

function canImportConfiguredDocuments() {
  const value = modelSession.value;
  return connected && value.configuration?.active_version != null && ingestionEnabled()
    && !state.mutating && !value.dirty && !modelRebuildLocked() && !['loading', 'saving', 'testing', 'activating', 'unknown'].includes(value.phase);
}

function renderModelSettings() {
  const panel = $('model-settings'); if (!panel) return;
  panel.hidden = !connected || !modelConfigurationEnabled(config); if (panel.hidden) return;
  const value = modelSession.value, saved = value.configuration;
  const busy = ['loading', 'saving', 'testing', 'activating'].includes(value.phase);
  const writable = saved?.can_edit === true && !busy && value.phase !== 'unknown' && !modelRebuildLocked();
  $('model-refresh').disabled = busy; $('model-stop').hidden = !busy;
  $('model-status').textContent = value.phase === 'unknown' ? '操作结果未知。请读取当前配置核对；不会自动再次提交。'
    : busy ? ({ loading: '正在读取配置…', saving: '正在保存草稿…', testing: '正在测试所选角色…', activating: '正在应用已保存版本…' })[value.phase]
      : saved ? `${saved.can_edit ? '模型管理员' : '只读'} · 已保存版本 ${saved.version ?? '无'} · 已应用版本 ${saved.active_version ?? '无'}${value.dirty ? ' · 有未保存改动，旧测试已失效' : ''}` : '尚未读取配置。';
  notice('model-error', value.error ? `${value.error.message}${value.error.field ? `（字段：${value.error.field}）` : ''}` : '');
  if ((!value.dirty && saved && renderedModelVersion !== saved.version) || !saved) {
    for (const role of modelRoles) {
      $(`model-${role}-name`).value = saved?.[role].model ?? '';
      $(`model-${role}-provider`).value = saved?.[role].provider ?? 'siliconflow';
    }
    $('model-embedding-dimensions').value = saved?.embedding.dimensions ?? '';
    $('model-embedding-revision').value = saved?.embedding.revision ?? '';
    renderedModelVersion = saved?.version;
  }
  for (const role of modelRoles) {
    const provider = $(`model-${role}-provider`).value;
    const providerChanged = provider !== (saved?.[role].provider ?? 'siliconflow');
    $(`model-${role}-provider`).disabled = !writable;
    $(`model-${role}-name`).disabled = !writable; $(`model-${role}-key`).disabled = !writable;
    $(`model-${role}-key-status`).textContent = providerChanged
      ? `服务商已更换为${modelProviderLabels[provider]}，请重新填写对应密钥；原服务商密钥不会沿用。`
      : saved?.[role].has_key ? `已保存${modelProviderLabels[provider]}密钥；同一服务商留空保留，填写新值则更新。` : `尚未保存密钥，请填写${modelProviderLabels[provider]}的密钥。`;
  }
  $('model-generation-name-help').textContent = $('model-generation-provider').value === 'deepseek'
    ? '填写 DeepSeek 官方控制台提供的模型 ID，并使用 DeepSeek 官方密钥。切换服务商不会自动修改模型名称。'
    : '填写硅基流动控制台提供的完整模型 ID，保留斜杠及大小写，并使用硅基流动密钥。';
  $('model-embedding-dimensions').disabled = !writable; $('model-embedding-revision').disabled = !writable;
  const ready = writable && !value.dirty && saved.state !== 'unconfigured';
  $('model-save').disabled = !writable || !value.dirty;
  const rebuildRequired = modelRebuildEnabled(config) && modelRebuildSession.value.status?.target_version === saved?.version && modelRebuildSession.value.status?.required;
  $('model-activate').disabled = !ready || !saved.projection.configured || saved?.active_version === saved?.version || rebuildRequired;
  for (const role of [...modelRoles, 'projection']) {
    $(`model-test-${role}`).disabled = !ready || role === 'projection' && !saved.projection.can_test;
    const result = value.tests[role];
    $(`model-test-${role}-status`).textContent = result ? result.status === 'passed' ? `版本 ${result.version}：测试通过` : `版本 ${result.version}：测试未通过（${result.error_code}）` : value.dirty ? '未保存改动，需保存后重新测试。' : '尚未测试当前版本。';
  }
  $('model-projection-status').textContent = saved?.projection.configured ? `已预置向量库 · 维度 ${saved.projection.dimension ?? '未提供'}` : '向量库尚未由服务器配置；页面不接收连接地址或凭据。';
  $('model-index-guidance').textContent = modelIndexGuidance();
  $('model-import').disabled = !canImportConfiguredDocuments();
  $('model-import').title = value.dirty ? '请先保存模型改动，再进入导入流程。' : '配置已应用且服务启用上传后，可选择原文件导入。';
  renderModelRebuild();
}

function renderModelRebuild() {
  const panel = $('model-rebuild'); if (!panel) return;
  panel.hidden = !connected || !modelRebuildEnabled(config); if (panel.hidden) return;
  const value = modelRebuildSession.value, status = value.status, job = status?.job, saved = modelSession.value.configuration;
  const busy = ['loading', 'starting'].includes(value.phase), pending = modelRebuildPending(job);
  const current = saved && status?.target_version === saved.version;
  const modelBusy = ['loading', 'saving', 'testing', 'activating', 'unknown'].includes(modelSession.value.phase);
  $('model-rebuild-refresh').disabled = busy || modelBusy;
  $('model-rebuild-start').disabled = busy || modelBusy || pending || value.phase !== 'ready' || !current
    || !saved.can_edit || modelSession.value.dirty || status?.can_start !== true || state.mutating;
  $('model-rebuild-start').hidden = status && !status.required && !pending;
  $('model-rebuild-guidance').textContent = modelSession.value.dirty ? '请先保存草稿，再核对重建资格。'
    : !current ? '读取已保存配置后，刷新本次重建资格。'
      : pending ? '旧配置和已发布资料仍可查询、打开来源及整理。重建期间暂停配置保存、导入和索引写入；离开页面不取消后台批次。'
        : status.required ? `当前草稿需要重建 ${status.total_documents} 份资料的索引后才能应用。将使用保存的解析材料，不重新解析或转录。`
          : modelRebuildReason(status.reason) || '当前草稿无需重建，可使用普通应用入口。';
  const labels = { queued: '等待重建', running: '正在重建索引', applying: '正在核对并应用', completed: '批次已完成', failed: '重建未完成' };
  $('model-rebuild-status').textContent = value.phase === 'starting' ? '正在创建后台批次…'
    : value.phase === 'unknown' ? '提交结果未知，请刷新批次状态；不会自动重复提交。'
      : job ? `配置版本 ${job.target_version} · ${labels[job.state]} · 已构建 ${job.completed_documents} / ${job.total_documents} 份${pending ? ' · 自动刷新中' : ''}`
        : busy ? '正在读取重建资格…' : '尚无重建批次。';
  if (job?.state === 'completed' && saved?.active_version === job.target_version) $('model-rebuild-status').textContent += ' · 新配置已确认生效，请重新测试召回或提问。';
  const reason = job?.state === 'failed' ? modelRebuildReason(job.error_code)
    : current && !pending && status?.can_start !== true && status?.required ? modelRebuildReason(status.reason) : '';
  notice('model-rebuild-error', value.error?.message ?? reason);
}

function modelRebuildDialog() {
  const status = modelRebuildSession.value.status, saved = modelSession.value.configuration;
  if (!connected || currentView !== 'settings' || !modelRebuildEnabled(config) || modelRebuildLocked() || state.mutating
    || ['loading', 'saving', 'testing', 'activating', 'unknown'].includes(modelSession.value.phase)
    || modelSession.value.dirty || !saved?.can_edit || status?.target_version !== saved.version || !status.can_start) return;
  showDialog('重建索引并应用配置', `将为本次 ${status.total_documents} 份资料使用已保存的解析材料重新建立索引，调用新的嵌入模型与向量服务，可能产生费用。处理中仍使用旧配置与已发布资料；全部完成后自动应用版本 ${saved.version}，失败保留旧配置。已有图片/音频独立向量会核验后继续使用，不重新生成媒体向量。`, [],
    { kind: 'model-rebuild', version: saved.version, epoch: state.epoch }, '确认重建并应用');
}

function modelDraft() {
  const result = {};
  for (const role of modelRoles) {
    const key = $(`model-${role}-key`).value;
    result[role] = { provider: $(`model-${role}-provider`).value, model: $(`model-${role}-name`).value, ...(key ? { api_key: key } : {}) };
  }
  result.embedding.dimensions = Number($('model-embedding-dimensions').value);
  result.embedding.revision = $('model-embedding-revision').value;
  return result;
}

async function refreshModelCapabilities({ isCurrent = () => true } = {}) {
  const epoch = state.epoch;
  const next = await api('/v1/config');
  if (epoch !== state.epoch || !connected || !isCurrent()) return;
  if (next?.auth_mode !== config.auth_mode || next.workspace_id !== config.workspace_id || !Array.isArray(next.capabilities)) throw new ApiError(502, '服务身份或能力状态不一致，请重新连接。');
  config.capabilities = [...next.capabilities];
  renderControls(); renderRows();
  renderScopeSummary();
  const guidance = modelIndexGuidance();
  if (guidance) $('scope-description').textContent += ` ${guidance}`;
  await loadData({ preserveDetail: true });
}

function resetRetrieval() {
  retrievalSourceSequence++; retrievalSourceMatch = null; retrievalOriginal.close(); retrievalSession.invalidate();
}

function refreshAnswerCapabilities() {
  if (!connected || currentView !== 'answers') return;
  const epoch = state.epoch, entry = answerEntry;
  if (answerCapabilityRefresh?.epoch === epoch && answerCapabilityRefresh.entry === entry) return answerCapabilityRefresh.promise;
  const ticket = { epoch, entry, promise: null };
  answerCapabilityRefresh = ticket; answerCapabilityError = null;
  const current = () => answerCapabilityRefresh === ticket && epoch === state.epoch && currentView === 'answers' && entry === answerEntry;
  ticket.promise = (async () => {
    try { await refreshModelCapabilities({ isCurrent: current }); }
    catch (error) {
      if (current() && !authenticationFailed(error)) answerCapabilityError = error;
    } finally {
      if (answerCapabilityRefresh === ticket) { answerCapabilityRefresh = null; renderAnswerControls(); }
    }
  })();
  renderAnswerControls();
  return ticket.promise;
}
function renderRetrieval() {
  const panel = $('retrieval-panel'); if (!panel) return;
  const available = connected && retrievalEnabled(config);
  $('retrieval-question').disabled = !available;
  $('retrieval-scope-label').textContent = retrievalScope === null ? '全部可访问的已发布资料' : `仅所选 ${retrievalScope.length} 份资料`;
  $('retrieval-scope-documents').hidden = retrievalScope === null;
  $('retrieval-scope-documents').replaceChildren(...retrievalScopeNames.map(name => element('li', name)));
  $('retrieval-all').hidden = retrievalScope === null;
  const value = retrievalSession.value, busy = value.phase === 'loading';
  const usable = available;
  $('retrieval-run').disabled = !usable || busy || !$('retrieval-question').value.trim();
  $('retrieval-stop').hidden = !busy;
  $('retrieval-count').disabled = !available || busy; $('retrieval-rerank').disabled = !available || busy;
  $('retrieval-continue').hidden = value.phase !== 'ready'; $('retrieval-continue').disabled = !answersEnabled(config, 'text');
  $('retrieval-help').textContent = !usable ? !connected ? '尚未连接资料服务，连接后即可开始测试。' : '当前服务未启用召回测试，请在设置中确认服务能力。'
    : '仅检索文字与OCR片段，不生成回答；可能调用已配置的嵌入及重排服务。排序分不是事实置信度。';
  $('retrieval-status').textContent = busy ? '正在检索与核对完整范围…' : value.result ? value.result.status === 'empty'
    ? value.result.reason === 'empty_scope' ? '当前范围为空。' : '当前范围没有召回片段。'
    : `配置版本 ${value.result.configuration_version} · 完整范围 ${value.result.scope_count} 份资料 · ${value.result.matches.length} 个片段`
    : '修改问题、范围或身份会清空本次预览；停止只结束本地等待。';
  $('retrieval-empty').hidden = !!value.result?.matches.length;
  $('retrieval-empty').querySelector('p').textContent = value.error ? '请查看左侧错误信息，调整后手动重试。' : value.result ? '请调整问题或核对资料是否已完成索引，再重新测试。' : busy ? '正在按当前问题与完整资料范围检索，请稍候。' : '输入问题并开始测试，在这里查看命中的原文片段。';
  $('retrieval-empty').querySelector('strong').textContent = busy ? '正在查找相关片段…' : value.error ? '本次测试未完成' : value.result ? '没有找到匹配片段' : '哪些内容能回答这个问题？';
  notice('retrieval-error', value.error ? messageFor(value.error) : '');
  const list = $('retrieval-matches'); list.replaceChildren();
  for (const match of value.result?.matches ?? []) {
    const item = element('li');
    item.append(element('h3', `${match.rank}. ${match.filename} · 第 ${match.page} 页`), element('pre', match.text, 'evidence-text'),
      element('p', `RRF排序分 ${match.retrieval_score.toPrecision(5)} · ${match.rerank_score === null ? '未重排' : `重排分 ${match.rerank_score.toPrecision(5)}`} · Unicode码点 ${match.start}–${match.end}`, 'help-text'));
    const open = button('核对并打开同版本原文件', () => openRetrievalOriginal(match)); open.disabled = !config.capabilities.includes('document_originals');
    item.append(open, button('在资料库查看详情', () => openRetrievalDetail(match))); list.append(item);
  }
}

async function openRetrievalOriginal(match) {
  if (currentView !== 'retrieval' || !retrievalSession.value.result?.matches.includes(match)) return;
  const sequence = ++retrievalSourceSequence, epoch = state.epoch;
  retrievalOriginal.close(); notice('retrieval-error');
  try {
    const metadata = await api(`/v1/documents/${match.document_id}/original`);
    if (sequence !== retrievalSourceSequence || epoch !== state.epoch || currentView !== 'retrieval') return;
    if (metadata?.document_id !== match.document_id || metadata.revision_id !== match.revision_id || metadata.filename !== match.filename || metadata.source_sha256 !== match.source_sha256) throw new ApiError(502, '当前原文件与召回版本不一致，请重新测试。');
    const item = { document_id: metadata.document_id, active_revision_id: metadata.revision_id, filename: metadata.filename, document_type: metadata.document_type,
      media_info: { mime_type: metadata.media_type, sha256: metadata.source_sha256, size_bytes: metadata.size_bytes } };
    retrievalSourceMatch = match; await retrievalOriginal.open(item);
  } catch (error) { if (sequence === retrievalSourceSequence && epoch === state.epoch && !authenticationFailed(error)) notice('retrieval-error', messageFor(error)); }
}

function renderRetrievalOriginal() {
  const panel = $('retrieval-original'); if (!panel) return;
  panel.replaceChildren(); panel.hidden = retrievalOriginal.value.phase === 'idle';
  const value = retrievalOriginal.value;
  if (value.phase === 'error') { panel.append(element('p', messageFor(value.error), 'notice error')); return; }
  if (!value.original) { if (!panel.hidden) panel.append(element('p', '正在核对完整原文件SHA…')); return; }
  const original = value.original;
  const link = element('a', `打开原文件：${original.filename}`); link.href = original.media_type === 'application/pdf' && retrievalSourceMatch ? `${original.url}#page=${retrievalSourceMatch.page}` : original.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  const download = element('a', '下载原文件'); download.href = original.url; download.download = original.filename;
  panel.append(link, download, element('p', `版本 ${original.revision_id} · SHA-256 ${original.source_sha256}`, 'help-text'));
}

async function openRetrievalDetail(match) {
  if (!retrievalSession.value.result?.matches.includes(match) || !navigate('documents')) return;
  $('filters').reset(); $('search').value = match.filename; folderId = ''; page = 1;
  resetContext(); await loadData();
  const item = state.items.find(row => row.document_id === match.document_id);
  if (!item || !matchCurrentOriginal(match, item)) { notice('list-error', '当前列表没有相同版本的资料，请重新查找并核对；没有打开其他同名文件。'); return; }
  openDetail(match.document_id);
}

$('model-form').addEventListener('input', () => modelSession.edit());
for (const role of modelRoles) $(`model-${role}-provider`).addEventListener('change', () => {
  $(`model-${role}-key`).value = '';
  modelSession.edit();
});
$('model-library-settings').addEventListener('click', () => navigate('settings'));
$('model-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!connected || currentView !== 'settings') return;
  const epoch = state.epoch;
  try {
    const result = await modelSession.save(modelDraft());
    if (result && epoch === state.epoch && currentView === 'settings' && modelRebuildEnabled(config)) await modelRebuildSession.load();
  } catch (error) { notice('model-error', messageFor(error)); }
});
$('model-refresh').addEventListener('click', async () => {
  if (!connected || currentView !== 'settings' || !modelConfigurationEnabled(config)) return;
  const epoch = state.epoch;
  renderedModelVersion = undefined;
  try {
    const result = await loadModelSettings();
    if (result && result.active_version !== null && epoch === state.epoch && connected && currentView === 'settings') await refreshModelCapabilities();
  } catch (error) { if (!authenticationFailed(error)) notice('model-error', messageFor(error)); }
});
$('model-stop').addEventListener('click', () => modelSession.stop());
for (const role of [...modelRoles, 'projection']) $(`model-test-${role}`).addEventListener('click', async () => { try { await modelSession.test(role); } catch {} });
$('model-activate').addEventListener('click', async () => {
  try {
    const result = await modelSession.activate();
    if (result) { await refreshModelCapabilities(); if (currentView === 'settings' && modelRebuildEnabled(config)) await modelRebuildSession.load(); }
  } catch (error) {
    if (!authenticationFailed(error)) {
      notice('model-error', messageFor(error));
      if (error.errorCode === 'model_rebuild_required' && currentView === 'settings' && modelRebuildEnabled(config)) await modelRebuildSession.load();
    }
  }
});
$('model-rebuild-start').addEventListener('click', modelRebuildDialog);
$('model-rebuild-refresh').addEventListener('click', () => {
  if (connected && currentView === 'settings' && modelRebuildEnabled(config)) modelRebuildSession.load();
});
$('model-import').addEventListener('click', () => {
  if (currentView !== 'settings' || !canImportConfiguredDocuments()) return;
  if (navigate('documents')) showUpload();
});

function openRetrieval(ids = null) {
  if (!navigate('retrieval')) return;
  retrievalScope = ids === null ? null : [...ids];
  retrievalScopeNames = (ids ?? []).map(id => state.items.find(item => item.document_id === id)?.display_name ?? id);
  resetRetrieval(); $('retrieval-question').focus();
}
$('batch-retrieval').addEventListener('click', () => openRetrieval([...state.selected]));
$('answer-configure').addEventListener('click', () => navigate('settings'));
$('answer-manage').addEventListener('click', () => {
  if (!navigate('documents')) return;
  if (connected && !state.mutating && !loading && ingestionEnabled()) showUpload();
});
$('retrieval-all').addEventListener('click', () => openRetrieval(null));
$('retrieval-question').addEventListener('input', resetRetrieval);
$('retrieval-run').addEventListener('click', () => {
  if (!connected || !retrievalEnabled(config) || retrievalSession.value.phase === 'loading') return;
  resetRetrieval(); retrievalSession.run($('retrieval-question').value, retrievalScope, Number($('retrieval-count').value), $('retrieval-rerank').value !== 'false');
});
$('retrieval-stop').addEventListener('click', resetRetrieval);
for (const id of ['retrieval-count', 'retrieval-rerank']) $(id).addEventListener('change', resetRetrieval);
$('retrieval-continue').addEventListener('click', () => {
  if (!retrievalSession.value.result) return;
  const question = $('retrieval-question').value, scope = retrievalScope === null ? null : [...retrievalScope];
  openAnswers(scope);
  if (currentView !== 'answers') return;
  answerMode = 'text'; $('answer-question').value = question; answerSession.reset();
  $('answer-question').focus(); notice('answer-error', '已带入问题与完整资料范围，点击发送后才会生成回答。');
});


function renderCleanupRecords() {
  const panel = $('cleanup-records'); if (!panel) return;
  panel.hidden = !connected || !cleanupEnabled(config);
  if (panel.hidden) return;
  const value = cleanupSession.value, busy = ['reading', 'requesting'].includes(value.phase);
  $('cleanup-refresh').disabled = busy;
  $('cleanup-stop').hidden = !busy;
  $('cleanup-previous').disabled = busy || value.page <= 1;
  $('cleanup-next').disabled = busy || value.page * value.pageSize >= value.total;
  $('cleanup-page').textContent = `当前授权记录 · 第 ${value.page} 页 · 共 ${value.total} 项`;
  notice('cleanup-error', value.error ? (value.phase === 'unknown' ? '结果未知，请刷新状态；不会自动再次提交。' : messageFor(value.error)) : '');
  const list = $('cleanup-items'); list.replaceChildren();
  for (const item of value.records) {
    const row = element('li'); row.append(element('strong', item.document_id), element('p', cleanupLabel(item)));
    if (value.unknownIds.includes(item.document_id)) row.append(element('p', '最新请求结果未知，请刷新状态。'));
    const refresh = button('刷新此项状态', () => cleanupSession.load(item.document_id)); refresh.disabled = busy; row.append(refresh);
    if (item.cleanup_status === 'not_requested') { const adopt = button('请求受控清理', () => cleanupDialog([item.document_id], false, true)); adopt.disabled = busy || state.mutating; row.append(adopt); }
    const resources = element('ul');
    const names = {database_payload:'库内正文',database_file:'数据库文件',managed_backups:'应用管理备份',managed_temporaries:'应用临时材料',remote_inventory:'远端写入登记',remote_logical_rows:'远端逻辑数据',remote_write_terminal:'远端写入结束',remote_physical_storage:'远端物理存储',restore_barrier:'恢复限制'};
    const labels = {pending:'待处理',running:'处理中',completed:'已完成',not_applicable:'不适用',blocked:'受阻',failed:'失败'};
    for (const resource of item.resources) resources.append(element('li', `${names[resource.kind]}：${labels[resource.status]}`));
    row.append(resources); list.append(row);
  }
  for (const id of value.unknownIds.filter(id => !value.records.some(item => item.document_id === id))) {
    const row = element('li'); row.append(element('p', `${id}：结果未知，请刷新状态。`));
    const refresh = button('刷新此项状态', () => cleanupSession.load(id)); refresh.disabled = busy; row.append(refresh); list.append(row);
  }
  if (!value.records.length && !value.unknownIds.length) list.append(element('li', value.phase === 'idle' ? '点击刷新，读取当前有权管理的清理记录。' : busy ? '正在读取授权记录…' : '此页没有当前有权管理的清理记录。'));
}

function cleanupDialog(ids, batch = false, fromRecord = false) {
  if (!connected || !cleanupEnabled(config) || state.mutating || !ids.length || !allowDetailLeave()) return;
  if (!batch && !(fromRecord ? cleanupSession.value.records.some(item => item.document_id === ids[0] && item.cleanup_status === 'not_requested') : canRequestCleanup(state.items.find(item => item.document_id === ids[0])))) return;
  if (ids.some(id => cleanupSession.value.unknownIds.includes(id))) { notice('cleanup-error', '上次请求结果未知，请先刷新此项状态。'); return; }
  const captured = [...ids];
  showDialog(batch ? `清理 ${captured.length} 份资料` : '清理这份资料',
    `确认请求清理以下完整范围：${captured.join('、')}。受理后资料会撤下；只有各项清理验证完成后才显示已完成。处理中的资料将被拒绝，批量逐项返回结果。范围仅限应用管理的正文、文件、备份及已登记远端材料，不包括已下载副本、第三方模型留存或设备快照。此操作不可撤销。`,
    [], { kind: 'cleanup', ids: captured, batch, fromRecord, epoch: state.epoch }, '确认请求清理');
}

const imageVectorSession = new ImageVectorSession((path, options) => api(path, options), {
  onChange: () => { renderDetailImageVector(); renderVectorReindexControls(); }, onAuthenticationFailure: error => authenticationFailed(error),
});

function vectorReadOptions(item) {
  return { allowPublishedDuringReindex: config?.capabilities?.includes('text_reindex_with_vectors') === true
    && item?.status === 'parsed' && item.latest_job?.state === 'parsed'
    && item.latest_job.document_id === item.document_id && item.latest_job.revision_id === item.active_revision_id
    && typeof item.active_revision_id === 'string' && item.active_revision_id.length > 0
    && typeof item.index_publication_id === 'string' && item.index_publication_id.length > 0 };
}

function ensureDetailImageVector() {
  const item = synopsisDocument();
  const options = vectorReadOptions(item);
  if (currentView !== 'documents' || !connected || !imageVectorsEnabled(config) || !canReadImageVector(item, options)) {
    imageVectorSession.close(); return;
  }
  if (!imageVectorSession.matches(item)) imageVectorSession.open(item, options);
}

function renderDetailImageVector() {
  const panel = $('detail-image-vector'); if (!panel) return;
  panel.replaceChildren(); panel.hidden = !imageVectorsEnabled(config) || synopsisDocument()?.document_type !== 'image';
  if (panel.hidden) return;
  panel.append(element('h3', '原图向量'), element('p', '建立后可用查询图片检索这份原图。建立操作将调用服务器配置的图片 embedding 模型，可能产生调用费用。读取状态不会重新建立。', 'help-text'));
  const item = synopsisDocument();
  if (!canReadImageVector(item, vectorReadOptions(item))) { panel.append(element('p', '请先完成真实 PNG / JPEG 原图解析及索引。', 'help-text')); return; }
  const value = imageVectorSession.value, busy = ['loading', 'building'].includes(value.phase);
  panel.setAttribute('aria-busy', String(busy));
  const status = value.phase === 'loading' ? '正在读取原图向量状态…' : value.phase === 'building' ? '正在建立并核对原图向量，请稍候…'
    : value.vector?.status === 'available' ? '当前原图向量已就绪。' : value.phase === 'error' ? '操作未完成，请刷新状态后核对。'
      : value.phase === 'ready' && value.vector?.status === 'missing' ? '当前原图尚未建立此模型配置的向量。'
        : '状态尚未读取或已停止本地等待；服务器可能仍在处理，请刷新状态核对。';
  const statusNode = element('p', status, 'help-text'); statusNode.setAttribute('role', 'status'); panel.append(statusNode);
  if (config?.capabilities?.includes('text_reindex') && hasReadyVectorReceipt(item)) panel.append(element('p', config.capabilities.includes('text_reindex_with_vectors')
    ? '重建文本索引时，已有图片或音频向量会在完整核对后继续使用。'
    : '当前资料已建立图片或音频向量，暂不支持重建文本索引。请刷新资料核对状态。', 'help-text'));
  if (value.vector?.status === 'missing') {
    const build = button('建立原图向量', () => {
      const current = synopsisDocument();
      if (currentView !== 'documents' || !connected || loading || state.mutating || !imageVectorsEnabled(config) || !current?.can_edit || !canReadImageVector(current)) return;
      imageVectorSession.build(current);
    });
    build.id = 'image-vector-build'; build.disabled = !connected || loading || state.mutating || busy || !item.can_edit || !canReadImageVector(item);
    panel.append(build);
  }
  if (!item.can_edit) panel.append(element('p', '当前身份只读，建立向量需要编辑权限。', 'help-text'));
  const refresh = button('刷新原图向量状态', () => {
    const current = synopsisDocument();
    const options = vectorReadOptions(current);
    if (currentView === 'documents' && connected && imageVectorsEnabled(config) && canReadImageVector(current, options)) imageVectorSession.open(current, options);
  });
  refresh.id = 'image-vector-refresh'; refresh.disabled = !connected || busy; panel.append(refresh);
  if (value.phase === 'building') panel.append(button('停止等待', () => imageVectorSession.close()), element('p', '停止等待后，服务器可能仍在处理；再次建立前请刷新状态。', 'help-text'));
  if (value.error) panel.append(element('p', messageFor(value.error), 'notice error'));
}

const audioVectorSession = new AudioVectorSession((path, options) => api(path, options), {
  onChange: () => { renderDetailAudioVector(); renderVectorReindexControls(); }, onAuthenticationFailure: error => authenticationFailed(error),
});

function ensureDetailAudioVector() {
  const item = synopsisDocument();
  const options = vectorReadOptions(item);
  if (currentView !== 'documents' || !connected || !audioVectorsEnabled(config) || standaloneSoundDocument(item) || !canReadAudioVector(item, options)) {
    audioVectorSession.close(); return;
  }
  if (!audioVectorSession.matches(item)) audioVectorSession.open(item, options);
}

function renderDetailAudioVector() {
  const panel = $('detail-audio-vector'); if (!panel) return;
  panel.replaceChildren(); panel.hidden = !audioVectorsEnabled(config) || synopsisDocument()?.document_type !== 'audio' || standaloneSoundDocument(synopsisDocument());
  if (panel.hidden) return;
  panel.append(element('h3', '原声向量'), element('p', '建立后可用查询音频检索这份音频。建立操作将调用服务器配置的原声 embedding 模型，处理全部可引用语音分段，可能产生调用费用。读取状态不会重新建立。', 'help-text'));
  const item = synopsisDocument();
  if (!canReadAudioVector(item, vectorReadOptions(item))) { panel.append(element('p', '请先完成真实音频解析及索引。', 'help-text')); return; }
  const value = audioVectorSession.value, busy = ['loading', 'building'].includes(value.phase);
  panel.setAttribute('aria-busy', String(busy));
  const status = value.phase === 'loading' ? '正在读取原声向量状态…' : value.phase === 'building' ? '正在建立并核对原声向量，请稍候…'
    : value.vector?.status === 'available' ? '当前原声向量已就绪。' : value.phase === 'error' ? '操作未完成，请刷新状态后核对。'
      : value.phase === 'ready' && value.vector?.status === 'missing' ? '当前音频尚未建立此模型配置的向量。'
        : '状态尚未读取或已停止本地等待；服务器可能仍在处理，请刷新状态核对。';
  const statusNode = element('p', status, 'help-text'); statusNode.setAttribute('role', 'status'); panel.append(statusNode);
  if (config?.capabilities?.includes('text_reindex') && hasReadyVectorReceipt(item)) panel.append(element('p', config.capabilities.includes('text_reindex_with_vectors')
    ? '重建文本索引时，已有图片或音频向量会在完整核对后继续使用。'
    : '当前资料已建立图片或音频向量，暂不支持重建文本索引。请刷新资料核对状态。', 'help-text'));
  if (value.vector?.status === 'missing') {
    const build = button('建立原声向量', () => {
      const current = synopsisDocument();
      if (currentView !== 'documents' || !connected || loading || state.mutating || !audioVectorsEnabled(config) || !current?.can_edit || !canReadAudioVector(current)) return;
      audioVectorSession.build(current);
    });
    build.id = 'audio-vector-build'; build.disabled = !connected || loading || state.mutating || busy || !item.can_edit || !canReadAudioVector(item);
    panel.append(build);
  }
  if (!item.can_edit) panel.append(element('p', '当前身份只读，建立向量需要编辑权限。', 'help-text'));
  const refresh = button('刷新原声向量状态', () => {
    const current = synopsisDocument();
    const options = vectorReadOptions(current);
    if (currentView === 'documents' && connected && audioVectorsEnabled(config) && canReadAudioVector(current, options)) audioVectorSession.open(current, options);
  });
  refresh.id = 'audio-vector-refresh'; refresh.disabled = !connected || busy; panel.append(refresh);
  if (value.phase === 'building') panel.append(button('停止等待', () => audioVectorSession.close()), element('p', '停止等待后，服务器可能仍在处理；再次建立前请刷新状态。', 'help-text'));
  if (value.error) panel.append(element('p', messageFor(value.error), 'notice error'));
}

const soundIndexSession = new SoundIndexSession((path, options) => api(path, options), {
  onChange: () => renderDetailSoundIndex(), onAuthenticationFailure: error => authenticationFailed(error),
});

function ensureDetailSoundIndex() {
  const item = synopsisDocument();
  if (currentView !== 'documents' || !connected || !soundEnabled(config) || !canReadSoundIndex(item)) { soundIndexSession.close(); return; }
  if (!soundIndexSession.matches(item)) soundIndexSession.open(item);
}

function renderDetailSoundIndex() {
  const panel = $('detail-sound-index'); if (!panel) return;
  const item = synopsisDocument(); panel.replaceChildren(); panel.hidden = !soundEnabled(config) || item?.document_type !== 'audio';
  if (panel.hidden) return;
  panel.append(element('h4', '声音理解索引'));
  if (!canReadSoundIndex(item)) { panel.append(element('p', '请先保存真实原音频。声音理解独立于语音转录。', 'help-text')); return; }
  const value = soundIndexSession.value, busy = ['loading', 'building'].includes(value.phase);
  const help = value.phase === 'unknown' ? '服务器可能仍在处理，结果未知；请刷新状态后再决定是否建立。'
    : value.phase === 'building' ? '正在处理全部声音窗口并核验索引，请稍候…'
      : value.index?.status === 'available' ? `声音索引已就绪，共${value.index.span_count}个完整窗口。`
        : '尚未建立当前声音索引。将调用模型分析和嵌入全部声音窗口（含静音），可能产生费用。';
  panel.append(element('p', help, 'help-text'));
  if (value.phase === 'ready' && value.index?.status === 'missing') {
    const build = button('建立声音理解索引', () => {
      const current = synopsisDocument();
      if (currentView === 'documents' && connected && !loading && !state.mutating && soundEnabled(config) && current?.can_edit) soundIndexSession.build(current);
    });
    build.id = 'sound-index-build'; build.disabled = !connected || loading || state.mutating || !item.can_edit; panel.append(build);
  }
  if (!item.can_edit) panel.append(element('p', '当前身份只读，建立声音索引需要编辑权限。', 'help-text'));
  const refresh = button('刷新声音索引状态', () => {
    const current = synopsisDocument(); if (currentView === 'documents' && connected && soundEnabled(config) && canReadSoundIndex(current)) soundIndexSession.open(current);
  });
  refresh.id = 'sound-index-refresh'; refresh.disabled = !connected || busy; panel.append(refresh);
  if (value.phase === 'building') panel.append(button('停止等待', () => soundIndexSession.stop()));
  if (value.error) panel.append(element('p', messageFor(value.error), 'notice error'));
}

const videoAvIndexSession = new VideoAvIndexSession((path, options) => api(path, options), {
  onChange: () => renderDetailVideoAvIndex(), onAuthenticationFailure: error => authenticationFailed(error),
});

function ensureDetailVideoAvIndex() {
  const item = synopsisDocument();
  if (currentView !== 'documents' || !connected || !videoAvEnabled(config) || !canReadVideoAvIndex(item)) { videoAvIndexSession.close(); return; }
  if (!videoAvIndexSession.matches(item)) videoAvIndexSession.open(item);
}

function renderDetailVideoAvIndex() {
  const panel = $('detail-video-av-index'); if (!panel) return;
  const item = synopsisDocument(); panel.replaceChildren(); panel.hidden = !videoAvEnabled(config) || item?.document_type !== 'video';
  if (panel.hidden) return;
  panel.append(element('h4', '原视频音画索引'));
  if (!canReadVideoAvIndex(item)) { panel.append(element('p', '请先保存真实原视频。完整画面与原声可独立于语音转录建立索引。', 'help-text')); return; }
  const value = videoAvIndexSession.value, busy = ['loading', 'building'].includes(value.phase);
  const help = value.phase === 'unknown' ? '服务器可能仍在处理，结果未知；请刷新状态后再决定是否建立。'
    : value.phase === 'building' ? '正在处理全部连续视频和声音窗口并核验索引，请稍候…'
      : value.index?.status === 'available' ? `原视频索引已就绪，共${value.index.window_count}个窗口：${value.index.video_window_count}个含画面，${value.index.audio_window_count}个含声音。`
        : '尚未建立当前原视频索引。建立时会嵌入完整连续画面与原声窗口，可能产生费用；不会转录。';
  panel.append(element('p', help, 'help-text'));
  if (value.phase === 'ready' && value.index?.status === 'missing') {
    const build = button('建立原视频音画索引', () => {
      const current = synopsisDocument();
      if (currentView === 'documents' && connected && !loading && !state.mutating && videoAvEnabled(config) && current?.can_edit) videoAvIndexSession.build(current);
    });
    build.id = 'video-av-index-build'; build.disabled = !connected || loading || state.mutating || !item.can_edit; panel.append(build);
  }
  if (!item.can_edit) panel.append(element('p', '当前身份只读，建立原视频索引需要编辑权限。', 'help-text'));
  const refresh = button('刷新原视频索引状态', () => {
    const current = synopsisDocument(); if (currentView === 'documents' && connected && videoAvEnabled(config) && canReadVideoAvIndex(current)) videoAvIndexSession.open(current);
  });
  refresh.id = 'video-av-index-refresh'; refresh.disabled = !connected || busy; panel.append(refresh);
  if (value.phase === 'building') panel.append(button('停止等待', () => videoAvIndexSession.stop()));
  if (value.error) panel.append(element('p', messageFor(value.error), 'notice error'));
}

function currentTagSynopsis() {
  const item = synopsisDocument();
  return synopsisSession.value.phase === 'ready' && synopsisSession.matches(item) ? synopsisSession.value.synopsis : null;
}

function synchronizeTagSuggestions() {
  const item = synopsisDocument(), synopsis = currentTagSynopsis();
  if (currentView !== 'documents' || !connected || !tagSuggestionsEnabled(config) || !canReadTagSuggestions(item, synopsis)
    || !tagSuggestionSession.matches(item, synopsis)) tagSuggestionSession.close();
}

function renderDetailTagSuggestions() {
  const panel = $('detail-tag-suggestions'); if (!panel) return;
  panel.replaceChildren(); panel.hidden = !tagSuggestionsEnabled(config);
  if (panel.hidden) return;
  const item = synopsisDocument(), synopsis = currentTagSynopsis();
  panel.append(element('h3', '摘要建议标签'), element('p', '从已保存摘要的短术语和主题推荐标签。勾选后再合并保存，保留现有标签。', 'help-text'));
  if (!canReadTagSuggestions(item, synopsis)) {
    panel.append(element('p', '请先完成资料索引，并生成或刷新当前可用摘要。', 'help-text')); return;
  }
  const value = tagSuggestionSession.value, busy = state.mutating || ['loading', 'saving'].includes(value.phase);
  panel.setAttribute('aria-busy', String(busy));
  const load = button('从摘要推荐标签', () => {
    const current = synopsisDocument(), summary = currentTagSynopsis();
    if (!connected || currentView !== 'documents' || state.mutating || !tagSuggestionsEnabled(config) || !canReadTagSuggestions(current, summary)) return;
    tagSuggestionSession.load(current, summary).catch(error => notice('tag-suggestions-error', messageFor(error)));
  });
  load.id = 'tag-suggestions-load'; load.disabled = !connected || busy; panel.append(load);
  if (value.phase === 'loading') panel.append(element('p', '正在读取当前摘要的标签建议…', 'help-text'));
  if (value.phase === 'saving') panel.append(element('p', '正在合并保存已选标签…', 'help-text'));
  if (value.suggestions && tagSuggestionSession.matches(item, synopsis)) {
    const suggestions = value.suggestions, candidates = suggestions.candidates.filter(candidate => !suggestions.existing_tags.includes(candidate.tag));
    if (!candidates.length) panel.append(element('p', '当前摘要没有适合新增的短标签；可继续手工整理。', 'help-text'));
    const choices = element('div', undefined, 'tag-list');
    for (const candidate of candidates) {
      const check = element('input'); check.type = 'checkbox'; check.id = `tag-suggestion-${candidate.ordinal}`;
      check.checked = value.selected.includes(candidate.ordinal); check.disabled = busy || !item.can_edit || !suggestions.can_apply;
      check.addEventListener('change', () => tagSuggestionSession.select(candidate.ordinal, check.checked));
      const choice = element('label', undefined, 'tag-suggestion-choice'); choice.htmlFor = check.id;
      choice.append(check, element('span', candidate.tag)); choices.append(choice);
    }
    panel.append(choices);
    if (!item.can_edit || !suggestions.can_apply) panel.append(element('p', '当前身份只读，保存标签需要编辑权限。', 'help-text'));
    const apply = button('合并保存已选标签', () => {
      const current = synopsisDocument(), summary = currentTagSynopsis();
      if (!connected || currentView !== 'documents' || state.mutating || !tagSuggestionsEnabled(config) || !current?.can_edit
        || !tagSuggestionSession.matches(current, summary) || !tagSuggestionSession.value.selected.length) return;
      if (detailDraftChanged()) { notice('tag-suggestions-error', '整理草稿尚未保存，请先保存草稿，或关闭详情时放弃修改，再合并标签。'); return; }
      mutate(() => tagSuggestionSession.apply(current, summary), result => {
        if (!result) return;
        feedback('建议标签已合并保存', [{ document_id: result.document_id, ok: true, detail: '所选标签已追加，现有标签保留。' }]);
        return loadData();
      }, 'tag-suggestions-error');
    });
    apply.id = 'tag-suggestions-apply'; apply.disabled = !connected || busy || !item.can_edit || !suggestions.can_apply || !value.selected.length;
    panel.append(apply);
  }
  const error = element('p', undefined, 'notice error'); error.id = 'tag-suggestions-error'; error.hidden = true; panel.append(error);
  if (value.error) notice('tag-suggestions-error', `${messageFor(value.error)} 请刷新摘要和标签建议后核对；保存操作不会自动重试。`);
}

function synopsisDocument() { return state.items.find(item => item.document_id === state.detail?.document_id) ?? null; }
function standaloneSoundDocument(item) { return item?.document_type === 'audio' && item.synthetic_fixture === false && item.registered_revision_id != null && item.latest_job == null; }
function standaloneVideoAvDocument(item) { return item?.document_type === 'video' && item.synthetic_fixture === false && item.registered_revision_id != null && item.latest_job == null; }
function stopSynopsisMedia() {
  for (const player of $('detail-synopsis')?.querySelectorAll('audio, video') ?? []) { player.pause(); player.removeAttribute('src'); player.load(); }
}
function ensureDetailSynopsis() {
  const item = synopsisDocument();
  if (currentView !== 'documents' || !connected || !item || !synopsisEnabled(config) || standaloneSoundDocument(item) || standaloneVideoAvDocument(item) || item.synthetic_fixture || !item.active_revision_id || !item.index_publication_id) {
    if (synopsisSession.value.phase !== 'idle') synopsisSession.close();
    return;
  }
  if (!synopsisSession.matches(item)) synopsisSession.open(item);
}

const synopsisReasons = { model_refused: '模型未给出可验证摘要。', unsupported_claims: '摘要条目缺少原始证据支持。', incomplete_evidence: '摘要未完整覆盖必要内容。',
  input_capacity_exceeded: '文件超过当前摘要处理容量。', worker_interrupted: '处理曾中断，可显式重新生成。', authorization_changed: '资料权限已变化。', source_changed: '文件或发布版本已变化。',
  configuration_changed: '摘要配置已变化。', processing_timeout: '摘要处理超时。', model_failure: '模型处理未完成。', processing_interrupted: '处理已中断。' };

function renderDetailSynopsis() {
  const panel = $('detail-synopsis'); if (!panel) return;
  stopSynopsisMedia(); panel.replaceChildren(element('h3', '文件摘要')); panel.setAttribute('aria-busy', 'false');
  const item = synopsisDocument(); if (!item) return;
  if (!synopsisEnabled(config)) { panel.append(element('p', '当前服务未启用文件摘要与摘要来源。', 'help-text')); return; }
  if (standaloneSoundDocument(item) || standaloneVideoAvDocument(item)) { panel.append(element('p', standaloneVideoAvDocument(item) ? '当前原视频资料可用音画问答；此资料尚未提供文件摘要。' : '当前声音资料可用声音理解问答；此资料尚未提供文件摘要。', 'help-text')); return; }
  if (item.synthetic_fixture || !item.active_revision_id || !item.index_publication_id) { panel.append(element('p', '完成真实资料索引后，可生成文件摘要。摘要不影响已有索引。', 'help-text')); return; }
  const value = synopsisSession.value, busy = ['loading', 'creating', 'processing'].includes(value.phase);
  panel.setAttribute('aria-busy', String(busy));
  panel.append(element('p', '摘要帮助浏览文件；核对事实请打开各条依据。生成使用服务器配置的模型，读取已保存摘要不会重新生成。', 'help-text'));
  const actions = element('div', undefined, 'synopsis-actions');
  const create = button(value.task?.state === 'unavailable' || value.task?.state === 'cancelled' ? '重新生成摘要' : '生成摘要', () => {
    const current = synopsisDocument();
    if (!connected || !synopsisEnabled(config) || currentView !== 'documents' || !canGenerateSynopsis(current) || !synopsisSession.matches(current) || busy) return;
    showDialog('生成文件摘要', '将把本资料已发布的完整证据交给服务器配置的摘要模型，可能产生调用费用。摘要会单独保存；失败不影响索引和问答。已有相同版本的任务会继续复用。', [],
      { kind: 'synopsis-create', documentId: current.document_id, publicationId: current.index_publication_id }, '确认生成摘要');
  });
  create.id = 'synopsis-create'; create.disabled = !connected || !canGenerateSynopsis(item) || busy || value.phase === 'ready';
  const refresh = button('刷新摘要 / 任务', () => synopsisSession.refresh()); refresh.id = 'synopsis-refresh'; refresh.disabled = !connected || ['loading', 'creating'].includes(value.phase);
  actions.append(create, refresh); panel.append(actions);
  if (!item.can_edit) panel.append(element('p', '当前身份可读取摘要，生成需要编辑权限。', 'help-text'));
  const stateText = value.phase === 'creating' ? '正在创建摘要任务…' : value.phase === 'loading' ? '正在读取摘要或任务…'
    : value.phase === 'processing' ? value.task?.state === 'queued' ? '摘要任务等待处理。' : '正在生成并核对摘要…'
      : value.phase === 'ready' ? '已读取当前发布版本的摘要。' : value.phase === 'error' ? '读取或创建未完成，自动刷新已暂停，请手动核对。'
        : value.task ? `${value.task.state === 'cancelled' ? '摘要任务已取消。' : '摘要暂不可用。'} ${synopsisReasons[value.task.error_code] ?? '请核对后再试。'} 原因代码：${value.task.error_code}`
          : '当前没有可读取的摘要，可生成或刷新后核对。';
  const status = element('p', stateText, 'help-text'); status.setAttribute('role', 'status'); panel.append(status);
  if (value.error) panel.append(element('p', messageFor(value.error), 'notice error'));
  if (value.task) panel.append(element('p', `摘要任务：${value.task.task_id}`, 'help-text'));
  if (!value.synopsis) return;
  const titles = { overview: '概览', topic: '主题', term: '术语', timeline: '时间线' };
  for (const [section, title] of Object.entries(titles)) {
    const entries = value.synopsis.entries.filter(entry => entry.section === section); if (!entries.length) continue;
    const group = element('section', undefined, 'synopsis-group'); group.append(element('h4', title));
    const list = element('ol');
    for (const entry of entries) {
      const row = element('li'); row.value = entry.ordinal;
      row.append(element('p', entry.text, 'evidence-text'));
      if (entry.interval) row.append(element('p', `${timeLabel(entry.interval.start_us / 1000)}–${timeLabel(entry.interval.end_us / 1000)} · 来源覆盖区间`, 'help-text'));
      const refs = element('div', undefined, 'synopsis-actions');
      for (const reference of entry.evidence) {
        const read = button(`查看依据 ${reference.ordinal}`, async () => {
          await synopsisSession.readSource(entry.ordinal, reference.ordinal);
          if (currentView === 'documents') $('synopsis-source')?.focus();
        });
        read.disabled = !connected || value.sourcePhase === 'loading'; refs.append(read);
      }
      row.append(refs); list.append(row);
    }
    group.append(list); panel.append(group);
  }
  panel.append(element('p', `摘要版本 ${value.synopsis.synopsis_id} · 发布 ${value.synopsis.publication_id}`, 'help-text'));
  if (value.sourcePhase !== 'idle') {
    const sourcePanel = element('section', undefined, 'synopsis-source'); sourcePanel.id = 'synopsis-source'; sourcePanel.setAttribute('tabindex', '-1'); sourcePanel.setAttribute('aria-label', '摘要原始依据');
    sourcePanel.append(element('h4', '摘要原始依据'));
    if (value.sourcePhase === 'loading') sourcePanel.append(element('p', '正在回读并核对原始依据…', 'help-text'));
    else if (value.sourceError) sourcePanel.append(element('p', messageFor(value.sourceError), 'notice error'));
    else if (value.source) renderSynopsisSource(sourcePanel, value.source);
    sourcePanel.append(button('关闭摘要来源', () => synopsisSession.closeSource())); panel.append(sourcePanel);
  }
}

function renderSynopsisPicture(panel, url, locator, filename) {
  const canvas = element('div', undefined, 'source-image-canvas');
  const image = element('img'); image.src = url; image.alt = `原始图像：${filename}`; image.width = locator.width; image.height = locator.height; canvas.append(image);
  if (locator.regions?.length) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${locator.width} ${locator.height}`); svg.setAttribute('aria-hidden', 'true');
    for (const region of locator.regions) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      for (const [key, value] of Object.entries({ x: region.left, y: region.top, width: region.right - region.left, height: region.bottom - region.top })) rect.setAttribute(key, String(value));
      svg.append(rect);
    }
    canvas.append(svg); panel.append(element('p', '高亮为服务器OCR词区域，请结合原图核对。', 'help-text'));
  }
  panel.append(canvas);
}

function renderSynopsisSource(panel, source) {
  const locator = source.locator;
  panel.append(element('p', source.filename));
  if (source.text) panel.append(element('pre', source.text, 'evidence-text synopsis-quote'));
  const links = element('div', undefined, 'original-actions');
  const open = element('a', '打开原文件'); open.href = source.originalUrl; open.target = '_blank'; open.rel = 'noopener noreferrer';
  const download = element('a', '下载原文件'); download.href = source.originalUrl; download.download = source.filename;
  links.append(open, download); panel.append(links);
  if (locator.type === 'page') panel.append(element('p', `第 ${locator.page} 页 · 字符区间 ${locator.start_code_point}–${locator.end_code_point}（Unicode码点）`, 'help-text'));
  if (source.media_type === 'application/pdf') {
    const pdf = element('object', undefined, 'original-pdf'); pdf.data = `${source.originalUrl}#page=${locator.page}`; pdf.type = 'application/pdf'; pdf.setAttribute('aria-label', `PDF原始依据：${source.filename}`);
    pdf.append(element('p', '浏览器无法显示时，可打开或下载原文件。')); panel.append(pdf);
  } else if (source.kind.startsWith('image')) renderSynopsisPicture(panel, source.originalUrl, locator, source.filename);
  if (source.kind.startsWith('audio_') || source.kind.startsWith('video_')) {
    const player = element(source.kind.startsWith('audio_') ? 'audio' : 'video'); player.controls = true; player.preload = 'metadata'; player.src = source.originalUrl;
    player.setAttribute('aria-label', `原始媒体依据：${source.filename}`);
    let excerpt = false;
    const seek = () => { player.currentTime = locator.start_us / 1_000_000; };
    player.addEventListener('loadedmetadata', seek);
    const status = element('p', `来源时间 ${timeLabel(locator.start_us / 1000)}–${timeLabel(locator.end_us / 1000)}。${source.time_precision === 'server_chunk' ? '转录按服务器片段定位，不代表逐词对齐。' : source.time_precision === 'subtitle_cue' ? '定位到内嵌字幕cue。' : '定位到服务器提取原帧的显示区间。'}`, 'help-text');
    player.addEventListener('timeupdate', () => { if (excerpt && player.currentTime >= locator.end_us / 1_000_000) { player.pause(); excerpt = false; } });
    player.addEventListener('error', () => { status.textContent = '浏览器未能播放此格式，请下载原文件后核对来源时间。'; });
    const play = button('播放此来源片段', async () => { try { seek(); excerpt = true; await player.play(); } catch { excerpt = false; status.textContent = '当前浏览器未能播放，请再次尝试或下载原文件。'; } });
    panel.append(player, status, play);
    if (source.frameUrl) renderSynopsisPicture(panel, source.frameUrl, locator, source.filename);
    if (source.kind === 'video_subtitle') panel.append(element('p', `字幕轨 ${locator.track_id} · ${locator.language ?? '未标注语言'} · ${locator.codec} · cue ${locator.cue_ordinal}`, 'help-text'));
  }
  panel.append(element('p', `依据 ${source.evidence_id} · SHA-256 ${source.sha256}`, 'help-text'));
}

function stopDetailMedia() {
  const player = $('detail-original-media');
  if (player) { player.pause(); player.removeAttribute('src'); player.load(); }
}

function ensureDetailOriginal() {
  const item = state.detail;
  if (currentView !== 'documents' || !connected || !item || !config?.capabilities?.includes('document_originals')
    || item.synthetic_fixture || !item.media_info?.size_bytes) return;
  if (!originalSession.matches(item)) originalSession.open(item);
}

function renderDetailOriginal() {
  const preview = $('detail-original');
  if (!preview) return;
  stopDetailMedia(); preview.replaceChildren(element('h3', '原文件预览'));
  const item = state.detail;
  if (!item) return;
  if (item.synthetic_fixture || !item.media_info?.size_bytes) {
    preview.append(element('p', '这条记录没有保存原文件内容，无法预览或下载。')); return;
  }
  if (!config?.capabilities?.includes('document_originals')) {
    preview.append(element('p', '当前服务尚未启用资料原文件读取。')); return;
  }
  const value = originalSession.value;
  if (value.phase === 'error') {
    preview.append(element('p', messageFor(value.error), 'notice error'), button('重新读取原文件', () => originalSession.open(state.detail))); return;
  }
  if (value.phase !== 'ready' || !originalSession.matches(item)) {
    preview.append(element('p', '正在读取并核对原文件…', 'help-text')); return;
  }
  const original = value.original;
  const actions = element('div', undefined, 'original-actions');
  const open = element('a', '打开原文件'); open.href = original.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
  const download = element('a', '下载原文件'); download.href = original.url; download.download = original.filename;
  actions.append(open, download); preview.append(actions);
  if (original.media_type === 'application/pdf') {
    const pdf = element('object', undefined, 'original-pdf'); pdf.data = original.url; pdf.type = 'application/pdf';
    pdf.setAttribute('aria-label', `原始 PDF：${original.filename}`);
    pdf.append(element('p', '浏览器无法在此显示 PDF 时，请使用“打开原文件”或“下载原文件”。'));
    preview.append(pdf);
  } else if (original.document_type === 'document') {
    preview.append(original.textError ? element('p', original.textError, 'help-text') : element('pre', original.text, 'original-text'));
  } else if (original.document_type === 'image') {
    const image = element('img', undefined, 'original-image'); image.src = original.url; image.alt = `原图：${original.filename}`; preview.append(image);
  } else {
    const player = element(original.document_type); player.id = 'detail-original-media'; player.controls = true; player.preload = 'metadata'; player.src = original.url;
    const hint = element('p', '浏览器无法播放此格式，请打开或下载原文件。', 'help-text'); hint.hidden = true;
    player.addEventListener('error', () => { if ($('detail-original-media') === player) hint.hidden = false; });
    preview.append(player, hint, element('p', '播放服务器保存的完整原文件。', 'help-text'));
  }
  preview.append(element('p', `原文件版本 ${original.revision_id} · SHA-256 ${original.source_sha256}`, 'help-text'));
}

function detailDraftChanged() {
  if (!detailBaseline || !$('detail-name')) return false;
  return ['detail-name', 'detail-folder', 'detail-tags'].some((id, index) => $(id).value !== detailBaseline[index]);
}

function allowDetailLeave() {
  return !detailDraftChanged() || globalThis.confirm('资料修改尚未保存。放弃修改并继续？');
}

function closeDetailPanel({ discard = true } = {}) {
  if (state.mutating || (discard && !allowDetailLeave())) return false;
  if (!state.closeDetail()) return false;
  detailBaseline = null;
  renderDetails();
  renderRows();
  $('documents-heading').focus();
  return true;
}

function showView(view, { focus = true } = {}) {
  const names = { documents: '资料库', tasks: '处理任务', retrieval: '召回测试', answers: '知识问答', settings: '设置' };
  const destination = Object.hasOwn(names, view) ? view : 'answers';
  const enteringAnswers = destination === 'answers' && currentView !== 'answers';
  if (['settings', 'answers', 'retrieval'].includes(destination) && (state.mutating || !allowDetailLeave())) {
    if (globalThis.history) globalThis.history.replaceState(null, '', `#/${currentView}`);
    return false;
  }
  if (['settings', 'answers', 'retrieval'].includes(destination) && state.detail) {
    state.closeDetail(); detailBaseline = null; renderDetails(); renderRows();
  }
  if (destination !== 'documents' && $('details').open) $('details').close();
  if (destination !== 'documents') { stopDetailMedia(); originalSession.close(); stopSynopsisMedia(); synopsisSession.close(); tagSuggestionSession.close(); imageVectorSession.close(); audioVectorSession.close(); soundIndexSession.close(); videoAvIndexSession.close(); replacementSession.close(); }
  if (currentView === 'answers' && destination !== 'answers') {
    answerCapabilityRefresh = null;
    voiceQuestionSession.reset();
    if (queryAttachments.length) clearQueryAttachments();
    else answerSession.closeSource();
  }
  if (currentView === 'settings' && destination !== 'settings') { modelRebuildSession.pause(); modelSession.close(); renderedModelVersion = undefined; }
  if (currentView === 'retrieval' && destination !== 'retrieval') resetRetrieval();
  currentView = destination;
  document.body.classList.toggle('chat-page', currentView === 'answers');
  if (currentView === 'settings' && connected && modelConfigurationEnabled(config) && modelSession.value.phase === 'idle') loadModelSettings();
  for (const name of Object.keys(names)) {
    $(`view-${name}`).hidden = name !== currentView;
    $(`nav-${name}`).setAttribute('aria-current', name === currentView ? 'page' : 'false');
  }
  const managing = ['documents', 'tasks', 'retrieval'].includes(currentView);
  $('knowledge-nav').hidden = !managing;
  document.body.classList.toggle('management-page', managing);
  if (managing) $('nav-documents').setAttribute('aria-current', 'page');
  for (const link of document.querySelectorAll('[data-knowledge-view]')) link.setAttribute('aria-current', link.dataset.knowledgeView === currentView ? 'page' : 'false');
  if (currentView === 'retrieval') renderRetrieval();
  if (currentView === 'answers') renderAnswers();
  if (enteringAnswers) { answerEntry++; refreshAnswerCapabilities(); }
  document.title = `${names[currentView]} · 证据知识库`;
  $('skip-content').setAttribute('href', `#${currentView === 'documents' ? 'documents' : currentView}-heading`);
  if (currentView === 'tasks') renderTaskList();
  if (currentView === 'documents' && state.detail && $('detail-form')) {
    if (!$('details').open) $('details').showModal();
    if (focus) $('detail-heading').focus();
    ensureDetailOriginal();
    ensureDetailSynopsis(); ensureDetailImageVector(); renderDetailImageVector(); ensureDetailAudioVector(); renderDetailAudioVector(); ensureDetailSoundIndex(); renderDetailSoundIndex(); ensureDetailVideoAvIndex(); renderDetailVideoAvIndex(); ensureDetailReplacement(); renderDetailReplacement();
  } else if (focus) $(`${currentView}-heading`).focus();
  return true;
}

function navigate(view) {
  // Task transitions keep the detail draft available when returning to the library.
  if (!showView(view)) return false;
  if (globalThis.location && globalThis.location.hash !== `#/${currentView}`) globalThis.location.hash = `#/${currentView}`;
  return true;
}

function renderTaskList() {
  const list = $('task-list');
  const focusedTask = document.activeElement?.dataset?.taskKey;
  list.replaceChildren();
  let count = 0;
  for (const item of state.items) {
    for (const kind of ['ingestion', 'indexing']) {
      if (taskFilter !== 'all' && taskFilter !== kind) continue;
      if (!(kind === 'indexing' ? indexingEnabled() : ingestionEnabled())) continue;
      if (!(kind === 'indexing' ? item.latest_index_job : item.latest_job)) continue;
      const task = kind === 'indexing' ? state.indexTaskForDocument(item.document_id) : state.taskForDocument(item.document_id);
      if (!task) continue;
      count += 1;
      const entry = button('', () => openTask(item, kind), 'task-list-item');
      entry.dataset.taskKey = `${kind}:${task.task_id}`;
      entry.disabled = !connected || state.mutating || loading;
      entry.setAttribute('aria-pressed', String(currentTask()?.task_id === task.task_id && taskKind === kind));
      const title = element('span', item.display_name, 'task-document-name');
      const label = kind === 'indexing' ? indexTaskLabel(task.state) : taskLabel(task.state, item);
      entry.append(title, element('span', `${kind === 'indexing' ? '索引' : '解析'} · ${label} · 第 ${task.attempt} 次`, 'muted'));
      list.append(entry);
      if (focusedTask === entry.dataset.taskKey && !entry.disabled) entry.focus();
    }
  }
  if (!count) {
    const empty = element('div', undefined, 'empty-state');
    empty.append(element('strong', loading ? '正在读取任务…' : '当前范围没有任务'), element('p', '可返回资料库选择其他资料页，或上传一份文本资料。'));
    list.append(empty);
  }
  $('task-list-scope').textContent = `资料库当前筛选 · 第 ${totalPages ? page : 0} 页 · ${count} 个${taskFilter === 'all' ? '' : taskFilter === 'ingestion' ? '解析' : '索引'}任务；不包含其他页或全部历史。`;
  $('task-placeholder').hidden = !!currentTask();
  $('tasks-refresh').disabled = !connected || state.mutating || loading;
}

function initNavigation() {
  const fromHash = () => {
    const hash = globalThis.location.hash;
    if (hash.endsWith('-heading')) return;
    const requested = hash.replace(/^#\//u, '');
    const view = ['documents', 'tasks', 'retrieval', 'answers', 'settings'].includes(requested) ? requested : 'answers';
    if (hash !== `#/${view}`) globalThis.history.replaceState(null, '', `#/${view}`);
    showView(view);
  };
  globalThis.addEventListener('hashchange', fromHash);
  globalThis.addEventListener('beforeunload', event => {
    if (detailDraftChanged()) { event.preventDefault(); event.returnValue = ''; }
  });
  fromHash();
}

function ingestionEnabled() { return config?.capabilities?.includes('ingestions') && (['text_upload', 'audio_upload', 'video_upload', 'sound_upload', 'video_av_upload'].some(capability => config.capabilities.includes(capability)) || !!imageUploadMode(config)); }
function anyAnswersEnabled() { return ['knowledge', 'text', 'visual', ...mediaModes].some(mode => answersEnabled(config, mode)); }
function scopeSelectionEnabled() { return connected; }
function evidenceModeEnabled(mode) { return answersEnabled(config, mode) || mode === 'text' && retrievalEnabled(config); }
function indexingEnabled() { return config?.capabilities?.includes('text_index') && config.capabilities.includes('indexings'); }
function hasReadyVectorReceipt(item) {
  return [imageVectorSession, audioVectorSession].some(session => session.matches(item)
    && session.value.phase === 'ready' && session.value.vector?.status === 'available');
}
function renderVectorReindexControls() {
  if (!connected || currentView !== 'documents' || !config?.capabilities?.includes('text_reindex')) return;
  renderRows(); renderDetailTaskControls(synopsisDocument());
}
function canReindex(item) {
  return indexingEnabled() && config.capabilities.includes('text_reindex') && item?.can_reindex === true
    && item.status === 'parsed' && !item.synthetic_fixture && item.latest_job?.state === 'parsed'
    && typeof item.active_revision_id === 'string' && item.active_revision_id === item.latest_job.revision_id
    && typeof item.index_publication_id === 'string' && item.index_publication_id.length > 0
    && !taskPending(item.latest_index_job) && !reindexNeedsRefresh.has(item.document_id)
    && (!hasReadyVectorReceipt(item) || config.capabilities.includes('text_reindex_with_vectors'));
}
function batchReindexEnabled() { return indexingEnabled() && config.capabilities.includes('text_reindex') && config.capabilities.includes('batch_text_reindex'); }
function reindexFingerprint(item) {
  const task = value => value ? [value.task_id, value.revision_id, value.state, value.attempt] : null;
  return JSON.stringify([item.active_revision_id, item.index_publication_id, item.status, item.index_status,
    item.media_info?.sha256, task(item.latest_job), task(item.latest_index_job)]);
}
function batchReindexUnavailable(item) {
  if (!item) return '当前页已无此资料，请刷新核对。';
  if (reindexNeedsRefresh.has(item.document_id)) return '上次提交结果待核对，请先刷新资料和索引任务。';
  if (taskPending(item.latest_index_job)) return '已有索引任务正在处理。';
  if (!item.active_revision_id || !item.index_publication_id) return '尚无已发布的文本索引。';
  return '当前资料、权限或处理状态不满足文本重建条件，请刷新后在详情核对。';
}
function currentTask() { return taskKind === 'indexing' ? state.indexTask : state.task; }
function taskEnabled() { return taskKind === 'indexing' ? indexingEnabled() : ingestionEnabled(); }
function checkedCurrentTask(value) { return taskKind === 'indexing' ? checkedIndexTask(value) : checkedTask(value); }
function commitCurrentTask(ticket, value) { return taskKind === 'indexing' ? state.commitIndexTask(ticket, value) : state.commitTask(ticket, value); }
function taskPath(id) { return `/v1/${taskKind === 'indexing' ? 'indexings' : 'ingestions'}/${encodeURIComponent(id)}`; }

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, handler, className) {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}

function notice(id, message = '') {
  showNotice($, id, message);
}

function messageFor(error) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return '无法连接 Java 服务，请确认服务已启动后重试。';
  return '服务返回的数据暂时不可用，请刷新后重试。';
}

function openAnswers(ids = null) {
  if (!connected || state.mutating || !navigate('answers')) return;
  answerMode = 'knowledge';
  answerScope = ids === null ? null : [...ids];
  answerScopeNames = (ids ?? []).map(id => state.items.find(item => item.document_id === id)?.display_name ?? id);
  voiceQuestionSession.reset();
  clearQueryAttachments();
  $('answer-question').focus();
}

function renderAnswerControls() {
  const enabled = connected && answersEnabled(config, answerMode);
  const anyEnabled = connected && scopeSelectionEnabled();
  const answerWaiting = answerSession.value.phase === 'loading';
  const waiting = answerWaiting || voiceQuestionSession.value.phase === 'loading';
  $('batch-ask').disabled = !anyEnabled || state.mutating || loading || state.selected.size === 0;
  $('batch-ask').hidden = !scopeSelectionEnabled();
  $('batch-ask').textContent = '在选中资料中提问';
  $('answer-mode').value = answerMode;
  $('answer-mode').disabled = !connected;
  $('answer-mode-text').disabled = !answersEnabled(config) && !retrievalEnabled(config);
  $('answer-mode-visual').disabled = !answersEnabled(config, 'visual');
  for (const mode of mediaModes) $(`answer-mode-${mode}`).disabled = !answersEnabled(config, mode);
  $('answer-question').disabled = waiting;
  $('answer-submit').disabled = !enabled || waiting || !!answerCapabilityRefresh || !!answerCapabilityError || !$('answer-question').value.trim() || (queryAttachments.length > 0 && (!currentQueryAttachmentsEnabled() || videoAvModes.includes(answerMode) && queryAttachments.some(item => item.kind !== 'video')));
  $('answer-cancel').hidden = !answerWaiting;
  $('answer-all').hidden = answerScope === null;
  $('answer-all').disabled = !anyEnabled || state.mutating;
  $('answer-all').textContent = '改问全库';
  $('answer-form').setAttribute('aria-busy', String(waiting));
  $('answer-availability').textContent = !connected ? '可以先写下问题。请到设置确认服务连接，再导入资料并建立索引。'
    : answerCapabilityRefresh ? '正在刷新服务能力，问题与完整所选范围会保留，不会自动提问。'
    : answerCapabilityError ? '服务能力尚未完成刷新，请到设置读取当前配置后返回；问题与范围已保留。'
    : answerMode === 'knowledge' ? !enabled ? '综合问答尚未启用。可先写问题并选择资料；请在设置保存并应用模型、确保服务器 Milvus 已配置，再导入资料并建立索引。返回后刷新能力，由你点击发送。'
      : '从当前范围的文档和视频文字证据综合回答，引用可打开原文页码或视频片段。请核对产品型号与版本；视频语音、字幕与画面文字不等同于完整画面理解。'
    : !answersEnabled(config, answerMode)
    ? answerMode === 'text' && retrievalEnabled(config)
      ? '当前可测试文字/OCR召回，生成问答尚未启用。请前往知识库管理中的“召回测试”。'
      : '当前服务未启用此模式的问答与来源功能，请选择可用模式。'
    : !connected ? '请先在设置中确认访问身份。' : answerMode === 'visual'
      ? '使用已发布原图核对画面事实，引用定位到整张原图。请选择对应图片；文字识别请用文字证据模式。'
      : videoAvModes.includes(answerMode) ? '检索完整连续画面或原声，在同一窗口核验完整问题。关系问题需要音画共同支持；来源按服务器窗口回放。'
      : answerMode === 'sound' ? '检索原音频波形，再由实际库内声音独立核验完整问题。来源为声音模型判断和服务器窗口，不是语音转录。'
        : mediaModes.includes(answerMode) ? '检索所选类型的已索引证据，引用可定位原素材时间。音频为机器转录；视频按所选画面、转录、画面文字或内嵌字幕核验，无相应证据时拒答。'
        : '检索已发布文字证据（含OCR转录）；图片中的文字使用此模式。解析完成不等于索引发布。';
  $('chat-capability-status').hidden = enabled && !answerCapabilityRefresh && !answerCapabilityError;
  $('chat-capability-status').textContent = $('answer-availability').textContent;
  for (const node of document.querySelectorAll('[data-answer-document]')) node.disabled = !anyEnabled || state.mutating || loading;
  const vectorHelp = $('answer-image-vector-help');
  vectorHelp.hidden = answerMode !== 'visual' || !imageVectorsEnabled(config);
  vectorHelp.textContent = '使用查询图片检索时，请先在资料详情中为当前范围的全部图片建立原图向量。结果仍引用资料库中的原图。';
  const audioVectorHelp = $('answer-audio-vector-help');
  audioVectorHelp.hidden = answerMode !== 'audio' || !audioVectorsEnabled(config);
  audioVectorHelp.textContent = '添加查询音频检索时，请先在资料详情中为当前范围的全部音频建立原声向量。结果仍引用资料库的转录及原音频时间段。';
  $('answer-sound-help').hidden = answerMode !== 'sound';
  $('answer-sound-help').textContent = '请为当前范围的全部音频显式建立声音理解索引。参考音频仅辅助检索，事实和时间来源均来自资料库。';
  $('answer-video-av-help').hidden = !videoAvModes.includes(answerMode);
  $('answer-video-av-help').textContent = '请先为当前范围的全部视频建立原视频音画索引。输入完整文字问题，启用参考视频时仅辅助查找库内证据；模型可能漏掉短暂动作或声事件，请打开原视频核对。';
  renderQueryAttachments(enabled, waiting);
  renderVoiceQuestion(enabled, answerWaiting); renderRetrieval();
  const inputStatus = [queryAttachments.length ? `${queryAttachments.length} 个参考附件` : '', voiceQuestionSession.value.filename ? '已选择语音，展开更多核对转录' : ''].filter(Boolean);
  $('chat-input-status').textContent = inputStatus.join(' · ');
  $('chat-input-status').hidden = !inputStatus.length;
  $('answer-new').disabled = waiting;
  $('chat-options').classList.toggle('has-selection', !!inputStatus.length);
}

function renderScopeSummary() {
  $('scope-title').textContent = anyAnswersEnabled() ? '当前可用：资料整理 + 有据问答与来源' : retrievalEnabled(config) ? '当前可用：资料整理 + 召回测试' : indexingEnabled() ? '当前可用：资料整理 + 索引' : ingestionEnabled() ? '当前可用：资料整理 + 解析' : '当前可用：资料整理';
  $('scope-description').textContent = anyAnswersEnabled() ? '可以问全库或完整所选范围。按文字、图片、音频或视频选择证据模式；点击引用回读服务器校验的来源，音视频可按引用时间播放。' : retrievalEnabled(config) ? '可测试全部可访问的已发布资料，或完整所选范围的文字/OCR召回；不会生成回答。' : indexingEnabled() ? '已解析的授权资料可显式建立索引。完整验证后由服务器发布；服务尚未启用问答与来源，合成资料不参与索引。' : ingestionEnabled() ? '按服务器启用的类型上传并解析。已解析不等于已索引；synthetic_fixture合成资料单独标识。' : '服务尚未启用上传。合成资料会单独标识，不代表已完成解析、索引或问答。';
}

function renderVoiceQuestion(enabled, answerWaiting) {
  const value = voiceQuestionSession.value, available = connected && voiceQuestionsEnabled(config);
  const waiting = value.phase === 'loading', ready = value.phase === 'ready';
  $('answer-voice-file').disabled = !enabled || !available || answerWaiting || waiting;
  $('answer-voice-transcribe').disabled = !enabled || !available || answerWaiting || waiting || !value.filename;
  $('answer-voice-cancel').hidden = value.phase === 'idle';
  $('answer-voice-cancel').textContent = waiting ? '停止转录等待' : '清除语音';
  $('answer-voice-preview').hidden = !ready;
  const preview = $('answer-voice-text');
  if (preview.value !== value.transcript) preview.value = value.transcript;
  preview.disabled = !enabled || !available || answerWaiting;
  let valid = false;
  if (ready) { try { answerRequest(value.transcript); valid = true; } catch {} }
  $('answer-voice-use').disabled = !enabled || !available || answerWaiting || !ready || !valid;
  $('answer-voice-help').textContent = !available ? '当前服务未启用语音输入，可继续填写文字问题。'
    : '选择一个最多20MiB的音频文件，转成文字后核对并确认作为问题。转录使用服务器配置的模型，可能产生调用费用；不会导入资料库或自动提问。';
  $('answer-voice-status').textContent = waiting ? `正在转录 ${value.filename}，请稍候…`
    : ready ? `已识别 ${value.filename}，请核对后用作问题。`
      : value.filename ? `${value.filename} · ${(value.bytes / 1024 / 1024).toFixed(2)} MiB` : '未选择语音';
  notice('answer-voice-error', value.error ? messageFor(value.error) : '');
}

function clearQueryAttachments() {
  queryAttachments = []; queryAttachmentError = '';
  $('answer-attachment-files').value = '';
  answerSession.reset(); resetRetrieval();
}

function currentQueryAttachmentsEnabled() {
  if (answerMode === 'knowledge') return false;
  return videoAvModes.includes(answerMode) ? videoAvQueryAttachmentsEnabled(config)
    : answerMode === 'sound' ? soundEnabled(config) : queryAttachmentsEnabled(config);
}

function renderQueryAttachments(enabled, waiting) {
  const available = currentQueryAttachmentsEnabled();
  const kind = $('answer-attachment-kind');
  if (!['image', 'audio', 'video'].includes(kind.value)) kind.value = 'image';
  if (answerMode === 'sound') kind.value = 'audio';
  if (videoAvModes.includes(answerMode)) kind.value = 'video';
  kind.disabled = !enabled || !available || waiting || answerMode === 'sound' || videoAvModes.includes(answerMode);
  const input = $('answer-attachment-files');
  input.accept = attachmentAccept(kind.value);
  input.disabled = !enabled || !available || waiting;
  $('answer-attachment-clear').hidden = !queryAttachments.length;
  $('answer-attachment-help').textContent = !available ? '当前服务未启用查询附件，可继续只输入文字问题。'
    : videoAvModes.includes(answerMode) ? '可添加参考原视频，最多3个、合计20MiB。连续画面与原声按所选模式辅助查找，可能产生模型调用费用；缺音轨的音频或联合参考会整体拒答。不入库或作为引用，仍需完整文字问题。'
    : answerMode === 'sound' ? '可添加原音频，最多3个、合计20MiB。全部波形经模型嵌入辅助检索，可能产生费用；不转录、不入库或引用，仍需输入文字问题。'
      : '可添加图片、音频或视频，最多3个、合计20MiB（单张图片10MiB）。附件在提交时交给服务器配置的模型辅助检索，可能产生调用费用；不保存为库内资料，引用仍来自资料库。仍需输入文字问题。';
  const labels = { image: '图片', audio: '音频', video: '视频' };
  $('answer-attachment-count').textContent = queryAttachments.length ? `${queryAttachments.length} / 3 个附件 · ${(queryAttachments.reduce((sum, item) => sum + item.file.size, 0) / 1024 / 1024).toFixed(2)} MiB` : '未添加附件';
  $('answer-attachment-list').replaceChildren(...queryAttachments.map((item, index) => {
    const row = element('li');
    const remove = button('移除', () => {
      queryAttachments = queryAttachments.filter((_item, ordinal) => ordinal !== index);
      queryAttachmentError = ''; answerSession.reset(); resetRetrieval();
    });
    remove.setAttribute('aria-label', `移除附件：${item.file.name}`);
    row.append(element('span', `${item.file.name} · ${labels[item.kind]} · ${(item.file.size / 1024 / 1024).toFixed(2)} MiB`), remove);
    return row;
  }));
  notice('answer-attachment-error', queryAttachmentError || (videoAvModes.includes(answerMode) && queryAttachments.some(item => item.kind !== 'video') ? '原视频音画只接受视频参考，请移除已选图片或音频；原问题和范围保持。' : ''));
}

const refusalReasons = {
  audio_vector_required: '请为当前范围的全部音频建立原声向量，再用查询音频检索。',
  image_vector_required: '请为当前范围的全部图片建立原图向量，再用查询图片检索。',
  empty_scope: '未选择任何资料，请重新选择范围。', no_evidence: '没有找到足够的原文证据。',
  incomplete_evidence: '现有证据不足以完整回答问题。', conflicting_evidence: '资料中存在冲突证据。',
  unsupported_question: '当前证据不能支持这个问题。', unsafe_evidence: '证据未通过安全核验。',
  invalid_quote: '摘录未通过原文校验。', model_refused: '模型未给出可核验的回答。',
  model_failure: '模型调用失败，本次未生成回答。请稍后重试，或检查模型连接。',
  scope_changed: '资料范围已变化，请核对后重新提问。', configuration_changed: '服务配置已变化，请重新连接。',
  upstream_unavailable: '上游模型暂时不可用。', upstream_invalid: '上游模型未返回有效结果。',
  processing_timeout: '处理超时，本次没有可验证答案。', evidence_capacity_exceeded: '证据超过当前处理容量。',
  query_text_limit: '附件提取出的检索内容超过当前处理容量，请减少附件或选择较短片段。',
  query_modality_missing: '参考视频缺少当前模式需要的画面或音轨，整批参考未完成处理。',
  query_preparation_limit: '完整参考视频超过处理容量，请减少附件或选择较短的原视频。',
};

function renderAnswers() {
  const value = answerSession.value;
  const result = value.result;
  const modelFailure = result?.status === 'abstained' && result.reason === 'model_failure';
  renderAnswerControls();
  $('answer-scope-label').textContent = answerScope === null ? (videoAvModes.includes(answerMode) ? '全部可访问的原视频资料（每份均需音画索引）' : answerMode === 'sound' ? '全部可访问的原声音资料（每份均需声音索引）' : '全部可访问的已发布资料') : `仅所选 ${answerScope.length} 份资料（不会回退全库）`;
  $('answer-scope-documents').hidden = answerScope === null;
  $('answer-scope-documents').replaceChildren(...answerScopeNames.map(name => element('li', name)));
  notice('answer-error', value.error ? messageFor(value.error) : '');
  $('answer-status').textContent = value.phase === 'loading' ? queryAttachments.length ? '正在读取附件、检索和核对库内证据，请稍候…' : '正在检索和核验证据，请稍候…' : value.phase === 'answered' ? '回答已生成，可逐条核对来源。' : value.phase === 'abstained' ? modelFailure ? '模型调用失败，本次未生成回答。' : '本次未给出有据回答。' : '';
  $('answer-attachment-status').hidden = !value.queryAttachments.length;
  $('answer-attachment-status').replaceChildren(...value.queryAttachments.map(item => {
    const label = queryAttachments[item.ordinal]?.file.name ?? `附件 ${item.ordinal + 1}`;
    const status = item.used_mode ? (item.status === 'prepared'
      ? `已处理全部 ${item.window_count} 个窗口（画面 ${item.visual_window_count}、原声 ${item.audio_window_count}）；仅辅助查找库内证据`
      : '未完成整批参考准备；原文件未加入资料库，请核对拒答说明。')
      : item.status === 'prepared' ? `已处理${item.visual_sampled ? '；视觉匹配使用采样图像' : ''}`
        : `未完成 · ${refusalReasons[item.reason] ?? '请核对附件并重新提问。'} 原因代码：${item.reason}`;
    return element('li', `${label}：${status}`);
  }));
  $('chat-scope-name').textContent = answerScope === null ? '全部资料' : `已选 ${answerScope.length} 份资料`;
  $('chat-question').hidden = value.phase === 'idle';
  $('chat-thinking').hidden = value.phase !== 'loading';
  $('answer-result').hidden = !result;
  $('answer-empty').hidden = !!result || value.phase === 'loading';
  $('answer-text').textContent = modelFailure ? refusalReasons.model_failure : result?.answer ?? '';
  $('answer-outcome').textContent = result?.status === 'answered' ? '有据回答' : modelFailure ? '模型调用失败' : '证据不足 / 拒答';
  $('answer-reason').hidden = result?.status !== 'abstained';
  const reasonText = result?.reason === 'empty_scope' && answerScope === null
    ? '当前范围没有可访问的已发布资料，请先导入并完成索引。'
    : refusalReasons[result?.reason] ?? '本次结果未通过证据核验。';
  $('answer-reason').textContent = result?.status === 'abstained' ? `${reasonText} 原因代码：${result.reason}` : '';
  $('answer-trace').textContent = result ? `回答编号：${result.answer_id}` : '';
  $('answer-citations-section').hidden = !result?.citations?.length;
  $('answer-citations').replaceChildren(...(result?.citations ?? []).map(citation => {
    const item = element('li', undefined, 'citation-card');
    item.value = citation.number;
    const read = button(`${citation.filename} · 查看来源`, async () => {
      await answerSession.readSource(citation.number);
      if (currentView === 'answers') $('source-heading').focus();
    }, 'citation-link');
    read.disabled = !connected || value.sourcePhase === 'loading';
    const locator = citation.kind === 'video_av_window' ? `${timeLabel(citation.window.start_ms)}–${timeLabel(citation.window.end_ms)}` : citation.kind === 'image_region' ? `整图来源 · ${citation.width} × ${citation.height}` : citation.content_url && Number.isFinite(citation.start_ms) && Number.isFinite(citation.end_ms) ? `${timeLabel(citation.start_ms)}–${timeLabel(citation.end_ms)}` : `第 ${citation.page} 页`;
    item.append(read, element('p', locator, 'help-text'));
    if (mediaQuote(citation)) {
      const excerpt = element('details', undefined, 'citation-excerpt');
      excerpt.append(element('summary', '查看摘录'), element('p', mediaQuote(citation), 'evidence-text citation-quote'));
      item.append(excerpt);
    }
    return item;
  }));
  const sourceDialog = $('source-panel');
  if (value.sourcePhase !== 'idle' && currentView === 'answers') {
    if (!sourceDialog.open) sourceDialog.showModal();
  } else if (sourceDialog.open) sourceDialog.close();
  sourceDialog.setAttribute('aria-busy', String(value.sourcePhase === 'loading'));
  $('source-status').textContent = value.sourcePhase === 'loading' ? '正在向服务器回读并核对来源…' : value.sourcePhase === 'ready' ? '来源已按当前身份与文档版本重新校验。' : value.sourcePhase === 'error' ? '来源回读未完成，旧摘录不能视为当前验证成功。' : '回答后，点击一条引用查看服务器校验的原文。';
  notice('source-error', value.sourceError ? messageFor(value.sourceError) : '');
  $('source-content').hidden = value.sourcePhase !== 'ready';
  $('source-filename').textContent = value.source?.filename ?? '';
  $('source-quote').textContent = mediaQuote(value.source);
  const source = value.source;
  $('source-quote').hidden = !mediaQuote(source);
  renderSourceImage(source);
  renderSourceMedia(source);
  renderSourcePdf(source);
  $('source-metadata').replaceChildren();
  const metadata = !source ? [] : source.evidence_kind ? [['引用编号', source.number], ['文档版本', source.revision_id], ['原文件 SHA-256', source.source_sha256], ['摘录 SHA-256', source.text_sha256], ['证据类型', source.evidence_kind], ['文字来源', source.origin],
    ...(source.evidence_kind === 'document_text' ? [['页码', source.page], ['字符区间', `${source.start}–${source.end}（Unicode码点，右端不含）`]]
      : [['时间片段', `${timeLabel(source.start_ms)}–${timeLabel(source.end_ms)}`], ['时间精度', source.time_precision]]),
    ...(source.parser_revision ? [['解析版本', source.parser_revision]] : [])] : source.kind === 'video_av_window' ? [['引用编号', source.number], ['文档版本', source.revision_id], ['原文件 SHA-256', source.source_sha256], ['音画模型版本', source.analysis_model_revision], ['证据模式', source.mode], ['服务器窗口', `${timeLabel(source.window.start_ms)}–${timeLabel(source.window.end_ms)}`], ['画面材料', source.window.video ? `${source.window.video.frame_count}个实际连续帧` : '此窗口没有画面'], ['声音材料', source.window.audio ? '完整原声音样本' : '此窗口没有声音'], ['时间精度', source.time_precision], ['事实 SHA-256', source.facts_sha256], ['证据策略', source.policy_revision]] : source.kind === 'sound_span' ? [['引用编号', source.number], ['文档版本', source.revision_id], ['原文件 SHA-256', source.source_sha256], ['声音模型版本', source.analysis_model_revision], ['证据策略版本', source.policy_revision], ['索引配置指纹', source.profile_fingerprint], ['解码版本', source.decoder_revision], ['PCM SHA-256', source.pcm_sha256], ['事实 SHA-256', source.facts_sha256], ['服务器样本窗口', `${source.start_sample}–${source.end_sample}（16000Hz，右端不含）`], ['时间片段', `${timeLabel(source.start_ms)}–${timeLabel(source.end_ms)}`], ['时间精度', source.time_precision], ['证据来源', '原声音模型判断']] : [['引用编号', source.number], ['文档版本', source.revision_id], ['解析版本', source.parser_revision], ['原文件 SHA-256', source.source_sha256],
    ...(source.mediaUrl ? [['时间片段', `${timeLabel(source.start_ms)}–${timeLabel(source.end_ms)}`], ['时间精度', source.time_precision], ['证据来源', source.proof_origin ?? source.text_origin]] : source.kind === 'image_region' ? [['定位', '整图'], ['视觉模型版本', source.model_revision], ['证据策略版本', source.policy_revision]]
      : [['页码', source.page], ['字符区间', `${source.start}–${source.end}（Unicode码点，右端不含）`], ['摘录 SHA-256', source.quote_sha256]])];
  for (const [label, text] of metadata) $('source-metadata').append(element('dt', label), element('dd', text));
}

function renderSourcePdf(source) {
  const panel = $('source-pdf-panel');
  if (source?.pdfUrl && panel.dataset.pdfUrl === source.pdfUrl) return;
  panel.replaceChildren(); panel.dataset.pdfUrl = source?.pdfUrl ?? ''; panel.hidden = !source?.pdfUrl;
  if (!source?.pdfUrl) return;
  const open = element('a', `打开原 PDF · 第 ${source.page} 页`);
  open.href = `${source.pdfUrl}#page=${source.page}`; open.target = '_blank'; open.rel = 'noopener noreferrer';
  const download = element('a', '下载原 PDF'); download.href = source.pdfUrl; download.download = source.filename;
  const actions = element('div', undefined, 'original-actions');
  actions.append(open, download, button('关闭来源', () => answerSession.closeSource()));
  const pdf = element('object', undefined, 'original-pdf'); pdf.type = 'application/pdf'; pdf.data = open.href;
  pdf.setAttribute('aria-label', `${source.filename}：第 ${source.page} 页原文件`);
  pdf.append(element('p', '浏览器无法内嵌 PDF 时，请打开或下载原文件，按页码核对。'));
  const origin = source.origin === 'machine_ocr' || source.parser_revision?.startsWith('java-pdf-ocr-v1:')
    ? '此摘录来自逐页OCR。字符区间对应机器识别文本；请在原 PDF 对应页核对内容。'
    : '按服务器引用页码定位原 PDF；字符区间对应提取文本。';
  panel.append(actions, element('p', origin, 'help-text'), pdf);
}

function renderSourceMedia(source) {
  const panel = $('source-media-panel');
  if (source?.mediaUrl && panel.dataset.mediaUrl === source.mediaUrl) return;
  for (const player of panel.querySelectorAll('audio, video')) { player.pause(); player.removeAttribute('src'); player.load(); }
  panel.replaceChildren();
  panel.dataset.mediaUrl = source?.mediaUrl ?? '';
  panel.hidden = !source?.mediaUrl;
  if (!source?.mediaUrl) return;
  const player = element(['audio_span', 'sound_span'].includes(source.kind) ? 'audio' : 'video');
  player.controls = true; player.preload = 'metadata'; player.src = source.mediaUrl;
  player.setAttribute('aria-label', `${source.filename}：服务器校验的原素材`);
  let playingExcerpt = false;
  const interval = source.kind === 'video_av_window' ? source.window : source;
  const timeHelp = {
    audio_span: '音频转录按服务器分段定位，不代表逐词对齐。',
    video_frame: '视频画面引用定位到原始解码帧及服务器画面区间，请结合下方原帧核对。',
    video_transcript: '视频中的语音转录按服务器分段定位，不代表逐词对齐。',
    video_frame_ocr: source.evidence_kind ? '画面文字按服务器返回的原帧区间定位，不代表完整动作起止。' : '画面文字按原帧区间定位；高亮为OCR词框，不是逐字符框。',
    video_subtitle: '内嵌字幕按原字幕条目起止定位，请结合字幕原文与视频核对。',
    video_av_window: '按服务器窗口回看完整原片；模型判断不代表逐帧或逐声事件精确定位。',
    sound_span: '声音模型判断按服务器窗口定位，不代表精确声事件起止。',
  }[source.kind] ?? '按服务器返回的引用区间核对原素材。';
  const status = element('p', `引用时间 ${timeLabel(interval.start_ms)}–${timeLabel(interval.end_ms)}。${timeHelp}`, 'help-text');
  const seek = () => { player.currentTime = interval.start_ms / 1000; };
  player.addEventListener('loadedmetadata', seek, { once: true });
  player.addEventListener('error', () => { status.textContent = '浏览器无法播放此媒体格式，可下载原文件后使用本机播放器按引用时间核对。'; });
  player.addEventListener('timeupdate', () => { if (playingExcerpt && player.currentTime >= interval.end_ms / 1000) { player.pause(); playingExcerpt = false; } });
  const play = button('播放此引用片段', async () => {
    try { seek(); playingExcerpt = true; await player.play(); }
    catch { playingExcerpt = false; status.textContent = '当前浏览器未能播放，可再次尝试或下载原文件核对。'; }
  });
  const download = element('a', '下载本次校验的原文件');
  download.href = source.mediaUrl; download.download = source.filename;
  panel.append(player, status, play, download, button('关闭来源', () => answerSession.closeSource()));
  if (source.frameUrl) {
    const picture = element('img');
    picture.src = source.frameUrl; picture.alt = `${source.filename}：${timeLabel(source.frame.frame_ms)} 的原始解码帧`;
    picture.width = source.frame.width; picture.height = source.frame.height;
    const canvas = element('div', undefined, 'source-image-canvas'); canvas.append(picture);
    if (source.ocr?.regions.length) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${source.frame.width} ${source.frame.height}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
      for (const region of source.ocr.regions) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        for (const [key, value] of Object.entries({ x: region.left, y: region.top, width: region.right - region.left, height: region.bottom - region.top })) rect.setAttribute(key, String(value));
        svg.append(rect);
      }
      canvas.append(svg);
    }
    panel.append(element('p', `已校验帧 · ${timeLabel(source.frame.frame_ms)}${source.ocr ? ' · 高亮为OCR词框' : ''}`, 'help-text'), canvas);
  }
}

function renderSourceImage(source) {
  const panel = $('source-image-panel');
  panel.replaceChildren();
  panel.hidden = !source?.imageUrl && !source?.originalUrl;
  if (source?.originalUrl) {
    const actions = element('div', undefined, 'original-actions');
    const open = element('a', '打开本次校验的原文件'); open.href = source.originalUrl; open.target = '_blank'; open.rel = 'noopener noreferrer';
    const download = element('a', '下载原文件'); download.href = source.originalUrl; download.download = source.filename;
    actions.append(open, download, button('关闭来源', () => answerSession.closeSource())); panel.append(actions);
    if (source.media_type.startsWith('image/')) {
      const picture = element('img'); picture.src = source.originalUrl; picture.alt = `${source.filename}：引用文字所在原图`;
      const canvas = element('div', undefined, 'source-image-canvas'); canvas.append(picture);
      panel.append(element('p', '摘录来自机器 OCR，请结合原图核对；此来源未提供文字框。', 'help-text'), canvas);
    } else if (source.original.text !== null) panel.append(element('pre', source.original.text, 'evidence-text'));
    else panel.append(element('p', source.original.textError ?? '请打开或下载原文件核对引用。', 'help-text'));
    return;
  }
  if (!source?.imageUrl) return;
  const picture = element('img');
  picture.src = source.imageUrl; picture.alt = `${source.filename}：服务器校验的原图`;
  picture.width = source.image.width; picture.height = source.image.height;
  picture.addEventListener('error', () => { answerSession.closeSource(); notice('source-error', '浏览器无法解码来源原图，请重新读取。'); }, { once: true });
  const canvas = element('div', undefined, 'source-image-canvas');
  canvas.append(picture);
  const regions = source.image.regions ?? [];
  if (regions.length) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1 1'); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
    for (const region of regions) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const [left, top, right, bottom] = region.bbox;
      for (const [key, value] of Object.entries({ x: left, y: top, width: right - left, height: bottom - top })) rect.setAttribute(key, String(value));
      svg.append(rect);
    }
    canvas.append(svg);
  }
  panel.append(canvas, element('p', regions.length ? '高亮为服务器OCR词级位置，不是逐字符框；请结合原图核对转录。' : '引用定位到整张原图。', 'help-text'));
  const download = element('a', '下载本次校验的原图');
  download.href = source.imageUrl; download.download = source.filename;
  panel.append(download, button('关闭原图', () => answerSession.closeSource()));
}

function clearFeedback() {
  $('operation-feedback').hidden = true;
  $('feedback-items').replaceChildren();
}

function resetContext({ identity = false } = {}) {
  if (identity) { answerEntry++; answerCapabilityRefresh = null; answerCapabilityError = null; }
  voiceQuestionSession.reset();
  stopDetailMedia(); originalSession.close(); stopSynopsisMedia(); synopsisSession.close(); tagSuggestionSession.close(); imageVectorSession.close(); audioVectorSession.close(); soundIndexSession.close(); videoAvIndexSession.close(); replacementSession.close();
  if (identity) { cleanupSession.close(); modelRebuildSession.close(); modelSession.close(); renderedModelVersion = undefined; }
  if (identity) document.dispatchEvent?.(new Event('knowledge-context-reset'));
  if (identity) {
    answerScope = null; answerScopeNames = []; $('answer-question').value = '';
    retrievalScope = null; retrievalScopeNames = []; $('retrieval-question').value = '';
    reindexNeedsRefresh.clear();
    queryAttachments = []; queryAttachmentError = ''; $('answer-attachment-files').value = '';
  }
  answerSession.reset(); resetRetrieval();
  clearTimeout(searchTimer);
  stopTaskPolling();
  state.invalidate();
  taskKind = 'ingestion';
  renderTask();
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  loading = false;
  total = 0;
  totalPages = 0;
  closeDialog();
  clearFeedback();
  notice('list-error');
  notice('global-error');
  if (identity) {
    folders = [];
    folderId = '';
    $('tag').replaceChildren(new Option('全部标签', ''));
    renderFolders();
    notice('folder-error');
  }
  renderRows();
  renderDetails();
  renderControls();
}

function authenticationFailed(error) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  connected = false;
  resetContext({ identity: true });
  $('identity-status').textContent = '身份未通过验证，请重新建立会话或切换开发身份。';
  notice('global-error', messageFor(error));
  return true;
}

async function read(kind, path, success, errorId, { preserveDetail = false } = {}) {
  controllers.get(kind)?.abort();
  const controller = new AbortController();
  controllers.set(kind, controller);
  const ticket = state.beginRead(kind);
  try {
    const result = await api(path, { signal: controller.signal });
    if (state.isCurrent(ticket)) success(result, ticket);
  } catch (error) {
    if (error.name !== 'AbortError' && state.isCurrent(ticket) && !authenticationFailed(error)) {
      notice(errorId, messageFor(error));
    }
  } finally {
    if (state.isCurrent(ticket)) {
      controllers.delete(kind);
      if (kind === 'documents') {
        loading = false;
        renderRows();
        if (preserveDetail && state.detail && $('detail-task-controls')) renderDetailEvidence();
        else renderDetails();
        renderControls();
        renderTask();
        scheduleTask();
      }
    }
  }
}

function documentQuery() {
  filterSnapshot = Object.fromEntries(['search', 'type', 'status', 'tag', 'sort', 'page-size'].map(id => [id, $(id).value]));
  const query = new URLSearchParams({ page: String(page), page_size: $('page-size').value, sort: $('sort').value });
  for (const [key, value] of [['q', $('search').value.trim()], ['type', $('type').value], ['status', $('status').value], ['tag', $('tag').value], ['folder_id', folderId]]) {
    if (value) query.set(key, value);
  }
  return query;
}

function loadDocuments({ preserveDetail = false } = {}) {
  if (!connected) return Promise.resolve();
  loading = true;
  notice('list-error');
  renderRows();
  renderControls();
  return read('documents', `/v1/management/documents?${documentQuery()}`, (result, ticket) => {
    if (!Array.isArray(result?.items) || !Number.isInteger(result.total) || !Number.isInteger(result.total_pages)) throw new Error('invalid page');
    total = result.total;
    totalPages = result.total_pages;
    if (totalPages > 0 && page > totalPages) {
      page = totalPages;
      resetContext();
      loadData();
      return;
    }
    const previousPublications = new Map(state.items.map(item => [item.document_id, item.index_publication_id]));
    if (!state.commitPage(ticket, result.items)) return;
    for (const item of state.items) reindexNeedsRefresh.delete(item.document_id);
    const changed = state.items.filter(item => previousPublications.get(item.document_id)
      && item.index_publication_id && previousPublications.get(item.document_id) !== item.index_publication_id);
    if (changed.some(item => answerScope === null || answerScope.includes(item.document_id))) {
      answerSession.reset(); resetRetrieval();
      notice('answer-error', '索引发布版本已更新，请重新测试召回或提问后打开来源。当前问题与范围已保留。');
    }
  }, 'list-error', { preserveDetail });
}

function loadFolders() {
  notice('folder-error');
  return read('folders', '/v1/management/folders', result => {
    if (!Array.isArray(result?.items)) throw new Error('invalid folders');
    folders = result.items;
    renderFolders();
    const current = $('detail-folder');
    if (current) {
      const selected = current.value;
      const replacement = folderSelect('detail-folder', selected);
      current.replaceChildren(...replacement.options);
      current.value = selected;
    }
  }, 'folder-error');
}

function loadTags() {
  return read('tags', '/v1/management/tags', result => {
    if (!Array.isArray(result?.items)) throw new Error('invalid tags');
    const selected = $('tag').value;
    $('tag').replaceChildren(new Option('全部标签', ''));
    const values = [...new Set([...result.items, ...(selected ? [selected] : [])])];
    for (const value of values) $('tag').append(new Option(value, value));
    $('tag').value = selected;
  }, 'global-error');
}

function loadData({ preserveDetail = false } = {}) {
  if (!connected) return Promise.resolve();
  return Promise.all([loadDocuments({ preserveDetail }), loadFolders(), loadTags()]);
}

function changeFilter({ delayed = false } = {}) {
  if (!allowDetailLeave()) {
    for (const [id, value] of Object.entries(filterSnapshot ?? {})) $(id).value = value;
    return;
  }
  page = 1;
  resetContext();
  if (delayed) searchTimer = setTimeout(loadData, 250);
  else loadData();
}

function renderControls() {
  renderCleanupRecords(); renderModelSettings();
  $('model-library-guidance').hidden = !connected || !modelConfigurationEnabled(config) || indexingEnabled();
  $('model-library-guidance-text').textContent = modelIndexGuidance();
  renderDetailTagSuggestions(); renderDetailImageVector(); renderDetailAudioVector(); renderDetailSoundIndex(); renderDetailVideoAvIndex(); renderDetailReplacement();
  const busy = state.mutating;
  const unavailable = !connected || busy;
  const detail = state.items.find(row => row.document_id === state.detail?.document_id);
  const canEditDetail = detail?.can_edit === true;
  $('refresh').disabled = unavailable || loading;
  $('new-folder').disabled = unavailable;
  $('upload').disabled = unavailable || !ingestionEnabled();
  $('upload').title = ingestionEnabled() ? (imageUploadMode(config) ? '文本最多20MiB；PNG/JPEG最多10MiB' : 'PDF / TXT / Markdown，1字节至20MiB') : '服务未启用上传';
  for (const id of ['task-refresh', 'task-dismiss']) $(id).disabled = unavailable;
  $('task-cancel').disabled = unavailable || !currentTask()?.can_cancel;
  $('task-retry').disabled = unavailable || !currentTask()?.can_retry;
  $('select-page').disabled = unavailable || loading || state.items.length === 0;
  $('select-page').checked = state.items.length > 0 && state.selected.size === state.items.length;
  $('select-page').indeterminate = state.selected.size > 0 && state.selected.size < state.items.length;
  $('batch-tools').hidden = state.selected.size === 0;
  $('batch-retrieval').disabled = unavailable || loading || !state.selected.size || !retrievalEnabled(config);
  $('batch-reindex').hidden = !batchReindexEnabled();
  $('batch-reindex').disabled = unavailable || loading || !state.selected.size;
  $('batch-cleanup').hidden = !cleanupEnabled(config);
  $('batch-cleanup').disabled = unavailable || loading || !state.selected.size || !state.items.some(item => state.selected.has(item.document_id) && canRequestCleanup(item));
  if ($('detail-cleanup')) { $('detail-cleanup').hidden = !cleanupEnabled(config); $('detail-cleanup').disabled = unavailable || loading || !canRequestCleanup(detail); }
  const activeFilters = ['type', 'status', 'tag'].filter(id => $(id).value).length;
  $('toggle-filters').textContent = activeFilters ? `筛选条件 · ${activeFilters}` : '筛选条件';
  $('selection-count').textContent = `已选 ${state.selected.size} 项`;
  for (const id of ['batch-move', 'batch-tag', 'clear-selection']) $(id).disabled = unavailable || loading || state.selected.size === 0;
  $('previous-page').disabled = unavailable || loading || page <= 1;
  $('next-page').disabled = unavailable || loading || page >= totalPages;
  $('list-count').textContent = loading ? '正在读取授权资料…' : `共 ${total} 份资料`;
  $('page-label').textContent = `第 ${totalPages ? page : 0} / ${totalPages} 页`;
  $('current-folder').textContent = folderId === 'unfiled' ? '未分类' : folders.find(folder => folder.folder_id === folderId)?.name ?? '全部资料';
  $('table-region').setAttribute('aria-busy', String(loading));
  for (const node of $('filters').elements) node.disabled = unavailable;
  $('page-size').disabled = unavailable || loading;
  for (const node of document.querySelectorAll('[data-mutation-control]')) node.disabled = unavailable || loading;
  for (const node of document.querySelectorAll('[data-detail-control]')) node.disabled = unavailable || loading || !canEditDetail;
  if ($('detail-permission')) $('detail-permission').hidden = canEditDetail;
  for (const node of document.querySelectorAll('[data-index-document]')) {
    const item = state.items.find(row => row.document_id === node.dataset.indexDocument);
    node.disabled = unavailable || loading || !canStartIndexing(config, item);
    if (!indexingEnabled() && modelConfigurationEnabled(config)) node.title = modelIndexGuidance();
  }
  for (const node of document.querySelectorAll('[data-reindex-document]')) {
    const item = state.items.find(row => row.document_id === node.dataset.reindexDocument);
    node.disabled = unavailable || loading || !canReindex(item);
  }
  for (const node of $('jwt-identity').querySelectorAll('button')) node.disabled = state.identityPending;
  $('dialog-submit').disabled = busy || dialogIntent?.kind === 'batch-reindex'
    && (!dialogIntent.entries.length || dialogIntent.entries.some(entry => reindexNeedsRefresh.has(entry.documentId)));
  $('dialog-cancel').disabled = busy;
  $('close-detail').disabled = busy;
  renderTaskList();
  renderAnswerControls();
}

function renderFolders() {
  const list = $('folder-list');
  list.replaceChildren();
  for (const folder of [{ folder_id: '', name: '全部资料' }, { folder_id: 'unfiled', name: '未分类' }, ...folders]) {
    const row = element('div', undefined, 'folder-row');
    const select = button('', () => { if (!allowDetailLeave()) return; detailBaseline = null; folderId = folder.folder_id; changeFilter(); renderFolders(); }, 'folder-filter');
    select.classList.toggle('selected', folderId === folder.folder_id);
    select.setAttribute('aria-current', folderId === folder.folder_id ? 'page' : 'false');
    select.append(element('span', folder.name));
    if (folder.document_count !== undefined) select.append(element('span', folder.document_count, 'muted'));
    select.disabled = !connected || state.mutating;
    row.append(select);
    if (folder.can_edit) {
      const rename = button('改名', () => folderDialog('rename', folder), 'folder-more');
      const remove = button('删除', () => folderDialog('remove', folder), 'folder-more');
      rename.setAttribute('aria-label', `重命名目录：${folder.name}`);
      remove.setAttribute('aria-label', `删除目录：${folder.name}`);
      rename.dataset.mutationControl = '';
      remove.dataset.mutationControl = '';
      row.append(rename, remove);
    }
    list.append(row);
  }
  renderControls();
}

function sizeLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '大小不可得';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间不可得' : date.toLocaleString('zh-CN', { hour12: false });
}

const types = { document: '文档', image: '图片', audio: '音频', video: '视频' };
const roles = { owner: '所有者', editor: '可编辑', reader: '只读' };

function appendIndexControl(container, item, className) {
  if (!indexingEnabled()) return;
  if (item.latest_index_job) {
    container.append(button('索引任务', () => openTask(item, 'indexing'), className));
  } else if (canStartIndexing(config, item)) {
    const control = button('建立索引', () => indexDialog(item.document_id), className);
    control.dataset.indexDocument = item.document_id;
    control.disabled = !connected || state.mutating || loading;
    container.append(control);
  }
  if (canReindex(item)) {
    const control = button('重建文本索引', () => reindexDialog(item.document_id), className);
    control.dataset.reindexDocument = item.document_id;
    control.disabled = !connected || state.mutating || loading;
    container.append(control);
  }
}

function reindexDialog(id) {
  const item = state.items.find(row => row.document_id === id);
  if (!connected || loading || state.mutating || !canReindex(item)) return;
  const media = config.capabilities.includes('text_reindex_with_vectors')
    ? '若已有图片或音频向量，服务器会完整核对后继续使用，不会重新生成这些媒体向量。' : '';
  showDialog('重建文本索引', `将用“${item.display_name}”已保存的解析文本建立新索引，并发送到当前索引配置的嵌入模型和Milvus，可能产生费用。${media}不会重新解析、转录或替换原文件。旧发布版本继续使用；新索引完整验证后才替换。失败或取消保留旧版本，成功后旧回答来源需重新查询。`, [],
    { kind: 'index-rebuild', epoch: state.epoch, documentId: id, revisionId: item.latest_job.revision_id,
      publicationId: item.index_publication_id, latestTaskId: item.latest_index_job?.task_id ?? null }, '确认重建文本索引');
}

function batchReindexDialog() {
  if (!connected || currentView !== 'documents' || loading || state.mutating || !batchReindexEnabled() || !state.selected.size) return;
  const selectionIds = [...state.selected];
  const entries = [], excluded = [];
  for (const id of selectionIds) {
    const item = state.items.find(row => row.document_id === id);
    if (canReindex(item)) entries.push({ documentId: id, label: item.display_name, revisionId: item.latest_job.revision_id,
      publicationId: item.index_publication_id, latestTaskId: item.latest_index_job?.task_id ?? null, fingerprint: reindexFingerprint(item) });
    else excluded.push({ documentId: id, label: item?.display_name ?? id, reason: batchReindexUnavailable(item) });
  }
  const list = element('ul');
  for (const entry of entries) list.append(element('li', `${entry.label} · 使用当前已发布的解析材料`));
  const fields = [element('p', `本次提交 ${entries.length} 份合格资料：`), list,
    element('p', `${excluded.length} 份不合格资料不会提交，仍保留选择。`)];
  if (excluded.length) {
    const skipped = element('ul');
    for (const entry of excluded) skipped.append(element('li', `${entry.label}：${entry.reason}`));
    fields.push(skipped);
  }
  const media = config.capabilities.includes('text_reindex_with_vectors')
    ? '已有图片或音频向量将经完整核对后继续使用，不会重新生成媒体向量。' : '';
  showDialog('重建选中文本索引', `仅为下列合格资料分别创建后台索引任务，将使用已保存的解析文本调用当前嵌入模型和Milvus，可能产生费用。${media}不会重新解析、转录或替换原文件。每份资料独立处理，旧发布继续可用，完整成功后才切换；失败或取消保留旧版本。`, fields,
    { kind: 'batch-reindex', epoch: state.epoch, selectionIds, entries, excluded }, '确认创建重建任务');
  $('dialog-submit').disabled = entries.length === 0;
}

function checkedBatchReindexItems(entries, result) {
  return entries.map(entry => {
    const matches = Array.isArray(result?.items) ? result.items.filter(item => item?.document_id === entry.documentId) : [];
    const item = matches.length === 1 ? matches[0] : null;
    if (!item || typeof item.ok !== 'boolean'
      || item.ok && (item.receipt?.status !== 'queued' || item.receipt.document_id !== entry.documentId)) {
      return { document_id: entry.documentId, ok: false, detail: '未收到有效创建回执，请刷新资料和任务核对；不会自动重试。' };
    }
    return { document_id: entry.documentId, ok: item.ok, detail: item.ok ? '后台重建任务已创建，尚未完成索引。'
      : typeof item.detail === 'string' && item.detail.length <= 1000 ? item.detail : '任务未能创建，请刷新资料后核对。' };
  });
}

function indexDialog(id) {
  const item = state.items.find(row => row.document_id === id);
  if (loading || !canStartIndexing(config, item)) return;
  showDialog('建立文本索引', `将把“${item.display_name}”的解析文本发送到服务器配置的嵌入模型和Milvus，可能产生调用费用。服务器验证完整索引后才发布版本；问答能力以服务配置为准。`, [], { kind: 'index-create', documentId: id }, '确认建立索引');
}

function openDetail(id) {
  if (loading || state.mutating) return;
  if (state.detail?.document_id === id && $('detail-form')) {
    if (!$('details').open) $('details').showModal();
    $('detail-heading').focus();
    ensureDetailOriginal();
    return;
  }
  if (!allowDetailLeave()) return;
  state.openDetail(id);
  renderRows();
  renderDetails();
  if (!$('details').open) $('details').showModal();
  $('detail-heading').tabIndex = -1;
  $('detail-heading').focus();
}

function renderRows() {
  const rows = $('document-rows');
  rows.replaceChildren();
  $('list-empty').hidden = loading || state.items.length > 0;
  if (loading) {
    for (let i = 0; i < 5; i += 1) {
      const row = element('tr');
      row.setAttribute('aria-hidden', 'true');
      const cell = element('td');
      cell.colSpan = 7;
      cell.append(element('div', undefined, 'skeleton'), element('div', undefined, 'skeleton short'));
      row.append(cell); rows.append(row);
    }
    return;
  }
  const empty = $('list-empty');
  empty.replaceChildren(element('strong', connected ? '当前筛选下没有资料' : '请先确认访问身份'), element('p', connected ? (ingestionEnabled() ? '上传PDF、TXT或Markdown，或试试清除筛选条件。解析完成后仍未索引，不能问答。' : '试试清除筛选条件。当前服务未启用文本上传，合成演示资料需由Java显式seed工具创建。') : '只有通过服务器身份验证后，才会显示有权访问的资料。'));
  for (const item of state.items) {
    const row = element('tr');
    row.classList.toggle('active', state.detail?.document_id === item.document_id);
    const checkCell = element('td');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(item.document_id);
    checkbox.disabled = state.mutating;
    checkbox.setAttribute('aria-label', `选择资料：${item.display_name}`);
    checkbox.dataset.documentId = item.document_id;
    checkbox.addEventListener('change', () => { state.select(item.document_id, checkbox.checked); renderControls(); });
    checkCell.append(checkbox);
    const name = element('td');
    name.className = 'document-name-cell';
    name.append(element('span', ({document:'文',image:'图',audio:'音',video:'影'})[item.document_type] ?? '文', 'file-kind'));
    name.append(button(item.display_name, () => openDetail(item.document_id), 'document-name'), element('div', item.filename, 'filename'));
    if (item.synthetic_fixture) name.append(element('span', 'synthetic_fixture · 合成资料', 'fixture-badge'));
    const type = element('td', undefined, 'optional');
    type.append(element('div', types[item.document_type] ?? item.media_info?.mime_type ?? '未知类型'), element('div', sizeLabel(item.media_info?.size_bytes), 'filename'));
    const classification = element('td', undefined, 'optional');
    classification.append(element('div', item.folder_name ?? '未分类'));
    const tags = element('div', undefined, 'tag-list');
    for (const tag of item.tags ?? []) tags.append(element('span', tag, 'tag'));
    classification.append(tags);
    const status = element('td'); status.append(element('span', documentStatusLabel(item), 'status-badge'));
    const updated = element('td', undefined, 'optional');
    updated.append(element('div', dateLabel(item.updated_at)), element('div', roles[item.current_role] ?? '未知权限', 'filename'));
    const action = element('td', undefined, 'document-row-actions');
    action.append(button('打开', () => openDetail(item.document_id), 'row-detail'));
    const menu = element('details', undefined, 'row-menu');
    const menuSummary = element('summary', '更多'); menuSummary.setAttribute('aria-label', `${item.display_name}的更多操作`);
    const menuBody = element('div', undefined, 'row-menu-body'); menu.append(menuSummary, menuBody); action.append(menu);
    menuBody.addEventListener('click', event => { if (event.target.closest('button')) menu.open = false; });
    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      for (const other of document.querySelectorAll('.row-menu[open]')) if (other !== menu) other.open = false;
      const rect = menuSummary.getBoundingClientRect();
      menuBody.style.left = `${Math.max(8, Math.min(rect.right - 170, innerWidth - 178))}px`;
      menuBody.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - menuBody.offsetHeight - 8))}px`;
    });
    if (ingestionEnabled() && item.latest_job) menuBody.append(button('解析任务', () => openTask(item), 'row-detail'));
    appendIndexControl(menuBody, item, 'row-detail');
    if (retrievalEnabled(config)) menuBody.append(button('召回测试', () => openRetrieval([item.document_id]), 'row-detail'));
    // Legacy management can_answer is a false placeholder; this opens a scope, not an eligibility claim.
    if (scopeSelectionEnabled()) {
      const ask = button('提问', () => openAnswers([item.document_id]), 'row-detail');
      ask.dataset.answerDocument = item.document_id;
      menuBody.append(ask);
    }
    row.append(checkCell, name, type, classification, status, updated, action);
    rows.append(row);
  }
}

function folderSelect(id, selected) {
  const select = element('select'); select.id = id;
  select.append(new Option('未分类', ''));
  for (const folder of folders) select.append(new Option(folder.name, folder.folder_id));
  if (selected && !folders.some(folder => folder.folder_id === selected)) select.append(new Option('当前目录（等待刷新）', selected));
  select.value = selected ?? '';
  return select;
}

function field(labelText, input) {
  const label = element('label', labelText);
  label.htmlFor = input.id;
  label.append(input);
  return label;
}

function checkedTags(value, requireNonempty = false) {
  const tags = parseTags(value);
  if ((requireNonempty && !tags.length) || tags.length > 20 || tags.some(tag => tag.length > 40)) {
    throw new ApiError(422, '标签最多 20 个，每个最多 40 字；批量添加时至少填写一个标签。');
  }
  return tags;
}

function replacementDocument() {
  return state.items.find(row => row.document_id === state.detail?.document_id);
}

function replacementUploadReady(item, replacement) {
  return replacement?.can_upload === true && (replacement.state !== 'published'
    || replacement.candidate_revision_id === item?.active_revision_id && replacement.publication_id === item?.index_publication_id);
}

function ensureDetailReplacement() {
  const item = replacementDocument();
  if (currentView !== 'documents' || !connected || !replacementsEnabled(config) || !item || item.synthetic_fixture !== false) {
    replacementSession.close(); return;
  }
  if (!replacementSession.matches(item)) replacementSession.open(item).catch(error => notice('detail-error', messageFor(error)));
}

function renderDetailReplacement() {
  const panel = $('detail-replacement'); if (!panel) return;
  const item = replacementDocument();
  panel.replaceChildren();
  panel.hidden = !connected || !replacementsEnabled(config) || !item || item.synthetic_fixture !== false;
  if (panel.hidden) return;
  const current = replacementSession.matches(item), value = replacementSession.value;
  const replacement = current ? value.replacement : null;
  const busy = current && ['loading', 'uploading', 'indexing'].includes(value.phase);
  const waiting = ['queued', 'processing', 'indexing'].includes(replacement?.state);
  panel.append(element('h4', '更新原文件'));
  panel.append(element('p', '保留资料 ID、显示名称、目录、标签和权限。新文件先作为独立版本处理，明确建立索引并发布成功后才替换当前版本。', 'help-text'));
  const status = element('p', busy ? ({ loading: '正在读取新版本状态…', uploading: '正在上传新原文件…', indexing: '正在提交新版本索引…' })[value.phase]
    : current && value.phase === 'unknown' ? '提交结果未知，请刷新状态核对；不会自动重试。'
      : replacement ? replacementLabel(replacement) : '正在读取新版本状态…');
  status.id = 'replacement-status'; status.setAttribute('aria-live', 'polite'); panel.append(status);
  if (replacement?.candidate_revision_id) {
    panel.append(element('p', `新原文件：${replacement.filename} · ${sizeLabel(replacement.size_bytes)}`, 'help-text'));
    if (replacement.ingestion_task) panel.append(element('p', `新版本解析：${taskLabel(replacement.ingestion_task.state)} · 第${replacement.ingestion_task.attempt}次`, 'help-text'));
    if (replacement.index_task) panel.append(element('p', `新版本索引：${indexTaskLabel(replacement.index_task.state)} · 第${replacement.index_task.attempt}次`, 'help-text'));
    const taskError = replacement.index_task?.error_code ?? replacement.ingestion_task?.error_code;
    if (taskError) panel.append(element('p', `任务未完成（${taskError}）。当前版本保持不变。`, 'notice error'));
    if (replacement.state === 'published') {
      const currentPublication = item.index_publication_id === replacement.publication_id && item.active_revision_id === replacement.candidate_revision_id;
      panel.append(element('p', currentPublication
        ? '新版本已切换。请重新测试召回或提问，再打开新来源；问题与范围已保留。图片/音频独立向量需在下方面板重新建立。'
        : '索引已发布，正在核对当前资料。回读确认前页面仍显示原版本；如未更新，请点击刷新新版本状态。', 'help-text'));
    } else panel.append(element('p', waiting ? '任务自动刷新中，当前已发布版本仍可使用。' : '当前已发布版本仍可使用；新版本未发布不会替换旧来源。', 'help-text'));
  }
  if (current && value.error) panel.append(element('p', messageFor(value.error), 'notice error'));
  const actions = element('div', undefined, 'detail-task-actions');
  const upload = button('选择新原文件', () => replacementUploadDialog()); upload.id = 'replacement-upload';
  upload.disabled = state.mutating || loading || busy || !current || value.phase !== 'ready' || item.can_edit !== true || !replacementUploadReady(item, replacement);
  actions.append(upload);
  if (replacement?.candidate_revision_id && replacement.state !== 'published') {
    const index = button('建立新版本索引', () => replacementIndexDialog()); index.id = 'replacement-index';
    index.disabled = state.mutating || loading || busy || value.phase !== 'ready' || item.can_edit !== true || replacement.can_index !== true;
    actions.append(index);
  }
  const refresh = button('刷新新版本状态', async () => {
    const row = replacementDocument();
    if (!row || state.mutating || !connected || !replacementsEnabled(config)) return;
    const alreadyPublished = replacementSession.value.replacement?.state === 'published';
    await replacementSession.open(row);
    if (alreadyPublished && state.detail?.document_id === row.document_id && replacementSession.matches(row)) await loadDocuments({ preserveDetail: true });
  });
  refresh.disabled = state.mutating || busy; actions.append(refresh); panel.append(actions);
}

function replacementUploadDialog() {
  const item = replacementDocument(), value = replacementSession.value;
  if (!connected || !replacementsEnabled(config) || !item?.can_edit || !replacementSession.matches(item)
    || value.phase !== 'ready' || !replacementUploadReady(item, value.replacement) || state.mutating) return;
  const file = element('input'); file.id = 'replacement-file'; file.type = 'file'; file.required = true; file.accept = replacementAccept(item.document_type);
  showDialog('更新这份资料的原文件', '请选择与当前资料类型相同的新文件。名称整理、目录、标签和权限保持不变；上传及解析不会直接替换当前已发布版本。',
    [field('新原文件', file), element('p', item.document_type === 'image' ? '图片最多10MiB。' : '文档、音频、视频最多20MiB。', 'help-text')],
    { kind: 'replacement-upload', documentId: item.document_id, baseRevisionId: item.active_revision_id ?? item.latest_job?.revision_id ?? item.registered_revision_id, epoch: state.epoch }, '上传新版本');
}

function replacementIndexDialog() {
  const item = replacementDocument(), value = replacementSession.value;
  if (!connected || !replacementsEnabled(config) || !item?.can_edit || !replacementSession.matches(item)
    || value.phase !== 'ready' || !value.replacement?.can_index || state.mutating) return;
  showDialog('建立并发布新版本索引', '将调用已配置的模型与向量服务，可能产生费用。完整索引成功后切换到新文件；失败或取消时保留当前已发布版本。新版本不沿用旧图片/音频独立向量，发布后可按需要另行建立。', [],
    { kind: 'replacement-index', documentId: item.document_id, baseRevisionId: value.replacement.base_revision_id,
      candidateRevisionId: value.replacement.candidate_revision_id, epoch: state.epoch }, '确认建立新版本索引');
}

function renderDetails() {
  const container = $('detail-content');
  stopDetailMedia(); stopSynopsisMedia();
  container.replaceChildren();
  const item = state.detail;
  $('close-detail').hidden = !item;
  container.className = item ? '' : 'detail-empty';
  if (!item) {
    originalSession.close();
    synopsisSession.close(); tagSuggestionSession.close(); imageVectorSession.close(); audioVectorSession.close(); soundIndexSession.close(); videoAvIndexSession.close(); replacementSession.close();
    detailBaseline = null;
    if ($('details').open) $('details').close();
    container.append(element('strong', '选择一份资料'), element('p', '点击列表中的名称，打开保存的原文件并修改显示名称、目录或标签。'));
    return;
  }
  container.append(element('h3', item.display_name, 'detail-title'), element('span', item.synthetic_fixture ? 'synthetic_fixture · 合成验证资料' : '资料元数据', 'fixture-badge'));
  const preview = element('section', undefined, 'document-preview-status');
  preview.id = 'detail-original';
  container.append(preview);
  const replacementPanel = element('section', undefined, 'detail-synopsis'); replacementPanel.id = 'detail-replacement'; container.append(replacementPanel);
  const synopsis = element('section', undefined, 'detail-synopsis'); synopsis.id = 'detail-synopsis'; container.append(synopsis);
  const tagPanel = element('section', undefined, 'detail-synopsis'); tagPanel.id = 'detail-tag-suggestions'; container.append(tagPanel);
  const vectorPanel = element('section', undefined, 'detail-synopsis'); vectorPanel.id = 'detail-image-vector'; container.append(vectorPanel);
  const audioVectorPanel = element('section', undefined, 'detail-synopsis'); audioVectorPanel.id = 'detail-audio-vector'; container.append(audioVectorPanel);
  const soundIndexPanel = element('section', undefined, 'detail-synopsis'); soundIndexPanel.id = 'detail-sound-index'; container.append(soundIndexPanel);
  const videoAvIndexPanel = element('section', undefined, 'detail-synopsis'); videoAvIndexPanel.id = 'detail-video-av-index'; container.append(videoAvIndexPanel);
  const taskControls = element('div'); taskControls.id = 'detail-task-controls'; container.append(taskControls);
  const form = element('form', undefined, 'detail-form'); form.id = 'detail-form';
  const detailEpoch = state.epoch;
  const name = element('input'); name.id = 'detail-name'; name.value = item.display_name; name.maxLength = 255; name.required = true;
  const folder = folderSelect('detail-folder', item.folder_id);
  const tags = element('textarea'); tags.id = 'detail-tags'; tags.value = (item.tags ?? []).join('，'); tags.maxLength = 1000;
  detailBaseline = [name.value, folder.value, tags.value];
  for (const node of [name, folder, tags]) { node.disabled = !item.can_edit; node.dataset.detailControl = ''; }
  form.append(field('显示名称', name), element('p', '仅修改显示名称，不改原文件名、版本或内容哈希。', 'help-text'), field('所在目录', folder), field('设置标签', tags), element('p', '用逗号或换行分隔。保存会替换本资料全部标签；留空清除。', 'help-text'));
  const error = element('p', undefined, 'notice error'); error.id = 'detail-error'; error.hidden = true;
  form.append(error);
  const save = element('button', '保存整理信息', 'primary'); save.type = 'submit'; save.dataset.detailControl = '';
  const permission = element('p', '当前身份为只读，不能修改这份资料。', 'help-text'); permission.id = 'detail-permission';
  form.append(save, permission);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const current = state.items.find(row => row.document_id === item.document_id);
    if (!connected || loading || state.mutating || state.epoch !== detailEpoch || $('detail-form') !== form
      || state.detail?.document_id !== item.document_id || current?.can_edit !== true) return;
    let payload;
    try { payload = { display_name: name.value.trim(), folder_id: folder.value || null, tags: checkedTags(tags.value) }; }
    catch (failure) { notice('detail-error', messageFor(failure)); return; }
    mutate(() => api(`/v1/management/documents/${encodeURIComponent(current.document_id)}`, { method: 'PATCH', body: payload }), () => {
      feedback('资料整理已保存', [{ document_id: current.document_id, ok: true, detail: `${current.display_name}：显示名称、目录及标签已保存。` }]);
      return loadData();
    }, 'detail-error');
  });
  container.append(form);
  const metadata = element('dl', undefined, 'metadata'); metadata.id = 'detail-metadata';
  container.append(metadata);
  renderDetailEvidence();
  const unavailable = element('div', undefined, 'detail-unavailable');
  unavailable.append(element('p', '问答引用可在问答结果中打开。符合当前服务器资格的资料可重建文本索引；其他索引迁移尚未开放。'));
  const actions = element('div');
  const cleanup = button('清理资料', () => cleanupDialog([state.detail.document_id])); cleanup.id = 'detail-cleanup'; actions.append(cleanup);
  unavailable.append(actions); container.append(unavailable);
  if (detailSectionDocument !== item.document_id) { detailSection = 'preview'; detailSectionDocument = item.document_id; }
  const sectionNav = element('div', undefined, 'detail-tabs'); sectionNav.setAttribute('role', 'group'); sectionNav.setAttribute('aria-label', '资料详情分区');
  const sections = [
    ['preview', '原文件', [preview]],
    ['summary', '摘要', [synopsis]],
    ['organize', '整理信息', [form, tagPanel, metadata]],
    ['processing', '处理与版本', [taskControls, replacementPanel, vectorPanel, audioVectorPanel, soundIndexPanel, videoAvIndexPanel, unavailable]],
  ];
  container.insertBefore(sectionNav, preview);
  for (const [key, label, nodes] of sections) {
    const section = element('div', undefined, 'detail-section'); section.id = `detail-section-${key}`; section.hidden = detailSection !== key;
    section.append(...nodes); container.append(section);
    const tab = button(label, () => {
      detailSection = key;
      for (const [name] of sections) $(`detail-section-${name}`).hidden = name !== key;
      for (const control of sectionNav.querySelectorAll('button')) control.setAttribute('aria-pressed', String(control === tab));
      for (const media of container.querySelectorAll('audio,video')) media.pause();
    });
    tab.setAttribute('aria-controls', section.id); tab.setAttribute('aria-pressed', String(detailSection === key)); sectionNav.append(tab);
  }
  renderDetailOriginal(); ensureDetailOriginal(); renderDetailSynopsis(); ensureDetailSynopsis();
  renderControls();
}

function renderDetailTaskControls(item) {
  const controls = $('detail-task-controls');
  if (!item || !controls) return;
  controls.replaceChildren();
  if (ingestionEnabled() && item.latest_job) controls.append(button('查看解析任务', () => openTask(item), 'detail-task'));
  appendIndexControl(controls, item, 'detail-task');
  if (scopeSelectionEnabled()) controls.append(button(anyAnswersEnabled() ? '在本资料中提问' : '在本资料中测试召回', () => openAnswers([item.document_id]), 'detail-task'));
}

function renderDetailEvidence() {
  const item = state.items.find(row => row.document_id === state.detail?.document_id);
  const controls = $('detail-task-controls');
  const metadata = $('detail-metadata');
  if (!item || !controls || !metadata) return;
  ensureDetailOriginal();
  ensureDetailSynopsis(); renderDetailSynopsis(); synchronizeTagSuggestions(); renderDetailTagSuggestions();
  ensureDetailImageVector(); renderDetailImageVector(); ensureDetailAudioVector(); renderDetailAudioVector(); ensureDetailSoundIndex(); renderDetailSoundIndex(); ensureDetailVideoAvIndex(); renderDetailVideoAvIndex(); ensureDetailReplacement(); renderDetailReplacement();
  renderDetailTaskControls(item);
  metadata.replaceChildren();
  for (const [label, value] of [['原文件名', item.filename], ['类型 / 大小', `${item.media_info?.mime_type ?? '不可得'} / ${sizeLabel(item.media_info?.size_bytes)}`], ['当前权限', roles[item.current_role] ?? item.current_role], ['处理状态', documentStatusLabel(item)], ['更新于', dateLabel(item.updated_at)], ['资料 ID', item.document_id], ['已发布版本', item.active_revision_id ?? '尚未发布'], ['索引发布编号', item.index_publication_id ?? '尚未发布'], ['内容 SHA-256', item.media_info?.sha256 ?? '不可得']]) metadata.append(element('dt', label), element('dd', value));
}

function feedback(title, items) {
  $('operation-feedback').hidden = false;
  $('operation-feedback').classList.toggle('failure', items.some(item => !item.ok));
  $('feedback-title').textContent = title;
  $('feedback-items').replaceChildren(...items.map(item => element('li', `${item.ok ? '成功' : '失败'} · ${item.detail}`, item.ok ? '' : 'failed')));
}

function stopTaskPolling() {
  clearTimeout(taskTimer);
  for (const kind of ['ingestion', 'indexing']) {
    controllers.get(kind)?.abort();
    controllers.delete(kind);
    state.reads.delete(kind);
  }
}

function renderTask() {
  const task = currentTask();
  $('task-panel').hidden = !task;
  renderTaskList();
  $('task-metadata').replaceChildren();
  if (!task) {
    $('task-status').textContent = '';
    notice('task-error');
    return;
  }
  const index = taskKind === 'indexing';
  const item = state.items.find(row => row.document_id === task.document_id);
  const label = index ? indexTaskLabel(task.state) : task.state === 'parsed' && !item ? '已解析 · 索引状态待核对' : taskLabel(task.state, item);
  $('task-heading').textContent = index ? '文本索引任务' : '文本解析任务';
  $('task-status').textContent = `${label} · 第${task.attempt}/3次尝试${taskPending(task) && !taskPollPaused ? ' · 自动刷新中' : ''}`;
  for (const [label, value] of [['任务编号', task.task_id], ['资料编号', task.document_id], ['解析版本', task.revision_id], ...(task.error_code ? [['失败代码', task.error_code]] : [])]) {
    $('task-metadata').append(element('dt', label), element('dd', value));
  }
  $('task-cancel').hidden = !task.can_cancel;
  $('task-retry').hidden = !task.can_retry;
  $('task-cancel').textContent = index ? item?.active_revision_id && taskPending(task) ? '取消本次重建' : '取消索引' : '取消解析';
  $('task-retry').textContent = index ? '重试索引' : '重试解析';
  $('task-boundary').textContent = index
    ? task.state === 'indexed' ? '索引任务已完成。当前发布版本由服务器资料列表核对；发布版本更新后，请重新测试召回或提问再打开来源。'
      : item?.active_revision_id && item.index_publication_id
        ? task.state === 'failed' || task.state === 'cancelled'
          ? '本次重建未发布，旧发布版本继续使用。不会自动重试；服务器允许时可明确重试，可能再次产生嵌入模型和Milvus费用。'
          : '正在建立新文本索引，旧发布版本继续使用。新索引完整验证后才替换；收起面板不会取消服务器任务。'
        : task.state === 'failed' || task.state === 'cancelled' ? '未发布索引，原解析证据保留。不会自动重试；重试会再次调用配置的嵌入模型和Milvus，最多3次尝试。'
          : '正在向配置的嵌入模型和Milvus建立文本索引。完成完整性验证后才由服务器发布；收起面板不会取消任务。'
    : task.state === 'parsed'
    ? '原文件已解析并保存版本化结果。请建立索引；发布后才可使用已启用的问答与来源功能。'
    : task.state === 'failed' || task.state === 'cancelled'
      ? '不会自动重试。只有服务器允许时才能显式重试；最多3次尝试。'
      : '任务已接收不代表解析完成。关闭或收起此页面不会取消服务器任务，请使用“取消解析”。';
}

function scheduleTask() {
  clearTimeout(taskTimer);
  if (connected && taskEnabled() && taskPending(currentTask()) && !taskPollPaused) taskTimer = setTimeout(loadTask, 1500);
}

function watchTask(value, kind = taskKind) {
  stopTaskPolling();
  taskKind = kind;
  if (kind === 'indexing') state.watchIndexTask(value);
  else state.watchTask(value);
  taskPollPaused = false;
  notice('task-error');
  renderTask();
  renderControls();
  scheduleTask();
}

function openTask(item, kind = 'ingestion') {
  if (!connected || state.mutating || loading || !(kind === 'indexing' ? indexingEnabled() : ingestionEnabled())) return;
  try {
    const task = kind === 'indexing' ? state.indexTaskForDocument(item.document_id) : state.taskForDocument(item.document_id);
    watchTask(task, kind);
    navigate('tasks');
    $('task-heading').focus();
    loadTask();
  } catch { notice('global-error', '任务信息暂时不可用，请刷新资料列表后重试。'); }
}

async function loadTask() {
  const task = currentTask();
  if (!task || !connected || !taskEnabled()) return;
  if (state.mutating) { scheduleTask(); return; }
  stopTaskPolling();
  const controller = new AbortController();
  const kind = taskKind;
  controllers.set(kind, controller);
  const ticket = state.beginRead(kind);
  try {
    const result = await api(taskPath(task.task_id), { signal: controller.signal });
    if (kind !== taskKind || !commitCurrentTask(ticket, result)) return;
    notice('task-error');
    renderTask();
    renderRows();
    if (state.detail?.document_id === task.document_id) renderDetailEvidence();
    renderControls();
    if ((kind === 'indexing' && (currentTask().state === 'indexed'
      || ['failed', 'cancelled'].includes(currentTask().state) && state.items.some(item => item.document_id === task.document_id && item.active_revision_id && item.index_publication_id)))
      || (kind === 'ingestion' && currentTask().state === 'parsed')) await loadDocuments({ preserveDetail: true });
  } catch (error) {
    if (error.name === 'AbortError' || !state.isCurrent(ticket)) return;
    if (authenticationFailed(error)) return;
    if (error instanceof ApiError && [403, 404].includes(error.status)) {
      resetContext();
      notice('global-error', '任务已不可访问，请按当前权限重新查看资料。');
      await loadData();
      return;
    }
    taskPollPaused = true;
    notice('task-error', `${messageFor(error)} 自动刷新已暂停，请手动刷新任务核对结果。`);
    renderTask();
  } finally {
    if (state.isCurrent(ticket)) { controllers.delete(kind); scheduleTask(); }
  }
}

function taskAction(action) {
  const before = currentTask();
  if (!['cancel', 'retry'].includes(action) || !before || state.mutating || !taskEnabled() || (action === 'cancel' ? !before.can_cancel : !before.can_retry)) return;
  if (taskKind === 'indexing' && action === 'retry') {
    showDialog('重试文本索引', '将再次把本资料的解析文本发送到服务器配置的嵌入模型和Milvus，可能产生调用费用。最多3次尝试；问答能力以服务配置和发布状态为准。', [], { kind: 'index-retry', task: before }, '确认重试索引');
    return;
  }
  submitTaskAction(action, before);
}

function submitTaskAction(action, before, errorId = 'task-error') {
  stopTaskPolling();
  mutate(() => api(`${taskPath(before.task_id)}/${action}`, { method: 'POST' }), result => {
    const task = checkedCurrentTask(result);
    if (task.task_id !== before.task_id || task.document_id !== before.document_id || task.revision_id !== before.revision_id
      || task.attempt !== before.attempt + (action === 'retry' ? 1 : 0)) throw new Error('invalid task action result');
    if (!commitCurrentTask(state.beginRead(taskKind), task)) throw new Error('outdated task action result');
    closeDialog();
    watchTask(task);
    return loadData({ preserveDetail: true });
  }, errorId);
}

async function mutate(request, success, errorId) {
  if (!connected) return;
  const ticket = state.beginMutation();
  if (!ticket) return;
  notice(errorId);
  renderControls();
  renderFolders();
  try {
    const result = await request();
    if (!state.finishMutation(ticket)) return;
    await success(result);
  } catch (error) {
    if (!state.finishMutation(ticket) && ticket.epoch !== state.epoch) return;
    if (!authenticationFailed(error)) notice(errorId, messageFor(error));
  } finally {
    renderControls();
    renderFolders();
    scheduleTask();
  }
}

function closeDialog() {
  if ($('edit-dialog').open) $('edit-dialog').close();
  dialogIntent = null;
}

function showDialog(title, description, fields, intent, submitText) {
  if (!connected || state.mutating) return;
  dialogIntent = intent;
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description;
  $('dialog-fields').replaceChildren(...fields);
  $('dialog-submit').textContent = submitText;
  notice('dialog-error');
  $('edit-dialog').showModal();
  $('dialog-fields').querySelector('input, select, textarea')?.focus();
}

function folderDialog(kind, folder = null) {
  const fields = [];
  if (kind !== 'remove') {
    const input = element('input'); input.id = 'dialog-name'; input.required = true; input.maxLength = 100; input.value = folder?.name ?? '';
    fields.push(field('目录名称', input));
  }
  showDialog(kind === 'create' ? '新建目录' : kind === 'rename' ? '重命名目录' : '删除空目录', kind === 'remove' ? `确认删除“${folder.name}”？只允许删除空目录，不会删除资料；非空目录将由服务器拒绝。` : '单层目录只用于整理资料，不改变任何访问权限。', fields, { kind, folder }, kind === 'remove' ? '确认删除空目录' : '保存目录');
}

function batchDialog(action) {
  if (!state.selected.size) return;
  const ids = [...state.selected];
  const labels = new Map(state.items.map(item => [item.document_id, item.display_name]));
  const input = action === 'move' ? folderSelect('dialog-folder', null) : element('textarea');
  if (action === 'tag') { input.id = 'dialog-tags'; input.required = true; input.maxLength = 1000; }
  showDialog(action === 'move' ? `移动 ${ids.length} 份资料` : `为 ${ids.length} 份资料添加标签`, action === 'move' ? '每份资料单独检查操作权限，结果逐项返回。选择“未分类”可移出目录。' : '新标签会追加并去重，保留每份资料已有标签。不会覆盖其他标签。', [field(action === 'move' ? '目标目录' : '添加标签（逗号或换行分隔）', input)], { kind: 'batch', action, ids, labels }, '确认批量整理');
}

$('dialog-form').addEventListener('submit', event => {
  event.preventDefault();
  const intent = dialogIntent;
  if (!intent || state.mutating || !connected) return;
  if (intent.kind === 'model-rebuild') {
    const saved = modelSession.value.configuration, status = modelRebuildSession.value.status;
    if (intent.epoch !== state.epoch || currentView !== 'settings' || !modelRebuildEnabled(config) || modelRebuildLocked()
      || ['loading', 'saving', 'testing', 'activating', 'unknown'].includes(modelSession.value.phase)
      || modelSession.value.dirty || !saved?.can_edit || saved.version !== intent.version || status?.target_version !== intent.version || !status.can_start) {
      notice('dialog-error', '配置或重建资格已变化，请关闭此窗口并刷新状态。'); return;
    }
    mutate(() => modelRebuildSession.start(intent.version), result => {
      if (result) closeDialog();
      else notice('dialog-error', modelRebuildSession.value.error?.message ?? '尚未确认批次，请关闭此窗口并刷新状态。');
    }, 'dialog-error');
  } else if (intent.kind === 'replacement-upload' || intent.kind === 'replacement-index') {
    const item = replacementDocument(), value = replacementSession.value;
    const revision = item?.active_revision_id ?? item?.latest_job?.revision_id ?? item?.registered_revision_id;
    if (intent.epoch !== state.epoch || currentView !== 'documents' || !replacementsEnabled(config)
      || item?.document_id !== intent.documentId || revision !== intent.baseRevisionId || item.can_edit !== true
      || !replacementSession.matches(item) || value.phase !== 'ready'
      || (intent.kind === 'replacement-upload' ? !replacementUploadReady(item, value.replacement)
        : value.replacement?.can_index !== true || value.replacement.candidate_revision_id !== intent.candidateRevisionId)) {
      notice('dialog-error', '资料版本或任务状态已变化，请关闭此窗口并刷新新版本状态。'); return;
    }
    let file;
    if (intent.kind === 'replacement-upload') {
      try { file = validateReplacementUpload($('replacement-file').files[0], item.document_type); }
      catch (error) { notice('dialog-error', messageFor(error)); return; }
    }
    mutate(() => intent.kind === 'replacement-upload' ? replacementSession.upload(item, file) : replacementSession.index(item), done => {
      if (!done) { notice('dialog-error', replacementSession.value.error ? messageFor(replacementSession.value.error) : '状态已变化，请刷新后核对。'); return; }
      closeDialog(); renderDetailReplacement();
    }, 'dialog-error');
  } else if (intent.kind === 'upload') {
    if (!ingestionEnabled()) return;
    let file;
    const uploadKind = $('upload-kind').value;
    try { file = validateUpload($('upload-file').files[0], config, uploadKind); }
    catch (error) { notice('dialog-error', messageFor(error)); return; }
    const controller = new AbortController();
    controllers.set('upload', controller);
    mutate(async () => {
      try {
        const result = await api(uploadKind === 'video-av' ? '/v1/video-av-documents' : uploadKind === 'sound' ? '/v1/sound-documents' : `/v1/documents?filename=${encodeURIComponent(file.name)}`, { method: 'POST', file, uploadKind, signal: controller.signal });
        return uploadKind === 'video-av' ? await checkedVideoAvUpload(result, file) : uploadKind === 'sound' ? await checkedSoundUpload(result, file) : result;
      }
      finally { if (controllers.get('upload') === controller) controllers.delete('upload'); }
    }, async result => {
      const task = ['sound', 'video-av'].includes(uploadKind) ? null : checkedTask(result);
      closeDialog();
      $('filters').reset();
      folderId = ''; page = 1;
      resetContext();
      if (['sound', 'video-av'].includes(uploadKind)) {
        feedback(uploadKind === 'video-av' ? '原视频资料已保存' : '原声音资料已保存', [{ ok: true, detail: uploadKind === 'video-av' ? '可在详情显式建立原视频音画索引。保存原文件不会调用转录或音画模型。' : '可在资料详情显式建立声音索引。保存原文件不会调用转录或声音模型。' }]);
        navigate('documents');
        await loadData();
        openDetail(result.document_id);
        return;
      }
      watchTask(task, 'ingestion');
      feedback('上传任务已创建', [{ ok: true, detail: '原文件已接收，正在等待解析；这不是索引或问答完成。' }]);
      navigate('tasks');
      $('task-heading').focus();
      return loadData();
    }, 'dialog-error');
  } else if (intent.kind === 'synopsis-create') {
    const item = synopsisDocument();
    if (currentView !== 'documents' || !synopsisEnabled(config) || !canGenerateSynopsis(item) || !synopsisSession.matches(item)
      || item.document_id !== intent.documentId || item.index_publication_id !== intent.publicationId) {
      notice('dialog-error', '资料或权限已变化，请回到当前详情核对。'); return;
    }
    closeDialog(); synopsisSession.create(item);
  } else if (intent.kind === 'index-create') {
    const item = state.items.find(row => row.document_id === intent.documentId);
    if (!canStartIndexing(config, item)) { notice('dialog-error', '资料状态已变化，请刷新列表后核对当前索引任务。'); return; }
    mutate(() => api(`/v1/documents/${encodeURIComponent(item.document_id)}/index`, { method: 'POST' }), result => {
      const task = checkedIndexTask(result);
      if (task.document_id !== item.document_id || task.revision_id !== item.latest_job?.revision_id || task.attempt !== 1) throw new Error('invalid index creation result');
      closeDialog();
      watchTask(task, 'indexing');
      state.commitIndexTask(state.beginRead('indexing'), task);
      navigate('tasks');
      $('task-heading').focus();
      return loadDocuments({ preserveDetail: true });
    }, 'dialog-error');
  } else if (intent.kind === 'index-rebuild') {
    const item = state.items.find(row => row.document_id === intent.documentId);
    if (intent.epoch !== state.epoch || !canReindex(item) || item.index_publication_id !== intent.publicationId
      || item.latest_job.revision_id !== intent.revisionId || (item.latest_index_job?.task_id ?? null) !== intent.latestTaskId) {
      notice('dialog-error', '资料、权限或发布版本已变化，请刷新列表后重新核对。'); return;
    }
    mutate(async () => {
      try {
        const result = await api(`/v1/documents/${encodeURIComponent(item.document_id)}/reindex`, {
          method: 'POST', body: { base_publication_id: intent.publicationId },
        });
        const task = checkedIndexTask(result);
        if (task.document_id !== intent.documentId || task.revision_id !== intent.revisionId
          || task.task_id === intent.latestTaskId || task.attempt !== 1) throw new Error('invalid rebuild creation result');
        return task;
      } catch (error) {
        if (intent.epoch === state.epoch) reindexNeedsRefresh.add(intent.documentId);
        throw new ApiError(error instanceof ApiError ? error.status : 502, `${messageFor(error)} 请关闭确认框并刷新资料/索引任务核对结果；不会自动重试。`, { errorCode: error?.errorCode, field: error?.field });
      }
    }, task => {
      closeDialog(); watchTask(task, 'indexing');
      state.commitIndexTask(state.beginRead('indexing'), task);
      navigate('tasks'); $('task-heading').focus();
      return loadDocuments({ preserveDetail: true });
    }, 'dialog-error');
  } else if (intent.kind === 'batch-reindex') {
    if (intent.epoch !== state.epoch || currentView !== 'documents' || loading || !batchReindexEnabled()
      || !intent.entries.length || state.selected.size !== intent.selectionIds.length
      || intent.selectionIds.some(id => !state.selected.has(id))
      || intent.entries.some(entry => {
        const item = state.items.find(row => row.document_id === entry.documentId);
        return !canReindex(item) || reindexFingerprint(item) !== entry.fingerprint;
      })) {
      notice('dialog-error', '选择、资料资格、发布版本或任务已变化，请关闭确认框并刷新列表后重新核对。'); return;
    }
    const ids = intent.entries.map(entry => entry.documentId);
    const body = { action: 'reindex', document_ids: ids,
      base_publication_ids: Object.fromEntries(intent.entries.map(entry => [entry.documentId, entry.publicationId])) };
    mutate(async () => {
      for (const id of ids) reindexNeedsRefresh.add(id);
      try { return checkedBatchReindexItems(intent.entries, await api('/v1/management/document-actions', { method: 'POST', body })); }
      catch (error) {
        throw new ApiError(error instanceof ApiError ? error.status : 502,
          `${messageFor(error)} 本次提交的全部资料均需先刷新资料和索引任务核对结果；不会自动重试。`,
          { errorCode: error?.errorCode, field: error?.field });
      }
    }, async items => {
      closeDialog();
      const accepted = items.filter(item => item.ok);
      for (const item of accepted) state.select(item.document_id, false);
      const labels = new Map(intent.entries.map(entry => [entry.documentId, entry.label]));
      feedback(`已创建 ${accepted.length} 个后台任务；${items.length - accepted.length} 项未创建或待核对；${intent.excluded.length} 项未提交`,
        items.map(item => ({ ...item, detail: `${labels.get(item.document_id)}：${item.detail}` })));
      for (const entry of intent.excluded) $('feedback-items').append(element('li', `未提交 · ${entry.label}：${entry.reason}`));
      if (accepted.length) {
        const entry = element('li');
        entry.append(button('查看当前页索引任务', () => {
          if (intent.epoch !== state.epoch || !connected || loading || state.mutating || !indexingEnabled()) return;
          const current = state.items.find(item => accepted.some(result => result.document_id === item.document_id)
            && item.latest_index_job && item.latest_index_job.revision_id === intent.entries.find(value => value.documentId === item.document_id)?.revisionId
            && item.latest_index_job.task_id !== intent.entries.find(value => value.documentId === item.document_id)?.latestTaskId);
          if (current) openTask(current, 'indexing');
          else notice('global-error', '请先刷新资料列表，再从资料行或详情打开索引任务。');
        }));
        $('feedback-items').append(entry);
      }
      await loadDocuments({ preserveDetail: true });
    }, 'dialog-error');
  } else if (intent.kind === 'index-retry') {
    const current = currentTask();
    if (taskKind !== 'indexing' || !indexingEnabled() || !current?.can_retry || current.task_id !== intent.task.task_id || current.attempt !== intent.task.attempt) {
      notice('dialog-error', '任务状态已变化，请刷新任务后核对。'); return;
    }
    submitTaskAction('retry', current, 'dialog-error');
  } else if (intent.kind === 'cleanup') {
    if (!cleanupEnabled(config) || intent.epoch !== state.epoch) return;
    if (!intent.batch && !intent.fromRecord && !canRequestCleanup(state.items.find(item => item.document_id === intent.ids[0]))) { notice('dialog-error', '资料权限已变化，请刷新后核对。'); return; }
    mutate(() => intent.batch ? cleanupSession.requestBatch(intent.ids) : cleanupSession.requestOne(intent.ids[0]), async result => {
      if (!result) return;
      closeDialog();
      const items = intent.batch ? result.items : [{document_id: result.document_id, status: 'accepted', cleanup: result}];
      const accepted = items.filter(item => item.status === 'accepted').map(item => item.document_id);
      if (accepted.includes(state.detail?.document_id)) { stopDetailMedia(); originalSession.close(); stopSynopsisMedia(); synopsisSession.close(); state.closeDetail(); detailBaseline = null; renderDetails(); }
      if (accepted.length) answerSession.reset(); resetRetrieval();
      state.selectPage(false);
      feedback('清理请求结果', items.map(item => ({ok: item.status === 'accepted', detail: `${item.document_id}：${item.status === 'accepted' ? cleanupLabel(item.cleanup) : item.status === 'busy' ? '资料仍在处理，本次未撤下' : '资料不存在或当前无管理权限'}`})));
      await loadData(); renderCleanupRecords();
    }, 'dialog-error');
  } else if (intent.kind === 'batch') {
    let body;
    try { body = { document_ids: intent.ids, action: intent.action, ...(intent.action === 'move' ? { folder_id: $('dialog-folder').value || null } : { tags: checkedTags($('dialog-tags').value, true) }) }; }
    catch (error) { notice('dialog-error', messageFor(error)); return; }
    mutate(() => api('/v1/management/document-actions', { method: 'POST', body }), result => {
      const report = batchFeedback(intent.ids, result?.items);
      closeDialog();
      state.selectPage(false);
      feedback(`批量结果：${report.succeeded} 项成功，${report.failed} 项失败`, report.items.map(item => ({ ...item, detail: `${intent.labels.get(item.document_id) ?? item.document_id}：${item.detail}` })));
      return loadData();
    }, 'dialog-error');
  } else {
    const path = intent.kind === 'create' ? '/v1/management/folders' : `/v1/management/folders/${encodeURIComponent(intent.folder.folder_id)}`;
    const method = intent.kind === 'create' ? 'POST' : intent.kind === 'rename' ? 'PATCH' : 'DELETE';
    const body = intent.kind === 'remove' ? undefined : { name: $('dialog-name').value.trim() };
    mutate(() => api(path, { method, body }), () => {
      closeDialog();
      if (intent.kind === 'remove' && folderId === intent.folder.folder_id) { folderId = ''; page = 1; resetContext(); }
      feedback('目录操作已完成', [{ ok: true, detail: intent.kind === 'remove' ? '空目录已删除，资料未删除。' : '目录名称已保存。' }]);
      return loadData();
    }, 'dialog-error');
  }
});

$('dialog-cancel').addEventListener('click', () => { if (!state.mutating) closeDialog(); });
$('edit-dialog').addEventListener('cancel', event => { if (state.mutating) event.preventDefault(); else dialogIntent = null; });
$('new-folder').addEventListener('click', () => folderDialog('create'));
function showUpload() {
  if (!ingestionEnabled()) return;
  const input = element('input'); input.id = 'upload-file'; input.type = 'file'; input.required = true;
  const mode = imageUploadMode(config);
  const kind = element('select'); kind.id = 'upload-kind';
  const uploadHelp = element('p', '', 'help-text');
  const choices = [['document', '文档 / 图片', config.capabilities.includes('text_upload') || !!mode], ['audio', '音频转录', config.capabilities.includes('audio_upload')], ['sound', '声音理解（含无语音音频）', soundEnabled(config)], ['video', '视频画面 / 语音转录', config.capabilities.includes('video_upload')], ['video-av', '原视频音画（含非语音声音）', videoAvEnabled(config)]];
  for (const [value, label, enabled] of choices) if (enabled) kind.append(new Option(label, value));
  kind.value = choices.find(([, , enabled]) => enabled)[0];
  const updateAccept = () => {
    input.value = '';
    input.accept = ['audio', 'sound'].includes(kind.value) ? '.wav,.mp3,.flac,.ogg,.m4a,.mp4,.webm' : ['video', 'video-av'].includes(kind.value) ? '.mp4,.mov,.webm,.mkv'
      : [config.capabilities.includes('text_upload') ? '.pdf,.txt,.md,application/pdf,text/plain,text/markdown' : '', mode ? '.png,.jpg,.jpeg,image/png,image/jpeg' : ''].filter(Boolean).join(',');
    uploadHelp.textContent = kind.value === 'video-av' ? '只保存原视频，不调用转录或音画模型。保存后在详情显式建立连续画面与原声索引。' : kind.value === 'sound' ? '只保存原声音资料，不调用转录或声音模型。保存后在详情显式建立声音索引，再用声音理解提问。' : '上传后查看解析任务，再显式建立索引。资料与原文件按当前身份保存。';
    $('dialog-submit').textContent = kind.value === 'video-av' ? '保存原视频资料' : kind.value === 'sound' ? '保存原声音资料' : '上传并解析';
  };
  kind.addEventListener('change', updateAccept); updateAccept();
  const imageHelp = mode === 'visual' ? '图片按原图视觉处理，会发送到服务器配置的视觉模型，可能产生费用；画面文字不会自动转为OCR证据。' : mode === 'ocr' ? '图片使用服务器OCR识别文字，提问时请选择文字证据模式。' : '';
  const mediaHelp = choices.slice(1).some(([, , enabled]) => enabled) ? '音视频最多20MiB，请按素材类型选择，MP4/WebM不会自动判为视频。处理会使用服务器配置的转录或视觉模型，可能产生费用。' : '';
  const pdfHelp = config.capabilities.includes('pdf_ocr_upload') ? 'PDF使用服务器本机逐页OCR识别整页画面，支持扫描件；识别结果请按原页核对。' : '';
  showDialog('上传资料', `文本支持PDF/TXT/Markdown，最多20MiB。${pdfHelp}${mode ? '图片支持PNG/JPEG，最多10MiB、1200万像素。' : ''}${imageHelp}${mediaHelp}`, [field('资料类型', kind), field('选择原文件', input), uploadHelp], { kind: 'upload' }, kind.value === 'video-av' ? '保存原视频资料' : kind.value === 'sound' ? '保存原声音资料' : '上传并解析');
}
$('upload').addEventListener('click', showUpload);
$('task-refresh').addEventListener('click', () => { taskPollPaused = false; notice('task-error'); loadTask(); });
$('task-cancel').addEventListener('click', () => taskAction('cancel'));
$('task-retry').addEventListener('click', () => taskAction('retry'));
$('task-dismiss').addEventListener('click', () => watchTask(null));
$('batch-move').addEventListener('click', () => batchDialog('move'));
$('batch-tag').addEventListener('click', () => batchDialog('tag'));
$('batch-reindex').addEventListener('click', batchReindexDialog);
$('batch-cleanup').addEventListener('click', () => cleanupDialog([...state.selected], true));
$('cleanup-refresh').addEventListener('click', () => { if (connected && cleanupEnabled(config)) cleanupSession.loadPage(); });
$('cleanup-stop').addEventListener('click', () => cleanupSession.stop());
$('cleanup-previous').addEventListener('click', () => { if (connected && cleanupEnabled(config)) cleanupSession.loadPage(cleanupSession.value.page - 1); });
$('cleanup-next').addEventListener('click', () => { if (connected && cleanupEnabled(config)) cleanupSession.loadPage(cleanupSession.value.page + 1); });
$('batch-ask').addEventListener('click', () => openAnswers([...state.selected]));
$('answer-all').addEventListener('click', () => openAnswers());
$('answer-question').addEventListener('input', () => { voiceQuestionSession.reset(); answerSession.reset(); resetRetrieval(); });
$('answer-mode').addEventListener('change', () => {
  answerMode = ['knowledge', 'text', 'visual', ...mediaModes].includes($('answer-mode').value) ? $('answer-mode').value : 'knowledge';
  voiceQuestionSession.reset();
  answerSession.reset(); resetRetrieval();
});
$('answer-attachment-kind').addEventListener('change', () => {
  $('answer-attachment-files').value = ''; renderAnswerControls();
});
$('answer-attachment-files').addEventListener('change', () => {
  const input = $('answer-attachment-files');
  if (!connected || !answersEnabled(config, answerMode) || !currentQueryAttachmentsEnabled() || answerSession.value.phase === 'loading') { input.value = ''; return; }
  try {
    const additions = Array.from(input.files ?? []).map(file => ({ file, kind: $('answer-attachment-kind').value }));
    if (!additions.length) return;
    queryAttachments = checkedQueryAttachments([...queryAttachments, ...additions]);
    queryAttachmentError = ''; answerSession.reset(); resetRetrieval();
  } catch (error) { queryAttachmentError = messageFor(error); renderAnswerControls(); }
  finally { input.value = ''; }
});
$('answer-attachment-clear').addEventListener('click', clearQueryAttachments);
globalThis.addEventListener?.('pagehide', () => { modelRebuildSession.close(); modelSession.close(); resetRetrieval(); answerCapabilityRefresh = null; cleanupSession.close(); voiceQuestionSession.reset(); clearQueryAttachments(); stopSynopsisMedia(); synopsisSession.close(); tagSuggestionSession.close(); imageVectorSession.close(); audioVectorSession.close(); soundIndexSession.close(); videoAvIndexSession.close(); replacementSession.close(); });
$('answer-voice-file').addEventListener('change', () => {
  const input = $('answer-voice-file');
  if (!connected || !voiceQuestionsEnabled(config) || !answersEnabled(config, answerMode) || answerSession.value.phase === 'loading' || voiceQuestionSession.value.phase === 'loading') { input.value = ''; return; }
  try {
    const files = Array.from(input.files ?? []);
    if (files.length !== 1) { voiceQuestionSession.reset(); throw new ApiError(422, '请选择一个语音文件。'); }
    voiceQuestionSession.select(files[0]);
  } catch (error) { notice('answer-voice-error', messageFor(error)); }
  finally { input.value = ''; }
});
$('answer-voice-transcribe').addEventListener('click', () => {
  if (currentView !== 'answers' || !connected || !voiceQuestionsEnabled(config) || !answersEnabled(config, answerMode) || answerSession.value.phase === 'loading' || voiceQuestionSession.value.phase === 'loading' || !voiceQuestionSession.value.filename) return;
  voiceQuestionSession.transcribe();
});
$('answer-voice-text').addEventListener('input', () => voiceQuestionSession.edit($('answer-voice-text').value));
$('answer-voice-use').addEventListener('click', () => {
  if (currentView !== 'answers' || answerSession.value.phase === 'loading') return;
  try {
    const question = voiceQuestionSession.confirm();
    $('answer-question').value = question;
    voiceQuestionSession.reset(); answerSession.reset(); resetRetrieval(); $('answer-question').focus();
  } catch (error) { notice('answer-voice-error', messageFor(error)); }
});
$('answer-voice-cancel').addEventListener('click', () => {
  const waiting = voiceQuestionSession.value.phase === 'loading';
  voiceQuestionSession.cancel(); $('answer-voice-file').value = '';
  if (waiting) $('answer-voice-status').textContent = '已停止本地等待；服务器转录可能仍在进行，不会自动重试。';
});
$('answer-cancel').addEventListener('click', () => { answerSession.cancel(); $('answer-status').textContent = '已停止本地等待；服务器处理可能仍在进行，不会自动重试。'; });
document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('.row-menu[open], .library-tools[open]')) if (!menu.contains(event.target)) menu.open = false;
  for (const disclosure of [$('chat-options'), document.querySelector('.chat-scope')]) {
    if (disclosure.open && !disclosure.contains(event.target)) disclosure.open = false;
  }
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || $('source-panel').open) return;
  for (const menu of document.querySelectorAll('.row-menu[open], .library-tools[open]')) { menu.open = false; menu.querySelector('summary').focus(); }
  for (const disclosure of [$('chat-options'), document.querySelector('.chat-scope')]) {
    if (disclosure.open) { disclosure.open = false; disclosure.querySelector('summary').focus(); }
  }
});
$('source-close').addEventListener('click', () => answerSession.closeSource());
$('source-panel').addEventListener('cancel', event => { event.preventDefault(); answerSession.closeSource(); });
$('answer-new').addEventListener('click', () => {
  voiceQuestionSession.reset(); clearQueryAttachments(); answerSession.reset(); resetRetrieval();
  $('answer-question').value = ''; $('chat-question-text').textContent = '';
  $('chat-options').open = false; renderAnswerControls(); $('answer-question').focus();
});
$('answer-question').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    if (!$('answer-submit').disabled) $('answer-form').requestSubmit();
  }
});
$('answer-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!connected || !answersEnabled(config, answerMode) || answerCapabilityRefresh || answerCapabilityError || answerSession.value.phase === 'loading' || voiceQuestionSession.value.phase === 'loading') return;
  $('chat-question-text').textContent = $('answer-question').value;
  $('chat-options').open = false;
  document.querySelector('.chat-scope').open = false;
  await answerSession.ask($('answer-question').value, answerScope, answerMode, queryAttachments);
  if (currentView === 'answers' && answerSession.value.result) $('answer-result-heading').focus();
});
$('dismiss-feedback').addEventListener('click', clearFeedback);
$('close-detail').addEventListener('click', () => closeDetailPanel());
$('details').addEventListener('cancel', event => { event.preventDefault(); closeDetailPanel(); });
$('toggle-filters').addEventListener('click', () => {
  const expanded = $('advanced-filters').hidden;
  $('advanced-filters').hidden = !expanded;
  $('toggle-filters').setAttribute('aria-expanded', String(expanded));
});
for (const kind of ['all', 'ingestion', 'indexing']) $(`tasks-${kind}`).addEventListener('click', () => {
  taskFilter = kind;
  for (const key of ['all', 'ingestion', 'indexing']) $(`tasks-${key}`).setAttribute('aria-pressed', String(key === kind));
  renderTaskList();
});
$('tasks-refresh').addEventListener('click', () => {
  if (!connected || loading || state.mutating) return;
  if (currentTask()) { taskPollPaused = false; notice('task-error'); loadTask(); }
  loadData({ preserveDetail: true });
});
$('reconnect').addEventListener('click', async () => {
  if (state.mutating || state.identityPending || !allowDetailLeave()) return;
  $('reconnect').disabled = true;
  connected = false;
  resetContext({ identity: true });
  try { await start(); } finally { $('reconnect').disabled = false; }
});
$('refresh').addEventListener('click', () => { if (!allowDetailLeave()) return; resetContext(); loadData(); });
$('select-page').addEventListener('change', event => {
  state.selectPage(event.target.checked);
  for (const input of document.querySelectorAll('input[data-document-id]')) input.checked = state.selected.has(input.dataset.documentId);
  renderControls();
});
$('clear-selection').addEventListener('click', () => { state.selectPage(false); renderRows(); renderControls(); });
$('search').addEventListener('input', () => changeFilter({ delayed: true }));
$('filters').addEventListener('submit', event => { event.preventDefault(); changeFilter(); });
for (const id of ['type', 'status', 'tag', 'sort', 'page-size']) $(id).addEventListener('change', () => changeFilter());
$('clear-filters').addEventListener('click', () => { if (!allowDetailLeave()) return; detailBaseline = null; $('filters').reset(); folderId = ''; changeFilter(); renderFolders(); });
for (const [id, delta] of [['previous-page', -1], ['next-page', 1]]) $(id).addEventListener('click', () => { if (!allowDetailLeave()) return; page += delta; resetContext(); loadData(); });

$('principal').addEventListener('input', () => {
  connected = false;
  resetContext({ identity: true });
  $('identity-status').textContent = '身份已修改，点击“切换身份”重新加载授权资料。';
});
$('dev-identity').addEventListener('submit', event => {
  event.preventDefault();
  principal = $('principal').value.trim();
  if (!principal || !config) return;
  page = 1;
  connected = true;
  resetContext({ identity: true });
  $('identity-status').textContent = `开发身份：${principal} · 组织：${config.workspace_id}`;
  loadData();
});
$('jwt-identity').addEventListener('submit', async event => {
  event.preventDefault();
  const token = $('token').value.trim();
  if (!token || !config || !state.beginIdentityChange()) return;
  $('token').value = '';
  connected = false;
  page = 1;
  resetContext({ identity: true });
  const ticket = state.beginRead('identity');
  $('identity-status').textContent = '正在由服务器校验凭证…';
  try {
    const result = await api('/v1/session', { method: 'POST', body: { token } });
    if (!state.isCurrent(ticket)) return;
    connected = true;
    $('identity-status').textContent = `会话身份：${result.principal_id} · 组织：${result.workspace_id}`;
    await loadData();
  } catch (error) { if (state.isCurrent(ticket)) notice('global-error', messageFor(error)); }
  finally { state.finishIdentityChange(); renderControls(); }
});
$('sign-out').addEventListener('click', async () => {
  if (!state.beginIdentityChange()) return;
  connected = false;
  $('token').value = '';
  resetContext({ identity: true });
  const ticket = state.beginRead('identity');
  $('identity-status').textContent = '正在退出会话…';
  try {
    await api('/v1/session', { method: 'DELETE' });
    if (state.isCurrent(ticket)) $('identity-status').textContent = '会话已退出；凭证只由 HttpOnly Cookie 管理。';
  } catch (error) { if (state.isCurrent(ticket)) notice('global-error', '服务端退出尚未确认，请重试退出后再离开。'); }
  finally { state.finishIdentityChange(); renderControls(); }
});

async function start() {
  try {
    config = await api('/v1/config');
    if (!['development_headers', 'jwt'].includes(config?.auth_mode) || !config.capabilities?.includes('management')) throw new Error('unsupported config');
    api = createApi(config, () => principal);
    renderScopeSummary();
    $('dev-identity').hidden = config.auth_mode !== 'development_headers';
    $('jwt-identity').hidden = config.auth_mode !== 'jwt';
    connected = true;
    renderAnswers();
    $('identity-status').textContent = config.auth_mode === 'development_headers' ? `开发身份：${principal} · 组织：${config.workspace_id}` : `组织：${config.workspace_id} · 会话身份由服务器校验`;
    renderFolders();
    await loadData();
    if (currentView === 'settings' && modelConfigurationEnabled(config)) loadModelSettings();
  } catch (error) {
    connected = false;
    notice('global-error', messageFor(error));
    $('identity-status').textContent = '无法读取 Java 服务配置。请确认服务就绪后刷新页面。';
    renderControls();
  }
}

if (globalThis.location) initNavigation();
start();
