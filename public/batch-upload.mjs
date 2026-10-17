import { ApiError } from './api.mjs';
import { fileSha256Hex } from './sha256-stream.mjs';

const UPLOAD_ATTEMPTS = 4;

/** The most files one folder selection or drop collects; a batch takes at most this many. */
export const MAX_COLLECTED_FILES = 10000;
/** Folder nesting a drop follows; deeper directories are left out and reported. */
export const MAX_FOLDER_DEPTH = 32;
/** The longest folder-relative path the server accepts, in code points. */
export const MAX_RELATIVE_PATH = 1024;

const relativePaths = new WeakMap();
/** Remembers the folder-relative path a dropped file was found at (File.webkitRelativePath is read-only). */
export function withRelativePath(file, path) { if (path) relativePaths.set(file, path); return file; }
/**
 * The file's folder-relative path as the manifest may carry it, or '' when it has none or the path
 * fails the server's rules: '/'-separated non-empty segments, no '.' or '..', no backslash or control
 * characters, at most 1024 code points, ending in the file's own name. A bare filename is no path.
 */
export function relativePathOf(file) {
  const path = relativePaths.get(file) ?? file?.webkitRelativePath ?? '';
  if (typeof path !== 'string' || !path || [...path].length > MAX_RELATIVE_PATH || /[\\\u0000-\u001f\u007f-\u009f]/u.test(path)) return '';
  const segments = path.split('/');
  if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..') || segments.at(-1) !== file.name) return '';
  return path;
}
/** What the batch page and lists show for a file: its folder path when it has one. */
export const displayPath = item => item?.relative_path || item?.relativePath || item?.filename || '';

const SYSTEM_FILES = new Set(['thumbs.db', 'desktop.ini', 'ehthumbs.db', 'icon\r']);
/**
 * Splits collected files into importable ones and silently skipped ones: hidden files or folders
 * (a segment starting with "."), system files (Thumbs.db, desktop.ini, __MACOSX, Office "~$" lock
 * files) and extensions the current upload type does not accept.
 */
export function partitionImportable(files, accept) {
  const extensions = new Set(String(accept ?? '').split(',').map(item => item.trim().toLowerCase()).filter(item => item.startsWith('.')));
  const accepted = [], skipped = [];
  for (const file of files) {
    const path = relativePathOf(file) || file.name, segments = path.split('/'), name = String(file.name ?? '');
    const lower = name.toLowerCase(), extension = lower.includes('.') ? `.${lower.split('.').at(-1)}` : '';
    const hidden = segments.some(segment => segment.startsWith('.') || segment === '__MACOSX') || SYSTEM_FILES.has(lower) || name.startsWith('~$');
    if (hidden || !extensions.has(extension)) skipped.push(path); else accepted.push(file);
  }
  return { accepted, skipped };
}

/**
 * Files of a drop, following folders (FileSystemEntry API) to a bounded depth and count. Entries are
 * taken from the DataTransfer synchronously, as browsers clear it once the drop handler returns.
 */
export function droppedEntries(dataTransfer) {
  const items = Array.from(dataTransfer?.items ?? []);
  if (items.length && items.every(item => typeof item.webkitGetAsEntry === 'function'))
    return items.filter(item => item.kind === 'file').map(item => item.webkitGetAsEntry()).filter(Boolean);
  return Array.from(dataTransfer?.files ?? []).map(file => ({ isFile: true, file: (resolve) => resolve(file), name: file.name, plain: true }));
}
export async function collectEntries(entries, { maxFiles = MAX_COLLECTED_FILES, maxDepth = MAX_FOLDER_DEPTH } = {}) {
  const files = [], state = { truncated: false };
  const fileOf = entry => new Promise((resolve, reject) => entry.file(resolve, reject));
  const children = reader => new Promise((resolve, reject) => {
    const all = [];
    // readEntries returns one bounded batch per call until it returns an empty one.
    const next = () => reader.readEntries(batch => { if (!batch.length) resolve(all); else { all.push(...batch); if (all.length > maxFiles) resolve(all); else next(); } }, reject);
    next();
  });
  async function visit(entry, prefix, depth) {
    if (files.length >= maxFiles) { state.truncated = true; return; }
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) { const file = await fileOf(entry); files.push(entry.plain ? file : withRelativePath(file, path.includes('/') ? path : '')); return; }
    if (!entry.isDirectory) return;
    if (depth >= maxDepth) { state.truncated = true; return; }
    for (const child of await children(entry.createReader())) await visit(child, path, depth + 1);
  }
  for (const entry of entries) await visit(entry, '', 0);
  return { files: files.slice(0, maxFiles), truncated: state.truncated };
}

/** Parser segments: 1200-code-point windows overlapping by 120 (TextParser in the Java service). */
export const SEGMENT_CHARS = 1200, SEGMENT_OVERLAP = 120, SEGMENTS_PER_REQUEST = 31, MAX_SEGMENTS = 4096;
/**
 * Estimated embedding requests for these files, taking characters ≈ bytes for text (an image counts one
 * request for its OCR text): each document is split into
 * segments and embedded SEGMENTS_PER_REQUEST at a time, so it needs ceil(segments / 31) requests.
 * Bytes overstate characters for UTF-8 Chinese text and compressed formats, so this is an upper estimate.
 */
export function estimateEmbeddingRequests(files) {
  let requests = 0;
  for (const file of files) {
    const chars = Math.max(0, Number(file?.size) || 0);
    if (!chars) continue;
    // An image's bytes are pixels, not text: its OCR text is short, so count one request.
    if (/\.(?:png|jpe?g)$/iu.test(file?.name ?? '')) { requests += 1; continue; }
    const segments = Math.min(MAX_SEGMENTS, chars <= SEGMENT_CHARS ? 1 : 1 + Math.ceil((chars - SEGMENT_CHARS) / (SEGMENT_CHARS - SEGMENT_OVERLAP)));
    requests += Math.ceil(segments / SEGMENTS_PER_REQUEST);
  }
  return requests;
}
export const MAX_EMBEDDING_REQUEST_LIMIT = 1000000;
/** A typed budget: undefined when left empty, the number when 1–1,000,000, otherwise null (invalid). */
export function checkedRequestLimit(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  if (!/^[1-9][0-9]{0,6}$/u.test(text) || Number(text) > MAX_EMBEDDING_REQUEST_LIMIT) return null;
  return Number(text);
}

const ACTIVE_FILE_STATES = ['queued', 'parsing', 'parsed', 'indexing'];
/**
 * Rate and estimate from the server's recent window: files finished per minute over the window, and
 * the time the uploaded files still in progress need at that rate. Too short a window or nothing
 * finished yet gives no estimate rather than a wild one.
 */
export function batchThroughput(batch) {
  const window = Number(batch?.throughput?.window_seconds), finished = Number(batch?.throughput?.finished);
  const remaining = ACTIVE_FILE_STATES.reduce((sum, name) => sum + (Number(batch?.counts?.[name]) || 0), 0);
  if (!Number.isFinite(window) || !Number.isFinite(finished) || window < 30 || finished < 1) return { filesPerMinute: null, etaSeconds: null, remaining };
  const filesPerMinute = finished / (window / 60);
  return { filesPerMinute, etaSeconds: remaining ? Math.ceil(remaining / filesPerMinute * 60) : 0, remaining };
}
/** "约 N 分钟" style duration for an estimate. */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return '不到 1 分钟';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `约 ${hours} 小时 ${rest} 分钟` : `约 ${hours} 小时`;
}

/** Bounded transfers; the durable server batch owns processing and recovery. */
export const DEFAULT_UPLOAD_CONCURRENCY = 4;
/** A slot that needs no further transfer: received by the server, or skipped as a duplicate. */
export const uploadSettled = state => state === 'submitted' || state === 'duplicate';

export class BatchUploadSession {
  constructor(api, { concurrency = DEFAULT_UPLOAD_CONCURRENCY, hash = fileSha256Hex, onProgress = () => {}, validate = () => {}, delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new TypeError('Invalid upload concurrency');
    this.api = api; this.concurrency = concurrency; this.hash = hash; this.onProgress = onProgress; this.validate = validate; this.delay = delay;
    this.batchId = null; this.requestId = null; this.progress = []; this.files = []; this.running = false;
  }
  async start(files, { requestId = crypto.randomUUID(), embeddingRequestLimit, includeDuplicates = false, signal } = {}) {
    if (this.running || !files.length || files.length > 10000) throw new ApiError(422, '请选择要导入的文件。');
    this.running = true; this.requestId = requestId; this.files = Array.from(files); this.progress = this.files.map(file => ({ filename: file.name, relativePath: relativePathOf(file), state: 'preparing' }));
    try {
      // Every slot must be uploadable before the server registers the manifest.
      for (const file of this.files) this.validate(file);
      const manifest = [];
      for (let ordinal = 0; ordinal < this.files.length; ordinal++) {
        signal?.throwIfAborted(); const file = this.files[ordinal];
        // Hashed in bounded slices: one chunk of one file is in memory at a time.
        const path = relativePathOf(file);
        manifest.push({ filename: file.name, size_bytes: file.size, source_sha256: await this.hash(file, { signal }), ...(path ? { relative_path: path } : {}) });
        this.progress[ordinal].state = 'awaiting_upload';
      }
      const batch = await this.api.createBatch({ request_id: requestId, files: manifest,
        ...(embeddingRequestLimit === undefined ? {} : { embedding_request_limit: embeddingRequestLimit }),
        // Sent only to opt out of skipping, so the default manifest is unchanged for older servers.
        ...(includeDuplicates === true ? { include_duplicates: true } : {}) }, { signal });
      if (typeof batch?.batch_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(batch.batch_id) || batch.total !== files.length) throw new ApiError(502, '批次回执无效，请刷新后核对。');
      this.batchId = batch.batch_id;
      this.ordinals = this.files.map((_, i) => i);
      // Files the server already holds (or that repeat an earlier file) are skipped, never sent.
      for (const item of await this.duplicates(batch, signal)) {
        if (Number.isSafeInteger(item.ordinal) && item.ordinal >= 0 && item.ordinal < this.files.length) this.progress[item.ordinal] = { ...this.duplicate(item), relativePath: this.progress[item.ordinal].relativePath };
      }
      this.onProgress(this.snapshot());
      await this.transfer(signal);
      return await this.api.getBatch(this.batchId, { signal });
    } finally { this.running = false; }
  }
  duplicate(item) {
    return { filename: item.filename, state: 'duplicate', documentId: typeof item.duplicate_of_document_id === 'string' ? item.duplicate_of_document_id : null,
      duplicateOrdinal: Number.isSafeInteger(item.duplicate_of_ordinal) ? item.duplicate_of_ordinal : null };
  }
  /** Duplicate slots of a fresh batch: the first page, then further pages only when the counts say more exist. */
  async duplicates(batch, signal) {
    const expected = Number(batch?.counts?.duplicate) || 0, found = (batch.items ?? []).filter(item => item?.state === 'duplicate');
    for (let offset = batch.items?.length ?? 0; found.length < expected && offset < batch.total; offset += 100) {
      const page = await this.api.getBatch(this.batchId, { offset, limit: 100, signal });
      if (!Array.isArray(page?.items) || page.offset !== offset || !page.items.length) throw new ApiError(502, '批次回执无效，请刷新后核对。');
      found.push(...page.items.filter(item => item?.state === 'duplicate'));
    }
    return found;
  }
  async transfer(signal) {
    let next = 0, failure;
    const worker = async () => {
      while (!failure && next < this.files.length) {
        signal?.throwIfAborted(); const index = next++, ordinal = this.ordinals[index], file = this.files[index];
        if (this.progress[index].state === 'duplicate') continue;
        this.progress[index].state = 'uploading'; this.onProgress(this.snapshot());
        try {
          let task;
          // 429 means the slot was not admitted, so a bounded resend cannot duplicate it.
          for (let attempt = 1; ; attempt++) {
            try { task = await this.api.uploadBatchFile(this.batchId, ordinal, file, { signal }); break; }
            catch (error) { if (error?.status !== 429 || attempt >= UPLOAD_ATTEMPTS) throw error; await this.delay(500 * 2 ** (attempt - 1)); signal?.throwIfAborted(); }
          }
          if (typeof task?.task_id !== 'string' || !task.task_id || task.filename !== file.name) throw new ApiError(502, '文件回执无效，请核对批次。');
          this.progress[index] = { filename: file.name, relativePath: relativePathOf(file), state: 'submitted', taskId: task.task_id };
        } catch (error) {
          if (error?.status === 409 && error.errorCode === 'batch_file_duplicate') {
            this.progress[index] = { filename: file.name, relativePath: relativePathOf(file), state: 'duplicate', documentId: null, duplicateOrdinal: null }; this.onProgress(this.snapshot()); continue;
          }
          try {
            const batch = await this.api.getBatch(this.batchId, { offset: ordinal, limit: 1, signal });
            const item = batch?.items?.[0];
            this.progress[index] = item?.ordinal === ordinal && item.filename === file.name && item.ingestion_task_id
              ? { filename: file.name, relativePath: relativePathOf(file), state: 'submitted', taskId: item.ingestion_task_id } : { filename: file.name, relativePath: relativePathOf(file), state: 'failed' };
          } catch { this.progress[index].state = 'unknown'; }
          failure = error;
        }
        this.onProgress(this.snapshot());
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, this.files.length) }, worker));
    if (failure) throw failure;
  }
  snapshot() { return { batchId: this.batchId, items: this.progress.map(item => ({ ...item })) }; }
  /**
   * Continues a batch with re-selected originals (single files or the same folder again). A file goes
   * to a not-yet-uploaded slot with the same name, size and SHA-256, preferring the slot with the same
   * folder-relative path. Files that are already received or skipped are left out; files that belong
   * to no slot (e.g. added to the folder since) are skipped without hashing when no slot has their
   * name and size. Rejects when nothing of the selection belongs to this batch's open slots.
   */
  async resume(batchId, files, { signal } = {}) {
    if (this.running) throw new ApiError(409, '上传正在进行。');
    this.running = true;
    try {
      const pending = [], received = [], duplicates = []; let total;
      for (let offset = 0; total === undefined || offset < total; offset += 100) {
        const page = await this.api.getBatch(batchId, { offset, limit: 100, signal }); total = page.total;
        if (!Number.isSafeInteger(total) || total < 1 || !Array.isArray(page.items) || page.offset !== offset
            || (page.items.length === 0 && offset < total) || ['halted', 'cancelled'].includes(page.state)) throw new ApiError(409, '批次已停止或状态发生变化。');
        pending.push(...page.items.filter(item => item.state === 'awaiting_upload'));
        received.push(...page.items.filter(item => item.state !== 'awaiting_upload' && item.ingestion_task_id));
        duplicates.push(...page.items.filter(item => item.state === 'duplicate'));
      }
      const known = new Set([...pending, ...received, ...duplicates].map(item => `${item.filename}\u0000${item.size_bytes}`));
      this.files = []; this.ordinals = []; this.unmatched = 0; let unknown = 0;
      for (const file of files) {
        signal?.throwIfAborted();
        // Not a file of this batch at all: no slot has its name and size, so it is never hashed.
        if (!known.has(`${file.name}\u0000${file.size}`)) { this.unmatched++; continue; }
        this.validate(file);
        const digest = await this.hash(file, { signal }), path = relativePathOf(file);
        const same = item => item.filename === file.name && item.size_bytes === file.size && item.source_sha256 === digest;
        let index = path ? pending.findIndex(item => same(item) && item.relative_path === path) : -1;
        if (index < 0) index = pending.findIndex(same);
        // A slot whose earlier response was lost is already received; never send it twice.
        // A skipped duplicate needs no upload either.
        if (index < 0 && (received.some(same) || duplicates.some(same))) continue;
        if (index < 0) { unknown++; continue; }
        this.files.push(file); this.ordinals.push(pending.splice(index, 1)[0].ordinal);
      }
      if (!this.files.length && (unknown || this.unmatched === files.length)) throw new ApiError(422, '请选择本批次尚未上传的原文件。');
      this.unmatched += unknown;
      this.batchId = batchId; this.progress = this.files.map(file => ({ filename: file.name, relativePath: relativePathOf(file), state: 'awaiting_upload' }));
      await this.transfer(signal); return await this.api.getBatch(batchId, { signal });
    } finally { this.running = false; }
  }
}
export const batchFileLabels = Object.freeze({ preparing: '准备中', awaiting_upload: '待上传', uploading: '上传中',
  submitted: '已提交', queued: '等待解析', parsing: '解析中', parsed: '等待索引', indexing: '索引中',
  indexed: '已完成', failed: '失败', unknown: '待核对', cancelled: '已取消', deleted: '已删除', duplicate: '已存在（跳过）' });
