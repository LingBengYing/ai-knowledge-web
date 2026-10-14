import { ApiError } from './api.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const vectorIdentity = row => JSON.stringify([row?.document_id, row?.index_publication_id, row?.active_revision_id,
  row?.document_type, row?.index_status, row?.synthetic_fixture, row?.media_info]);
const vectorFields = ['status', 'document_id', 'publication_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint',
  'model_revision', 'dimensions', 'vector_generation_id', 'manifest_sha256'];
const idleVector = () => ({ phase: 'idle', vector: null, error: null });

/**
 * Explicit build of the media vector of a saved, published original (image or audio);
 * local cancellation never promises upstream rollback.
 */
export function mediaVectorKind({ endpoint, documentType, mimeTypes, maxBytes, maxDimensions, message }) {
  const invalid = () => new ApiError(502, message);

  function expected(row, { allowPublishedDuringReindex = false } = {}) {
    const retainedPublication = allowPublishedDuringReindex === true
      && ['queued', 'processing', 'failed', 'cancelled'].includes(row?.index_status)
      && row?.status === 'parsed' && row.latest_job?.state === 'parsed'
      && row.latest_job.document_id === row.document_id && row.latest_job.revision_id === row.active_revision_id
      && row.latest_index_job?.state === row.index_status && row.latest_index_job.document_id === row.document_id
      && row.latest_index_job.revision_id === row.active_revision_id;
    if (!row || row.synthetic_fixture !== false || row.document_type !== documentType || (row.index_status !== 'indexed' && !retainedPublication)
      || !id(row.document_id) || !id(row.index_publication_id) || !id(row.active_revision_id)
      || !mimeTypes.includes(row.media_info?.mime_type) || !hash(row.media_info.sha256)
      || !Number.isSafeInteger(row.media_info.size_bytes) || row.media_info.size_bytes < 1 || row.media_info.size_bytes > maxBytes
      || typeof row.can_edit !== 'boolean') throw invalid();
    return { document_id: row.document_id, publication_id: row.index_publication_id, source_revision_id: row.active_revision_id,
      source_sha256: row.media_info.sha256 };
  }

  function canRead(row, options) {
    try { expected(row, options); return true; } catch { return false; }
  }

  function checked(value, wanted, previous = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== vectorFields.length
      || vectorFields.some(key => !Object.hasOwn(value, key)) || Object.entries(wanted).some(([key, expectedValue]) => value[key] !== expectedValue)
      || !['missing', 'available'].includes(value.status) || !hash(value.profile_fingerprint)
      || typeof value.model_revision !== 'string' || !value.model_revision.trim() || [...value.model_revision].length > 200
      || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value.model_revision)
      || !Number.isSafeInteger(value.dimensions) || value.dimensions < 2 || value.dimensions > maxDimensions
      || (value.status === 'missing' ? value.vector_generation_id !== null || value.manifest_sha256 !== null
        : !id(value.vector_generation_id) || !hash(value.manifest_sha256))
      || (previous && (value.status !== 'available' || ['profile_fingerprint', 'model_revision', 'dimensions'].some(key => value[key] !== previous[key])))) throw invalid();
    return Object.freeze(Object.fromEntries(vectorFields.map(key => [key, value[key]])));
  }

  class Session {
    constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) {
      this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure;
      this.value = idleVector(); this.serial = 0; this.identity = null; this.controller = null;
    }

    matches(row) { return this.identity === vectorIdentity(row); }
    emit(value) { this.value = value; this.onChange(); }

    close() {
      this.serial++; this.controller?.abort(); this.controller = null; this.identity = null;
      if (this.value.phase !== 'idle') this.emit(idleVector());
    }

    async open(row, options) {
      const wanted = expected(row, options);
      if (this.matches(row) && ['loading', 'building'].includes(this.value.phase)) return;
      this.close(); this.identity = vectorIdentity(row);
      const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
      this.emit({ ...idleVector(), phase: 'loading' });
      try {
        const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/${endpoint}`, { signal: controller.signal });
        if (serial !== this.serial) return;
        this.emit({ ...idleVector(), phase: 'ready', vector: checked(result, wanted) });
      } catch (error) {
        if (serial !== this.serial) return;
        this.emit({ ...idleVector(), phase: 'error', error });
        if (error?.status === 401) this.onAuthenticationFailure(error);
      } finally { if (serial === this.serial) this.controller = null; }
    }

    async build(row) {
      const wanted = expected(row), { phase, vector } = this.value;
      if (!this.matches(row) || phase !== 'ready' || vector?.status !== 'missing') return;
      const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
      this.emit({ ...idleVector(), phase: 'building', vector });
      try {
        const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/${endpoint}`, { method: 'POST', signal: controller.signal });
        if (serial !== this.serial) return;
        this.emit({ ...idleVector(), phase: 'ready', vector: checked(result, wanted, vector) });
      } catch (error) {
        if (serial !== this.serial) return;
        this.emit({ ...idleVector(), phase: 'error', error });
        if (error?.status === 401) this.onAuthenticationFailure(error);
      } finally { if (serial === this.serial) this.controller = null; }
    }
  }

  return { canRead, Session };
}

const indexIdentity = row => JSON.stringify([row?.document_id, row?.document_type, row?.synthetic_fixture,
  row?.active_revision_id, row?.registered_revision_id, row?.index_publication_id, row?.media_info]);
const idleIndex = () => ({ phase: 'idle', index: null, error: null });

/**
 * Explicit indexing of a complete raw sound or video original, independent of any ASR publication or local waiting.
 * `checkedIndex(value, row, previous)` validates one server receipt for the module's own fields.
 */
export function mediaIndexSession({ endpoint, canRead, checkedIndex, invalid }) {
  return class {
    constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) {
      this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure;
      this.value = idleIndex(); this.serial = 0; this.identity = null; this.controller = null;
    }
    matches(row) { return this.identity === indexIdentity(row); }
    emit(value) { this.value = value; this.onChange(); }
    close() { this.serial++; this.controller?.abort(); this.controller = null; this.identity = null; this.emit(idleIndex()); }
    stop() {
      if (this.value.phase !== 'building') return;
      this.serial++; this.controller?.abort(); this.controller = null;
      this.emit({ phase: 'unknown', index: null, error: null });
    }
    async open(row) {
      if (!canRead(row)) throw invalid();
      if (this.matches(row) && ['loading', 'building'].includes(this.value.phase)) return;
      this.close(); this.identity = indexIdentity(row); const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
      this.emit({ ...idleIndex(), phase: 'loading' });
      try {
        const result = await this.request(`/v1/documents/${encodeURIComponent(row.document_id)}/${endpoint}`, { signal: controller.signal });
        if (serial !== this.serial || !this.matches(row)) return;
        this.emit({ phase: 'ready', index: checkedIndex(result, row), error: null });
      } catch (error) {
        if (serial !== this.serial) return;
        this.emit({ ...idleIndex(), phase: 'error', error }); if (error?.status === 401) this.onAuthenticationFailure(error);
      } finally { if (this.controller === controller) this.controller = null; }
    }
    async build(row) {
      if (!canRead(row) || !this.matches(row) || this.value.phase !== 'ready' || this.value.index?.status !== 'missing') return;
      const previous = this.value.index, serial = ++this.serial, controller = new AbortController(); this.controller = controller;
      this.emit({ phase: 'building', index: previous, error: null });
      try {
        const result = await this.request(`/v1/documents/${encodeURIComponent(row.document_id)}/${endpoint}`, { method: 'POST', signal: controller.signal });
        if (serial !== this.serial || !this.matches(row)) return;
        this.emit({ phase: 'ready', index: checkedIndex(result, row, previous), error: null });
      } catch (error) {
        if (serial !== this.serial) return;
        this.emit({ ...idleIndex(), phase: 'error', error }); if (error?.status === 401) this.onAuthenticationFailure(error);
      } finally { if (this.controller === controller) this.controller = null; }
    }
  };
}
