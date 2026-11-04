import { AUDIO_MIME_TYPES, hasCapabilities } from './api.mjs';
import { createMediaVectorKind } from './media-sessions.mjs';

export function audioVectorsEnabled(config) {
  return hasCapabilities(config, 'audio_vector_retrieval', 'audio_answers', 'audio_sources');
}

const audio = createMediaVectorKind({ endpoint: 'audio-vector', documentType: 'audio', mimeTypes: AUDIO_MIME_TYPES,
  maxBytes: 20 * 1024 * 1024, maxDimensions: 3072, message: '原声向量结果与当前资料、版本或模型配置不一致，请刷新后核对。' });
export const canReadAudioVector = audio.canRead;
/** Explicit build of a saved original audio; local cancellation never promises upstream rollback. */
export const AudioVectorSession = audio.Session;
