import { ApiError } from './api.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && [...value].length <= max
  && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value);
const tags = value => Array.isArray(value) && value.length <= 20 && value.every(tag => text(tag, 40)) && new Set(value).size === value.length;
const invalid = () => new ApiError(502, '标签建议或保存结果与当前资料、摘要不一致，请刷新后核对。');
const idle = () => ({ phase: 'idle', suggestions: null, selected: [], error: null });
const identity = (item, synopsis) => JSON.stringify([item?.document_id, item?.index_publication_id, item?.active_revision_id,
  item?.media_info?.sha256, item?.can_edit, synopsis?.synopsis_id, synopsis?.input_fingerprint, synopsis?.model_revision, synopsis?.policy_revision]);

export function tagSuggestionsEnabled(config) {
  return ['file_synopsis', 'synopsis_sources', 'tag_suggestions'].every(name => config?.capabilities?.includes(name));
}

function expected(item, synopsis) {
  if (!item || item.synthetic_fixture || !id(item.document_id) || !id(item.index_publication_id) || !id(item.active_revision_id)
    || !hash(item.media_info?.sha256) || typeof item.can_edit !== 'boolean' || synopsis?.status !== 'available'
    || synopsis.document_id !== item.document_id || synopsis.publication_id !== item.index_publication_id
    || synopsis.revision_id !== item.active_revision_id || synopsis.source_sha256 !== item.media_info.sha256
    || !id(synopsis.synopsis_id) || !hash(synopsis.input_fingerprint) || !text(synopsis.model_revision, 200) || !text(synopsis.policy_revision, 200)) throw invalid();
  return { document_id: item.document_id, publication_id: item.index_publication_id, revision_id: item.active_revision_id,
    source_sha256: item.media_info.sha256, synopsis_id: synopsis.synopsis_id, input_fingerprint: synopsis.input_fingerprint,
    model_revision: synopsis.model_revision, synopsis_policy_revision: synopsis.policy_revision, can_apply: item.can_edit };
}

export function canReadTagSuggestions(item, synopsis) {
  try { expected(item, synopsis); return true; } catch { return false; }
}

function checked(value, wanted) {
  if (!value || Object.entries(wanted).some(([key, expectedValue]) => value[key] !== expectedValue)
    || value.policy_revision !== 'java-synopsis-tags-v1' || !hash(value.suggestion_fingerprint) || !tags(value.existing_tags)
    || !Array.isArray(value.candidates) || value.candidates.length > 8) throw invalid();
  const candidates = value.candidates.map((candidate, index) => {
    if (!candidate || candidate.ordinal !== index + 1 || !text(candidate.tag, 40) || /[,，;；]/u.test(candidate.tag)) throw invalid();
    return Object.freeze({ ordinal: candidate.ordinal, tag: candidate.tag });
  });
  if (new Set(candidates.map(candidate => candidate.tag)).size !== candidates.length) throw invalid();
  return Object.freeze({ ...wanted, policy_revision: value.policy_revision, suggestion_fingerprint: value.suggestion_fingerprint,
    existing_tags: Object.freeze([...value.existing_tags]), candidates: Object.freeze(candidates) });
}

function checkedSaved(row, wanted, selected) {
  if (!row || row.document_id !== wanted.document_id || row.active_revision_id !== wanted.revision_id
    || row.index_publication_id !== wanted.publication_id || row.media_info?.sha256 !== wanted.source_sha256
    || row.synthetic_fixture !== false || row.can_edit !== true || !tags(row.tags)
    || selected.some(tag => !row.tags.includes(tag))) throw invalid();
  return row;
}

/** The server owns candidates and merging. A read or selection never writes document metadata. */
export class TagSuggestionSession {
  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) {
    this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure;
    this.value = idle(); this.serial = 0; this.identity = null; this.controller = null;
  }

  matches(item, synopsis) { return this.identity === identity(item, synopsis); }

  emit(value) { this.value = value; this.onChange(); }

  close() {
    this.serial++; this.controller?.abort(); this.controller = null; this.identity = null;
    if (this.value.phase !== 'idle') this.emit(idle());
  }

  async load(item, synopsis) {
    const wanted = expected(item, synopsis);
    if (this.value.phase === 'saving') return;
    this.close();
    this.identity = identity(item, synopsis);
    const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ ...idle(), phase: 'loading' });
    try {
      const response = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/tag-suggestions`, { signal: controller.signal });
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'ready', suggestions: checked(response, wanted) });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (serial === this.serial) this.controller = null; }
  }

  select(ordinal, selected) {
    const { suggestions, phase } = this.value;
    if (phase !== 'ready' || !suggestions?.can_apply) return;
    const candidate = suggestions.candidates.find(item => item.ordinal === ordinal);
    if (!candidate || suggestions.existing_tags.includes(candidate.tag)) return;
    const values = new Set(this.value.selected);
    if (selected) values.add(ordinal); else values.delete(ordinal);
    this.emit({ ...this.value, selected: [...values].sort((a, b) => a - b), error: null });
  }

  async apply(item, synopsis) {
    const wanted = expected(item, synopsis), { suggestions, selected, phase } = this.value;
    if (phase !== 'ready' || !this.matches(item, synopsis) || !wanted.can_apply || !suggestions?.can_apply || !selected.length) return null;
    const serial = ++this.serial;
    const chosen = suggestions.candidates.filter(candidate => selected.includes(candidate.ordinal)).map(candidate => candidate.tag);
    this.emit({ ...this.value, phase: 'saving', error: null });
    try {
      // Once sent, an apply may commit even if the user leaves. close() only ignores its late result.
      const response = await this.request(`/v1/documents/${encodeURIComponent(wanted.document_id)}/tag-suggestions/apply`, {
        method: 'POST', body: { suggestion_fingerprint: suggestions.suggestion_fingerprint, ordinals: [...selected] },
      });
      if (serial !== this.serial) return null;
      const row = checkedSaved(response, wanted, chosen);
      this.emit({ ...idle(), phase: 'ready', suggestions: Object.freeze({ ...suggestions, existing_tags: Object.freeze([...row.tags]) }) });
      return row;
    } catch (error) {
      if (serial !== this.serial) return null;
      // Do not silently retry a possibly committed write, or keep stale suggestions actionable.
      this.emit({ ...idle(), phase: 'error', error });
      if (error?.status === 401) this.onAuthenticationFailure(error);
      throw error;
    }
  }
}
