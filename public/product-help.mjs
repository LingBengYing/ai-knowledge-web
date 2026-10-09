import { ApiError } from './api.mjs';
import { answerRequest } from './answers.mjs';
import { DocumentOriginalSession } from './document-originals.mjs';

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const sourceId = /^[A-Za-z0-9_-]{1,128}$/u;
const sha = /^[a-f0-9]{64}$/u;
const documentTypes = ['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg'];
const videoTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const matchFields = ['rank', 'category', 'evidence_kind', 'document_id', 'revision_id', 'filename', 'source_sha256',
  'parser_revision', 'media_type', 'text', 'text_sha256', 'page', 'start', 'end', 'start_ms', 'end_ms',
  'origin', 'time_precision', 'content_url', 'retrieval_score', 'rerank_score'];
const invalid = () => new ApiError(502, '检索片段的范围、版本或定位不一致，请重新查找。');
const changed = () => new ApiError(409, '原文件版本已变化或与片段不一致，请重新查找后打开。');
const idleSource = () => ({ sourcePhase: 'idle', sourceMatch: null, original: null, sourceError: null });
const idle = () => ({ phase: 'idle', command: null, result: null, error: null, ...idleSource() });
const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');

export const productHelpEnabled = config => config?.capabilities?.includes('product_help') === true;

export function productHelpRequest(question, documentIds = null, topK = 5, rerank = true) {
  const command = answerRequest(question);
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 10 || typeof rerank !== 'boolean') {
    throw new ApiError(422, '每类返回片段数须为1到10，请核对检索参数。');
  }
  return Object.freeze({ ...command, top_k: topK, rerank });
}

async function checkedResult(value, command) {
  if (!keys(value, ['search_id', 'configuration_version', 'status', 'reason', 'scope_count', 'score_kind', 'matches'])
    || !sourceId.test(value.search_id ?? '') || !Number.isSafeInteger(value.configuration_version) || value.configuration_version < 0
    || !Number.isSafeInteger(value.scope_count) || value.scope_count < 0
    || value.score_kind !== 'rrf' || !Array.isArray(value.matches) || value.matches.length > command.top_k * 2
    || (value.status === 'completed' ? value.reason !== null || !value.matches.length || !value.scope_count
      : value.status !== 'empty' || value.matches.length || value.reason !== (value.scope_count === 0 ? 'empty_scope' : 'no_matches'))) throw invalid();
  const ranks = { document: 0, video: 0 }, seen = new Set(), matches = [];
  for (const match of value.matches) {
    if (!keys(match, matchFields) || !Object.hasOwn(ranks, match.category)
      || match.rank !== ++ranks[match.category] || match.rank > command.top_k
      || !id.test(match.document_id ?? '') || !id.test(match.revision_id ?? '')
      || typeof match.filename !== 'string' || !match.filename || typeof match.parser_revision !== 'string' || !match.parser_revision
      || !sha.test(match.source_sha256 ?? '') || !sha.test(match.text_sha256 ?? '')
      || typeof match.text !== 'string' || !match.text
      || match.content_url !== `/v1/documents/${match.document_id}/revisions/${match.revision_id}/content`
      || !Number.isFinite(match.retrieval_score) || match.retrieval_score < 0
      || (command.rerank ? !Number.isFinite(match.rerank_score) : match.rerank_score !== null)) throw invalid();
    if (match.category === 'document') {
      if (match.evidence_kind !== 'document_text' || !documentTypes.includes(match.media_type)
        || !['source_text', 'machine_ocr'].includes(match.origin) || match.time_precision !== null
        || !Number.isSafeInteger(match.page) || match.page < 1 || !Number.isSafeInteger(match.start) || match.start < 0
        || !Number.isSafeInteger(match.end) || match.end <= match.start || [...match.text].length !== match.end - match.start
        || match.start_ms !== null || match.end_ms !== null) throw invalid();
    } else {
      const kind = { video_transcript: ['machine_asr', 'server_chunk'], video_subtitle: ['embedded_subtitle', 'subtitle_cue'], video_frame_ocr: ['machine_ocr', 'frame_interval'] }[match.evidence_kind];
      if (!kind || match.origin !== kind[0] || match.time_precision !== kind[1] || !videoTypes.includes(match.media_type)
        || match.page !== null || match.start !== null || match.end !== null
        || !Number.isFinite(match.start_ms) || match.start_ms < 0 || !Number.isFinite(match.end_ms) || match.end_ms <= match.start_ms) throw invalid();
    }
    if (await digest(match.text) !== match.text_sha256) throw invalid();
    const identity = JSON.stringify([match.category, match.evidence_kind, match.document_id, match.revision_id, match.page, match.start, match.end, match.start_ms, match.end_ms, match.text_sha256]);
    if (seen.has(identity)) throw invalid();
    seen.add(identity); matches.push(Object.freeze({ ...match }));
  }
  return Object.freeze({ ...value, matches: Object.freeze(matches) });
}

/** One explicit search; original reading remains tied to its checked match and current identity. */
export class ProductHelpSession {
  #request; #change; #auth; #serial = 0; #sourceSerial = 0; #controller = null; #sourceController = null; #original;
  value = Object.freeze(idle());

  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {}, objectUrls = URL } = {}) {
    this.#request = request; this.#change = onChange; this.#auth = onAuthenticationFailure;
    this.#original = new DocumentOriginalSession(request, {
      objectUrls, onAuthenticationFailure,
      onChange: value => {
        if (this.value.sourceMatch && value.phase !== 'idle') this.#emit({ ...this.value, sourcePhase: value.phase, original: value.original, sourceError: value.error });
      },
    });
  }

  #emit(value) { this.value = Object.freeze(value); this.#change(this.value); }

  closeSource() {
    this.#sourceSerial++; this.#sourceController?.abort(); this.#sourceController = null;
    this.#emit({ ...this.value, ...idleSource() }); this.#original.close();
  }

  invalidate() {
    this.#serial++; this.#controller?.abort(); this.#controller = null;
    this.closeSource(); this.#emit(idle());
  }

  async search(question, documentIds = null, topK = 5, rerank = true) {
    this.invalidate();
    let command;
    try { command = productHelpRequest(question, documentIds, topK, rerank); }
    catch (error) { this.#emit({ ...idle(), phase: 'error', error }); return null; }
    const serial = this.#serial, controller = new AbortController(); this.#controller = controller;
    this.#emit({ ...idle(), phase: 'loading', command });
    try {
      const response = await this.#request('/v1/product-help/search', { method: 'POST', body: command, signal: controller.signal });
      if (serial !== this.#serial) return null;
      const result = await checkedResult(response, command);
      if (serial !== this.#serial) return null;
      this.#emit({ ...idle(), phase: 'ready', command, result }); return result;
    } catch (error) {
      if (serial !== this.#serial) return null;
      this.#emit({ ...idle(), phase: 'error', command, error });
      if (error?.status === 401) this.#auth(error);
      return null;
    } finally { if (serial === this.#serial) this.#controller = null; }
  }

  async openSource(match) {
    if (!this.value.result?.matches.includes(match)) return;
    this.closeSource();
    const serial = this.#serial, sourceSerial = this.#sourceSerial, controller = new AbortController();
    this.#sourceController = controller;
    const current = () => serial === this.#serial && sourceSerial === this.#sourceSerial;
    this.#emit({ ...this.value, sourcePhase: 'loading', sourceMatch: match });
    try {
      const metadata = await this.#request(`/v1/documents/${match.document_id}/original`, { signal: controller.signal });
      if (!current()) return;
      if (!metadata || ['document_id', 'revision_id', 'filename', 'source_sha256', 'media_type', 'content_url'].some(key => metadata[key] !== match[key])
        || (match.category === 'video' ? metadata.document_type !== 'video' : !['document', 'image'].includes(metadata.document_type))) throw changed();
      await this.#original.open({ document_id: metadata.document_id, active_revision_id: metadata.revision_id,
        filename: metadata.filename, document_type: metadata.document_type,
        media_info: { mime_type: metadata.media_type, sha256: metadata.source_sha256, size_bytes: metadata.size_bytes } });
    } catch (error) {
      if (!current()) return;
      this.#emit({ ...this.value, sourcePhase: 'error', original: null, sourceError: error });
      if (error?.status === 401) this.#auth(error);
    } finally { if (current()) this.#sourceController = null; }
  }
}
