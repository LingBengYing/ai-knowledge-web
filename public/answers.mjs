import { ApiError, DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, SHA256_PATTERN, VIDEO_MIME_TYPES, isId, sha256Hex } from './api.mjs';

const idle = () => ({ phase: 'idle', result: null, error: null });
const invalidResponse = () => new ApiError(502, '服务器返回的答案或来源格式无效，请刷新后核对。');
const knowledgeFields = ['citation_id', 'evidence_kind', 'document_id', 'revision_id', 'filename', 'source_sha256',
  'media_type', 'quote', 'text_sha256', 'origin', 'content_url', 'source_url', 'page', 'start', 'end', 'start_ms', 'end_ms', 'time_precision'];

/** Preserve the original question; all authenticated members query the shared library. */
export function answerRequest(question) {
  if (typeof question !== 'string' || !question.trim()
    || [...question].some(character => {
      const point = character.codePointAt(0);
      return (point < 32 && point !== 10 && point !== 9) || point === 127 || (point >= 0xd800 && point <= 0xdfff);
    })) throw new ApiError(422, '请输入非空问题，不能包含不合法字符。');
  return { question };
}

/**
 * A citation's locator: page and character range for document text, or a time interval for video evidence.
 * Shared by answer validation and answer-source reads; the quote must already be a non-empty string.
 */
export function isCitationLocator(value) {
  if (value.evidence_kind === 'document_text') {
    return [...DOCUMENT_MIME_TYPES, ...IMAGE_MIME_TYPES].includes(value.media_type)
      && ['source_text', 'machine_ocr'].includes(value.origin)
      && Number.isSafeInteger(value.page) && value.page >= 1
      && Number.isSafeInteger(value.start) && value.start >= 0
      && Number.isSafeInteger(value.end) && value.end > value.start && [...value.quote].length === value.end - value.start
      && value.start_ms === null && value.end_ms === null && value.time_precision === null;
  }
  const type = { video_transcript: ['machine_asr', 'server_chunk'], video_subtitle: ['embedded_subtitle', 'subtitle_cue'], video_frame_ocr: ['machine_ocr', 'frame_interval'] }[value.evidence_kind];
  return !!type && value.origin === type[0] && value.time_precision === type[1]
    && VIDEO_MIME_TYPES.includes(value.media_type)
    && value.page === null && value.start === null && value.end === null
    && Number.isFinite(value.start_ms) && value.start_ms >= 0
    && Number.isFinite(value.end_ms) && value.end_ms > value.start_ms;
}

async function checkedKnowledgeCitation(value, answerId, ordinal) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || knowledgeFields.some(field => !Object.hasOwn(value, field))
    || value.citation_id !== ordinal || !Number.isSafeInteger(ordinal) || ordinal < 1
    || !isId(value.document_id)
    || !isId(value.revision_id)
    || typeof value.filename !== 'string' || !value.filename
    || !SHA256_PATTERN.test(value.source_sha256 ?? '') || !SHA256_PATTERN.test(value.text_sha256 ?? '')
    || typeof value.quote !== 'string' || !value.quote
    || value.source_url !== `/v1/knowledge-sources/${answerId}/${ordinal}`
    || value.content_url !== `/v1/documents/${value.document_id}/revisions/${value.revision_id}/content`) throw invalidResponse();
  if (!isCitationLocator(value)) throw invalidResponse();
  if (await sha256Hex(new TextEncoder().encode(value.quote)) !== value.text_sha256) throw invalidResponse();
  return Object.freeze({ ...Object.fromEntries(knowledgeFields.map(field => [field, value[field]])),
    ...(typeof value.parser_revision === 'string' && value.parser_revision ? { parser_revision: value.parser_revision } : {}),
    number: ordinal, kind: value.evidence_kind });
}

export async function checkedKnowledgeAnswer(value) {
  if (!value || !isId(value.answer_id)
    || !['answered', 'abstained'].includes(value.status) || typeof value.answer !== 'string' || !value.answer.trim()
    || !Array.isArray(value.citations)
    || (value.status === 'answered' ? value.reason !== null || !value.citations.length
      : typeof value.reason !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/u.test(value.reason) || value.citations.length)) throw invalidResponse();
  const citations = [];
  for (const [index, item] of value.citations.entries()) {
    const citation = await checkedKnowledgeCitation(item, value.answer_id, index + 1);
    citations.push(citation);
  }
  return Object.freeze({ answer_id: value.answer_id, status: value.status, answer: value.answer,
    reason: value.reason, citations: Object.freeze(citations) });
}

/** Unified knowledge answer: one request per question, local cancellation and stale-answer isolation. */
export class AnswerSession {
  #request;
  #onChange;
  #onAuthenticationFailure;
  #value = Object.freeze(idle());
  #serial = 0;
  #controller = null;

  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) {
    this.#request = request;
    this.#onChange = onChange;
    this.#onAuthenticationFailure = onAuthenticationFailure;
  }

  get value() { return this.#value; }

  #publish(value) {
    this.#value = Object.freeze(value);
    this.#onChange(this.#value);
  }

  #invalidate() {
    this.#serial += 1;
    this.#controller?.abort();
    this.#controller = null;
  }

  // Cancels local waiting only. There is no server task-cancellation endpoint for answers.
  cancel() {
    this.#invalidate();
    this.#publish(idle());
  }

  async ask(question) {
    this.#invalidate();
    const serial = this.#serial;
    let body;
    try { body = answerRequest(question); }
    catch (error) { this.#publish({ ...idle(), phase: 'error', error }); return this.value; }
    const controller = new AbortController();
    this.#controller = controller;
    this.#publish({ ...idle(), phase: 'loading' });
    try {
      const response = await this.#request('/v1/knowledge-answers', { method: 'POST', body, signal: controller.signal });
      if (serial !== this.#serial) return this.value;
      const result = await checkedKnowledgeAnswer(response);
      if (serial !== this.#serial) return this.value;
      this.#publish({ ...idle(), phase: result.status, result });
    } catch (error) {
      if (serial !== this.#serial) return this.value;
      this.#publish({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.#onAuthenticationFailure(error);
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
    return this.value;
  }
}
