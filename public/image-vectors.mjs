import { ApiError } from './api.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const invalid = () => new ApiError(502, '原图向量结果与当前资料、版本或模型配置不一致，请刷新后核对。');
const idle = () => ({ phase: 'idle', vector: null, error: null });
const identity = row => JSON.stringify([row?.document_id, row?.index_publication_id, row?.active_revision_id,
  row?.document_type, row?.index_status, row?.synthetic_fixture, row?.can_edit, row?.media_info]);
const fields = ['status', 'document_id', 'publication_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint',
  'model_revision', 'dimensions', 'vector_generation_id', 'manifest_sha256'];

export function imageVectorsEnabled(config) {
  return ['image_vector_retrieval', 'visual_answers', 'visual_sources'].every(name => config?.capabilities?.includes(name));
}

function expected(row, { allowPublishedDuringReindex = false } = {}) {
  const retainedPublication = allowPublishedDuringReindex === true
    && ['queued', 'processing', 'failed', 'cancelled'].includes(row?.index_status)
    && row?.status === 'parsed' && row.latest_job?.state === 'parsed'
    && row.latest_job.document_id === row.document_id && row.latest_job.revision_id === row.active_revision_id
    && row.latest_index_job?.state === row.index_status && row.latest_index_job.document_id === row.document_id
    && row.latest_index_job.revision_id === row.active_revision_id;
  if (!row || row.synthetic_fixture !== false || row.document_type !== 'image' || (row.index_status !== 'indexed' && !retainedPublication)
    || !id(row.document_id) || !id(row.index_publication_id) || !id(row.active_revision_id)
    || !['image/png', 'image/jpeg'].includes(row.media_info?.mime_type) || !hash(row.media_info.sha256)
    || !Number.isSafeInteger(row.media_info.size_bytes) || row.media_info.size_bytes < 1 || row.media_info.size_bytes > 10 * 1024 * 1024
    || typeof row.can_edit !== 'boolean') throw invalid();
  return { document_id: row.document_id, publication_id: row.index_publication_id, source_revision_id: row.active_revision_id,
    source_sha256: row.media_info.sha256 };
}

export function canReadImageVector(row, options) {
  try { expected(row, options); return true; } catch { return false; }
}

function checked(value, wanted, previous = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
    || fields.some(key => !Object.hasOwn(value, key)) || Object.entries(wanted).some(([key, expectedValue]) => value[key] !== expectedValue)
    || !['missing', 'available'].includes(value.status) || !hash(value.profile_fingerprint)
    || typeof value.model_revision !== 'string' || !value.model_revision.trim() || [...value.model_revision].length > 200
    || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value.model_revision)
    || !Number.isSafeInteger(value.dimensions) || value.dimensions < 2 || value.dimensions > 8192
    || (value.status === 'missing' ? value.vector_generation_id !== null || value.manifest_sha256 !== null
      : !id(value.vector_generation_id) || !hash(value.manifest_sha256))
    || (previous && (value.status !== 'available' || ['profile_fingerprint', 'model_revision', 'dimensions'].some(key => value[key] !== previous[key])))) throw invalid();
  return Object.freeze(Object.fromEntries(fields.map(key => [key, value[key]])));
}

/** Explicit build of a saved original image; local cancellation never promises upstream rollback. */
export class ImageVectorSession {
  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) {
    this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure;
    this.value = idle(); this.serial = 0; this.identity = null; this.controller = null;
  }

  matches(row) { return this.identity === identity(row); }
  emit(value) { this.value = value; this.onChange(); }

  close() {
    this.serial++; this.controller?.abort(); this.controller = null; this.identity = null;
    if (this.value.phase !== 'idle') this.emit(idle());
  }

  async open(row, options) {
    const wanted = expected(row, options);
    if (this.matches(row) && ['loading', 'building'].includes(this.value.phase)) return;
    this.close(); this.identity = identity(row);
    const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ ...idle(), phase: 'loading' });
    try {
      const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/image-vector`, { signal: controller.signal });
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'ready', vector: checked(result, wanted) });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (serial === this.serial) this.controller = null; }
  }

  async build(row) {
    const wanted = expected(row), { phase, vector } = this.value;
    if (!this.matches(row) || row.can_edit !== true || phase !== 'ready' || vector?.status !== 'missing') return;
    const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ ...idle(), phase: 'building', vector });
    try {
      const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/image-vector`, { method: 'POST', signal: controller.signal });
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'ready', vector: checked(result, wanted, vector) });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (serial === this.serial) this.controller = null; }
  }
}
