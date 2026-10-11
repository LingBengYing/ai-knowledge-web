import { ApiError, DOCUMENT_MIME_TYPES } from './api.mjs';
import { checkedRetrievalSettings } from './retrieval-settings.mjs';
import { createKnowledgeAgentApi } from './knowledge-agent.mjs';
import { createKnowledgeConversationsApi } from './knowledge-conversations.mjs';

const validId = /^[A-Za-z0-9_-]{1,128}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const invalid = () => new ApiError(422, '知识工作台的请求参数无效，请刷新后重试。');
const inconsistent = () => new ApiError(502, '来源或分页数据不一致，请重新读取；不会使用演示数据代替。');
const id = value => { if (typeof value !== 'string' || !validId.test(value)) throw invalid(); return value; };
const version = (value, minimum = 1) => { if (!Number.isSafeInteger(value) || value < minimum) throw invalid(); return value; };
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const query = (path, fields) => `${path}?${new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== '' && value != null)).toString()}`;
const paging = (offset, limit) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw invalid();
  return { offset, limit };
};

/** Build a pinned Wiki source path from identities, never from a model-generated URL. */
export function wikiSourcePath(context) {
  const source = id(context?.source_id);
  if (context?.proposal_id && context?.page_id == null && context?.version == null) return `/v1/wiki/proposals/${id(context.proposal_id)}/sources/${source}`;
  if (context?.page_id && context?.proposal_id == null) return `/v1/wiki/pages/${id(context.page_id)}/versions/${version(context.version)}/sources/${source}`;
  throw invalid();
}

async function verifyBlob(blob, expectedHash, expectedType, expectedSize) {
  if (!(blob instanceof Blob) || !sha256.test(expectedHash ?? '') || blob.size < 1
    || (expectedType != null && blob.type !== expectedType) || (expectedSize != null && blob.size !== expectedSize)
    || await digest(await blob.arrayBuffer()) !== expectedHash) throw inconsistent();
  return blob;
}

function validAnswerLocator(citation) {
  if (typeof citation.filename !== 'string' || !citation.filename || typeof citation.media_type !== 'string') return false;
  if (citation.evidence_kind === 'document_text') return [...DOCUMENT_MIME_TYPES, 'image/png', 'image/jpeg'].includes(citation.media_type)
    && ['source_text', 'machine_ocr'].includes(citation.origin) && Number.isSafeInteger(citation.page) && citation.page > 0
    && Number.isSafeInteger(citation.start) && citation.start >= 0 && Number.isSafeInteger(citation.end) && citation.end > citation.start
    && [...citation.quote].length === citation.end - citation.start && citation.start_ms === null && citation.end_ms === null && citation.time_precision === null;
  const media = { video_transcript: ['machine_asr', 'server_chunk'], video_subtitle: ['embedded_subtitle', 'subtitle_cue'], video_frame_ocr: ['machine_ocr', 'frame_interval'] }[citation.evidence_kind];
  return !!media && ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'].includes(citation.media_type)
    && citation.origin === media[0] && citation.time_precision === media[1] && citation.page === null && citation.start === null && citation.end === null
    && Number.isFinite(citation.start_ms) && citation.start_ms >= 0 && Number.isFinite(citation.end_ms) && citation.end_ms > citation.start_ms;
}

/** Same-origin workflow Interface. No fake data, provider calls, implicit writes or retries. */
export function createWikiWorkspaceApi({ api }) {
  if (typeof api !== 'function') throw new TypeError('A same-origin request Adapter is required.');
  const get = (path, { signal } = {}) => api(path, { signal });
  const write = (path, method, body, { signal } = {}) => api(path, { method, ...(body === undefined ? {} : { body }), signal });
  const workspace = {
    ...createKnowledgeAgentApi(api),
    ...createKnowledgeConversationsApi(api),
    request: api,
    config: options => get('/v1/config', options),
    modelConfiguration: options => get('/v1/model-configuration', options),
    listPages: ({ offset = 0, limit = 100, q = '', state = 'active', signal } = {}) => {
      if (!['active', 'deleted'].includes(state)) throw invalid();
      return get(query('/v1/wiki/pages', { ...paging(offset, limit), q, state }), { signal });
    },
    getPage: (pageId, options) => get(`/v1/wiki/pages/${id(pageId)}`, options),
    getPageVersion: (pageId, pageVersion, options) => get(`/v1/wiki/pages/${id(pageId)}/versions/${version(pageVersion)}`, options),
    deletePage: (pageId, expectedVersion, lifecycleVersion, options) => write(query(`/v1/wiki/pages/${id(pageId)}`, { version: version(expectedVersion), lifecycle_version: version(lifecycleVersion, 0) }), 'DELETE', undefined, options),
    restorePage: (pageId, expectedVersion, lifecycleVersion, options) => write(`/v1/wiki/pages/${id(pageId)}/restore`, 'POST', { version: version(expectedVersion), lifecycle_version: version(lifecycleVersion, 0) }, options),
    async purgePage(pageId, expectedVersion, lifecycleVersion, options) {
      const page = id(pageId);
      const result = await write(query(`/v1/wiki/pages/${page}/purge`, { version: version(expectedVersion), lifecycle_version: version(lifecycleVersion, 0) }), 'DELETE', undefined, options);
      if (result?.page_id !== page || result.state !== 'purged') throw inconsistent();
      return Object.freeze({ page_id: page, state: 'purged' });
    },
    listProposals: ({ offset = 0, limit = 100, status = 'pending', signal } = {}) => {
      if (!['pending', 'accepted', 'dismissed'].includes(status)) throw invalid();
      return get(query('/v1/wiki/proposals', { ...paging(offset, limit), status }), { signal });
    },
    getProposal: (proposalId, options) => get(`/v1/wiki/proposals/${id(proposalId)}`, options),
    createProposal: (command, options) => write('/v1/wiki/proposals', 'POST', command, options),
    acceptProposal: (proposalId, baseVersion, options) => write(`/v1/wiki/proposals/${id(proposalId)}/accept`, 'POST', { base_version: version(baseVersion, 0) }, options),
    dismissProposal: (proposalId, options) => write(`/v1/wiki/proposals/${id(proposalId)}/dismiss`, 'POST', {}, options),
    listCatalog: ({ offset = 0, limit = 20, q = '', kind = '', signal } = {}) => {
      if (!['', 'document', 'image', 'audio', 'video'].includes(kind)) throw invalid();
      return get(query('/v1/wiki/catalog', { ...paging(offset, limit), q, kind }), { signal });
    },
    listDrafts: ({ offset = 0, limit = 100, signal } = {}) => get(query('/v1/wiki/drafts', paging(offset, limit)), { signal }),
    getDraft: (draftId, options) => get(`/v1/wiki/drafts/${id(draftId)}`, options),
    createDraft: ({ title, body }, options) => write('/v1/wiki/drafts', 'POST', { title, body }, options),
    updateDraft: (draftId, command, options) => write(`/v1/wiki/drafts/${id(draftId)}`, 'PUT', { version: version(command?.version), title: command?.title, body: command?.body }, options),
    deleteDraft: (draftId, expectedVersion, options) => write(`/v1/wiki/drafts/${id(draftId)}?version=${version(expectedVersion)}`, 'DELETE', undefined, options),
    upload: (file, { uploadKind = 'document', signal } = {}) => api(uploadKind === 'sound' ? '/v1/sound-documents' : uploadKind === 'video-av' ? '/v1/video-av-documents' : `/v1/documents?filename=${encodeURIComponent(file?.name ?? '')}`, { method: 'POST', file, uploadKind, signal }),
    getIngestion: (taskId, options) => get(`/v1/ingestions/${id(taskId)}`, options),
    startIndexing: (documentId, options) => write(`/v1/documents/${id(documentId)}/index`, 'POST', undefined, options),
    getIndexing: (taskId, options) => get(`/v1/indexings/${id(taskId)}`, options),
    listDocuments: ({ page = 1, page_size = 100, q = '', type = '', status = '', signal } = {}) => {
      version(page); paging(0, page_size);
      return get(query('/v1/management/documents', { page, page_size, q, type, status, sort: 'updated_desc' }), { signal });
    },
    getDocumentOriginal: (documentId, options) => get(`/v1/documents/${id(documentId)}/original`, options),
    getSettings: async options => checkedRetrievalSettings(await get('/v1/retrieval-settings', options)),
    saveSettings: async (command, options) => {
      const before = checkedRetrievalSettings(command);
      const result = checkedRetrievalSettings(await write('/v1/retrieval-settings', 'PUT', before, options));
      if (result.version !== before.version + 1 || Object.keys(before).some(key => key !== 'version' && result[key] !== before[key])) throw inconsistent();
      return result;
    },
    async getSource(context, options) {
      const path = wikiSourcePath(context);
      const source = await get(path, options);
      if (!source || source.source_id !== context.source_id || typeof source.evidence_id !== 'string' || !source.evidence_id || [...source.evidence_id].length > 128 || !sha256.test(source.sha256 ?? '')
        || typeof source.filename !== 'string' || typeof source.media_type !== 'string'
        || source.content_url !== `${path}/content` || (source.frame_url !== null && source.frame_url !== `${path}/frame`)
        || (source.text !== null && (typeof source.text !== 'string' || await digest(new TextEncoder().encode(source.text)) !== source.sha256))) throw inconsistent();
      return source;
    },
    async sourceContent(context, { signal, expectedSha256 } = {}) {
      if (!sha256.test(expectedSha256 ?? '')) throw invalid();
      const blob = await api(`${wikiSourcePath(context)}/content`, { signal, binary: true });
      return verifyBlob(blob, expectedSha256);
    },
    sourceFrame: (context, { signal } = {}) => api(`${wikiSourcePath(context)}/frame`, { signal, binary: true }),
    async originalContent(metadata, { signal } = {}) {
      const path = `/v1/documents/${id(metadata?.document_id)}/revisions/${id(metadata?.revision_id)}/content`;
      if (metadata?.content_url !== path || !sha256.test(metadata?.source_sha256 ?? '') || !Number.isSafeInteger(metadata?.size_bytes) || metadata.size_bytes < 1) throw inconsistent();
      return verifyBlob(await api(path, { signal, binary: true }), metadata.source_sha256, metadata.media_type, metadata.size_bytes);
    },
    async getAnswerSource(answerId, ordinal, options) {
      const path = `/v1/knowledge-sources/${id(answerId)}/${version(ordinal)}`;
      const result = await get(path, options), citation = result?.citation;
      if (result?.answer_id !== answerId || !citation || citation.citation_id !== ordinal
        || !validId.test(citation.document_id ?? '') || !validId.test(citation.revision_id ?? '')
        || !sha256.test(citation.source_sha256 ?? '') || !sha256.test(citation.text_sha256 ?? '')
        || citation.source_url !== path || citation.content_url !== `/v1/documents/${citation.document_id}/revisions/${citation.revision_id}/content`
        || typeof citation.quote !== 'string' || !citation.quote || !validAnswerLocator(citation)
        || await digest(new TextEncoder().encode(citation.quote)) !== citation.text_sha256) throw inconsistent();
      return result;
    },
    async allPages({ signal, state = 'active' } = {}) {
      const items = [], seen = new Set(); let total;
      do {
        signal?.throwIfAborted();
        const page = await workspace.listPages({ offset: items.length, limit: 100, signal, state });
        if (!page || !Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0
          || page.offset !== items.length || page.limit !== 100 || page.items.length > page.limit
          || (total !== undefined && total !== page.total) || items.length + page.items.length > page.total
          || (!page.items.length && items.length < page.total)) throw inconsistent();
        total = page.total;
        for (const item of page.items) {
          if (!validId.test(item?.page_id ?? '') || seen.has(item.page_id)) throw inconsistent();
          seen.add(item.page_id); items.push(item);
        }
      } while (items.length < total);
      return items;
    },
    async getDocument(documentId, { signal } = {}) {
      id(documentId); let count = 0, total;
      for (let page = 1; ; page++) {
        signal?.throwIfAborted();
        const response = await workspace.listDocuments({ page, page_size: 100, signal });
        if (!response || !Array.isArray(response.items) || !Number.isSafeInteger(response.total) || response.total < 0
          || response.page !== page || response.page_size !== 100 || (total !== undefined && total !== response.total)
          || (!response.items.length && count < response.total)) throw inconsistent();
        total = response.total; count += response.items.length;
        const document = response.items.find(item => item.document_id === documentId);
        if (document) return document;
        if (count >= total) throw new ApiError(404, '资料不存在或已经不可用，请刷新目录。');
      }
    },
  };
  return Object.freeze(workspace);
}
