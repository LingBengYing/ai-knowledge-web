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

/** A short upload estimate: seconds while under a minute, then as formatDuration. */
export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `约 ${Math.max(1, Math.ceil(seconds))} 秒`;
  return formatDuration(seconds);
}
/** Bytes as B, KB, MB or GB (1024-based) with one decimal where it helps. */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB']; let amount = value, unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${unit && amount < 10 ? amount.toFixed(1) : Math.round(amount)} ${units[unit]}`;
}

/** Bounded transfers; the durable server batch owns processing and recovery. */
export const DEFAULT_UPLOAD_CONCURRENCY = 4;
/** Files hashed at once while preparing a manifest; small files are dominated by read latency. */
export const DEFAULT_HASH_CONCURRENCY = 4;
/** The most often progress is reported: at most five renders a second, however many files move. */
export const PROGRESS_MS = 200;
/** @deprecated The preparation report interval is the general progress interval now. */
export const PREPARE_PROGRESS_MS = PROGRESS_MS;
/**
 * Open batches register their manifest in chunks while files upload: the first chunk goes as soon as
 * this many files are hashed (a fraction of a second for small files), so uploads start at once.
 */
export const FIRST_CHUNK = 50;
/** Later chunks: up to this many entries per append (the server takes at most 1000). */
export const CHUNK_FILES = 500;
/** A partial chunk is registered anyway once this long has passed since the last append. */
export const CHUNK_WAIT_MS = 1000;
/** Speed is measured over the uploads finished within this recent window. */
export const SPEED_WINDOW_MS = 10000;
/** Finished files listed under the files in flight. */
export const RECENT_ROWS = 8;
const REGISTER_ATTEMPTS = 4;
/** A slot that needs no further transfer: received by the server, or skipped as a duplicate. */
export const uploadSettled = state => state === 'submitted' || state === 'duplicate';
const FINISHED = new Set(['submitted', 'duplicate', 'failed', 'unknown', 'skipped']);
const STATES = ['preparing', 'awaiting_upload', 'uploading', 'submitted', 'duplicate', 'failed', 'unknown', 'skipped'];
/** A lost or refused-for-now request that is safe to repeat: a network error, 429 or a 5xx. */
const transient = error => error?.name !== 'AbortError' && (!(error instanceof ApiError) || error.status === 0 || error.status === 429 || error.status >= 500);
const validBatchId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(value);
const invalidReceipt = () => new ApiError(502, '批次回执无效，请刷新后核对。');
const duplicateOf = item => ({ documentId: typeof item?.duplicate_of_document_id === 'string' ? item.duplicate_of_document_id : null,
  duplicateOrdinal: Number.isSafeInteger(item?.duplicate_of_ordinal) ? item.duplicate_of_ordinal : null });

/**
 * One import: hashes files, registers them and uploads them with bounded concurrency.
 *
 * With `streaming` (servers offering `batch_streaming_upload`), the batch is opened first and its
 * manifest grows in chunks: the first chunk is appended once FIRST_CHUNK files are hashed and its
 * files upload while the rest is still being hashed and registered; the manifest is sealed after the
 * last chunk. Without it, every file is hashed and the whole manifest registered at once, as before.
 *
 * Progress is counters and a few rows, never a copy of every file: `onProgress` receives `view()`
 * at most once per PROGRESS_MS (with a trailing report), so thousands of files render a few times a
 * second at most.
 */
export class BatchUploadSession {
  constructor(api, { concurrency = DEFAULT_UPLOAD_CONCURRENCY, hashConcurrency = DEFAULT_HASH_CONCURRENCY, hash = fileSha256Hex, onProgress = () => {}, validate = () => {},
    delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)), now = () => Date.now(), streaming = false,
    firstChunk = FIRST_CHUNK, chunkFiles = CHUNK_FILES, chunkWaitMs = CHUNK_WAIT_MS, progressMs = PROGRESS_MS,
    timers = { set: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: handle => clearTimeout(handle) } } = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new TypeError('Invalid upload concurrency');
    if (!Number.isSafeInteger(hashConcurrency) || hashConcurrency < 1 || hashConcurrency > 8) throw new TypeError('Invalid hash concurrency');
    if (!Number.isSafeInteger(firstChunk) || firstChunk < 1 || !Number.isSafeInteger(chunkFiles) || chunkFiles < firstChunk || chunkFiles > 1000) throw new TypeError('Invalid chunk size');
    Object.assign(this, { api, concurrency, hashConcurrency, hash, onProgress, validate, delay, now, streaming: streaming === true, firstChunk, chunkFiles, chunkWaitMs, progressMs, timers });
    this.batchId = null; this.requestId = null; this.running = false; this.unmatched = 0; this.trailing = null;
    this.reset([]);
  }
  reset(files) {
    this.files = Array.from(files);
    this.progress = this.files.map(file => ({ filename: file.name, relativePath: relativePathOf(file), state: 'preparing' }));
    this.ordinals = new Array(this.files.length);
    this.counts = Object.fromEntries(STATES.map(name => [name, 0])); this.counts.preparing = this.files.length;
    this.hashed = 0; this.registered = 0; this.hashing = new Set(); this.uploading = new Set(); this.recent = [];
    this.finished = []; this.finishedBytes = 0; this.uploadedBytes = 0;
    this.startedAt = this.now(); this.firstUploadAt = null; this.phase = 'preparing'; this.sealed = false; this.reported = -Infinity;
  }
  /** Moves one file to a state, keeping the counters and the rows of files in flight and recently finished. */
  setState(index, state, extra = {}) {
    const previous = this.progress[index];
    this.counts[previous.state]--; this.counts[state]++;
    this.progress[index] = { filename: previous.filename, relativePath: previous.relativePath, state, ...extra };
    if (state === 'uploading') this.uploading.add(index); else this.uploading.delete(index);
    if (FINISHED.has(state)) { this.recent.push(index); if (this.recent.length > RECENT_ROWS) this.recent.shift(); }
  }
  /** The progress the dialog shows: counters, rate and estimate, files in flight and the last few finished. */
  view() {
    const time = this.now(), total = this.files.length, counts = this.counts;
    while (this.finished.length && time - this.finished[0].at > SPEED_WINDOW_MS) this.finishedBytes -= this.finished.shift().bytes;
    const settled = counts.submitted + counts.duplicate + counts.skipped;
    const span = this.firstUploadAt === null ? 0 : Math.min(SPEED_WINDOW_MS, time - this.firstUploadAt);
    let filesPerSecond = null, bytesPerSecond = null, etaSeconds = null;
    // Under a second of uploading or nothing finished yet says nothing reliable about the rate.
    if (span >= 1000 && this.finished.length) {
      filesPerSecond = this.finished.length / (span / 1000); bytesPerSecond = this.finishedBytes / (span / 1000);
      const remaining = Math.max(0, total - settled - counts.failed - counts.unknown);
      etaSeconds = remaining ? Math.ceil(remaining / filesPerSecond) : 0;
    }
    const row = (index, state = this.progress[index].state) => ({ label: displayPath(this.progress[index]), state });
    return { batchId: this.batchId, phase: this.phase, streaming: this.streaming, total, prepared: this.hashed, registered: this.registered,
      counts: { ...counts, hashing: this.hashing.size }, settled, percent: total ? Math.floor(settled * 100 / total) : 0,
      filesPerSecond, bytesPerSecond, etaSeconds, uploadedBytes: this.uploadedBytes,
      firstUploadMs: this.firstUploadAt === null ? null : this.firstUploadAt - this.startedAt,
      active: [...[...this.uploading].map(index => row(index)), ...[...this.hashing].map(index => row(index, 'hashing'))],
      recent: this.recent.map(index => row(index)).reverse() };
  }
  /** Reports progress at most once per progressMs; a report skipped meanwhile is sent when the interval ends. */
  emit(force = false) {
    const time = this.now();
    if (!force && time - this.reported < this.progressMs) {
      if (this.trailing === null && this.running) this.trailing = this.timers.set(() => { this.trailing = null; if (this.running) this.emit(true); }, Math.max(1, this.progressMs - (time - this.reported)));
      return;
    }
    if (this.trailing !== null) { this.timers.clear(this.trailing); this.trailing = null; }
    this.reported = time; this.onProgress(this.view());
  }
  /** Every file and its full state, on demand (tests and diagnostics); never sent per event. */
  snapshot(extra = {}) { return { ...this.view(), ...extra, items: this.progress.map(item => ({ ...item })) }; }
  /** Files that still need a transfer after a failure, for "确认导入" to continue with. */
  unsettledFiles() { return this.files.filter((_, index) => !uploadSettled(this.progress[index].state) && this.progress[index].state !== 'skipped'); }

  async start(files, { requestId = crypto.randomUUID(), embeddingRequestLimit, includeDuplicates = false, signal } = {}) {
    if (this.running || !files.length || files.length > 10000) throw new ApiError(422, '请选择要导入的文件。');
    this.running = true; this.requestId = requestId; this.batchId = null; this.unmatched = 0; this.reset(files);
    const options = { ...(embeddingRequestLimit === undefined ? {} : { embedding_request_limit: embeddingRequestLimit }),
      // Sent only to opt out of skipping, so the default manifest is unchanged for older servers.
      ...(includeDuplicates === true ? { include_duplicates: true } : {}) };
    try {
      // Every slot must be uploadable before the server registers anything.
      for (const file of this.files) this.validate(file);
      const order = this.files.map((_, index) => index);
      if (this.streaming) {
        this.phase = 'starting'; this.emit(true);
        let batch;
        try { batch = await this.repeating(() => this.api.createBatch({ request_id: requestId, open: true, expected_total: this.files.length, ...options }, { signal }), signal); }
        catch (error) { throw this.lostRegistration(error, `${this.files.length} 份文件的批次创建未完成（连接中断或超时）。`); }
        if (!validBatchId(batch?.batch_id) || batch.open !== true || batch.expected_total !== this.files.length) throw invalidReceipt();
        this.batchId = batch.batch_id; this.phase = 'uploading'; this.emit(true);
        try { await this.pipeline({ register: order, base: 0, seal: true, signal }); }
        catch (error) {
          if (!this.entryRouteMissing(error)) throw error;
          // An entry server without the append route (not updated yet): the empty open batch is
          // cancelled and the import continues as one manifest under a new request ID.
          await this.api.cancelBatch?.(this.batchId, { signal }).catch(() => {});
          this.streaming = false; this.batchId = null; this.requestId = crypto.randomUUID(); this.reset(files);
          this.emit(true); await this.pipeline({ register: order, oneShot: { requestId: this.requestId, options }, signal });
        }
      } else { this.emit(true); await this.pipeline({ register: order, oneShot: { requestId, options }, signal }); }
      this.phase = 'done';
      return await this.api.getBatch(this.batchId, { signal });
    } catch (error) { this.phase = 'failed'; throw error; }
    finally { this.running = false; this.emit(true); }
  }
  /** The entry server refused the append route itself (404/405 without a service error code) before anything was registered. */
  entryRouteMissing(error) { return this.registered === 0 && error instanceof ApiError && [404, 405].includes(error.status) && !error.errorCode; }
  lostRegistration(error, prefix) {
    // A lost or timed-out registration may still have been recorded: the retry reuses the request ID.
    if (error?.name !== 'AbortError' && transient(error))
      return new ApiError(error?.status ?? 0, `${prefix}请检查网络后再次点击“确认导入”继续，不会重复登记。`, { errorCode: error?.errorCode });
    return error;
  }
  /** Repeats an idempotent registration request on a transient failure, with bounded backoff. */
  async repeating(request, signal) {
    for (let attempt = 1; ; attempt++) {
      try { return await request(); }
      catch (error) { if (!transient(error) || attempt >= REGISTER_ATTEMPTS) throw error; await this.delay(500 * 2 ** (attempt - 1)); signal?.throwIfAborted(); }
    }
  }

  /**
   * Hashing, registration and uploads running side by side. `verify` files (a resume) are matched to
   * already registered slots once hashed and upload straight away; `register` files are appended to an
   * open batch at ordinals base, base+1, … in chunks (or, with `oneShot`, registered all at once after
   * every file is hashed). With `seal`, the open batch is sealed after its last chunk.
   */
  async pipeline({ register = [], verify = [], base = 0, oneShot = null, seal = false, claim = null, related = () => true, signal }) {
    const queue = [], digests = new Map(), order = [...verify, ...register], toMatch = new Set(verify);
    let head = 0, next = 0, failure = null, waiters = [], registering = register.length > 0 || oneShot !== null || seal, verifying = verify.length;
    const wake = () => { const list = waiters; waiters = []; for (const resolve of list) resolve(); };
    const fail = error => { failure ??= error; wake(); };
    const sleep = milliseconds => new Promise(resolve => {
      let handle = null;
      waiters.push(() => { if (handle !== null) this.timers.clear(handle); resolve(); });
      if (milliseconds) handle = this.timers.set(wake, milliseconds);
    });
    const aborted = () => fail(signal.reason ?? new DOMException('上传已取消。', 'AbortError'));
    if (signal?.aborted) aborted(); else signal?.addEventListener?.('abort', aborted, { once: true });

    const hasher = async () => {
      while (!failure && next < order.length) {
        const index = order[next++], file = this.files[index];
        this.hashing.add(index); this.emit();
        let digest;
        try { digest = await this.hash(file, { signal }); }
        catch (error) {
          this.hashing.delete(index);
          fail(error?.name === 'AbortError' || error instanceof ApiError ? error
            : new ApiError(422, `无法读取文件“${displayPath(this.progress[index])}”，请确认它仍在原位置且未被其他程序占用后重新选择。`));
          return;
        }
        this.hashing.delete(index); this.hashed++; digests.set(index, digest);
        if (toMatch.has(index)) { if (claim?.(index, digest)) queue.push(index); verifying--; }
        wake(); this.emit();
      }
    };

    const registerOneShot = async () => {
      while (!failure && this.hashed < order.length) await sleep(0);
      if (failure) return;
      this.emit(true); this.phase = 'registering'; this.emit(true);
      const manifest = register.map(index => { const file = this.files[index], path = relativePathOf(file);
        return { filename: file.name, size_bytes: file.size, source_sha256: digests.get(index), ...(path ? { relative_path: path } : {}) }; });
      let batch;
      try { batch = await this.api.createBatch({ request_id: oneShot.requestId, files: manifest, ...oneShot.options }, { signal }); }
      catch (error) { fail(this.lostRegistration(error, `${manifest.length} 份文件的批次登记未完成（连接中断或超时）。`)); return; }
      if (!validBatchId(batch?.batch_id) || batch.total !== manifest.length) { fail(invalidReceipt()); return; }
      this.batchId = batch.batch_id;
      let duplicates;
      // Files the server already holds (or that repeat an earlier file) are skipped, never sent.
      try { duplicates = await this.duplicates(batch, signal); } catch (error) { fail(error); return; }
      const skipped = new Map(duplicates.filter(item => Number.isSafeInteger(item?.ordinal) && item.ordinal >= 0 && item.ordinal < manifest.length).map(item => [item.ordinal, item]));
      register.forEach((index, ordinal) => {
        this.ordinals[index] = ordinal;
        if (skipped.has(ordinal)) this.setState(index, 'duplicate', duplicateOf(skipped.get(ordinal)));
        else { this.setState(index, 'awaiting_upload'); queue.push(index); }
      });
      this.registered = manifest.length; this.phase = 'uploading'; registering = false; wake(); this.emit(true);
    };

    const registrar = async () => {
      if (oneShot) { await registerOneShot(); return; }
      let position = 0, last = this.now(), first = true;
      while (!failure && position < register.length) {
        let ready = 0;
        while (position + ready < register.length && ready < this.chunkFiles && digests.has(register[position + ready])) ready++;
        const remaining = register.length - position, target = Math.min(first ? this.firstChunk : this.chunkFiles, remaining);
        // Idle uploaders take a smaller chunk rather than wait for a full one.
        const starving = queue.length - head < this.concurrency * 2 && ready >= Math.min(remaining, this.firstChunk);
        if (ready < target && !(ready > 0 && (starving && !first || this.now() - last >= this.chunkWaitMs))) { await sleep(this.chunkWaitMs); continue; }
        // The first chunk stays small so the first upload starts as early as possible.
        if (first) ready = Math.min(ready, this.firstChunk);
        const indexes = register.slice(position, position + ready);
        const entries = indexes.map((index, offset) => { const file = this.files[index], path = relativePathOf(file);
          return { ordinal: base + position + offset, filename: file.name, size_bytes: file.size, source_sha256: digests.get(index), ...(path ? { relative_path: path } : {}) }; });
        let result;
        try { result = await this.repeating(() => this.api.appendBatchFiles(this.batchId, entries, { signal }), signal); }
        catch (error) { fail(this.lostRegistration(error, `第 ${entries[0].ordinal + 1} 份起的文件登记未完成（连接中断或超时）。已登记的文件不受影响，`)); return; }
        if (!Array.isArray(result?.items) || result.items.length !== entries.length || result.items.some((item, offset) => item?.ordinal !== entries[offset].ordinal)) { fail(invalidReceipt()); return; }
        result.items.forEach((item, offset) => {
          const index = indexes[offset]; this.ordinals[index] = item.ordinal;
          if (item.state === 'duplicate') this.setState(index, 'duplicate', duplicateOf(item));
          else if (item.state === 'awaiting_upload') { this.setState(index, 'awaiting_upload'); queue.push(index); }
          // A replayed chunk whose files were received meanwhile: never sent twice.
          else this.setState(index, 'submitted');
        });
        this.registered += entries.length; position += ready; first = false; last = this.now(); wake(); this.emit();
      }
      // A resume decides on sealing only after every re-selected file was matched or not.
      while (!failure && verifying > 0) await sleep(0);
      if (!failure && seal && related()) {
        try { await this.repeating(() => this.api.sealBatch(this.batchId, { signal }), signal); this.sealed = true; }
        catch (error) { fail(this.lostRegistration(error, '批次结束登记未完成（连接中断或超时）。文件已全部登记，')); return; }
      }
      registering = false; wake();
    };

    const uploader = async () => {
      for (;;) {
        if (failure) return;
        if (head < queue.length) { const index = queue[head++]; wake(); await this.uploadOne(index, signal, fail); continue; }
        if (!registering && verifying === 0) return;
        await sleep(0);
      }
    };

    await Promise.all([...Array.from({ length: Math.min(this.hashConcurrency, order.length) }, hasher), registrar(), ...Array.from({ length: this.concurrency }, uploader)]);
    signal?.removeEventListener?.('abort', aborted);
    if (failure) throw failure;
  }

  async uploadOne(index, signal, fail) {
    const file = this.files[index], ordinal = this.ordinals[index];
    this.setState(index, 'uploading'); this.firstUploadAt ??= this.now(); this.emit();
    try {
      let task;
      // 429 means the slot was not admitted, so a bounded resend cannot duplicate it.
      for (let attempt = 1; ; attempt++) {
        try { task = await this.api.uploadBatchFile(this.batchId, ordinal, file, { signal }); break; }
        catch (error) { if (error?.status !== 429 || attempt >= UPLOAD_ATTEMPTS) throw error; await this.delay(500 * 2 ** (attempt - 1)); signal?.throwIfAborted(); }
      }
      if (typeof task?.task_id !== 'string' || !task.task_id || task.filename !== file.name) throw new ApiError(502, '文件回执无效，请核对批次。');
      this.setState(index, 'submitted', { taskId: task.task_id });
      this.uploadedBytes += file.size; this.finished.push({ at: this.now(), bytes: file.size }); this.finishedBytes += file.size;
    } catch (error) {
      if (error?.status === 409 && error.errorCode === 'batch_file_duplicate') { this.setState(index, 'duplicate', { documentId: null, duplicateOrdinal: null }); this.emit(); return; }
      try {
        const batch = await this.api.getBatch(this.batchId, { offset: ordinal, limit: 1, signal });
        const item = batch?.items?.[0];
        if (item?.ordinal === ordinal && item.filename === file.name && item.ingestion_task_id) this.setState(index, 'submitted', { taskId: item.ingestion_task_id });
        else this.setState(index, 'failed');
      } catch { this.setState(index, 'unknown'); }
      fail(error);
    }
    this.emit();
  }

  /** Duplicate slots of a fresh batch: the first page, then further pages only when the counts say more exist. */
  async duplicates(batch, signal) {
    const expected = Number(batch?.counts?.duplicate) || 0, found = (batch.items ?? []).filter(item => item?.state === 'duplicate');
    for (let offset = batch.items?.length ?? 0; found.length < expected && offset < batch.total; offset += 100) {
      const page = await this.api.getBatch(this.batchId, { offset, limit: 100, signal });
      if (!Array.isArray(page?.items) || page.offset !== offset || !page.items.length) throw invalidReceipt();
      found.push(...page.items.filter(item => item?.state === 'duplicate'));
    }
    return found;
  }

  /**
   * Continues a batch with re-selected originals (single files or the same folder again). A file goes
   * to a not-yet-uploaded slot with the same name, size and SHA-256, preferring the slot with the same
   * folder-relative path. Files that are already received or skipped are left out; files that belong
   * to no slot (e.g. added to the folder since) are skipped without hashing when no slot has their
   * name and size. Rejects when nothing of the selection belongs to this batch's open slots.
   *
   * An open batch (its manifest was never sealed, e.g. the page was reloaded mid-registration) also
   * takes the files it has no entry for yet — no slot with the same folder path (or name) and size —
   * up to its announced count: they are hashed, appended and uploaded like a fresh import, and the
   * batch is sealed afterwards. Matching, registering and uploading overlap, so uploads start at once.
   */
  async resume(batchId, files, { signal } = {}) {
    if (this.running) throw new ApiError(409, '上传正在进行。');
    this.running = true;
    try {
      const slots = []; let total, open = false, expected = 0;
      for (let offset = 0; total === undefined || offset < total; offset += 100) {
        const page = await this.api.getBatch(batchId, { offset, limit: 100, signal }); total = page?.total;
        open = page?.open === true; expected = Number(page?.expected_total) || 0;
        if (!Number.isSafeInteger(total) || total < (open ? 0 : 1) || !Array.isArray(page.items) || page.offset !== offset
            || (page.items.length === 0 && offset < total) || ['halted', 'cancelled'].includes(page.state)) throw new ApiError(409, '批次已停止或状态发生变化。');
        slots.push(...page.items);
      }
      const pending = new Map(), received = new Set(), duplicates = new Set();
      const content = (name, size, digest) => `${name}\u0000${size}\u0000${digest}`;
      for (const item of slots) {
        const key = content(item.filename, item.size_bytes, item.source_sha256);
        if (item.state === 'awaiting_upload') { if (!pending.has(key)) pending.set(key, []); pending.get(key).push(item); }
        else if (item.state === 'duplicate') duplicates.add(key);
        else if (item.ingestion_task_id) received.add(key);
      }
      const known = new Set(slots.filter(item => item.state === 'awaiting_upload' || item.state === 'duplicate' || item.ingestion_task_id).map(item => `${item.filename}\u0000${item.size_bytes}`));
      const entries = new Set(slots.map(item => `${item.relative_path || item.filename}\u0000${item.size_bytes}`));
      const toVerify = [], toRegister = []; let unmatched = 0;
      for (const file of files) {
        signal?.throwIfAborted();
        // An open batch has no entry for this file yet: it is registered (up to the announced count).
        if (open && !entries.has(`${relativePathOf(file) || file.name}\u0000${file.size}`)) { toRegister.push(file); continue; }
        // Not a file of this batch at all: no slot has its name and size, so it is never hashed.
        if (!known.has(`${file.name}\u0000${file.size}`)) { unmatched++; continue; }
        toVerify.push(file);
      }
      const room = open ? Math.max(0, expected - total) : 0;
      if (toRegister.length > room) { unmatched += toRegister.length - room; toRegister.length = room; }
      for (const file of [...toVerify, ...toRegister]) this.validate(file);
      this.batchId = batchId; this.reset([...toVerify, ...toRegister]); this.registered = total;
      let matched = 0, done = 0, unknown = 0;
      const claim = (index, digest) => {
        const file = this.files[index], path = relativePathOf(file), key = content(file.name, file.size, digest), candidates = pending.get(key) ?? [];
        let at = path ? candidates.findIndex(item => item.relative_path === path) : -1;
        if (at < 0 && candidates.length) at = 0;
        if (at >= 0) { this.ordinals[index] = candidates.splice(at, 1)[0].ordinal; this.setState(index, 'awaiting_upload'); matched++; return true; }
        // A slot whose earlier response was lost is already received; never send it twice.
        // A skipped duplicate needs no upload either.
        if (received.has(key)) { this.setState(index, 'submitted'); done++; return false; }
        if (duplicates.has(key)) { this.setState(index, 'duplicate', { documentId: null, duplicateOrdinal: null }); done++; return false; }
        this.setState(index, 'skipped'); unknown++; return false;
      };
      const verify = toVerify.map((_, index) => index), register = toRegister.map((_, index) => toVerify.length + index);
      this.phase = 'uploading'; this.emit(true);
      // Nothing of the selection belongs to the batch: never seal an open batch for it.
      const related = () => matched + done + register.length > 0 || !files.length;
      await this.pipeline({ verify, register, base: total, seal: open, claim, related, signal });
      this.unmatched = unmatched + unknown;
      if (!matched && !register.length && (unknown || unmatched === files.length)) throw new ApiError(422, '请选择本批次尚未上传的原文件。');
      this.phase = 'done';
      return await this.api.getBatch(batchId, { signal });
    } catch (error) { this.phase = 'failed'; throw error; }
    finally { this.running = false; this.emit(true); }
  }
}
export const batchFileLabels = Object.freeze({ preparing: '准备中', awaiting_upload: '待上传', uploading: '上传中',
  submitted: '已提交', queued: '等待解析', parsing: '解析中', parsed: '等待索引', indexing: '索引中',
  indexed: '已完成', failed: '失败', unknown: '待核对', cancelled: '已取消', deleted: '已删除', duplicate: '已存在（跳过）',
  hashing: '校验中', skipped: '不属于本批次（跳过）' });
