import { ApiError } from './api.mjs';

const sourceId = /^[A-Za-z0-9_-]{1,128}$/u;
const documentId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const citationFields = ['number', 'document_id', 'revision_id', 'source_sha256', 'parser_revision',
  'filename', 'page', 'start', 'end', 'quote', 'quote_sha256', 'source_url'];
const idle = () => ({ phase: 'idle', result: null, error: null, sourcePhase: 'idle', source: null, sourceError: null });
const invalidResponse = () => new ApiError(502, '服务器返回的答案或来源格式无效，请刷新后核对。');

export function answersEnabled(config) {
  return Array.isArray(config?.capabilities)
    && config.capabilities.includes('answers') && config.capabilities.includes('sources');
}

/** Preserve the original question and complete selection; [] never means the whole library. */
export function answerRequest(question, documentIds = null) {
  if (typeof question !== 'string' || !question.trim()
    || new TextEncoder().encode(question).length > 4096
    || [...question].some(character => {
      const point = character.codePointAt(0);
      return (point < 32 && point !== 10 && point !== 9) || point === 127 || (point >= 0xd800 && point <= 0xdfff);
    })) throw new ApiError(422, '请输入非空问题，最多4096 UTF-8字节，不能包含不合法字符。');
  if (documentIds === null) return { question };
  if (!Array.isArray(documentIds) || documentIds.length > 128
    || documentIds.some(id => typeof id !== 'string' || !documentId.test(id))
    || new Set(documentIds).size !== documentIds.length) {
    throw new ApiError(422, '所选资料范围无效，请重新选择；不会自动改为全库问答。');
  }
  return { question, document_ids: [...documentIds] };
}

function checkedCitation(value, answerId, ordinal) {
  if (!value || typeof value !== 'object' || value.number !== ordinal
    || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > 32
    || typeof value.document_id !== 'string' || !documentId.test(value.document_id)
    || typeof value.revision_id !== 'string' || !documentId.test(value.revision_id)
    || typeof value.source_sha256 !== 'string' || !sha256.test(value.source_sha256)
    || typeof value.quote_sha256 !== 'string' || !sha256.test(value.quote_sha256)
    || typeof value.parser_revision !== 'string' || !value.parser_revision
    || typeof value.filename !== 'string' || !value.filename
    || !Number.isSafeInteger(value.page) || value.page < 1
    || !Number.isSafeInteger(value.start) || value.start < 0
    || !Number.isSafeInteger(value.end) || value.end <= value.start
    || typeof value.quote !== 'string' || !value.quote
    || [...value.quote].length !== value.end - value.start
    || value.source_url !== `/v1/sources/${answerId}/${ordinal}`) throw invalidResponse();
  return Object.freeze(Object.fromEntries(citationFields.map(field => [field, value[field]])));
}

function checkedAnswer(value) {
  if (!value || typeof value !== 'object' || typeof value.answer_id !== 'string' || !sourceId.test(value.answer_id)
    || !['answered', 'abstained'].includes(value.status)
    || typeof value.answer !== 'string' || !value.answer.trim()
    || !Array.isArray(value.citations) || value.citations.length > 32) throw invalidResponse();
  if (value.status === 'answered' && (value.reason !== null || !value.citations.length)) throw invalidResponse();
  if (value.status === 'abstained' && (typeof value.reason !== 'string'
    || !/^[a-z][a-z0-9_]{0,99}$/u.test(value.reason) || value.citations.length)) throw invalidResponse();
  const citations = value.citations.map((item, index) => checkedCitation(item, value.answer_id, index + 1));
  return Object.freeze({ answer_id: value.answer_id, status: value.status, answer: value.answer,
    reason: value.reason, citations: Object.freeze(citations) });
}

function checkedSource(value, answerId, expected) {
  if (!value || value.answer_id !== answerId) throw invalidResponse();
  const citation = checkedCitation(value.citation, answerId, expected.number);
  if (citationFields.some(field => citation[field] !== expected[field])) throw invalidResponse();
  // Optional typed image data is intentionally not interpreted in this text-source Module.
  return citation;
}

/** Answer Module: one request per action, server locators, local cancellation and stale-read isolation. */
export class AnswerSession {
  #request;
  #onChange;
  #onAuthenticationFailure;
  #value = Object.freeze(idle());
  #epoch = 0;
  #sourceSequence = 0;
  #answerController = null;
  #sourceController = null;

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
    this.#sourceSequence += 1;
    this.#answerController?.abort();
    this.#sourceController?.abort();
    this.#answerController = null;
    this.#sourceController = null;
  }

  reset() {
    this.#invalidate();
    this.#publish(idle());
  }

  // Cancels local waiting only. There is no server task-cancellation endpoint for answers.
  cancel() { this.reset(); }

  async ask(question, documentIds = null) {
    this.#invalidate();
    const epoch = this.#epoch;
    let body;
    try { body = answerRequest(question, documentIds); }
    catch (error) { this.#publish({ ...idle(), phase: 'error', error }); return this.value; }
    const controller = new AbortController();
    this.#answerController = controller;
    this.#publish({ ...idle(), phase: 'loading' });
    try {
      const response = await this.#request('/v1/answers', { method: 'POST', body, signal: controller.signal });
      if (epoch !== this.#epoch) return this.value;
      const result = checkedAnswer(response);
      this.#publish({ ...idle(), phase: result.status, result });
    } catch (error) {
      if (epoch !== this.#epoch) return this.value;
      this.#publish({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.#onAuthenticationFailure(error);
    } finally {
      if (this.#answerController === controller) this.#answerController = null;
    }
    return this.value;
  }

  async readSource(number) {
    const epoch = this.#epoch;
    const sequence = ++this.#sourceSequence;
    this.#sourceController?.abort();
    this.#sourceController = null;
    const result = this.value.result;
    const expected = Number.isInteger(number) && result?.status === 'answered'
      ? result.citations.find(citation => citation.number === number) : null;
    this.#publish({ ...this.value, sourcePhase: 'loading', source: null, sourceError: null });
    if (!expected) {
      this.#publish({ ...this.value, sourcePhase: 'error', sourceError: invalidResponse() });
      return this.value;
    }
    const controller = new AbortController();
    this.#sourceController = controller;
    try {
      const response = await this.#request(expected.source_url, { signal: controller.signal });
      if (epoch !== this.#epoch || sequence !== this.#sourceSequence) return this.value;
      const source = checkedSource(response, result.answer_id, expected);
      this.#publish({ ...this.value, sourcePhase: 'ready', source, sourceError: null });
    } catch (error) {
      if (epoch !== this.#epoch || sequence !== this.#sourceSequence) return this.value;
      this.#publish({ ...this.value, sourcePhase: 'error', source: null, sourceError: error });
      if (error?.status === 401) this.#onAuthenticationFailure(error);
    } finally {
      if (this.#sourceController === controller) this.#sourceController = null;
    }
    return this.value;
  }
}
