import { ApiError, validateReplacementUpload } from './api.mjs';
import { checkedTask, checkedIndexTask } from './workbench-state.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const fields = ['document_id', 'base_revision_id', 'base_publication_id', 'candidate_revision_id', 'pipeline', 'state',
  'filename', 'document_type', 'media_type', 'source_sha256', 'size_bytes', 'ingestion_task', 'index_task', 'can_upload', 'can_index', 'publication_id'];
const types = { document: ['application/pdf', 'text/plain', 'text/markdown'], image: ['image/png', 'image/jpeg'],
  audio: ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'] };
const labels = { none: '尚无新版本', stored: '新版本待索引', queued: '新版本等待解析', processing: '正在解析新版本',
  parsed: '新版本待索引', indexing: '正在建立新版本索引', published: '新版本已发布', failed: '新版本处理失败', cancelled: '新版本任务已取消' };
const pending = value => ['queued', 'processing', 'indexing'].includes(value?.state);
const idle = () => ({ phase: 'idle', replacement: null, error: null });
const invalid = () => new ApiError(502, '新版本状态与当前资料不一致，请刷新资料后核对。');
const revision = row => row?.active_revision_id ?? row?.latest_job?.revision_id ?? row?.registered_revision_id;
const identity = row => JSON.stringify([row?.document_id, revision(row), row?.index_publication_id ?? null,
  row?.document_type, row?.media_info?.sha256, row?.synthetic_fixture]);

export function replacementsEnabled(config) { return config?.capabilities?.includes('document_replacements') === true; }
export function replacementLabel(value) { return labels[value?.state] ?? '状态待核对'; }
export function replacementAccept(type) {
  return { document: '.pdf,.txt,.md', image: '.png,.jpg,.jpeg', audio: '.wav,.mp3,.flac,.ogg,.m4a,.mp4,.webm', video: '.mp4,.mov,.webm,.mkv' }[type] ?? '';
}

function expected(row) {
  if (!id(row?.document_id) || !id(revision(row)) || !Object.hasOwn(types, row?.document_type)
    || row.synthetic_fixture !== false || typeof row.can_edit !== 'boolean') throw invalid();
  return { documentId: row.document_id, baseRevisionId: revision(row), publicationId: row.index_publication_id ?? null, documentType: row.document_type };
}

function checked(value, wanted) {
  if (!value || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))
    || value.document_id !== wanted.documentId || !id(value.base_revision_id) || !Object.hasOwn(labels, value.state)
    || !['corpus', 'sound', 'video_av'].includes(value.pipeline)
    || (value.state === 'none' ? value.document_type !== null && value.document_type !== wanted.documentType : value.document_type !== wanted.documentType)
    || typeof value.can_upload !== 'boolean' || typeof value.can_index !== 'boolean'
    || (value.base_publication_id !== null && !id(value.base_publication_id))
    || (value.publication_id !== null && !id(value.publication_id))) throw invalid();
  const stillBase = value.base_revision_id === wanted.baseRevisionId && value.base_publication_id === wanted.publicationId;
  const nowPublished = value.state === 'published' && value.candidate_revision_id === wanted.baseRevisionId && value.publication_id === wanted.publicationId;
  if (!stillBase && !nowPublished) throw invalid();
  if (value.state === 'none') {
    if (['candidate_revision_id', 'filename', 'media_type', 'source_sha256', 'size_bytes', 'ingestion_task', 'index_task', 'publication_id'].some(key => value[key] !== null)
      || value.can_index) throw invalid();
  } else if (!id(value.candidate_revision_id) || value.candidate_revision_id === value.base_revision_id
    || typeof value.filename !== 'string' || !value.filename.trim() || value.filename.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(value.filename)
    || !types[value.document_type].includes(value.media_type) || !hash(value.source_sha256)
    || !Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1 || value.size_bytes > (value.document_type === 'image' ? 10 : 20) * 1024 * 1024
    || (value.state === 'published' ? !id(value.publication_id) : value.publication_id !== null)) throw invalid();
  const result = { ...value };
  try {
    for (const [key, checker] of [['ingestion_task', checkedTask], ['index_task', checkedIndexTask]]) {
      if (value[key] !== null) {
        result[key] = checker(value[key]);
        if (result[key].document_id !== value.document_id || result[key].revision_id !== value.candidate_revision_id) throw invalid();
      }
    }
  } catch { throw invalid(); }
  return Object.freeze(result);
}

/** A candidate has its own lifecycle; it never rewrites the current management row or task slot. */
export class DocumentReplacementSession {
  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {}, onPublished = () => {},
    setTimer = (callback, delay) => setTimeout(callback, delay), clearTimer = timer => clearTimeout(timer) } = {}) {
    this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure; this.onPublished = onPublished;
    this.setTimer = setTimer; this.clearTimer = clearTimer; this.value = idle(); this.serial = 0;
    this.identity = null; this.controller = null; this.timer = null; this.notifiedPublication = null;
  }
  matches(row) { return this.identity === identity(row); }
  emit(value) { this.value = value; this.onChange(); }
  close() {
    this.serial++; this.controller?.abort(); this.controller = null; this.clearTimer(this.timer); this.timer = null;
    this.identity = null; this.notifiedPublication = null;
    if (this.value.phase !== 'idle') this.emit(idle());
  }
  async open(row) {
    expected(row);
    if (!this.matches(row)) { this.close(); this.identity = identity(row); }
    if (this.controller) return false;
    return this.perform(row, 'loading');
  }
  async upload(row, file) {
    const wanted = expected(row), current = this.value.replacement;
    if (!this.matches(row) || this.value.phase !== 'ready' || current?.can_upload !== true) return false;
    if (current.state === 'published' && (current.candidate_revision_id !== wanted.baseRevisionId || current.publication_id !== wanted.publicationId)) return false;
    validateReplacementUpload(file, wanted.documentType);
    return this.perform(row, 'uploading', { method: 'POST', file, replacement: wanted },
      `?filename=${encodeURIComponent(file.name)}&base_revision_id=${wanted.baseRevisionId}`);
  }
  async index(row) {
    const wanted = expected(row), current = this.value.replacement;
    if (!this.matches(row) || this.value.phase !== 'ready' || current?.can_index !== true) return false;
    return this.perform(row, 'indexing', { method: 'POST', body: {
      candidate_revision_id: current.candidate_revision_id, base_revision_id: wanted.baseRevisionId,
    } }, '/index');
  }
  async perform(row, phase, options = {}, suffix = '') {
    if (this.controller) return false;
    const wanted = expected(row), serial = ++this.serial, controller = new AbortController();
    this.clearTimer(this.timer); this.timer = null; this.controller = controller;
    this.emit({ ...this.value, phase, error: null });
    let value;
    try {
      const result = await this.request(`/v1/documents/${wanted.documentId}/replacement${suffix}`, { ...options, signal: controller.signal });
      if (serial !== this.serial) return false;
      value = checked(result, wanted);
      if (options.file && (value.filename !== options.file.name || value.size_bytes !== options.file.size)) throw invalid();
      this.emit({ phase: 'ready', replacement: value, error: null });
    } catch (error) {
      if (serial !== this.serial) return false;
      this.emit({ ...this.value, phase: options.method === 'POST' ? 'unknown' : 'error', error });
      if (error?.status === 401) this.onAuthenticationFailure(error);
      return false;
    } finally { if (serial === this.serial) this.controller = null; }
    if (serial !== this.serial) return false;
    if (pending(value)) this.timer = this.setTimer(() => { this.timer = null; if (serial === this.serial) this.open(row); }, 1500);
    if (value.state === 'published' && value.publication_id !== wanted.publicationId && this.notifiedPublication !== value.publication_id) {
      this.notifiedPublication = value.publication_id;
      this.onPublished(value);
    }
    return true;
  }
}
