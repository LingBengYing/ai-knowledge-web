import { ApiError } from './api.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, max = 64000) => typeof value === 'string' && !!value.trim() && [...value].length <= max;
const invalid = () => new ApiError(502, '摘要或来源的身份、版本、定位或完整性无效，请刷新资料后核对。');
const pending = task => ['queued', 'processing'].includes(task?.state);
const kinds = ['text', 'image_ocr', 'image', 'audio_transcript', 'video_frame', 'video_transcript', 'video_ocr', 'video_subtitle'];
const timed = kind => kind.startsWith('audio_') || kind.startsWith('video_');
const mediaTypes = { document: ['application/pdf', 'text/plain', 'text/markdown'], image: ['image/png', 'image/jpeg'],
  audio: ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'], video: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'] };
const idle = () => ({ phase: 'idle', synopsis: null, task: null, error: null, sourcePhase: 'idle', source: null, sourceError: null });
const identity = item => JSON.stringify([item?.document_id, item?.index_publication_id, item?.active_revision_id, item?.filename,
  item?.document_type, item?.media_info, item?.synthetic_fixture, item?.can_edit]);
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export function synopsisEnabled(config) {
  return Array.isArray(config?.capabilities) && ['file_synopsis', 'synopsis_sources'].every(name => config.capabilities.includes(name));
}

function expected(item) {
  if (!item || item.synthetic_fixture || !id(item.document_id) || !id(item.index_publication_id) || !id(item.active_revision_id)
    || !text(item.filename, 255) || !mediaTypes[item.document_type]?.includes(item.media_info?.mime_type)
    || !hash(item.media_info?.sha256) || !integer(item.media_info?.size_bytes) || item.media_info.size_bytes < 1 || item.media_info.size_bytes > 20 * 1024 * 1024) throw invalid();
  return { document_id: item.document_id, publication_id: item.index_publication_id, revision_id: item.active_revision_id,
    source_sha256: item.media_info.sha256, filename: item.filename, media_type: item.media_info.mime_type, size: item.media_info.size_bytes, type: item.document_type };
}

export function canGenerateSynopsis(item) {
  try { expected(item); return item.can_edit === true; } catch { return false; }
}

function time(value) {
  if (!value || !integer(value.start_us) || !integer(value.end_us) || value.end_us <= value.start_us) throw invalid();
  return Object.freeze({ start_us: value.start_us, end_us: value.end_us });
}

function checkedDocument(value, wanted, task) {
  if (!value || !id(value.synopsis_id) || value.status !== 'available'
    || ['document_id', 'publication_id', 'revision_id', 'source_sha256'].some(key => value[key] !== wanted[key])
    || !hash(value.input_fingerprint) || !text(value.model_revision, 200) || !text(value.policy_revision, 200)
    || !Array.isArray(value.entries) || value.entries.length < 3 || value.entries.length > 32
    || (task?.state === 'available' && value.synopsis_id !== task.task_id)) throw invalid();
  const entries = value.entries.map((entry, index) => {
    if (!entry || entry.ordinal !== index + 1 || !['overview', 'topic', 'term', 'timeline'].includes(entry.section)
      || !text(entry.text, 1024) || !Array.isArray(entry.evidence) || !entry.evidence.length || entry.evidence.length > 8) throw invalid();
    const evidence = entry.evidence.map((reference, number) => {
      if (!reference || reference.ordinal !== number + 1 || !text(reference.evidence_id, 128) || !kinds.includes(reference.kind)
        || !hash(reference.sha256) || reference.source_url !== `/v1/synopsis-sources/${value.synopsis_id}/${index + 1}/${number + 1}`) throw invalid();
      const interval = timed(reference.kind) ? time(reference.time) : null;
      if (!interval && reference.time !== null) throw invalid();
      return Object.freeze({ ordinal: reference.ordinal, evidence_id: reference.evidence_id, kind: reference.kind, sha256: reference.sha256, time: interval, source_url: reference.source_url });
    });
    if (new Set(evidence.map(item => item.evidence_id)).size !== evidence.length) throw invalid();
    const interval = entry.section === 'timeline' ? time(entry.interval) : null;
    if (interval ? evidence.some(item => !item.time) || interval.start_us !== Math.min(...evidence.map(item => item.time.start_us))
      || interval.end_us !== Math.max(...evidence.map(item => item.time.end_us)) : entry.interval !== null) throw invalid();
    return Object.freeze({ ordinal: entry.ordinal, section: entry.section, text: entry.text, interval, evidence: Object.freeze(evidence) });
  });
  if (entries.filter(entry => entry.section === 'overview').length !== 1 || !entries.some(entry => entry.section === 'topic') || !entries.some(entry => entry.section === 'term')) throw invalid();
  return Object.freeze({ ...Object.fromEntries(['synopsis_id', 'document_id', 'publication_id', 'revision_id', 'source_sha256', 'input_fingerprint', 'model_revision', 'policy_revision', 'status'].map(key => [key, value[key]])), entries: Object.freeze(entries) });
}

function checkedTask(value, wanted, previous = null) {
  if (!value || !id(value.task_id) || value.document_id !== wanted.document_id || value.publication_id !== wanted.publication_id
    || !['queued', 'processing', 'available', 'unavailable', 'cancelled'].includes(value.state)
    || (['unavailable', 'cancelled'].includes(value.state) ? typeof value.error_code !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/u.test(value.error_code) : value.error_code !== null)
    || !Number.isFinite(Date.parse(value.created_at)) || !Number.isFinite(Date.parse(value.updated_at))
    || (previous && (previous.task_id !== value.task_id || (previous.state === 'processing' && value.state === 'queued')))) throw invalid();
  return Object.freeze(Object.fromEntries(['task_id', 'document_id', 'publication_id', 'state', 'error_code', 'created_at', 'updated_at'].map(key => [key, value[key]])));
}

function dimensions(locator) {
  if (!integer(locator.width) || !integer(locator.height) || locator.width < 1 || locator.height < 1 || locator.width * locator.height > 12_000_000) throw invalid();
}

function checkedSource(value, synopsis, entry, reference, wanted) {
  const kind = reference.kind, locator = value?.locator;
  const picture = ['image', 'video_frame'].includes(kind), framed = ['video_frame', 'video_ocr'].includes(kind);
  const origin = kind.includes('ocr') ? 'machine_ocr' : kind.includes('transcript') ? 'machine_asr' : kind === 'video_subtitle' ? 'embedded_subtitle' : picture ? 'machine_vlm' : 'original_text';
  const precision = !timed(kind) ? null : kind === 'video_subtitle' ? 'subtitle_cue' : framed ? 'frame_interval' : 'server_chunk';
  const locatorType = { text: 'page', image_ocr: 'page', image: 'image', audio_transcript: 'audio_span' }[kind] ?? kind;
  const fileType = kind === 'text' ? 'document' : kind.startsWith('image') ? 'image' : kind.startsWith('audio') ? 'audio' : 'video';
  if (!value || value.synopsis_id !== synopsis.synopsis_id || value.entry_ordinal !== entry.ordinal || value.source_ordinal !== reference.ordinal
    || ['evidence_id', 'kind', 'sha256'].some(key => value[key] !== reference[key]) || value.filename !== wanted.filename || value.media_type !== wanted.media_type || wanted.type !== fileType
    || value.proof_origin !== origin || value.time_precision !== precision || !locator || locator.type !== locatorType
    || (kind === 'image' && value.sha256 !== synopsis.source_sha256)
    || value.content_url !== `${reference.source_url}/content` || value.frame_url !== (framed ? `${reference.source_url}/frame` : null)
    || (picture ? value.text !== null : !text(value.text))) throw invalid();
  if (timed(kind) && JSON.stringify(time(locator)) !== JSON.stringify(reference.time)) throw invalid();
  if (['image', 'image_ocr', 'video_frame', 'video_ocr'].includes(kind)) dimensions(locator);
  if (['text', 'image_ocr'].includes(kind) && (!integer(locator.page) || locator.page < 1)) throw invalid();
  if (['text', 'image_ocr', 'video_ocr', 'video_subtitle'].includes(kind)
    && (!integer(locator.start_code_point) || !integer(locator.end_code_point) || locator.end_code_point <= locator.start_code_point || [...value.text].length !== locator.end_code_point - locator.start_code_point)) throw invalid();
  if (['audio_transcript', 'video_transcript'].includes(kind) && !integer(locator.span_ordinal)) throw invalid();
  if (kind === 'video_transcript' && !text(locator.span_id, 128)) throw invalid();
  if (framed && (!text(locator.frame_id, 128) || !integer(locator.frame_ordinal))) throw invalid();
  if (['text', 'image_ocr', 'video_ocr'].includes(kind)) {
    if (!Array.isArray(locator.regions) || (kind === 'text' && (locator.width !== null || locator.height !== null || locator.regions.length))) throw invalid();
    for (const region of locator.regions) {
      if (['start_code_point', 'end_code_point', 'left', 'top', 'right', 'bottom'].some(key => !integer(region[key]))
        || region.end_code_point <= region.start_code_point || region.start_code_point >= locator.end_code_point || region.end_code_point <= locator.start_code_point
        || region.right <= region.left || region.bottom <= region.top || region.right > locator.width || region.bottom > locator.height) throw invalid();
    }
  }
  if (kind === 'video_subtitle' && (!text(locator.cue_id, 128) || !text(locator.track_id, 128) || !integer(locator.stream_index) || !integer(locator.cue_ordinal)
    || !text(locator.codec, 100) || (locator.language !== null && typeof locator.language !== 'string') || !Number.isSafeInteger(locator.pts)
    || !integer(locator.duration) || locator.duration < 1 || !integer(locator.time_base_numerator) || locator.time_base_numerator < 1
    || !integer(locator.time_base_denominator) || locator.time_base_denominator < 1 || !text(locator.decoder_revision, 200) || !text(locator.text_format, 200)
    || ['payload_sha256', 'subtitle_manifest_sha256', 'native_manifest_sha256', 'track_text_sha256'].some(key => !hash(locator[key])))) throw invalid();
  return Object.freeze({ ...Object.fromEntries(['synopsis_id', 'entry_ordinal', 'source_ordinal', 'evidence_id', 'kind', 'sha256', 'filename', 'media_type', 'text', 'proof_origin', 'time_precision', 'content_url', 'frame_url'].map(key => [key, value[key]])), locator: structuredClone(locator) });
}

/** Persistent summary navigation, with independent bounded task polling and current-source rereads. */
export class SynopsisSession {
  #request; #change; #authentication; #setTimer; #clearTimer; #timer = null; #urls; #blobs = new Set();
  #epoch = 0; #sourceEpoch = 0; #controller = null; #sourceController = null; #identity = null; #wanted = null;
  value = Object.freeze(idle());

  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, objectUrls = URL } = {}) {
    this.#request = request; this.#change = onChange; this.#authentication = onAuthenticationFailure;
    this.#setTimer = setTimer; this.#clearTimer = clearTimer; this.#urls = objectUrls;
  }
  matches(item) { return this.#identity === identity(item); }
  #publish(value) { this.value = Object.freeze(value); this.#change(this.value); }
  #stopTimer() { if (this.#timer !== null) this.#clearTimer(this.#timer); this.#timer = null; }
  #release() { for (const url of this.#blobs) this.#urls.revokeObjectURL(url); this.#blobs.clear(); }
  closeSource() {
    this.#sourceEpoch++; this.#sourceController?.abort(); this.#sourceController = null; this.#release();
    this.#publish({ ...this.value, sourcePhase: 'idle', source: null, sourceError: null });
  }
  close() {
    this.#epoch++; this.#controller?.abort(); this.#controller = null; this.#stopTimer();
    this.#sourceEpoch++; this.#sourceController?.abort(); this.#sourceController = null; this.#release();
    this.#identity = null; this.#wanted = null; this.#publish(idle());
  }
  async open(item) {
    this.close(); this.#identity = identity(item);
    try { this.#wanted = expected(item); }
    catch (error) { this.#publish({ ...idle(), phase: 'error', error }); return this.value; }
    return this.#run('loading', (signal, current) => this.#load(signal, current));
  }
  async create(item) {
    if (!this.matches(item) || !canGenerateSynopsis(item) || ['loading', 'creating', 'processing'].includes(this.value.phase)) return this.value;
    return this.#run('creating', async (signal, current) => {
      const value = await this.#request(`/v1/documents/${this.#wanted.document_id}/synopsis`, { method: 'POST', signal });
      if (!current()) return;
      await this.#acceptTask(checkedTask(value, this.#wanted), signal, current);
    });
  }
  async refresh() {
    if (!this.#wanted || ['loading', 'creating'].includes(this.value.phase)) return this.value;
    const task = this.value.task;
    return this.#run('loading', async (signal, current) => {
      if (pending(task)) {
        const value = await this.#request(`/v1/synopsis-tasks/${task.task_id}`, { signal });
        if (current()) await this.#acceptTask(checkedTask(value, this.#wanted, task), signal, current);
      } else await this.#load(signal, current);
    });
  }
  async #acceptTask(task, signal, current) {
    this.#publish({ ...this.value, task, phase: pending(task) ? 'processing' : task.state === 'available' ? 'loading' : 'unavailable' });
    if (!current()) return;
    if (task.state === 'available') await this.#load(signal, current);
    else if (pending(task)) this.#timer = this.#setTimer(() => { this.#timer = null; return this.refresh(); }, 1500);
  }
  async #load(signal, current) {
    let value;
    try { value = await this.#request(`/v1/documents/${this.#wanted.document_id}/synopsis`, { signal }); }
    catch (error) {
      if (current() && error?.status === 404) { this.#publish({ ...this.value, phase: 'unavailable', synopsis: null, error: null }); return; }
      throw error;
    }
    if (current()) this.#publish({ ...this.value, phase: 'ready', synopsis: checkedDocument(value, this.#wanted, this.value.task), error: null });
  }
  async #run(phase, action) {
    this.#stopTimer(); this.#controller?.abort(); this.closeSource();
    const epoch = ++this.#epoch, controller = new AbortController(); this.#controller = controller;
    const current = () => epoch === this.#epoch && !controller.signal.aborted;
    this.#publish({ ...this.value, phase, synopsis: null, error: null });
    try { await action(controller.signal, current); }
    catch (error) {
      if (current()) {
        this.#stopTimer(); this.#publish({ ...this.value, phase: 'error', synopsis: null, error });
        if (error?.status === 401) this.#authentication(error);
      }
    } finally { if (this.#controller === controller) this.#controller = null; }
    return this.value;
  }
  async readSource(entryOrdinal, sourceOrdinal) {
    this.closeSource();
    const epoch = this.#epoch, sequence = this.#sourceEpoch, synopsis = this.value.synopsis;
    const entry = synopsis?.entries.find(item => item.ordinal === entryOrdinal), reference = entry?.evidence.find(item => item.ordinal === sourceOrdinal);
    if (!reference) { this.#publish({ ...this.value, sourcePhase: 'error', sourceError: invalid() }); return this.value; }
    const controller = new AbortController(); this.#sourceController = controller;
    const current = () => epoch === this.#epoch && sequence === this.#sourceEpoch && !controller.signal.aborted;
    this.#publish({ ...this.value, sourcePhase: 'loading', source: null, sourceError: null });
    try {
      const value = await this.#request(reference.source_url, { signal: controller.signal });
      if (!current()) return this.value;
      const source = checkedSource(value, synopsis, entry, reference, this.#wanted);
      if (source.text !== null && await digest(new TextEncoder().encode(source.text)) !== reference.sha256) throw invalid();
      if (!current()) return this.value;
      const original = await this.#blob(source.content_url, [source.media_type], synopsis.source_sha256, 20, controller.signal, current, this.#wanted.size);
      if (!current()) return this.value;
      const frame = source.frame_url ? await this.#blob(source.frame_url, mediaTypes.image, source.kind === 'video_frame' ? source.sha256 : null, 10, controller.signal, current) : null;
      if (!current()) return this.value;
      this.#publish({ ...this.value, sourcePhase: 'ready', source: Object.freeze({ ...source, originalUrl: original.url, frameUrl: frame?.url ?? null }), sourceError: null });
    } catch (error) {
      if (current()) {
        this.#release(); this.#publish({ ...this.value, sourcePhase: 'error', source: null, sourceError: error });
        if (error?.status === 401) this.#authentication(error);
      }
    } finally { if (this.#sourceController === controller) this.#sourceController = null; }
    return this.value;
  }
  async #blob(path, types, expectedSha, maxMiB, signal, current, size = null) {
    const blob = await this.#request(path, { signal, binary: true });
    if (!current()) return null;
    if (!(blob instanceof Blob) || !types.includes(blob.type) || !blob.size || blob.size > maxMiB * 1024 * 1024 || (size !== null && blob.size !== size)) throw invalid();
    const bytes = await blob.arrayBuffer();
    if (expectedSha && await digest(bytes) !== expectedSha) throw invalid();
    if (!current()) return null;
    const url = this.#urls.createObjectURL(blob); this.#blobs.add(url); return { url };
  }
}
