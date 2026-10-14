import { ApiError } from './api.mjs';
import { mediaIndexSession } from './media-sessions.mjs';

const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = (value, max = 200) => typeof value === 'string' && !!value.trim() && [...value].length <= max
  && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value);
const types = ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'];
const invalid = () => new ApiError(502, '声音结果的来源、事实、模型或时间身份无效，请刷新后核对。');
const exact = (value, fields) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const indexFields = ['status', 'document_id', 'source_revision_id', 'source_sha256', 'profile_fingerprint', 'model_revision',
  'embedding_model_revision', 'dimensions', 'publication_id', 'generation_id', 'manifest_sha256', 'span_count'];

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
export const SoundIndexSession = mediaIndexSession({ endpoint: 'sound-index', canRead: canReadSoundIndex, checkedIndex, invalid });
