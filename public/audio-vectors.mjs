import { ApiError } from './api.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const invalid = () => new ApiError(502, '原声向量结果与当前资料、版本或模型配置不一致，请刷新后核对。');
const idle = () => ({ phase: 'idle', vector: null, error: null });
const identity = row => JSON.stringify([row?.document_id, row?.index_publication_id, row?.active_revision_id,
  row?.document_type, row?.index_status, row?.synthetic_fixture, row?.can_edit, row?.media_info]);
const fields = ['status', 'document_id', 'publication_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint',
  'model_revision', 'dimensions', 'vector_generation_id', 'manifest_sha256'];

export function audioVectorsEnabled(config) {
  return ['audio_vector_retrieval', 'audio_answers', 'audio_sources'].every(name => config?.capabilities?.includes(name));
}

function expected(row) {
  if (!row || row.synthetic_fixture !== false || row.document_type !== 'audio' || row.index_status !== 'indexed'
    || !id(row.document_id) || !id(row.index_publication_id) || !id(row.active_revision_id)
    || !['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'].includes(row.media_info?.mime_type) || !hash(row.media_info.sha256)
    || !Number.isSafeInteger(row.media_info.size_bytes) || row.media_info.size_bytes < 1 || row.media_info.size_bytes > 20 * 1024 * 1024
    || typeof row.can_edit !== 'boolean') throw invalid();
  return { document_id: row.document_id, publication_id: row.index_publication_id, source_revision_id: row.active_revision_id,
    source_sha256: row.media_info.sha256 };
}

export function canReadAudioVector(row) {
  try { expected(row); return true; } catch { return false; }
}

function checked(value, wanted, previous = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length
    || fields.some(key => !Object.hasOwn(value, key)) || Object.entries(wanted).some(([key, expectedValue]) => value[key] !== expectedValue)
    || !['missing', 'available'].includes(value.status) || !hash(value.profile_fingerprint)
    || typeof value.model_revision !== 'string' || !value.model_revision.trim() || [...value.model_revision].length > 200
    || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value.model_revision)
    || !Number.isSafeInteger(value.dimensions) || value.dimensions < 2 || value.dimensions > 3072
    || (value.status === 'missing' ? value.vector_generation_id !== null || value.manifest_sha256 !== null
      : !id(value.vector_generation_id) || !hash(value.manifest_sha256))
    || (previous && (value.status !== 'available' || ['profile_fingerprint', 'model_revision', 'dimensions'].some(key => value[key] !== previous[key])))) throw invalid();
  return Object.freeze(Object.fromEntries(fields.map(key => [key, value[key]])));
}

/** Explicit build of a saved original audio; local cancellation never promises upstream rollback. */
export class AudioVectorSession {
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

  async open(row) {
    const wanted = expected(row);
    if (this.matches(row) && ['loading', 'building'].includes(this.value.phase)) return;
    this.close(); this.identity = identity(row);
    const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ ...idle(), phase: 'loading' });
    try {
      const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/audio-vector`, { signal: controller.signal });
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
      const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/audio-vector`, { method: 'POST', signal: controller.signal });
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'ready', vector: checked(result, wanted, vector) });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (serial === this.serial) this.controller = null; }
  }
}
