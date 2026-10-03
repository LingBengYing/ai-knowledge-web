export class ApiError extends Error {
  constructor(status, message, { errorCode, field } = {}) {
    super(message); this.status = status;
    if (typeof errorCode === 'string' && /^[a-z][a-z0-9_]{0,95}$/u.test(errorCode)) this.errorCode = errorCode;
    if (['request', 'base_version', 'version', 'role', 'embedding.model', 'embedding.dimensions', 'embedding.revision', 'embedding.api_key', 'rerank.model', 'rerank.api_key', 'generation.model', 'generation.api_key'].includes(field)) this.field = field;
  }
}

export function imageUploadMode(config) {
  const capabilities = config?.capabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes('ingestions')) return null;
  return capabilities.includes('visual_image_upload') ? 'visual' : capabilities.includes('image_text_upload') ? 'ocr' : null;
}

const videoTypes = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };
export function validateUpload(file, config, uploadKind = 'document') {
  const image = typeof file?.name === 'string' && /\.(?:png|jpe?g)$/iu.test(file.name);
  const media = ['audio', 'video', 'sound', 'video-av'].includes(uploadKind);
  const enabledMedia = config?.capabilities?.includes(`${uploadKind === 'video-av' ? 'video_av' : uploadKind}_upload`) && config?.capabilities?.includes('ingestions');
  const supported = media ? enabledMedia && (!['video', 'video-av'].includes(uploadKind) ? /\.(?:wav|mp3|flac|ogg|m4a|mp4|webm)$/iu.test(file?.name ?? '') : /\.(?:mp4|mov|webm|mkv)$/iu.test(file?.name ?? ''))
    : uploadKind === 'document' && (image ? imageUploadMode(config) : /\.(?:pdf|txt|md)$/iu.test(file?.name ?? ''));
  if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name.trim()
    || file.name.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(file.name)
    || !supported
    || file.size < 1 || file.size > (image ? 10 : 20) * 1024 * 1024) {
    throw new ApiError(422, '请选择当前上传类型支持的原文件：图片最多10MiB，文档/音频/视频最多20MiB；文件不能为空或包含路径，请明确选择音频或视频类型。');
  }
  try { encodeURIComponent(file.name); } catch { throw new ApiError(422, '文件名包含不合法字符。'); }
  return file;
}

/** Cookies remain browser-owned; this client never stores a token. */
export function createApi(config, principal, fetcher = globalThis.fetch) {
  return async function request(path, { method = 'GET', body, file, signal, binary = false, uploadKind = 'document' } = {}) {
    if (!path.startsWith('/v1/')) throw new Error('仅允许同源 API 请求。');
    if (binary && (method !== 'GET' || body !== undefined || file !== undefined
      || !/^\/v1\/(?:(?:sources|visual-sources|audio-sources|video-sources|sound-sources|video-av-sources)\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/content|video-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/frame|synopsis-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/[1-8]\/(?:content|frame)|documents\/[A-Za-z0-9_-]{1,128}\/revisions\/[A-Za-z0-9_-]{1,128}\/content)$/u.test(path))) {
      throw new ApiError(422, '原素材只能从服务器指定的来源接口读取。');
    }
    const headers = { Accept: binary ? '*/*' : 'application/json' };
    if (config.auth_mode === 'development_headers') {
      headers['X-Workspace-Id'] = config.workspace_id;
      headers['X-Principal-Id'] = principal();
    }
    if (file !== undefined) {
      validateUpload(file, config, uploadKind);
      if (method !== 'POST' || body !== undefined || path !== (uploadKind === 'video-av' ? '/v1/video-av-documents' : uploadKind === 'sound' ? '/v1/sound-documents' : `/v1/documents?filename=${encodeURIComponent(file.name)}`)) {
        throw new ApiError(422, '原始文件仅允许发送到指定文本上传接口。');
      }
      headers['Content-Type'] = uploadKind === 'video' ? videoTypes[file.name.split('.').at(-1).toLowerCase()] : 'application/octet-stream';
      if (['sound', 'video-av'].includes(uploadKind)) headers['X-Filename'] = encodeURIComponent(file.name);
    } else if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetcher(path, {
      method, headers, signal, credentials: 'same-origin', cache: 'no-store',
      ...(file !== undefined ? { body: file } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (binary && response.ok) return readBinary(response, path);
    const result = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof result?.detail === 'string' && result.detail.length <= 500
        ? result.detail : `请求未完成（${response.status}），请稍后重试。`;
      throw new ApiError(response.status, detail, { errorCode: result?.error_code, field: response.status === 422 ? result?.field : undefined });
    }
    return result;
  };
}

async function readBinary(response, path) {
  const original = path.startsWith('/v1/documents/') || (path.startsWith('/v1/synopsis-sources/') && path.endsWith('/content'));
  const headerType = response.headers.get('content-type')?.toLowerCase();
  const type = original ? headerType?.split(';')[0].trim() : headerType;
  const audio = path.startsWith('/v1/audio-sources/') || path.startsWith('/v1/sound-sources/');
  const video = ['/v1/video-sources/', '/v1/video-av-sources/'].some(prefix => path.startsWith(prefix)) && path.endsWith('/content');
  const audioTypes = ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'];
  const types = original ? ['application/pdf', 'text/plain', 'text/markdown', 'image/png', 'image/jpeg', ...audioTypes, ...Object.values(videoTypes)]
    : audio ? audioTypes : video ? Object.values(videoTypes) : ['image/png', 'image/jpeg'];
  const limit = (original || audio || video ? 20 : 10) * 1024 * 1024;
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
