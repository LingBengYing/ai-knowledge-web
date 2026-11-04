import { ApiError, hasExactKeys, isId, isSha256 } from './api.mjs';

const vectorIdentity = row => JSON.stringify([row?.document_id, row?.index_publication_id, row?.active_revision_id,
  row?.document_type, row?.index_status, row?.synthetic_fixture, row?.media_info]);
const vectorFields = ['status', 'document_id', 'publication_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint',
  'model_revision', 'dimensions', 'vector_generation_id', 'manifest_sha256'];
const idle = () => ({ phase: 'idle', vector: null, error: null });

/**
 * Explicit build of the media vector of a saved, published original (image or audio);
 * local cancellation never promises upstream rollback.
 */
export function createMediaVectorKind({ endpoint, documentType, mimeTypes, maxBytes, maxDimensions, message }) {
  const invalid = () => new ApiError(502, message);

  function expected(row, { allowPublishedDuringReindex = false } = {}) {
    const retainedPublication = allowPublishedDuringReindex === true
      && ['queued', 'processing', 'failed', 'cancelled'].includes(row?.index_status)
      && row?.status === 'parsed' && row.latest_job?.state === 'parsed'
      && row.latest_job.document_id === row.document_id && row.latest_job.revision_id === row.active_revision_id
      && row.latest_index_job?.state === row.index_status && row.latest_index_job.document_id === row.document_id
      && row.latest_index_job.revision_id === row.active_revision_id;
    if (!row || row.synthetic_fixture !== false || row.document_type !== documentType || (row.index_status !== 'indexed' && !retainedPublication)
      || !isId(row.document_id) || !isId(row.index_publication_id) || !isId(row.active_revision_id)
      || !mimeTypes.includes(row.media_info?.mime_type) || !isSha256(row.media_info.sha256)
      || !Number.isSafeInteger(row.media_info.size_bytes) || row.media_info.size_bytes < 1 || row.media_info.size_bytes > maxBytes
      || typeof row.can_edit !== 'boolean') throw invalid();
    return { document_id: row.document_id, publication_id: row.index_publication_id, source_revision_id: row.active_revision_id,
      source_sha256: row.media_info.sha256 };
  }

  function canRead(row, options) {
    try { expected(row, options); return true; } catch { return false; }
  }

  function checked(value, wanted, previous = null) {
    if (!hasExactKeys(value, vectorFields) || Object.entries(wanted).some(([key, expectedValue]) => value[key] !== expectedValue)
      || !['missing', 'available'].includes(value.status) || !isSha256(value.profile_fingerprint)
      || typeof value.model_revision !== 'string' || !value.model_revision.trim() || [...value.model_revision].length > 200
      || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value.model_revision)
      || !Number.isSafeInteger(value.dimensions) || value.dimensions < 2 || value.dimensions > maxDimensions
      || (value.status === 'missing' ? value.vector_generation_id !== null || value.manifest_sha256 !== null
        : !isId(value.vector_generation_id) || !isSha256(value.manifest_sha256))
      || (previous && (value.status !== 'available' || ['profile_fingerprint', 'model_revision', 'dimensions'].some(key => value[key] !== previous[key])))) throw invalid();
    return Object.freeze(Object.fromEntries(vectorFields.map(key => [key, value[key]])));
  }

  class Session {
    constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) {
      this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure;
      this.value = idle(); this.serial = 0; this.identity = null; this.controller = null;
    }

    matches(row) { return this.identity === vectorIdentity(row); }
    publish(value) { this.value = value; this.onChange(); }

    close() {
      this.serial++; this.controller?.abort(); this.controller = null; this.identity = null;
      if (this.value.phase !== 'idle') this.publish(idle());
    }

    async open(row, options) {
      const wanted = expected(row, options);
      if (this.matches(row) && ['loading', 'building'].includes(this.value.phase)) return;
      this.close(); this.identity = vectorIdentity(row);
      const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
      this.publish({ ...idle(), phase: 'loading' });
      try {
        const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/${endpoint}`, { signal: controller.signal });
        if (serial !== this.serial) return;
        this.publish({ ...idle(), phase: 'ready', vector: checked(result, wanted) });
      } catch (error) {
        if (serial !== this.serial) return;
        this.publish({ ...idle(), phase: 'error', error });
        if (error?.status === 401) this.onAuthenticationFailure(error);
      } finally { if (serial === this.serial) this.controller = null; }
    }

    async build(row) {
      const wanted = expected(row), { phase, vector } = this.value;
      if (!this.matches(row) || phase !== 'ready' || vector?.status !== 'missing') return;
      const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
      this.publish({ ...idle(), phase: 'building', vector });
      try {
        const result = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/${endpoint}`, { method: 'POST', signal: controller.signal });
        if (serial !== this.serial) return;
        this.publish({ ...idle(), phase: 'ready', vector: checked(result, wanted, vector) });
      } catch (error) {
        if (serial !== this.serial) return;
        this.publish({ ...idle(), phase: 'error', error });
        if (error?.status === 401) this.onAuthenticationFailure(error);
      } finally { if (serial === this.serial) this.controller = null; }
    }
  }

  return { canRead, Session };
}
