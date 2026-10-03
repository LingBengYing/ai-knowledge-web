import { ApiError } from './api.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const traceId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = (value, max = 200) => typeof value === 'string' && !!value.trim() && [...value].length <= max
  && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value);
const bytes = value => new TextEncoder().encode(value);
const types = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
export const videoAvModes = ['video-av-visual', 'video-av-audio', 'video-av-joint'];
const modes = ['VISUAL', 'AUDIO', 'JOINT'];
const invalid = () => new ApiError(502, '原视频音画结果的来源、事实、模型或时间身份无效，请刷新后核对。');
const exact = (value, fields) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const digest = async content => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)), byte => byte.toString(16).padStart(2, '0')).join('');
const indexFields = ['status', 'document_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint', 'model_revision',
  'embedding_model_revision', 'dimensions', 'publication_id', 'generation_id', 'manifest_sha256', 'window_count', 'video_window_count', 'audio_window_count'];
const answerFields = ['answer_id', 'status', 'mode', 'answer', 'reason_code', 'citations', 'policy_revision'];
const identity = row => JSON.stringify([row?.document_id, row?.document_type, row?.synthetic_fixture, row?.can_edit,
  row?.active_revision_id, row?.registered_revision_id, row?.index_publication_id, row?.media_info]);
const idle = () => ({ phase: 'idle', index: null, error: null });

export function videoAvEnabled(config) {
  return ['video_av_upload', 'video_av_index', 'video_av_answers', 'video_av_sources']
    .every(name => config?.capabilities?.includes(name));
}

export function videoAvQueryAttachmentsEnabled(config) {
  return Array.isArray(config?.capabilities) && config.capabilities.includes('video_av_query_attachments') && videoAvEnabled(config);
}

const queryReceiptFields = ['ordinal', 'source_sha256', 'media_kind', 'compiler_revision', 'content_sha256',
  'window_count', 'visual_window_count', 'audio_window_count', 'audio_present', 'used_mode', 'status'];

/** Preparation receipts describe reference inputs; only the nested library result is evidence. */
export function checkedVideoAvQueryResponse(value, sourceShas, mode) {
  if (!modes.includes(mode) || !Array.isArray(sourceShas) || sourceShas.length < 1 || sourceShas.length > 3
    || !sourceShas.every(hash) || !exact(value, ['mode', 'result', 'query_attachments'])
    || value.mode !== mode || value.result?.mode !== mode || !Array.isArray(value.query_attachments)
    || value.query_attachments.length !== sourceShas.length) throw invalid();
  let compiler, status, windowCount = 0;
  const notices = value.query_attachments.map((item, ordinal) => {
    if (!exact(item, queryReceiptFields) || item.ordinal !== ordinal || item.source_sha256 !== sourceShas[ordinal]
      || item.media_kind !== 'video' || item.used_mode !== mode || !text(item.compiler_revision)
      || !['prepared', 'not_prepared'].includes(item.status)
      || ordinal > 0 && (item.compiler_revision !== compiler || item.status !== status)) throw invalid();
    compiler = item.compiler_revision; status = item.status;
    if (item.status === 'not_prepared') {
      if (value.result.status !== 'abstained' || ['content_sha256', 'window_count', 'visual_window_count', 'audio_window_count', 'audio_present']
        .some(field => item[field] !== null)) throw invalid();
    } else {
      if (!hash(item.content_sha256) || !Number.isSafeInteger(item.window_count) || item.window_count < 1 || item.window_count > 1201
        || !Number.isSafeInteger(item.visual_window_count) || item.visual_window_count < 1 || item.visual_window_count > item.window_count
        || !Number.isSafeInteger(item.audio_window_count) || item.audio_window_count < 0 || item.audio_window_count > item.window_count
        || item.visual_window_count + item.audio_window_count < item.window_count
        || typeof item.audio_present !== 'boolean' || item.audio_present !== (item.audio_window_count > 0)
        || mode !== 'VISUAL' && !item.audio_present) throw invalid();
      windowCount += item.window_count;
    }
    return Object.freeze(Object.fromEntries(queryReceiptFields.map(field => [field, item[field]])));
  });
  if (windowCount > 1201) throw invalid();
  return { result: value.result, notices: Object.freeze(notices) };
}

export function canReadVideoAvIndex(row) {
  return !!row && id(row.document_id) && row.document_type === 'video' && row.synthetic_fixture === false
    && typeof row.can_edit === 'boolean' && types.includes(row.media_info?.mime_type) && hash(row.media_info.sha256)
    && Number.isSafeInteger(row.media_info.size_bytes) && row.media_info.size_bytes > 0 && row.media_info.size_bytes <= 20 * 1024 * 1024;
}

function checkedIndex(value, row, previous = null) {
  if (!canReadVideoAvIndex(row) || !exact(value, indexFields) || value.document_id !== row.document_id
    || value.source_sha256 !== row.media_info.sha256 || !id(value.source_revision_id) || ((row.registered_revision_id ?? row.latest_job?.revision_id ?? row.active_revision_id) != null && value.source_revision_id !== (row.registered_revision_id ?? row.latest_job?.revision_id ?? row.active_revision_id)) || !hash(value.profile_fingerprint)
    || !text(value.model_revision) || !text(value.embedding_model_revision) || !Number.isSafeInteger(value.dimensions)
    || value.dimensions < 2 || value.dimensions > 3072 || !['missing', 'available'].includes(value.status)
    || (value.status === 'missing' ? value.publication_id !== null || value.generation_id !== null || value.manifest_sha256 !== null || value.window_count !== 0 || value.video_window_count !== 0 || value.audio_window_count !== 0
      : !id(value.publication_id) || value.generation_id !== value.publication_id || !hash(value.manifest_sha256) || !Number.isSafeInteger(value.window_count) || value.window_count < 1 || value.window_count > 1201
        || !Number.isSafeInteger(value.video_window_count) || value.video_window_count < 1 || value.video_window_count > value.window_count
        || !Number.isSafeInteger(value.audio_window_count) || value.audio_window_count < 0 || value.audio_window_count > value.window_count
        || value.video_window_count + value.audio_window_count < value.window_count)
    || (previous && (value.status !== 'available' || ['document_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint',
      'model_revision', 'embedding_model_revision', 'dimensions'].some(key => value[key] !== previous[key])))) throw invalid();
  return Object.freeze(Object.fromEntries(indexFields.map(key => [key, value[key]])));
}

/** Explicit continuous-video and complete-sound indexing; no ASR prerequisite. */
export class VideoAvIndexSession {
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
    if (!canReadVideoAvIndex(row)) throw invalid();
    if (this.matches(row) && ['loading', 'building'].includes(this.value.phase)) return;
    this.close(); this.identity = identity(row); const serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ ...idle(), phase: 'loading' });
    try {
      const result = await this.request(`/v1/documents/${encodeURIComponent(row.document_id)}/video-av-index`, { signal: controller.signal });
      if (serial !== this.serial || !this.matches(row)) return;
      this.emit({ phase: 'ready', index: checkedIndex(result, row), error: null });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error }); if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (this.controller === controller) this.controller = null; }
  }
  async build(row) {
    if (!canReadVideoAvIndex(row) || row.can_edit !== true || !this.matches(row) || this.value.phase !== 'ready' || this.value.index?.status !== 'missing') return;
    const previous = this.value.index, serial = ++this.serial, controller = new AbortController(); this.controller = controller;
    this.emit({ phase: 'building', index: previous, error: null });
    try {
      const result = await this.request(`/v1/documents/${encodeURIComponent(row.document_id)}/video-av-index`, { method: 'POST', signal: controller.signal });
      if (serial !== this.serial || !this.matches(row)) return;
      this.emit({ phase: 'ready', index: checkedIndex(result, row, previous), error: null });
    } catch (error) {
      if (serial !== this.serial) return;
      this.emit({ ...idle(), phase: 'error', error }); if (error?.status === 401) this.onAuthenticationFailure(error);
    } finally { if (this.controller === controller) this.controller = null; }
  }
}

const citationFields = ['number', 'kind', 'mode', 'document_id', 'revision_id', 'source_sha256', 'publication_id',
  'profile_fingerprint', 'decoder_revision', 'filename', 'media_type', 'epoch', 'window', 'facts', 'facts_sha256',
  'analysis_model_revision', 'policy_revision', 'time_precision', 'source_url', 'content_url'];
const factFields = ['id', 'text', 'requirement', 'visual_contribution', 'audio_contribution'];
const long = (value, signed = false) => {
  if (typeof value !== 'string' || !(signed ? /^(?:0|-[1-9][0-9]{0,18}|[1-9][0-9]{0,18})$/u : /^(?:0|[1-9][0-9]{0,18})$/u).test(value)) throw invalid();
  const result = BigInt(value);
  if (result < (signed ? -9223372036854775808n : 0n) || result > 9223372036854775807n) throw invalid();
  return result;
};
const gcd = (a, b) => { while (b) { const remainder = a % b; a = b; b = remainder; } return a; };

function checkedEpoch(value) {
  if (!exact(value, ['pts', 'time_base_num', 'time_base_den', 'ticks_per_second'])) throw invalid();
  long(value.pts, true);
  const num = long(value.time_base_num), den = long(value.time_base_den), rate = long(value.ticks_per_second);
  if (num < 1n || den < 1n || num > 10000000000n || den > 10000000000n || gcd(num, den) !== 1n
    || rate !== den / gcd(den, 16000n) * 16000n) throw invalid();
  return Object.freeze({ ...value });
}

function checkedWindow(value, epoch) {
  if (!exact(value, ['id', 'ordinal', 'start_tick', 'end_tick', 'start_ms', 'end_ms', 'video', 'audio'])
    || !id(value.id) || !Number.isSafeInteger(value.ordinal) || value.ordinal < 0 || value.ordinal >= 1201) throw invalid();
  const rate = long(epoch.ticks_per_second), start = long(value.start_tick), end = long(value.end_tick);
  if (end <= start || end > 600n * rate || end - start > 30n * rate
    || value.start_ms !== Number(start * 1000n / rate) || value.end_ms !== Number((end * 1000n + rate - 1n) / rate)) throw invalid();
  let video = null, audio = null;
  if (value.video !== null) {
    const v = value.video;
    if (!exact(v, ['clip_sha256', 'frame_count', 'frames_manifest_sha256', 'first_local_tick', 'end_local_tick'])
      || !hash(v.clip_sha256) || !hash(v.frames_manifest_sha256) || !Number.isSafeInteger(v.frame_count)
      || v.frame_count < 1 || v.frame_count > 2147483647) throw invalid();
    const first = long(v.first_local_tick), last = long(v.end_local_tick);
    if (last <= first || last > end - start) throw invalid();
    video = Object.freeze({ ...v });
  }
  if (value.audio !== null) {
    const a = value.audio;
    if (!exact(a, ['pcm_sha256', 'wav_sha256', 'start_sample', 'end_sample', 'sample_rate'])
      || !hash(a.pcm_sha256) || !hash(a.wav_sha256) || a.sample_rate !== 16000) throw invalid();
    const first = long(a.start_sample), last = long(a.end_sample);
    if (first !== start * 16000n / rate || last <= first || last > end * 16000n / rate
      || last > 9600000n || last - first > 480000n) throw invalid();
    audio = Object.freeze({ ...a });
  }
  if (video === null && audio === null) throw invalid();
  return Object.freeze({ ...value, video, audio });
}

async function checkedCitation(value, answerId, ordinal, mode) {
  if (!exact(value, citationFields) || value.number !== ordinal || ordinal < 1 || ordinal > 32
    || value.kind !== 'video_av_window' || value.mode !== mode || !modes.includes(mode)
    || ['document_id', 'revision_id', 'publication_id'].some(key => !id(value[key]))
    || ['source_sha256', 'profile_fingerprint', 'facts_sha256'].some(key => !hash(value[key]))
    || ['decoder_revision', 'analysis_model_revision'].some(key => !text(value[key])) || !text(value.filename, 255)
    || !types.includes(value.media_type) || value.policy_revision !== 'java-video-av-answer-v1'
    || value.time_precision !== 'server_window' || value.source_url !== `/v1/video-av-sources/${answerId}/${ordinal}`
    || value.content_url !== `${value.source_url}/content` || !Array.isArray(value.facts)
    || value.facts.length < 1 || value.facts.length > 16) throw invalid();
  const epoch = checkedEpoch(value.epoch), window = checkedWindow(value.window, epoch);
  if (mode !== 'AUDIO' && window.video === null || mode !== 'VISUAL' && window.audio === null) throw invalid();
  const facts = value.facts.map(fact => {
    if (!exact(fact, factFields) || !hash(fact.id) || !text(fact.text, 1024) || !modes.includes(fact.requirement)
      || typeof fact.visual_contribution !== 'boolean' || typeof fact.audio_contribution !== 'boolean'
      || fact.visual_contribution !== (fact.requirement !== 'AUDIO') || fact.audio_contribution !== (fact.requirement !== 'VISUAL')
      || mode !== 'JOINT' && fact.requirement !== mode) throw invalid();
    return Object.freeze(Object.fromEntries(factFields.map(key => [key, fact[key]])));
  });
  if (new Set(facts.map(fact => fact.id)).size !== facts.length || new Set(facts.map(fact => fact.text)).size !== facts.length
    || facts.reduce((sum, fact) => sum + bytes(fact.text).length, 0) > 8192
    || mode === 'JOINT' && (!facts.some(fact => fact.visual_contribution) || !facts.some(fact => fact.audio_contribution))
    || await digest(bytes(JSON.stringify(facts))) !== value.facts_sha256) throw invalid();
  return Object.freeze({ ...Object.fromEntries(citationFields.map(key => [key, value[key]])), epoch, window, facts: Object.freeze(facts) });
}

export async function checkedVideoAvAnswer(value, expectedMode) {
  if (!exact(value, answerFields) || !traceId(value.answer_id) || value.mode !== expectedMode || !modes.includes(expectedMode)
    || !['answered', 'abstained'].includes(value.status) || typeof value.answer !== 'string' || !value.answer.trim()
    || bytes(value.answer).length > 8207 || value.policy_revision !== 'java-video-av-answer-v1'
    || !Array.isArray(value.citations) || value.citations.length > 32
    || (value.status === 'answered' ? value.reason_code !== null || !value.citations.length
      : typeof value.reason_code !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/u.test(value.reason_code) || value.citations.length)) throw invalid();
  const citations = [];
  for (let i = 0; i < value.citations.length; i++) citations.push(await checkedCitation(value.citations[i], value.answer_id, i + 1, expectedMode));
  if (citations.length && citations.some(citation => citation.facts.map(fact => fact.text).join('\n') !== value.answer)) throw invalid();
  return Object.freeze({ answer_id: value.answer_id, status: value.status, mode: value.mode, answer: value.answer,
    reason: value.reason_code, policy_revision: value.policy_revision, citations: Object.freeze(citations) });
}

export async function checkedVideoAvSource(value, answerId, expected) {
  if (!exact(value, ['answer_id', 'citation']) || value.answer_id !== answerId || !traceId(answerId)) throw invalid();
  const citation = await checkedCitation(value.citation, answerId, expected.number, expected.mode);
  if (citationFields.some(key => JSON.stringify(citation[key]) !== JSON.stringify(expected[key]))) throw invalid();
  return citation;
}

export async function checkedVideoAvUpload(value, file) {
  if (!(file instanceof Blob) || typeof file.name !== 'string' || !/\.(?:mp4|mov|webm|mkv)$/iu.test(file.name)
    || !file.size || file.size > 20 * 1024 * 1024 || !exact(value, ['document_id', 'source_revision_id', 'source_sha256', 'size_bytes'])
    || !id(value.document_id) || !id(value.source_revision_id) || value.size_bytes !== file.size || !hash(value.source_sha256)
    || await digest(await file.arrayBuffer()) !== value.source_sha256) throw invalid();
  return Object.freeze({ ...value });
}
