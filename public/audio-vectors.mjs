import { mediaVectorKind } from './media-sessions.mjs';

export function audioVectorsEnabled(config) {
  return ['audio_vector_retrieval', 'audio_answers', 'audio_sources'].every(name => config?.capabilities?.includes(name));
}

const audio = mediaVectorKind({ endpoint: 'audio-vector', documentType: 'audio',
  mimeTypes: ['audio/wav', 'audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/webm'],
  maxBytes: 20 * 1024 * 1024, maxDimensions: 3072, message: '原声向量结果与当前资料、版本或模型配置不一致，请刷新后核对。' });
export const canReadAudioVector = audio.canRead;
/** Explicit build of a saved original audio; local cancellation never promises upstream rollback. */
export const AudioVectorSession = audio.Session;
