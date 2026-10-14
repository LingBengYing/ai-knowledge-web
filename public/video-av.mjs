import { ApiError } from './api.mjs';
import { mediaIndexSession } from './media-sessions.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = (value, max = 200) => typeof value === 'string' && !!value.trim() && [...value].length <= max
  && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value);
const types = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'];
const invalid = () => new ApiError(502, '原视频音画结果的来源、事实、模型或时间身份无效，请刷新后核对。');
const exact = (value, fields) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const indexFields = ['status', 'document_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint', 'model_revision',
  'embedding_model_revision', 'dimensions', 'publication_id', 'generation_id', 'manifest_sha256', 'window_count', 'video_window_count', 'audio_window_count'];

export function videoAvEnabled(config) {
  return ['video_av_upload', 'video_av_index', 'video_av_answers', 'video_av_sources']
    .every(name => config?.capabilities?.includes(name));
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
export const VideoAvIndexSession = mediaIndexSession({ endpoint: 'video-av-index', canRead: canReadVideoAvIndex, checkedIndex, invalid });
