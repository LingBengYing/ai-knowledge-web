import { ApiError } from './api.mjs';
import { answerRequest } from './answers.mjs';
import { checkedRetrievalSettings, checkedRetrievalOverride, retrievalScoreKind } from './retrieval-settings.mjs';

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const invalid = () => new ApiError(502, '召回片段的范围、版本或完整性不一致，请重新测试。');
const idle = () => ({ phase: 'idle', command: null, result: null, error: null });
const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const retrievalEnabled = config => config?.capabilities?.includes('retrieval_test') === true;

export function retrievalRequest(question, documentIds = null, topK, rerank) {
  const answer = answerRequest(question);
  if (topK && typeof topK === 'object') {
    if (rerank !== undefined) throw new ApiError(422, '不能同时使用两组临时检索参数。');
    return { ...answer, retrieval_settings: checkedRetrievalOverride(topK) };
  }
  if (topK !== undefined && (!Number.isSafeInteger(topK) || topK < 1 || topK > 20) || rerank !== undefined && typeof rerank !== 'boolean') throw new ApiError(422, '召回数量须为1到20，重排选项须明确。');
  return { ...answer, ...(topK === undefined ? {} : { top_k: topK }), ...(rerank === undefined ? {} : { rerank }) };
}

export async function checkedRetrievalResult(value, command) {
  let effective;
  try { effective = checkedRetrievalSettings(value?.effective_settings); } catch { throw invalid(); }
  if (command.retrieval_settings && Object.entries(command.retrieval_settings).some(([name, parameter]) => effective[name] !== parameter)
    || command.top_k !== undefined && effective.top_k !== command.top_k
    || command.rerank !== undefined && (effective.ranking_mode === 'rerank') !== command.rerank) throw invalid();
  if (!keys(value, ['test_id', 'configuration_version', 'effective_settings', 'status', 'reason', 'scope_count', 'score_kind', 'matches'])
    || typeof value.test_id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value.test_id)
    || !Number.isSafeInteger(value.configuration_version) || value.configuration_version < 0
    || !Number.isSafeInteger(value.scope_count) || value.scope_count < 0
    || value.score_kind !== retrievalScoreKind(effective) || !Array.isArray(value.matches) || value.matches.length > effective.top_k
    || (value.status === 'completed' ? value.reason !== null || value.matches.length === 0 || value.scope_count === 0
      : value.status !== 'empty' || value.matches.length !== 0 || value.reason !== (value.scope_count === 0 ? 'empty_scope' : 'no_matches'))) throw invalid();
  const matches = [], seen = new Set();
  for (const [index, match] of value.matches.entries()) {
    if (!keys(match, ['rank', 'document_id', 'revision_id', 'filename', 'source_sha256', 'parser_revision', 'page', 'start', 'end', 'text', 'text_sha256', 'retrieval_score', 'rerank_score'])
      || match.rank !== index + 1 || !id.test(match.document_id ?? '') || !id.test(match.revision_id ?? '')
      || typeof match.filename !== 'string' || !match.filename || typeof match.parser_revision !== 'string' || !match.parser_revision
      || !sha256.test(match.source_sha256 ?? '') || !sha256.test(match.text_sha256 ?? '')
      || !Number.isSafeInteger(match.page) || match.page < 1 || !Number.isSafeInteger(match.start) || match.start < 0
      || !Number.isSafeInteger(match.end) || match.end <= match.start || typeof match.text !== 'string' || [...match.text].length !== match.end - match.start
      || !Number.isFinite(match.retrieval_score) || match.retrieval_score < 0
      || (effective.ranking_mode === 'rerank' ? !Number.isFinite(match.rerank_score) : match.rerank_score !== null)
      || await digest(match.text) !== match.text_sha256) throw invalid();
    const identity = JSON.stringify([match.document_id, match.revision_id, match.page, match.start, match.end]);
    if (seen.has(identity)) throw invalid(); seen.add(identity); matches.push(Object.freeze({ ...match }));
  }
  return Object.freeze({ ...value, matches: Object.freeze(matches) });
}

export function matchCurrentOriginal(match, item) {
  return Boolean(match && item && item.document_id === match.document_id && item.active_revision_id === match.revision_id
    && item.filename === match.filename && item.media_info?.sha256 === match.source_sha256);
}

/** Preview only. No answer trace or model-generated claim is created by this module. */
export class RetrievalSession {
  #request; #change; #auth; #serial = 0; #controller = null;
  value = Object.freeze(idle());
  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) { this.#request = request; this.#change = onChange; this.#auth = onAuthenticationFailure; }
  #emit(value) { this.value = Object.freeze(value); this.#change(this.value); }
  invalidate() { this.#serial++; this.#controller?.abort(); this.#controller = null; this.#emit(idle()); }
  close() { this.invalidate(); }
  stop() { this.invalidate(); }
  async run(question, documentIds = null, topK, rerank) {
    this.invalidate();
    let command;
    try { command = retrievalRequest(question, documentIds, topK, rerank); }
    catch (error) { this.#emit({ ...idle(), phase: 'error', error }); return null; }
    command = Object.freeze(command);
    const serial = this.#serial, controller = new AbortController(); this.#controller = controller;
    this.#emit({ phase: 'loading', command, result: null, error: null });
    try {
      const response = await this.#request('/v1/retrieval-tests', { method: 'POST', body: command, signal: controller.signal });
      if (serial !== this.#serial) return null;
      const checked = await checkedRetrievalResult(response, command);
      if (serial !== this.#serial) return null;
      this.#emit({ phase: 'ready', command, result: checked, error: null }); return checked;
    } catch (error) {
      if (serial !== this.#serial) return null;
      if (error?.status === 401) { this.close(); this.#auth(error); return null; }
      this.#emit({ phase: 'error', command, result: null, error }); return null;
    } finally { if (serial === this.#serial) this.#controller = null; }
  }
}
