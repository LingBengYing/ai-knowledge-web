import { ApiError, DOCUMENT_MIME_TYPES, sha256Hex } from './api.mjs';

const sourceId = /^[A-Za-z0-9_-]{1,128}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
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

async function checkedKnowledgeCitation(value, answerId, ordinal) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || knowledgeFields.some(field => !Object.hasOwn(value, field))
    || value.citation_id !== ordinal || !Number.isSafeInteger(ordinal) || ordinal < 1
    || typeof value.document_id !== 'string' || !sourceId.test(value.document_id)
    || typeof value.revision_id !== 'string' || !sourceId.test(value.revision_id)
    || typeof value.filename !== 'string' || !value.filename
    || !sha256.test(value.source_sha256 ?? '') || !sha256.test(value.text_sha256 ?? '')
    || typeof value.quote !== 'string' || !value.quote
    || value.source_url !== `/v1/knowledge-sources/${answerId}/${ordinal}`
    || value.content_url !== `/v1/documents/${value.document_id}/revisions/${value.revision_id}/content`) throw invalidResponse();
  if (value.evidence_kind === 'document_text') {
    if (![...DOCUMENT_MIME_TYPES, 'image/png', 'image/jpeg'].includes(value.media_type)
      || !['source_text', 'machine_ocr'].includes(value.origin)
      || !Number.isSafeInteger(value.page) || value.page < 1
      || !Number.isSafeInteger(value.start) || value.start < 0
      || !Number.isSafeInteger(value.end) || value.end <= value.start || [...value.quote].length !== value.end - value.start
      || value.start_ms !== null || value.end_ms !== null || value.time_precision !== null) throw invalidResponse();
  } else {
    const type = { video_transcript: ['machine_asr', 'server_chunk'], video_subtitle: ['embedded_subtitle', 'subtitle_cue'], video_frame_ocr: ['machine_ocr', 'frame_interval'] }[value.evidence_kind];
    if (!type || value.origin !== type[0] || value.time_precision !== type[1]
      || !['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'].includes(value.media_type)
      || value.page !== null || value.start !== null || value.end !== null
      || !Number.isFinite(value.start_ms) || value.start_ms < 0
      || !Number.isFinite(value.end_ms) || value.end_ms <= value.start_ms) throw invalidResponse();
  }
  if (await sha256Hex(new TextEncoder().encode(value.quote)) !== value.text_sha256) throw invalidResponse();
  return Object.freeze({ ...Object.fromEntries(knowledgeFields.map(field => [field, value[field]])),
    ...(typeof value.parser_revision === 'string' && value.parser_revision ? { parser_revision: value.parser_revision } : {}),
    number: ordinal, kind: value.evidence_kind });
}

export async function checkedKnowledgeAnswer(value) {
  if (!value || typeof value.answer_id !== 'string' || !sourceId.test(value.answer_id)
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
  #epoch = 0;
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
    this.#epoch += 1;
    this.#controller?.abort();
    this.#controller = null;
  }

  reset() {
    this.#invalidate();
    this.#publish(idle());
  }

  // Cancels local waiting only. There is no server task-cancellation endpoint for answers.
  cancel() { this.reset(); }

  async ask(question) {
    this.#invalidate();
    const epoch = this.#epoch;
    let body;
    try { body = answerRequest(question); }
    catch (error) { this.#publish({ ...idle(), phase: 'error', error }); return this.value; }
    const controller = new AbortController();
    this.#controller = controller;
    this.#publish({ ...idle(), phase: 'loading' });
    try {
      const response = await this.#request('/v1/knowledge-answers', { method: 'POST', body, signal: controller.signal });
      if (epoch !== this.#epoch) return this.value;
      const result = await checkedKnowledgeAnswer(response);
      if (epoch !== this.#epoch) return this.value;
      this.#publish({ ...idle(), phase: result.status, result });
    } catch (error) {
      if (epoch !== this.#epoch) return this.value;
      this.#publish({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.#onAuthenticationFailure(error);
    } finally {
      if (this.#controller === controller) this.#controller = null;
    }
    return this.value;
  }
}
