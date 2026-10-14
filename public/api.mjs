export class ApiError extends Error {
  constructor(status, message, { errorCode, field } = {}) {
    super(message); this.status = status;
    if (typeof errorCode === 'string' && /^[a-z][a-z0-9_]{0,95}$/u.test(errorCode)) this.errorCode = errorCode;
    if (['request', 'base_version', 'version', 'role', 'embedding.provider', 'embedding.model', 'embedding.dimensions', 'embedding.revision', 'embedding.api_key', 'rerank.provider', 'rerank.model', 'rerank.api_key', 'generation.provider', 'generation.model', 'generation.api_key'].includes(field)) this.field = field;
  }
}

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
/** Lowercase hex SHA-256 of bytes (BufferSource). */
export const sha256Hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');

export function imageUploadMode(config) {
  const capabilities = config?.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes('ingestions')) return null;
  return capabilities.includes('visual_image_upload') ? 'visual' : capabilities.includes('image_text_upload') ? 'ocr' : null;
}

export const DOCUMENT_FORMATS = Object.freeze({
  pdf: 'application/pdf', properties: 'text/x-java-properties', html: 'text/html', vtt: 'text/vtt', csv: 'text/csv',
  msg: 'application/vnd.ms-outlook', markdown: 'text/markdown', eml: 'message/rfc822', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mdx: 'text/markdown', xls: 'application/vnd.ms-excel',
  odt: 'application/vnd.oasis.opendocument.text', md: 'text/markdown', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml', epub: 'application/epub+zip', htm: 'text/html',
});
export const DOCUMENT_MIME_TYPES = Object.freeze([...new Set(Object.values(DOCUMENT_FORMATS))]);
export const DOCUMENT_ACCEPT = Object.keys(DOCUMENT_FORMATS).map(extension => `.${extension}`).join(',');
export const documentExtension = filename => String(filename ?? '').split('.').at(-1).toLowerCase();
export const documentDownloadOnly = mime => DOCUMENT_MIME_TYPES.includes(mime) && !['application/pdf', 'text/plain', 'text/markdown'].includes(mime);
export const documentTextPreview = mime => DOCUMENT_MIME_TYPES.includes(mime) && (mime.startsWith('text/') || ['application/xml', 'message/rfc822'].includes(mime));
export const safeOriginalBlob = blob => documentDownloadOnly(blob.type) ? new Blob([blob], { type: 'application/octet-stream' }) : blob;
const documentFile = file => Object.hasOwn(DOCUMENT_FORMATS, documentExtension(file?.name));
const imageFile = file => /\.(?:png|jpe?g)$/iu.test(file?.name ?? '');
const audioFile = file => /\.(?:wav|mp3|flac|ogg|m4a|mp4|webm)$/iu.test(file?.name ?? '');
const videoFile = file => /\.(?:mp4|mov|webm|mkv)$/iu.test(file?.name ?? '');
function checkFile(file, image = false) {
  if (!(file instanceof Blob)) throw new ApiError(422, '请选择原始文件。');
  if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(file.name)) throw new ApiError(422, '文件名无效，不能包含路径或控制字符。');
  try { encodeURIComponent(file.name); } catch { throw new ApiError(422, '文件名包含不合法字符。'); }
  if (file.size < 1) throw new ApiError(422, '不能上传空文件。');
  if (file.size > (image ? 10 : 20) * 1024 * 1024) throw new ApiError(422, image ? '图片大小不能超过10MiB。' : '文件大小不能超过20MiB。');
}
function checkFormat(file, supported) {
  if (supported) return;
  const known = documentFile(file) || imageFile(file) || audioFile(file) || videoFile(file);
  throw new ApiError(422, known ? '文件与当前上传类型不匹配，请选择正确的资料类型。' : '不支持此文件格式，请选择受支持的原文件。');
}

const videoTypes = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };
const wikiBinarySource = /^\/v1\/wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]{0,15}|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128}\/(?:content|frame)$/u;
export function validateReplacementUpload(file, documentType) {
  checkFile(file, documentType === 'image');
  checkFormat(file, { document: documentFile, image: imageFile, audio: audioFile, video: videoFile }[documentType]?.(file));
  return file;
}

export function validateUpload(file, config, uploadKind = 'document') {
  const image = imageFile(file);
  checkFile(file, image);
  const media = ['audio', 'video', 'sound', 'video-av'].includes(uploadKind);
  const enabledMedia = config?.capabilities?.includes(`${uploadKind === 'video-av' ? 'video_av' : uploadKind}_upload`) && config?.capabilities?.includes('ingestions');
  const supported = media ? (['video', 'video-av'].includes(uploadKind) ? videoFile(file) : audioFile(file))
    : uploadKind === 'document' && (image || documentFile(file));
  checkFormat(file, supported);
  const enabledDocument = !Array.isArray(config?.capabilities) || ['ingestions', 'text_upload'].every(capability => config.capabilities.includes(capability));
  if (media ? !enabledMedia : image ? !imageUploadMode(config) : !enabledDocument) throw new ApiError(422, '服务尚未启用此类型的上传功能。');
  return file;
}

const MAINTENANCE_RETRIES = 6;
function pause(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, milliseconds);
    function abort() { clearTimeout(timer); reject(signal.reason); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Cookies remain browser-owned; this client never stores a token. */
export function createApi(config, principal, fetcher = globalThis.fetch) {
  return async function request(path, { method = 'GET', body, file, signal, binary = false, uploadKind = 'document', replacement, onEvent } = {}) {
    if (!path.startsWith('/v1/')) throw new Error('仅允许同源 API 请求。');
    if (onEvent !== undefined && (typeof onEvent !== 'function' || method !== 'GET' || body !== undefined
      || file !== undefined || binary || !/^\/v1\/knowledge-agent\/runs\/[A-Za-z0-9_-]{1,128}\/events$/u.test(path))) {
      throw new ApiError(422, '流式输出只能从当前知识助手任务读取。');
    }
    if (binary && (method !== 'GET' || body !== undefined || file !== undefined
      || (!/^\/v1\/(?:synopsis-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/[1-8]\/(?:content|frame)|documents\/[A-Za-z0-9_-]{1,128}\/revisions\/[A-Za-z0-9_-]{1,128}\/content)$/u.test(path)
        && !wikiBinarySource.test(path)))) {
      throw new ApiError(422, '原素材只能从服务器指定的来源接口读取。');
    }
    const headers = { Accept: onEvent ? 'text/event-stream' : binary ? '*/*' : 'application/json' };
    if (config.auth_mode === 'development_headers') {
      headers['X-Workspace-Id'] = config.workspace_id;
      headers['X-Principal-Id'] = principal();
    }
    if (file !== undefined && replacement !== undefined) {
      validateReplacementUpload(file, replacement.documentType);
      const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
      if (!config?.capabilities?.includes('document_replacements') || !validId(replacement.documentId) || !validId(replacement.baseRevisionId)
        || method !== 'POST' || body !== undefined
        || path !== `/v1/documents/${replacement.documentId}/replacement?filename=${encodeURIComponent(file.name)}&base_revision_id=${replacement.baseRevisionId}`) {
        throw new ApiError(422, '新原文件只能提交到当前资料的指定版本更新接口。');
      }
      headers['Content-Type'] = replacement.documentType === 'video' ? videoTypes[file.name.split('.').at(-1).toLowerCase()] : 'application/octet-stream';
    } else if (file !== undefined) {
      validateUpload(file, config, uploadKind);
      if (method !== 'POST' || body !== undefined || path !== (uploadKind === 'video-av' ? '/v1/video-av-documents' : uploadKind === 'sound' ? '/v1/sound-documents' : `/v1/documents?filename=${encodeURIComponent(file.name)}`)) {
        throw new ApiError(422, '原始文件仅允许发送到指定文本上传接口。');
      }
      headers['Content-Type'] = uploadKind === 'video' ? videoTypes[file.name.split('.').at(-1).toLowerCase()] : 'application/octet-stream';
      if (['sound', 'video-av'].includes(uploadKind)) headers['X-Filename'] = encodeURIComponent(file.name);
    } else if (body !== undefined) headers['Content-Type'] = 'application/json';
    const send = () => fetcher(path, {
      method, headers, signal, credentials: 'same-origin', cache: 'no-store',
      ...(file !== undefined ? { body: file } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let response = await send();
    // Deleting documents briefly locks the library; reads wait it out instead of failing the page.
    for (let attempt = 0; method === 'GET' && response.status === 503 && attempt < MAINTENANCE_RETRIES; attempt += 1) {
      const seconds = Number(response.headers?.get?.('retry-after'));
      if (!Number.isInteger(seconds) || seconds < 1) break;
      await response.body?.cancel?.();
      await pause(Math.min(seconds, 10) * 1000, signal);
      response = await send();
    }
    if (binary && response.ok) return readBinary(response, path);
    if (onEvent && response.ok) return readEventStream(response, onEvent, signal);
    const result = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof result?.detail === 'string' && result.detail.length <= 500
        ? result.detail : `请求未完成（${response.status}），请稍后重试。`;
      throw new ApiError(response.status, detail, { errorCode: result?.error_code, field: response.status === 422 ? result?.field : undefined });
    }
    return result;
  };
}

/** Decode server frames as bytes arrive. Never reconnect or retry a question implicitly. */
async function readEventStream(response, onEvent, signal) {
  const invalidStream = () => new ApiError(502, '流式连接已中断，请刷新当前任务核对；没有重新发送问题。');
  if (response.status !== 200 || !/^text\/event-stream(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel(); throw invalidStream();
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidStream();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const maximumFrame = 4 * 1024 * 1024;
  let buffered = '', event = '', id = '', data = [], frameSize = 0, terminal = false;
  async function line(value) {
    if (!value) {
      if (data.length) {
        if (signal?.aborted) throw signal.reason ?? invalidStream();
        const content = data.join('\n');
        if (new TextEncoder().encode(content).length > maximumFrame) throw invalidStream();
        terminal = await onEvent({ event: event || 'message', id, data: content }) === true;
      }
      event = ''; id = ''; data = []; frameSize = 0;
      return;
    }
    frameSize += value.length;
    if (frameSize > maximumFrame) throw invalidStream();
    if (value.startsWith(':')) return;
    const delimiter = value.indexOf(':'), field = delimiter < 0 ? value : value.slice(0, delimiter);
    let content = delimiter < 0 ? '' : value.slice(delimiter + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'data') data.push(content);
    else if (field === 'event') event = content;
    else if (field === 'id') { if (content.includes('\0')) throw invalidStream(); id = content; }
  }
  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      if (signal?.aborted) throw signal.reason ?? invalidStream();
      buffered += decoder.decode(value, { stream: !done });
      let newline;
      while (!terminal && (newline = buffered.search(/[\r\n]/u)) >= 0) {
        // A CR at a chunk boundary may be the first byte of a CRLF delimiter.
        if (buffered[newline] === '\r' && newline === buffered.length - 1 && !done) break;
        const size = buffered[newline] === '\r' && buffered[newline + 1] === '\n' ? 2 : 1;
        const current = buffered.slice(0, newline); buffered = buffered.slice(newline + size);
        await line(current);
      }
      if (buffered.length + frameSize > maximumFrame) throw invalidStream();
      if (done && !terminal) throw invalidStream();
    }
  } catch (error) { throw error instanceof ApiError || signal?.aborted ? error : invalidStream(); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function readBinary(response, path) {
  const original = path.startsWith('/v1/documents/') || (path.startsWith('/v1/synopsis-sources/') && path.endsWith('/content'))
    || (wikiBinarySource.test(path) && path.endsWith('/content'));
  const headerType = response.headers.get('content-type')?.toLowerCase();
  const type = original ? headerType?.split(';')[0].trim() : headerType;
  const audioTypes = ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'];
  // Originals may be any library format; everything else readable here is a server-decoded frame image.
  const types = original ? [...DOCUMENT_MIME_TYPES, 'image/png', 'image/jpeg', ...audioTypes, ...Object.values(videoTypes)] : ['image/png', 'image/jpeg'];
  const limit = (original ? 20 : 10) * 1024 * 1024;
  if (response.status !== 200 || !types.includes(type) || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new ApiError(502, '来源原素材的类型、状态或大小无效。');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError(502, '来源原素材为空。');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new ApiError(502, '来源原素材超过读取限额。');
      chunks.push(value);
    }
    if (!length) throw new ApiError(502, '来源原素材为空。');
    return new Blob(chunks, { type });
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
