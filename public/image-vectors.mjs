import { mediaVectorKind } from './media-sessions.mjs';

export function imageVectorsEnabled(config) {
  return ['image_vector_retrieval', 'visual_answers', 'visual_sources'].every(name => config?.capabilities?.includes(name));
}

const image = mediaVectorKind({ endpoint: 'image-vector', documentType: 'image', mimeTypes: ['image/png', 'image/jpeg'],
  maxBytes: 10 * 1024 * 1024, maxDimensions: 8192, message: '原图向量结果与当前资料、版本或模型配置不一致，请刷新后核对。' });
export const canReadImageVector = image.canRead;
/** Explicit build of a saved original image; local cancellation never promises upstream rollback. */
export const ImageVectorSession = image.Session;
