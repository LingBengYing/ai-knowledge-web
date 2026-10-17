import { ApiError, sha256Hex } from './api.mjs';

const UPLOAD_ATTEMPTS = 4;

/** Bounded transfers; the durable server batch owns processing and recovery. */
export class BatchUploadSession {
  constructor(api, { concurrency = 2, onProgress = () => {}, validate = () => {}, delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) } = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new TypeError('Invalid upload concurrency');
    this.api = api; this.concurrency = concurrency; this.onProgress = onProgress; this.validate = validate; this.delay = delay;
    this.batchId = null; this.requestId = null; this.progress = []; this.files = []; this.running = false;
  }
  async start(files, { requestId = crypto.randomUUID(), embeddingRequestLimit, signal } = {}) {
    if (this.running || !files.length || files.length > 10000) throw new ApiError(422, '请选择要导入的文件。');
    this.running = true; this.requestId = requestId; this.files = Array.from(files); this.progress = this.files.map(file => ({ filename: file.name, state: 'preparing' }));
    try {
      // Every slot must be uploadable before the server registers the manifest.
      for (const file of this.files) this.validate(file);
      const manifest = [];
      for (let ordinal = 0; ordinal < this.files.length; ordinal++) {
        signal?.throwIfAborted(); const file = this.files[ordinal];
        manifest.push({ filename: file.name, size_bytes: file.size, source_sha256: await sha256Hex(new Uint8Array(await file.arrayBuffer())) });
        this.progress[ordinal].state = 'awaiting_upload';
      }
      const batch = await this.api.createBatch({ request_id: requestId, files: manifest,
        ...(embeddingRequestLimit === undefined ? {} : { embedding_request_limit: embeddingRequestLimit }) }, { signal });
      if (typeof batch?.batch_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(batch.batch_id) || batch.total !== files.length) throw new ApiError(502, '批次回执无效，请刷新后核对。');
      this.batchId = batch.batch_id; this.onProgress(this.snapshot());
      this.ordinals = this.files.map((_, i) => i);
      await this.transfer(signal);
      return await this.api.getBatch(this.batchId, { signal });
    } finally { this.running = false; }
  }
  async transfer(signal) {
    let next = 0, failure;
    const worker = async () => {
      while (!failure && next < this.files.length) {
        signal?.throwIfAborted(); const index = next++, ordinal = this.ordinals[index], file = this.files[index];
        this.progress[index].state = 'uploading'; this.onProgress(this.snapshot());
        try {
          let task;
          // 429 means the slot was not admitted, so a bounded resend cannot duplicate it.
          for (let attempt = 1; ; attempt++) {
            try { task = await this.api.uploadBatchFile(this.batchId, ordinal, file, { signal }); break; }
            catch (error) { if (error?.status !== 429 || attempt >= UPLOAD_ATTEMPTS) throw error; await this.delay(500 * 2 ** (attempt - 1)); signal?.throwIfAborted(); }
          }
          if (typeof task?.task_id !== 'string' || !task.task_id || task.filename !== file.name) throw new ApiError(502, '文件回执无效，请核对批次。');
          this.progress[index] = { filename: file.name, state: 'submitted', taskId: task.task_id };
        } catch (error) {
          try {
            const batch = await this.api.getBatch(this.batchId, { offset: ordinal, limit: 1, signal });
            const item = batch?.items?.[0];
            this.progress[index] = item?.ordinal === ordinal && item.filename === file.name && item.ingestion_task_id
              ? { filename: file.name, state: 'submitted', taskId: item.ingestion_task_id } : { filename: file.name, state: 'failed' };
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
  async resume(batchId, files, { signal } = {}) {
    if (this.running) throw new ApiError(409, '上传正在进行。');
    this.running = true;
    try {
      for (const file of files) this.validate(file);
      const pending = [], received = []; let total;
      for (let offset = 0; total === undefined || offset < total; offset += 100) {
        const page = await this.api.getBatch(batchId, { offset, limit: 100, signal }); total = page.total;
        if (!Number.isSafeInteger(total) || total < 1 || !Array.isArray(page.items) || page.offset !== offset
            || (page.items.length === 0 && offset < total) || page.state === 'halted') throw new ApiError(409, '批次已停止或状态发生变化。');
        pending.push(...page.items.filter(item => item.state === 'awaiting_upload'));
        received.push(...page.items.filter(item => item.state !== 'awaiting_upload' && item.ingestion_task_id));
      }
      this.files = []; this.ordinals = [];
      for (const file of files) {
        signal?.throwIfAborted(); const digest = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
        const same = item => item.filename === file.name && item.size_bytes === file.size && item.source_sha256 === digest;
        const index = pending.findIndex(same);
        // A slot whose earlier response was lost is already received; never send it twice.
        if (index < 0 && received.some(same)) continue;
        if (index < 0) throw new ApiError(422, '请选择本批次尚未上传的原文件。');
        this.files.push(file); this.ordinals.push(pending.splice(index, 1)[0].ordinal);
      }
      this.batchId = batchId; this.progress = this.files.map(file => ({ filename: file.name, state: 'awaiting_upload' }));
      await this.transfer(signal); return await this.api.getBatch(batchId, { signal });
    } finally { this.running = false; }
  }
}
export const batchFileLabels = Object.freeze({ preparing: '准备中', awaiting_upload: '待上传', uploading: '上传中',
  submitted: '已提交', queued: '等待解析', parsing: '解析中', parsed: '等待索引', indexing: '索引中',
  indexed: '已完成', failed: '失败', unknown: '待核对', cancelled: '已取消', deleted: '已删除' });
