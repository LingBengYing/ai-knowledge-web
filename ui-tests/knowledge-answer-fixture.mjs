import { createHash } from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');

/** Synthetic transport bytes exercise source binding, not native PDF/video decoding. */
export function knowledgeAnswerFixture() {
  const materials = [
    { id: 'manual', revision: 'manual-v1', filename: 'manual.pdf', type: 'document', mime: 'application/pdf',
      bytes: Buffer.from('%PDF synthetic source protocol fixture'), quote: '长按月亮键3秒，开启夜间模式。',
      evidence: { evidence_kind: 'document_text', origin: 'source_text', page: 2, start: 0, start_ms: null, end_ms: null, time_precision: null } },
    { id: 'tutorial', revision: 'tutorial-v1', filename: 'tutorial.mp4', type: 'video', mime: 'video/mp4',
      bytes: Buffer.from('synthetic video source protocol fixture'), quote: '长按月亮键3秒，开启夜间模式。',
      evidence: { evidence_kind: 'video_subtitle', origin: 'embedded_subtitle', page: null, start: null, start_ms: 3200, end_ms: 7800, time_precision: 'subtitle_cue' } },
  ];
  const answerId = 'knowledge-answer-one';
  const citations = materials.map((material, index) => ({ citation_id: index + 1, ...material.evidence,
    document_id: material.id, revision_id: material.revision, filename: material.filename,
    source_sha256: sha(material.bytes), parser_revision: 'synthetic-parser-v1', media_type: material.mime,
    quote: material.quote, text_sha256: sha(material.quote), end: material.type === 'document' ? [...material.quote].length : null,
    content_url: `/v1/documents/${material.id}/revisions/${material.revision}/content`,
    source_url: `/v1/knowledge-sources/${answerId}/${index + 1}` }));
  const answer = { answer_id: answerId, status: 'answered', answer: '长按月亮键3秒，开启夜间模式。[1][2]', reason: null, citations };
  const read = (path, options = {}) => {
    if (path === '/v1/knowledge-answers') return answer;
    const citation = citations.find(item => item.source_url === path);
    if (citation) return { answer_id: answerId, citation };
    const index = materials.findIndex(item => path === `/v1/documents/${item.id}/original` || path === citations[materials.indexOf(item)].content_url);
    if (index < 0) throw new Error(`Unexpected synthetic source path: ${path}`);
    const material = materials[index], source = citations[index];
    if (path.endsWith('/content')) {
      if (!options.binary) throw new Error('Original must use binary transport');
      return new Blob([material.bytes], { type: material.mime });
    }
    return { document_id: source.document_id, revision_id: source.revision_id, filename: source.filename,
      document_type: material.type, media_type: source.media_type, source_sha256: source.source_sha256,
      size_bytes: material.bytes.length, content_url: source.content_url };
  };
  return { answer, read };
}
