import { ApiError } from './api.mjs';
import { mediaModes, checkedMediaCitation } from './media-sources.mjs';
import { checkedQueryAttachments, encodeQueryAttachments, encodeQueryAttachmentsWithHashes, attachmentMode, checkedAttachmentResponse } from './query-attachments.mjs';
import { videoAvModes, videoAvEnabled, checkedVideoAvAnswer, checkedVideoAvSource, checkedVideoAvQueryResponse } from './video-av.mjs';
import { checkedSoundAnswer, checkedSoundSource, checkedSoundAttachments, soundEnabled } from './sound-library.mjs';

const sourceId = /^[A-Za-z0-9_-]{1,128}$/u;
const documentId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const citationFields = ['number', 'document_id', 'revision_id', 'source_sha256', 'parser_revision',
  'filename', 'page', 'start', 'end', 'quote', 'quote_sha256', 'source_url'];
const visualFields = ['number', 'kind', 'document_id', 'revision_id', 'source_sha256', 'parser_revision',
  'filename', 'media_type', 'width', 'height', 'bbox', 'coordinate_system', 'model_revision', 'policy_revision', 'source_url', 'content_url'];
const idle = () => ({ phase: 'idle', result: null, error: null, queryAttachments: Object.freeze([]), sourcePhase: 'idle', source: null, sourceError: null });
const invalidResponse = () => new ApiError(502, '服务器返回的答案或来源格式无效，请刷新后核对。');

export function answersEnabled(config, mode = 'text') {
  if (!['text', 'visual', ...mediaModes].includes(mode)) return false;
  if (videoAvModes.includes(mode)) return videoAvEnabled(config);
  if (mode === 'sound') return soundEnabled(config);
  const prefix = mode.startsWith('video-') ? 'video' : mode;
  const capabilities = mode === 'text' ? ['answers', 'sources'] : [`${prefix}_answers`, `${prefix}_sources`];
  return Array.isArray(config?.capabilities)
    && capabilities.every(name => config.capabilities.includes(name));
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

function checkedImageGeometry(value, mime) {
  if (!value || !['image/png', 'image/jpeg'].includes(mime)
    || !Number.isSafeInteger(value.width) || value.width < 1
    || !Number.isSafeInteger(value.height) || value.height < 1 || value.width * value.height > 12_000_000
    || value.coordinate_system !== 'normalized_xyxy'
    || JSON.stringify(value.bbox) !== '[0,0,1,1]') throw invalidResponse();
}

function checkedVisualCitation(value, answerId, ordinal) {
  checkedImageGeometry(value, value?.media_type);
  if (value.number !== ordinal || value.kind !== 'image_region'
    || typeof value.document_id !== 'string' || !documentId.test(value.document_id)
    || typeof value.revision_id !== 'string' || !documentId.test(value.revision_id)
    || typeof value.source_sha256 !== 'string' || !sha256.test(value.source_sha256)
    || ['parser_revision', 'filename', 'model_revision', 'policy_revision'].some(key => typeof value[key] !== 'string' || !value[key])
    || ['page', 'start', 'end', 'quote', 'quote_sha256'].some(key => key in value)
    || value.source_url !== `/v1/visual-sources/${answerId}/${ordinal}`
    || value.content_url !== `${value.source_url}/content`) throw invalidResponse();
  return Object.freeze(Object.fromEntries(visualFields.map(field => [field, field === 'bbox' ? Object.freeze([...value.bbox]) : value[field]])));
}

function checkedOcrImage(value, citation) {
  checkedImageGeometry(value, value?.mime_type);
  if (value.type !== 'image' || value.text_origin !== 'machine_ocr'
    || value.content_url !== `${citation.source_url}/content`) throw invalidResponse();
  const regions = [];
  const hasRegions = value.region_kind != null || value.regions != null;
  if (hasRegions || citation.parser_revision.startsWith('java-image-ocr-v2-tsv:')) {
    if (value.region_kind !== 'ocr_word' || !Array.isArray(value.regions) || !value.regions.length) throw invalidResponse();
    let previousEnd = -1;
    for (const region of value.regions) {
      if (!Number.isSafeInteger(region.start) || !Number.isSafeInteger(region.end)
        || region.start < 0 || region.start < previousEnd || region.end <= region.start
        || region.start >= citation.end || region.end <= citation.start
        || !Array.isArray(region.bbox) || region.bbox.length !== 4
        || region.bbox.some(value => !Number.isFinite(value) || value < 0 || value > 1)
        || region.bbox[0] >= region.bbox[2] || region.bbox[1] >= region.bbox[3]) throw invalidResponse();
      previousEnd = region.end;
      regions.push(Object.freeze({ start: region.start, end: region.end, bbox: Object.freeze([...region.bbox]) }));
    }
  }
  return Object.freeze({ type: 'image', mime_type: value.mime_type, width: value.width, height: value.height,
    bbox: Object.freeze([...value.bbox]), coordinate_system: value.coordinate_system, text_origin: value.text_origin,
    content_url: value.content_url, region_kind: hasRegions ? 'ocr_word' : null, regions: Object.freeze(regions) });
}

function checkedAnswer(value, mode) {
  if (!value || typeof value !== 'object' || typeof value.answer_id !== 'string' || !sourceId.test(value.answer_id)
    || !['answered', 'abstained'].includes(value.status)
    || typeof value.answer !== 'string' || !value.answer.trim()
    || !Array.isArray(value.citations) || value.citations.length > 32) throw invalidResponse();
  if (value.status === 'answered' && (value.reason !== null || !value.citations.length)) throw invalidResponse();
  if (value.status === 'abstained' && (typeof value.reason !== 'string'
    || !/^[a-z][a-z0-9_]{0,99}$/u.test(value.reason) || value.citations.length)) throw invalidResponse();
  const check = mediaModes.includes(mode) ? checkedMediaCitation : mode === 'visual' ? checkedVisualCitation : checkedCitation;
  const citations = value.citations.map((item, index) => check(item, value.answer_id, index + 1, mode));
  return Object.freeze({ answer_id: value.answer_id, status: value.status, answer: value.answer,
    reason: value.reason, citations: Object.freeze(citations) });
}

function checkedSource(value, answerId, expected, mode) {
  if (!value || value.answer_id !== answerId) throw invalidResponse();
  if (mediaModes.includes(mode)) {
    const citation = checkedMediaCitation(value.citation, answerId, expected.number, mode);
    if (JSON.stringify(citation) !== JSON.stringify(expected)) throw invalidResponse();
    return citation;
  }
  const citation = (mode === 'visual' ? checkedVisualCitation : checkedCitation)(value.citation, answerId, expected.number);
  const fields = mode === 'visual' ? visualFields : citationFields;
  if (fields.some(field => JSON.stringify(citation[field]) !== JSON.stringify(expected[field]))) throw invalidResponse();
  if (mode === 'visual') return { ...citation, image: citation };
  if (value.image != null) return { ...citation, image: checkedOcrImage(value.image, citation) };
  if (citation.parser_revision.startsWith('java-image-ocr-')) throw invalidResponse();
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
  #mode = 'text';
  #objectUrls;
  #imageUrl = null;
  #canReadImage;
  #canUseAttachments;
  #canUseVideoAvAttachments;
  #canReadOriginal;
  #mediaUrls = new Set();

  constructor(request, { onChange = () => {}, onAuthenticationFailure = () => {}, objectUrls = URL, canReadImage = () => true, canUseAttachments = () => false, canUseVideoAvAttachments = () => false, canReadOriginal = () => false } = {}) {
    this.#request = request;
    this.#onChange = onChange;
    this.#onAuthenticationFailure = onAuthenticationFailure;
    this.#objectUrls = objectUrls;
    this.#canReadImage = canReadImage;
    this.#canUseAttachments = canUseAttachments;
    this.#canUseVideoAvAttachments = canUseVideoAvAttachments;
    this.#canReadOriginal = canReadOriginal;
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
    this.#releaseImage();
  }

  #releaseImage() {
    if (this.#imageUrl) this.#objectUrls.revokeObjectURL(this.#imageUrl);
    this.#imageUrl = null;
    for (const url of this.#mediaUrls) this.#objectUrls.revokeObjectURL(url);
    this.#mediaUrls.clear();
  }

  closeSource() {
    this.#sourceSequence += 1;
    this.#sourceController?.abort();
    this.#sourceController = null;
    this.#releaseImage();
    this.#publish({ ...this.value, sourcePhase: 'idle', source: null, sourceError: null });
  }

  reset() {
    this.#invalidate();
    this.#publish(idle());
  }

  // Cancels local waiting only. There is no server task-cancellation endpoint for answers.
  cancel() { this.reset(); }

  async ask(question, documentIds = null, mode = 'text', attachments = []) {
    this.#invalidate();
    const epoch = this.#epoch;
    let body, selection, sourceShas;
    try {
      if (!['text', 'visual', ...mediaModes].includes(mode)) throw new ApiError(422, '请选择已支持的证据类型。');
      body = answerRequest(question, documentIds);
      selection = checkedQueryAttachments(attachments);
      if (videoAvModes.includes(mode) && selection.length) {
        if (!this.#canUseVideoAvAttachments(mode)) throw new ApiError(503, '当前服务未启用原视频参考附件，请移除附件后提问。');
        if (selection.some(item => item.kind !== 'video')) throw new ApiError(422, '原视频音画参考只接受视频原件，请移除图片或音频附件。');
      }
      if (mode === 'sound' && selection.some(item => item.kind !== 'audio')) throw new ApiError(422, '声音理解只接受原音频查询附件，请移除图片或视频。');
      if (selection.length && !videoAvModes.includes(mode) && !this.#canUseAttachments(mode)) throw new ApiError(503, '当前服务未启用查询附件，请移除附件后提问，或联系管理员启用。');
      if (!selection.length && mode.startsWith('video-')) body.mode = videoAvModes.includes(mode) ? mode.slice('video-av-'.length).toUpperCase() : mode.slice('video-'.length);
    }
    catch (error) { this.#publish({ ...idle(), phase: 'error', error }); return this.value; }
    const controller = new AbortController();
    this.#answerController = controller;
    this.#mode = mode;
    this.#publish({ ...idle(), phase: 'loading' });
    try {
      if (selection.length) {
        if (videoAvModes.includes(mode)) {
          const prepared = await encodeQueryAttachmentsWithHashes(selection, controller.signal);
          sourceShas = prepared.sourceShas;
          body = { ...body, mode: mode.slice('video-av-'.length).toUpperCase(), attachments: prepared.attachments };
        } else body = { ...body, mode: attachmentMode(mode), attachments: await encodeQueryAttachments(selection, controller.signal) };
        if (epoch !== this.#epoch) return this.value;
      }
      const prefix = videoAvModes.includes(mode) ? 'video-av' : mode.startsWith('video-') ? 'video' : mode;
      const response = await this.#request(selection.length ? (videoAvModes.includes(mode) ? '/v1/video-av-query-answers' : mode === 'sound' ? '/v1/sound-query-answers' : '/v1/attachment-answers') : mode === 'text' ? '/v1/answers' : `/v1/${prefix}-answers`, { method: 'POST', body, signal: controller.signal });
      if (epoch !== this.#epoch) return this.value;
      const unwrapped = selection.length ? (videoAvModes.includes(mode) ? checkedVideoAvQueryResponse(response, sourceShas, body.mode) : mode === 'sound' ? await checkedSoundAttachments(response, selection) : checkedAttachmentResponse(response, mode, selection)) : { result: response, notices: Object.freeze([]) };
      const result = videoAvModes.includes(mode) ? await checkedVideoAvAnswer(unwrapped.result, body.mode) : mode === 'sound' ? await checkedSoundAnswer(unwrapped.result) : checkedAnswer(unwrapped.result, mode);
      if (epoch !== this.#epoch) return this.value;
      this.#publish({ ...idle(), phase: result.status, result, queryAttachments: unwrapped.notices });
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
    this.#releaseImage();
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
      let source = videoAvModes.includes(this.#mode) ? await checkedVideoAvSource(response, result.answer_id, expected) : this.#mode === 'sound' ? await checkedSoundSource(response, result.answer_id, expected) : checkedSource(response, result.answer_id, expected, this.#mode);
      if (epoch !== this.#epoch || sequence !== this.#sourceSequence) return this.value;
      if (source.image) {
        if (!this.#canReadImage(this.#mode)) throw new ApiError(503, '服务未启用此来源的原图读取。');
        const blob = await this.#request(source.image.content_url, { binary: true, signal: controller.signal });
        if (epoch !== this.#epoch || sequence !== this.#sourceSequence) return this.value;
        if (!(blob instanceof Blob) || !blob.size || blob.size > 10 * 1024 * 1024
          || blob.type !== (source.image.mime_type ?? source.image.media_type)) throw invalidResponse();
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        if (epoch !== this.#epoch || sequence !== this.#sourceSequence) return this.value;
        if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== source.source_sha256) throw invalidResponse();
        this.#imageUrl = this.#objectUrls.createObjectURL(blob);
        source = Object.freeze({ ...source, imageUrl: this.#imageUrl });
      } else if (mediaModes.includes(this.#mode)) {
        const current = () => epoch === this.#epoch && sequence === this.#sourceSequence;
        const mediaUrl = await this.#loadMedia(source.content_url, source.media_type, source.source_sha256, controller.signal, current, 20);
        if (!current()) return this.value;
        let frameUrl = null;
        if (source.frame) frameUrl = await this.#loadMedia(source.frame.content_url, source.frame.media_type, source.frame.frame_sha256, controller.signal, current, 10);
        if (!current()) return this.value;
        source = Object.freeze({ ...source, mediaUrl, frameUrl });
      } else if (this.#mode === 'text' && /\.pdf$/iu.test(source.filename) && this.#canReadOriginal()) {
        const current = () => epoch === this.#epoch && sequence === this.#sourceSequence;
        if (!sourceId.test(source.document_id) || !sourceId.test(source.revision_id) || source.page > 500) throw invalidResponse();
        const original = await this.#request(`/v1/documents/${source.document_id}/original`, { signal: controller.signal });
        if (!current()) return this.value;
        if (!original || ['document_id', 'revision_id', 'filename', 'source_sha256'].some(key => original[key] !== source[key])
          || original.document_type !== 'document' || original.media_type !== 'application/pdf'
          || !Number.isSafeInteger(original.size_bytes) || original.size_bytes < 1 || original.size_bytes > 20 * 1024 * 1024
          || original.content_url !== `/v1/documents/${source.document_id}/revisions/${source.revision_id}/content`) throw invalidResponse();
        const pdfUrl = await this.#loadMedia(original.content_url, original.media_type, source.source_sha256, controller.signal, current, 20, original.size_bytes);
        if (!current()) return this.value;
        source = Object.freeze({ ...source, pdfUrl });
      }
      this.#publish({ ...this.value, sourcePhase: 'ready', source, sourceError: null });
    } catch (error) {
      if (epoch !== this.#epoch || sequence !== this.#sourceSequence) return this.value;
      this.#releaseImage();
      this.#publish({ ...this.value, sourcePhase: 'error', source: null, sourceError: error });
      if (error?.status === 401) this.#onAuthenticationFailure(error);
    } finally {
      if (this.#sourceController === controller) this.#sourceController = null;
    }
    return this.value;
  }

  async #loadMedia(path, type, sha, signal, current, maxMiB, expectedSize = null) {
    const blob = await this.#request(path, { binary: true, signal });
    if (!current()) return null;
    if (!(blob instanceof Blob) || blob.type !== type || !blob.size || blob.size > maxMiB * 1024 * 1024
      || expectedSize !== null && blob.size !== expectedSize) throw invalidResponse();
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    if (!current()) return null;
    if ([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') !== sha) throw invalidResponse();
    const url = this.#objectUrls.createObjectURL(blob); this.#mediaUrls.add(url); return url;
  }
}
