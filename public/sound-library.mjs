import { ApiError } from './api.mjs';
import { checkedQueryAttachments } from './query-attachments.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const traceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = (value, max = 200) => typeof value === 'string' && !!value.trim() && [...value].length <= max
  && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value);
const bytes = value => new TextEncoder().encode(value);
const types = ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'];
const invalid = () => new ApiError(502, '声音结果的来源、事实、模型或时间身份无效，请刷新后核对。');
const exact = (value, fields) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const digest = async content => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)), byte => byte.toString(16).padStart(2, '0')).join('');
const indexFields = ['status', 'document_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint', 'model_revision',
  'embedding_model_revision', 'dimensions', 'publication_id', 'generation_id', 'manifest_sha256', 'span_count'];
const citationFields = ['number', 'kind', 'document_id', 'revision_id', 'source_sha256', 'publication_id', 'profile_fingerprint',
  'decoder_revision', 'pcm_sha256', 'filename', 'media_type', 'start_sample', 'end_sample', 'sample_rate', 'start_ms', 'end_ms',
  'facts', 'facts_sha256', 'analysis_model_revision', 'policy_revision', 'time_precision', 'source_url', 'content_url'];
const answerFields = ['answer_id', 'status', 'answer', 'reason_code', 'citations', 'policy_revision'];
const identity = row => JSON.stringify([row?.document_id, row?.document_type, row?.synthetic_fixture,
  row?.active_revision_id, row?.registered_revision_id, row?.index_publication_id, row?.media_info]);
const idle = () => ({ phase: 'idle', index: null, error: null });

export function soundEnabled(config) {
  return ['sound_upload', 'sound_index', 'sound_answers', 'sound_sources', 'sound_query_attachments']
    .every(name => config?.capabilities?.includes(name));
}

export function canReadSoundIndex(row) {
  return !!row && id(row.document_id) && row.document_type === 'audio' && row.synthetic_fixture === false
    && typeof row.can_edit === 'boolean' && types.includes(row.media_info?.mime_type) && hash(row.media_info.sha256)
    && Number.isSafeInteger(row.media_info.size_bytes) && row.media_info.size_bytes > 0 && row.media_info.size_bytes <= 20 * 1024 * 1024;
}

function checkedIndex(value, row, previous = null) {
  if (!canReadSoundIndex(row) || !exact(value, indexFields) || value.document_id !== row.document_id
    || value.source_sha256 !== row.media_info.sha256 || !id(value.source_revision_id) || ((row.registered_revision_id ?? row.latest_job?.revision_id ?? row.active_revision_id) != null && value.source_revision_id !== (row.registered_revision_id ?? row.latest_job?.revision_id ?? row.active_revision_id)) || !hash(value.profile_fingerprint)
    || !text(value.model_revision) || !text(value.embedding_model_revision) || !Number.isSafeInteger(value.dimensions)
    || value.dimensions < 2 || value.dimensions > 3072 || !['missing', 'available'].includes(value.status)
    || (value.status === 'missing' ? value.publication_id !== null || value.generation_id !== null || value.manifest_sha256 !== null || value.span_count !== 0
      : !id(value.publication_id) || !id(value.generation_id) || !hash(value.manifest_sha256) || !Number.isSafeInteger(value.span_count) || value.span_count < 1 || value.span_count > 600)
    || (previous && (value.status !== 'available' || ['document_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint',
      'model_revision', 'embedding_model_revision', 'dimensions'].some(key => value[key] !== previous[key])))) throw invalid();
  return Object.freeze(Object.fromEntries(indexFields.map(key => [key, value[key]])));
}

/** Explicit all-window indexing, independent of any ASR publication or local waiting. */
export class SoundIndexSession {
  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {} } = {}) {
    this.request = request; this.onChange = onChange; this.onAuthenticationFailure = onAuthenticationFailure;
    this.value = idle(); this.serial = 0; this.identity = null; this.controller = null;
  }
  matches(row) { return this.identity === identity(row); }
  emit(value) { this.value = value; this.onChange(); }
  close() { this.serial++; this.controller?.abort(); this.controller = null; this.identity = null; this.emit(idle()); }
  stop() {
    if (this.value.phase !== 'building') return;
    this.serial++; this.controller?.abort(); this.controller = null;
    this.emit({ phase: 'unknown', index: null, error: null });
  }
  async open(row) {
    if (!canReadSoundIndex(row)) throw invalid();
    if (this.matches(row) && ['loading', 'building'].includes(this.value.phase)) return;
    this.close(); this.identity = identity(row); const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ ...idle(), phase: 'loading' });
    try {
      const result = await this.request(`/v1/documents/${encodeURIComponent(row.document_id)}/sound-index`, { signal: controller.signal });
      if (serial !== this.serial || !this.matches(row)) return;
      this.emit({ phase: 'ready', index: checkedIndex(result, row), error: null });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error }); if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (this.controller === controller) this.controller = null; }
  }
  async build(row) {
    if (!canReadSoundIndex(row) || !this.matches(row) || this.value.phase !== 'ready' || this.value.index?.status !== 'missing') return;
    const previous = this.value.index, serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ phase: 'building', index: previous, error: null });
    try {
      const result = await this.request(`/v1/documents/${encodeURIComponent(row.document_id)}/sound-index`, { method: 'POST', signal: controller.signal });
      if (serial !== this.serial || !this.matches(row)) return;
      this.emit({ phase: 'ready', index: checkedIndex(result, row, previous), error: null });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error }); if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (this.controller === controller) this.controller = null; }
  }
}

async function checkedCitation(value, answerId, ordinal) {
  if (!exact(value, citationFields) || value.number !== ordinal || ordinal < 1 || ordinal > 32 || value.kind !== 'sound_span'
    || !id(value.document_id) || !id(value.revision_id) || !id(value.publication_id)
    || ['source_sha256', 'profile_fingerprint', 'pcm_sha256', 'facts_sha256'].some(key => !hash(value[key]))
    || ['decoder_revision', 'analysis_model_revision'].some(key => !text(value[key])) || !text(value.filename, 255)
    || /[/\\]/u.test(value.filename) || !types.includes(value.media_type) || value.sample_rate !== 16000
    || !Number.isSafeInteger(value.start_sample) || !Number.isSafeInteger(value.end_sample) || value.start_sample < 0
    || value.end_sample <= value.start_sample || value.end_sample > 9_600_000 || value.end_sample - value.start_sample > 480_000
    || value.start_ms !== Math.floor(value.start_sample / 16) || value.end_ms !== Math.ceil(value.end_sample / 16)
    || value.policy_revision !== 'java-sound-answer-v1' || value.time_precision !== 'server_window'
    || value.source_url !== `/v1/sound-sources/${answerId}/${ordinal}` || value.content_url !== `${value.source_url}/content`
    || !Array.isArray(value.facts) || value.facts.length < 1 || value.facts.length > 16
    || value.facts.some(fact => !text(fact, 1024)) || new Set(value.facts).size !== value.facts.length
    || value.facts.reduce((total, fact) => total + bytes(fact).length, 0) > 8192
    || await digest(bytes(JSON.stringify(value.facts))) !== value.facts_sha256) throw invalid();
  return Object.freeze(Object.fromEntries(citationFields.map(key => [key, key === 'facts' ? Object.freeze([...value.facts]) : value[key]])));
}

export async function checkedSoundAnswer(value) {
  // The server joins at most sixteen raw facts with fifteen LF separators.
  if (!exact(value, answerFields) || !traceId(value.answer_id) || !['answered', 'abstained'].includes(value.status)
    || typeof value.answer !== 'string' || !value.answer.trim() || bytes(value.answer).length > 8192 + 15
    || value.policy_revision !== 'java-sound-answer-v1' || !Array.isArray(value.citations) || value.citations.length > 32
    || (value.status === 'answered' ? value.reason_code !== null || !value.citations.length
      : typeof value.reason_code !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/u.test(value.reason_code) || value.citations.length)) throw invalid();
  const citations = [];
  for (let index = 0; index < value.citations.length; index++) citations.push(await checkedCitation(value.citations[index], value.answer_id, index + 1));
  return Object.freeze({ answer_id: value.answer_id, status: value.status, answer: value.answer, reason: value.reason_code,
    policy_revision: value.policy_revision, citations: Object.freeze(citations) });
}

export async function checkedSoundSource(value, answerId, expected) {
  if (!exact(value, ['answer_id', 'citation']) || value.answer_id !== answerId || !traceId(answerId)) throw invalid();
  const citation = await checkedCitation(value.citation, answerId, expected.number);
  if (citationFields.some(key => JSON.stringify(citation[key]) !== JSON.stringify(expected[key]))) throw invalid();
  return citation;
}

export async function checkedSoundAttachments(value, selection) {
  const fields = ['ordinal', 'source_sha256', 'media_kind', 'compiler_revision', 'content_sha256', 'text_code_points', 'visual_count', 'selected_image_sha256', 'visual_sampled'];
  if (!exact(value, [...answerFields, 'mode', 'attachment_manifest']) || value.mode !== 'SOUND'
    || !Array.isArray(value.attachment_manifest) || selection.some(item => item.kind !== 'audio')) throw invalid();
  const result = Object.fromEntries(answerFields.map(key => [key, value[key]]));
  if (!value.attachment_manifest.length && value.status === 'abstained') {
    if (typeof value.reason_code !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/u.test(value.reason_code)) throw invalid();
    return { result, notices: Object.freeze(selection.map((item, ordinal) => Object.freeze({ ordinal, media_kind: 'audio', status: 'failed', visual_sampled: false, reason: value.reason_code }))) };
  }
  if (value.attachment_manifest.length !== selection.length) throw invalid();
  const notices = [];
  for (let ordinal = 0; ordinal < selection.length; ordinal++) {
    const manifest = value.attachment_manifest[ordinal];
    if (!exact(manifest, fields) || manifest.ordinal !== ordinal || manifest.media_kind !== 'audio' || !hash(manifest.source_sha256)
      || !hash(manifest.content_sha256) || !text(manifest.compiler_revision) || manifest.text_code_points !== 0 || manifest.visual_count !== 0
      || manifest.visual_sampled !== false || !Array.isArray(manifest.selected_image_sha256) || manifest.selected_image_sha256.length
      || await digest(await selection[ordinal].file.arrayBuffer()) !== manifest.source_sha256) throw invalid();
    notices.push(Object.freeze({ ordinal, media_kind: 'audio', status: 'prepared', visual_sampled: false, reason: null }));
  }
  return { result, notices: Object.freeze(notices) };
}

export async function checkedSoundUpload(value, file) {
  checkedQueryAttachments([{ file, kind: 'audio' }]);
  if (!exact(value, ['document_id', 'source_revision_id', 'source_sha256', 'size_bytes']) || !id(value.document_id)
    || !id(value.source_revision_id) || value.size_bytes !== file.size || !hash(value.source_sha256)
    || await digest(await file.arrayBuffer()) !== value.source_sha256) throw invalid();
  return Object.freeze({ ...value });
}
