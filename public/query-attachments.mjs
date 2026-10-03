import { ApiError } from './api.mjs';

const types = {
  image: { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' },
  audio: { wav: 'audio/wav', mp3: 'audio/mpeg', flac: 'audio/flac', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm' },
  video: { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' },
};
const modes = { text: 'text', visual: 'image', audio: 'audio', sound: 'SOUND', 'video-visual': 'video_visual',
  'video-transcript': 'video_transcript', 'video-joint': 'video_joint', 'video-ocr': 'video_ocr', 'video-subtitle': 'video_subtitle' };

export function queryAttachmentsEnabled(config) {
  return Array.isArray(config?.capabilities) && config.capabilities.includes('query_attachments');
}

export function attachmentAccept(kind) {
  return Object.hasOwn(types, kind) ? Object.keys(types[kind]).map(extension => `.${extension}`).join(',') : '';
}

/** Validate the whole selection before any file is read. No library upload or persistent storage. */
export function checkedQueryAttachments(items) {
  if (!Array.isArray(items) || items.length > 3) throw new ApiError(422, '查询附件最多3个，总大小不能超过20MiB。');
  let total = 0;
  return Object.freeze(items.map(item => {
    const file = item?.file, kind = item?.kind;
    const extension = typeof file?.name === 'string' ? file.name.split('.').at(-1).toLowerCase() : '';
    const mediaType = Object.hasOwn(types, kind ?? '') && Object.hasOwn(types[kind], extension) ? types[kind][extension] : null;
    if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name.trim() || [...file.name].length > 255
      || /[/\\\u0000-\u001f\u007f-\u009f]/u.test(file.name) || [...file.name].some(char => /[\ud800-\udfff]/u.test(char))
      || !mediaType || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > (kind === 'image' ? 10 : 20) * 1024 * 1024) {
      throw new ApiError(422, '请选择附件类型支持的非空原文件；图片最多10MiB，音频或视频最多20MiB，文件名不能包含路径或不合法字符。');
    }
    total += file.size;
    if (total > 20 * 1024 * 1024) throw new ApiError(422, '查询附件总大小不能超过20MiB。');
    return Object.freeze({ file, kind, mediaType });
  }));
}

export async function encodeQueryAttachments(items, signal) {
  return (await encodeAttachments(items, signal, false)).attachments;
}

/** Hash exactly the original bytes encoded for this request, without a second File read. */
export async function encodeQueryAttachmentsWithHashes(items, signal) {
  return encodeAttachments(items, signal, true);
}

async function encodeAttachments(items, signal, withHashes) {
  const selection = checkedQueryAttachments(items);
  const encoded = [], sourceShas = [];
  for (const { file, mediaType } of selection) {
    signal?.throwIfAborted();
    let bytes;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { signal?.throwIfAborted(); throw new ApiError(422, '无法读取查询附件，请重新选择原文件。'); }
    signal?.throwIfAborted();
    if (bytes.length !== file.size) throw new ApiError(422, '查询附件读取不完整，请重新选择原文件。');
    const parts = [];
    // Each nonfinal block is divisible by three, preserving canonical base64 across blocks.
    for (let offset = 0; offset < bytes.length; offset += 24_576) {
      parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
    }
    encoded.push({ filename: file.name, media_type: mediaType, content_base64: parts.join('') });
    if (withHashes) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      signal?.throwIfAborted();
      sourceShas.push(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
    }
  }
  return { attachments: encoded, sourceShas: Object.freeze(sourceShas) };
}

export function attachmentMode(mode) {
  if (!Object.hasOwn(modes, mode)) throw new ApiError(422, '请选择已支持的证据类型。');
  return modes[mode];
}

/** Unwrap safe notices; the caller still validates the original typed library answer. */
export function checkedAttachmentResponse(value, mode, selection) {
  const invalid = () => new ApiError(502, '服务器返回的查询附件处理结果无效，请重新核对。');
  if (!value || value.mode !== attachmentMode(mode) || !Array.isArray(value.query_attachments)
    || value.query_attachments.length !== selection.length) throw invalid();
  const notices = value.query_attachments.map((item, ordinal) => {
    if (!item || item.ordinal !== ordinal || item.media_kind !== selection[ordinal].kind
      || !['prepared', 'failed'].includes(item.status) || typeof item.visual_sampled !== 'boolean'
      || (item.visual_sampled && (item.status !== 'prepared' || item.media_kind === 'audio'))
      || (item.status === 'prepared' ? item.reason !== null : typeof item.reason !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(item.reason))) throw invalid();
    return Object.freeze({ ordinal, media_kind: item.media_kind, status: item.status, visual_sampled: item.visual_sampled, reason: item.reason });
  });
  return { result: value.result, notices: Object.freeze(notices) };
}
