import { ApiError, DOCUMENT_MIME_TYPES, documentTextPreview, documentDownloadOnly, safeOriginalBlob } from './api.mjs';

const id = /^[A-Za-z0-9_-]{1,128}$/u;
const hashes = /^[a-f0-9]{64}$/u;
const maxBytes = 20 * 1024 * 1024;
const types = {
  document: DOCUMENT_MIME_TYPES,
  image: ['image/png', 'image/jpeg'],
  audio: ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'],
};
const idle = () => ({ phase: 'idle', original: null, error: null });
const invalid = () => new ApiError(502, '原文件身份、版本、类型或完整性不一致，请刷新资料后重试。');
const identity = item => JSON.stringify([item?.document_id, item?.active_revision_id ?? item?.latest_job?.revision_id ?? item?.registered_revision_id,
  item?.filename, item?.document_type, item?.media_info?.mime_type, item?.media_info?.sha256,
  item?.media_info?.size_bytes, item?.synthetic_fixture]);

function expected(item) {
  const revision = item?.active_revision_id ?? item?.latest_job?.revision_id ?? item?.registered_revision_id;
  const media = item?.media_info;
  if (item?.synthetic_fixture || !id.test(item?.document_id ?? '') || !id.test(revision ?? '')
    || typeof item?.filename !== 'string' || !item.filename || item.filename.length > 255
    || !types[item.document_type]?.includes(media?.mime_type)
    || !hashes.test(media?.sha256 ?? '') || !Number.isSafeInteger(media?.size_bytes)
    || media.size_bytes < 1 || media.size_bytes > maxBytes) throw invalid();
  return Object.freeze({ document_id: item.document_id, revision_id: revision, filename: item.filename,
    document_type: item.document_type, media_type: media.mime_type, source_sha256: media.sha256, size_bytes: media.size_bytes });
}

function checked(metadata, wanted) {
  if (!metadata || Object.keys(wanted).some(key => metadata[key] !== wanted[key])
    || metadata.content_url !== `/v1/documents/${wanted.document_id}/revisions/${wanted.revision_id}/content`) throw invalid();
  return Object.freeze({ ...wanted, content_url: metadata.content_url });
}

/** Opens only the currently selected saved original; URLs live for one detail context. */
export class DocumentOriginalSession {
  #request; #onChange; #onAuthenticationFailure; #objectUrls; #controller = null;
  #sequence = 0; #identity = null; #url = null;
  value = idle();

  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {}, objectUrls = URL } = {}) {
    this.#request = request; this.#onChange = onChange;
    this.#onAuthenticationFailure = onAuthenticationFailure; this.#objectUrls = objectUrls;
  }

  matches(item) {
    return this.#identity === identity(item);
  }

  #publish(value) { this.value = value; this.#onChange(value); }

  close() {
    this.#sequence += 1; this.#controller?.abort(); this.#controller = null;
    if (this.#url) this.#objectUrls.revokeObjectURL(this.#url);
    this.#url = null; this.#identity = null; this.#publish(idle());
  }

  async open(item) {
    this.close();
    const sequence = this.#sequence;
    const controller = new AbortController(); this.#controller = controller;
    const current = () => sequence === this.#sequence && !controller.signal.aborted;
    this.#identity = identity(item);
    this.#publish({ phase: 'loading', original: null, error: null });
    try {
      const wanted = expected(item);
      const metadata = await this.#request(`/v1/documents/${wanted.document_id}/original`, { signal: controller.signal });
      if (!current()) return this.value;
      const original = checked(metadata, wanted);
      const blob = await this.#request(original.content_url, { signal: controller.signal, binary: true });
      if (!current()) return this.value;
      if (!(blob instanceof Blob) || blob.size !== original.size_bytes || blob.type !== original.media_type) throw invalid();
      const bytes = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      if (!current()) return this.value;
      if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== original.source_sha256) throw invalid();
      let text = null, textError = null;
      if (documentTextPreview(original.media_type)) {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
        catch { textError = '原文件不是有效 UTF-8 文本，无法在此预览；可打开或下载原文件。'; }
      }
      this.#url = this.#objectUrls.createObjectURL(safeOriginalBlob(blob));
      this.#publish({ phase: 'ready', original: Object.freeze({ ...original, url: this.#url, text, textError, downloadOnly: documentDownloadOnly(original.media_type),
        ...(original.media_type === 'application/pdf' ? { blob } : {}) }), error: null });
    } catch (error) {
      if (current() && error.name !== 'AbortError') {
        this.#publish({ phase: 'error', original: null, error });
        if (error instanceof ApiError && error.status === 401) this.#onAuthenticationFailure(error);
      }
    } finally { if (current()) this.#controller = null; }
    return this.value;
  }
}
