import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { BatchUploadSession, batchFileLabels, uploadSettled } from '../public/batch-upload.mjs';
import { Sha256, fileSha256Hex } from '../public/sha256-stream.mjs';
import { ApiError, createApi } from '../public/api.mjs';
import { createWikiWorkspaceApi } from '../public/wiki-workspace-api.mjs';

const files = count => Array.from({ length: count }, (_, i) => new File([`Synthetic ${i}`], `source-${i}.txt`));
test('batch uploads have four actual overlapping transfers and preserve manifest order', async () => {
  let inFlight = 0, peak = 0, count = 0, manifest;
  const api = {
    async createBatch(command) { manifest = command.files; return { batch_id: 'batch-1', total: command.files.length }; },
    async uploadBatchFile(id, ordinal, file) { inFlight++; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 10)); inFlight--; count++; return { task_id: `task-${ordinal}`, filename: file.name }; },
    async getBatch() { return { batch_id: 'batch-1', total: count }; },
  };
  const session = new BatchUploadSession(api);
  await session.start(files(7));
  assert.equal(peak, 4); assert.equal(count, 7); assert.equal(manifest.length, 7);
  assert.equal(session.snapshot().items.every(item => item.state === 'submitted'), true);
  assert.deepEqual(manifest.map(item => item.filename), files(7).map(file => file.name));
  assert.equal(manifest.every(item => /^[a-f0-9]{64}$/u.test(item.source_sha256)), true);
});
test('lost upload response is read back once and never automatically resent', async () => {
  let writes = 0, reads = 0;
  const api = { async createBatch() { return { batch_id: 'batch-1', total: 1 }; },
    async uploadBatchFile() { writes++; throw new Error('response lost'); },
    async getBatch() { reads++; return { items: [{ ordinal: 0, filename: 'source-0.txt', ingestion_task_id: 'task-0' }] }; } };
  const session = new BatchUploadSession(api);
  await assert.rejects(session.start(files(1)), /response lost/u);
  assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(session.snapshot().items[0].state, 'submitted');
});
test('resume transfers only matching unreceived slots and rejects a different original', async () => {
  const input = files(3), rows = [];
  for (let ordinal = 0; ordinal < input.length; ordinal++) rows.push({ ordinal, filename: input[ordinal].name,
    size_bytes: input[ordinal].size, source_sha256: await (await import('../public/api.mjs')).sha256Hex(new Uint8Array(await input[ordinal].arrayBuffer())),
    state: ordinal === 0 ? 'queued' : 'awaiting_upload', ingestion_task_id: ordinal === 0 ? 'old-task' : null });
  const writes = [];
  const api = { async getBatch(id, { offset = 0, limit = 100 } = {}) { return { batch_id: id, state: 'processing', total: rows.length, offset, items: rows.slice(offset, offset + limit) }; },
    async uploadBatchFile(id, ordinal, file) { writes.push(ordinal); return { task_id: `task-${ordinal}`, filename: file.name }; } };
  await new BatchUploadSession(api).resume('batch-1', input.slice(1));
  assert.deepEqual(writes.sort(), [1, 2]);
  await assert.rejects(new BatchUploadSession(api).resume('batch-1', [new File(['different'], input[1].name)]));
  assert.equal(writes.length, 2);
});
test('batch file transport accepts only the exact batch slot and original byte body', async () => {
  const calls = [], file = files(1)[0];
  const api = createApi({ capabilities: ['text_upload', 'ingestions'] }, 'owner', async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify({ task_id: 't', filename: file.name }), { status: 202, headers: { 'Content-Type': 'application/json' } });
  });
  const wiki = createWikiWorkspaceApi({ api });
  await wiki.uploadBatchFile('batch-1', 3, file);
  assert.equal(calls[0].url, '/v1/document-batches/batch-1/files/3');
  assert.equal(calls[0].options.body, file); assert.equal(calls[0].options.headers['Content-Type'], 'application/octet-stream');
  await assert.rejects(api('/v1/documents', { method: 'POST', file, batchUpload: { batchId: 'batch-1', ordinal: 3 } }));
});
test('busy upload slots are resent with bounded backoff, other failures are not', async () => {
  const waits = []; let writes = 0;
  const api = { async createBatch() { return { batch_id: 'batch-1', total: 1 }; },
    async uploadBatchFile(id, ordinal, file) { if (++writes < 3) throw new ApiError(429, '上传通道繁忙，请稍后继续上传。'); return { task_id: 't', filename: file.name }; },
    async getBatch() { return { items: [] }; } };
  await new BatchUploadSession(api, { delay: async ms => { waits.push(ms); } }).start(files(1));
  assert.equal(writes, 3); assert.deepEqual(waits, [500, 1000]);
  writes = 0; api.uploadBatchFile = async () => { writes++; throw new ApiError(429, 'busy'); };
  await assert.rejects(new BatchUploadSession(api, { delay: async () => {} }).start(files(1)), /busy/u); assert.equal(writes, 4);
});

test('streaming SHA-256 matches a one-shot digest across chunk and block boundaries', async () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 70001]) {
    const bytes = randomBytes(size), hash = new Sha256();
    for (let offset = 0; offset < size; offset += 37) hash.update(bytes.subarray(offset, offset + 37));
    assert.equal(hash.hex(), createHash('sha256').update(bytes).digest('hex'), `size ${size}`);
  }
  const bytes = randomBytes(3 * 1024 * 1024 + 5), sliced = [];
  const blob = new Blob([bytes]), slice = blob.slice.bind(blob);
  blob.slice = (start, end) => { sliced.push(end - start); return slice(start, end); };
  assert.equal(await fileSha256Hex(blob, { chunkBytes: 1024 * 1024 }), createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(sliced, [1048576, 1048576, 1048576, 5], 'read in bounded slices, never whole');
  const small = new Blob(['Synthetic']);
  assert.equal(await fileSha256Hex(small), createHash('sha256').update('Synthetic').digest('hex'));
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(fileSha256Hex(blob, { chunkBytes: 1024 * 1024, signal: aborted.signal }));
});
test('duplicate slots are skipped, settled and never uploaded; opting in sends the flag', async () => {
  const input = files(205), writes = [], creates = [], reads = [];
  const duplicateOrdinals = new Set([1, 150, 204]);
  const row = ordinal => ({ ordinal, filename: input[ordinal].name, state: duplicateOrdinals.has(ordinal) ? 'duplicate' : 'awaiting_upload',
    duplicate_of_document_id: ordinal === 1 ? 'doc-existing' : null, duplicate_of_ordinal: ordinal === 1 ? null : 0 });
  const api = {
    async createBatch(command) { creates.push(command); const items = Array.from({ length: 100 }, (_, i) => row(i));
      return { batch_id: 'batch-1', total: input.length, counts: { duplicate: command.include_duplicates ? 0 : 3 }, items: command.include_duplicates ? [] : items }; },
    async getBatch(id, { offset = 0, limit = 100 } = {}) { reads.push(offset); return { batch_id: id, total: input.length, offset, items: Array.from({ length: Math.min(limit, input.length - offset) }, (_, i) => row(offset + i)) }; },
    async uploadBatchFile(id, ordinal, file) { writes.push(ordinal); return { task_id: `task-${ordinal}`, filename: file.name }; },
  };
  const session = new BatchUploadSession(api);
  await session.start(input);
  assert.equal(creates[0].include_duplicates, undefined, 'the default manifest is unchanged');
  assert.deepEqual(reads.slice(0, 2), [100, 200], 'later pages are read only until every duplicate is known');
  assert.equal(writes.length, 202); assert.equal(writes.some(ordinal => duplicateOrdinals.has(ordinal)), false);
  const items = session.snapshot().items;
  assert.equal(items[1].state, 'duplicate'); assert.equal(items[1].documentId, 'doc-existing'); assert.equal(items[150].duplicateOrdinal, 0);
  assert.equal(items.every(item => uploadSettled(item.state)), true);
  assert.equal(batchFileLabels.duplicate, '已存在（跳过）');
  writes.length = 0;
  await new BatchUploadSession(api).start(input, { includeDuplicates: true });
  assert.equal(creates[1].include_duplicates, true); assert.equal(writes.length, 205);
});
test('a slot the server reports as duplicate on upload is settled, not failed', async () => {
  const api = { async createBatch() { return { batch_id: 'batch-1', total: 2, counts: {}, items: [] }; },
    async uploadBatchFile(id, ordinal, file) { if (ordinal === 0) throw new ApiError(409, '已存在', { errorCode: 'batch_file_duplicate' }); return { task_id: 't1', filename: file.name }; },
    async getBatch() { return { batch_id: 'batch-1', total: 2 }; } };
  const session = new BatchUploadSession(api);
  await session.start(files(2));
  assert.deepEqual(session.snapshot().items.map(item => item.state), ['duplicate', 'submitted']);
});
test('resume skips files whose slot was skipped as a duplicate', async () => {
  const input = files(2), rows = [];
  for (let ordinal = 0; ordinal < input.length; ordinal++) rows.push({ ordinal, filename: input[ordinal].name, size_bytes: input[ordinal].size,
    source_sha256: createHash('sha256').update(Buffer.from(await input[ordinal].arrayBuffer())).digest('hex'),
    state: ordinal === 0 ? 'duplicate' : 'awaiting_upload', ingestion_task_id: null });
  const writes = [];
  const api = { async getBatch(id, { offset = 0, limit = 100 } = {}) { return { batch_id: id, state: 'awaiting_upload', total: rows.length, offset, items: rows.slice(offset, offset + limit) }; },
    async uploadBatchFile(id, ordinal, file) { writes.push(ordinal); return { task_id: `task-${ordinal}`, filename: file.name }; } };
  await new BatchUploadSession(api).resume('batch-1', input);
  assert.deepEqual(writes, [1]);
});

// Phase 3: folders, drag and drop, paths, resume by path, estimates and throughput.
const { withRelativePath, relativePathOf, partitionImportable, droppedEntries, collectEntries, estimateEmbeddingRequests, checkedRequestLimit,
  batchThroughput, formatDuration, displayPath } = await import('../public/batch-upload.mjs');
const inFolder = (content, path) => { const file = new File([content], path.split('/').at(-1)); Object.defineProperty(file, 'webkitRelativePath', { value: path }); return file; };
/** A FileSystemEntry tree like Chrome's: readEntries hands out at most `batch` children per call. */
function entryTree(node, name = node.name, batch = 2) {
  if (node.content !== undefined) return { isFile: true, isDirectory: false, name, file: (resolve) => resolve(new File([node.content], name)) };
  return { isFile: false, isDirectory: true, name, createReader() {
    let index = 0; const children = Object.entries(node.children).map(([child, value]) => entryTree(value, child, batch));
    return { readEntries(resolve) { const next = children.slice(index, index + batch); index += next.length; setTimeout(() => resolve(next), 0); } };
  } };
}
test('dropped folders are followed recursively with paths, readEntries batches and bounded count and depth', async () => {
  const tree = { name: '资料', children: { 'a.txt': { content: 'a' }, '.DS_Store': { content: 'x' }, sub: { children: { 'b.md': { content: 'b' }, deeper: { children: { 'c.pdf': { content: 'c' } } }, 'Thumbs.db': { content: 't' } } }, 'x.exe': { content: 'e' } } };
  const loose = new File(['loose'], 'loose.txt');
  const transfer = { items: [{ kind: 'file', webkitGetAsEntry: () => entryTree(tree) }, { kind: 'file', webkitGetAsEntry: () => ({ isFile: true, name: 'loose.txt', file: resolve => resolve(loose) }) }, { kind: 'string', webkitGetAsEntry: () => null }] };
  const entries = droppedEntries(transfer);
  assert.equal(entries.length, 2, 'entries are taken synchronously, strings ignored');
  const { files: collected, truncated } = await collectEntries(entries);
  assert.equal(truncated, false);
  assert.deepEqual(collected.map(file => relativePathOf(file) || file.name).sort(),
    ['loose.txt', '资料/.DS_Store', '资料/a.txt', '资料/sub/Thumbs.db', '资料/sub/b.md', '资料/sub/deeper/c.pdf', '资料/x.exe'].sort());
  const { accepted, skipped } = partitionImportable(collected, '.txt,.md,.pdf');
  assert.deepEqual(accepted.map(file => relativePathOf(file) || file.name).sort(), ['loose.txt', '资料/a.txt', '资料/sub/b.md', '资料/sub/deeper/c.pdf']);
  assert.deepEqual(skipped.sort(), ['资料/.DS_Store', '资料/sub/Thumbs.db', '资料/x.exe']);
  const capped = await collectEntries(droppedEntries(transfer), { maxFiles: 3 });
  assert.equal(capped.files.length, 3); assert.equal(capped.truncated, true);
  const shallow = await collectEntries(droppedEntries(transfer), { maxDepth: 1 });
  assert.equal(shallow.truncated, true); assert.equal(shallow.files.some(file => relativePathOf(file).includes('deeper')), false);
  // Without the entry API the drop falls back to its plain files.
  const fallback = await collectEntries(droppedEntries({ items: [], files: [loose] }));
  assert.deepEqual(fallback.files, [loose]);
});
test('hidden folders, system and lock files are skipped from a folder selection', () => {
  const picked = ['proj/.git/config.txt', 'proj/__MACOSX/a.txt', 'proj/~$draft.docx', 'proj/desktop.ini', 'proj/ok.docx', 'proj/README', 'proj/图.PNG'].map(path => inFolder('x', path));
  const { accepted, skipped } = partitionImportable(picked, '.docx,.png,.txt');
  assert.deepEqual(accepted.map(relativePathOf), ['proj/ok.docx', 'proj/图.PNG']);
  assert.equal(skipped.length, 5);
});
test('relative paths follow the server rules and travel only for folder files', async () => {
  assert.equal(relativePathOf(inFolder('a', 'top/a.txt')), 'top/a.txt');
  assert.equal(relativePathOf(new File(['a'], 'a.txt')), '', 'a loose file has no path');
  for (const bad of ['../a.txt', 'x/../a.txt', './a.txt', '/abs/a.txt', 'x//a.txt', 'x\\y/a.txt', 'x/\u0007/a.txt', 'x/b.txt', `${'d/'.repeat(512)}a.txt`])
    assert.equal(relativePathOf(withRelativePath(new File(['a'], 'a.txt'), bad)), '', bad);
  assert.equal(relativePathOf(withRelativePath(new File(['a'], 'a.txt'), `${'d/'.repeat(509)}a.txt`)).length, 1023);
  assert.equal(displayPath({ filename: 'a.txt', relative_path: 'x/a.txt' }), 'x/a.txt'); assert.equal(displayPath({ filename: 'a.txt', relative_path: null }), 'a.txt');
  let manifest;
  const api = { async createBatch(command) { manifest = command.files; return { batch_id: 'batch-1', total: command.files.length }; },
    async uploadBatchFile(id, ordinal, file) { return { task_id: `t${ordinal}`, filename: file.name }; }, async getBatch() { return {}; } };
  const session = new BatchUploadSession(api);
  await session.start([inFolder('a', '资料/一/a.txt'), new File(['b'], 'b.txt')], { embeddingRequestLimit: 7 });
  assert.equal(manifest[0].relative_path, '资料/一/a.txt'); assert.equal('relative_path' in manifest[1], false);
  assert.equal(session.snapshot().items[0].relativePath, '资料/一/a.txt');
});
test('continuing with the same folder matches slots by path, size and SHA and skips files of no slot unhashed', async () => {
  const sha = file => file.arrayBuffer().then(bytes => createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
  // Same name and bytes in two folders: each goes to the slot of its own path.
  const one = inFolder('same', 'root/one/note.txt'), two = inFolder('same', 'root/two/note.txt'), done = inFolder('done', 'root/done.txt');
  const rows = [
    { ordinal: 0, filename: 'note.txt', relative_path: 'root/two/note.txt', size_bytes: two.size, source_sha256: await sha(two), state: 'awaiting_upload' },
    { ordinal: 1, filename: 'note.txt', relative_path: 'root/one/note.txt', size_bytes: one.size, source_sha256: await sha(one), state: 'awaiting_upload' },
    { ordinal: 2, filename: 'done.txt', relative_path: 'root/done.txt', size_bytes: done.size, source_sha256: await sha(done), state: 'queued', ingestion_task_id: 'old' }];
  const writes = [], hashed = [];
  const api = { async getBatch(id, { offset = 0, limit = 100 } = {}) { return { batch_id: id, state: 'processing', total: rows.length, offset, items: rows.slice(offset, offset + limit) }; },
    async uploadBatchFile(id, ordinal, file) { writes.push([ordinal, relativePathOf(file)]); return { task_id: `t${ordinal}`, filename: file.name }; } };
  const extra = inFolder('added later', 'root/new.txt');
  const session = new BatchUploadSession(api, { hash: async file => { hashed.push(relativePathOf(file)); return sha(file); } });
  await session.resume('batch-1', [one, two, done, extra]);
  assert.deepEqual(writes.sort(), [[0, 'root/two/note.txt'], [1, 'root/one/note.txt']]);
  assert.equal(session.unmatched, 1); assert.equal(hashed.includes('root/new.txt'), false, 'a file of no slot is never hashed');
  await assert.rejects(new BatchUploadSession(api).resume('batch-1', [extra]), /尚未上传的原文件/u);
});
test('embedding estimate follows segment windows and 31 segments per request; the budget field is checked', () => {
  const sized = size => ({ size });
  assert.equal(estimateEmbeddingRequests([]), 0);
  assert.equal(estimateEmbeddingRequests([sized(1)]), 1);
  assert.equal(estimateEmbeddingRequests([sized(1200)]), 1);
  // 31 segments: 1200 + 30 × 1080 characters fit one request; one more character needs a second.
  assert.equal(estimateEmbeddingRequests([sized(1200 + 30 * 1080)]), 1);
  assert.equal(estimateEmbeddingRequests([sized(1200 + 30 * 1080 + 1)]), 2);
  // Requests are per document: two small files are two requests, not one.
  assert.equal(estimateEmbeddingRequests([sized(10), sized(10)]), 2);
  // A document never exceeds the parser's 4096 segments: ceil(4096 / 31) = 133.
  assert.equal(estimateEmbeddingRequests([sized(20 * 1024 * 1024)]), 133);
  assert.equal(estimateEmbeddingRequests([{ name: 'scan.JPG', size: 9 * 1024 * 1024 }, { name: 'a.png', size: 5 }]), 2, 'images count one request each');
  assert.equal(checkedRequestLimit(''), undefined); assert.equal(checkedRequestLimit(' 25 '), 25); assert.equal(checkedRequestLimit('1000000'), 1000000);
  for (const bad of ['0', '-1', '1.5', '1000001', 'abc', '1e3']) assert.equal(checkedRequestLimit(bad), null, bad);
});
test('throughput and ETA come from the recent window and only count uploaded files still in progress', () => {
  const batch = (finished, windowSeconds, counts) => ({ counts, throughput: { finished, window_seconds: windowSeconds } });
  assert.deepEqual(batchThroughput(batch(20, 600, { queued: 30, indexing: 10, awaiting_upload: 99, indexed: 20 })), { filesPerMinute: 2, etaSeconds: 1200, remaining: 40 });
  assert.equal(batchThroughput(batch(0, 600, { queued: 3 })).etaSeconds, null, 'nothing finished yet: no estimate');
  assert.equal(batchThroughput(batch(5, 10, { queued: 3 })).filesPerMinute, null, 'too short a window: no estimate');
  assert.equal(batchThroughput(batch(5, 300, {})).etaSeconds, 0);
  assert.equal(batchThroughput({ counts: { queued: 1 } }).filesPerMinute, null, 'an older server without throughput');
  assert.equal(batchThroughput(batch(3, 90, { parsing: 1 })).etaSeconds, 30);
  assert.equal(formatDuration(30), '不到 1 分钟'); assert.equal(formatDuration(1200), '约 20 分钟'); assert.equal(formatDuration(7500), '约 2 小时 5 分钟'); assert.equal(formatDuration(7200), '约 2 小时');
});
test('history and filtered batch reads build exact query strings and refuse unknown state names', async () => {
  const urls = [];
  const api = createApi({ capabilities: ['ingestions', 'text_upload'] }, 'owner', async url => { urls.push(url); return Response.json({}); });
  const wiki = createWikiWorkspaceApi({ api });
  await wiki.listBatches(); await wiki.listBatches({ offset: 40, limit: 20 });
  await wiki.getBatch('b1', { states: ['failed', 'cancelled'] }); await wiki.getBatch('b1');
  assert.deepEqual(urls, ['/v1/document-batches?offset=0&limit=20', '/v1/document-batches?offset=40&limit=20',
    '/v1/document-batches/b1?offset=0&limit=100&state=failed%2Ccancelled', '/v1/document-batches/b1?offset=0&limit=100']);
  assert.throws(() => wiki.getBatch('b1', { states: ['Failed'] })); assert.throws(() => wiki.getBatch('b1', { states: ['a<b'] }));
  assert.throws(() => wiki.listBatches({ limit: 101 }));
});

test('a large manifest is hashed four files at a time, in order, with throttled preparation progress', async () => {
  const input = Array.from({ length: 3827 }, (_, i) => new File([`<doc>${i}</doc>`], `ted2020-${i}.xml`));
  let inFlight = 0, peak = 0, clock = 0, manifest;
  const reports = [];
  const hash = async file => { inFlight++; peak = Math.max(peak, inFlight); clock += 1; await new Promise(resolve => setTimeout(resolve, Number(file.name.match(/\d+/u)[0]) % 3)); inFlight--; return createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex'); };
  const api = { async createBatch(command) { manifest = command.files; return { batch_id: 'batch-1', total: command.files.length }; },
    async uploadBatchFile(id, ordinal, file) { return { task_id: `task-${ordinal}`, filename: file.name }; }, async getBatch() { return {}; } };
  const session = new BatchUploadSession(api, { hash, now: () => clock, onProgress: progress => { if (progress.phase) reports.push([progress.phase, progress.prepared, progress.total]); } });
  await session.start(input);
  assert.equal(peak, 4);
  assert.deepEqual(manifest.map(item => item.filename), input.map(file => file.name));
  assert.equal(manifest[3826].source_sha256, createHash('sha256').update('<doc>3826</doc>').digest('hex'));
  const preparing = reports.filter(([phase]) => phase === 'preparing');
  assert.deepEqual(preparing[0], ['preparing', 0, 3827]); assert.deepEqual(preparing.at(-1), ['preparing', 3827, 3827]);
  assert.ok(preparing.length > 10 && preparing.length < 60, `throttled: ${preparing.length} reports`);
  assert.ok(preparing.every((report, i) => i === 0 || report[1] >= preparing[i - 1][1]));
  assert.deepEqual(reports.find(([phase]) => phase === 'registering'), ['registering', 3827, 3827]);
});
test('an unreadable file or a lost registration fails preparation with a clear message', async () => {
  let creates = 0;
  const api = { async createBatch() { creates++; throw new ApiError(504, '知识库服务暂不可用。'); } };
  const unreadable = new BatchUploadSession(api, { hash: async file => { if (file.name === 'source-2.txt') throw new DOMException('A requested file could not be read', 'NotReadableError'); return 'a'.repeat(64); } });
  await assert.rejects(unreadable.start(files(5)), error => error instanceof ApiError && /无法读取文件“source-2\.txt”/u.test(error.message));
  assert.equal(creates, 0); assert.equal(unreadable.running, false);
  const lost = new BatchUploadSession(api, { hash: async () => 'a'.repeat(64) });
  await assert.rejects(lost.start(files(3)), error => error.status === 504 && /3 份文件的批次登记未完成/u.test(error.message) && /确认导入/u.test(error.message));
  assert.equal(creates, 1); assert.equal(lost.batchId, null);
  const refused = new BatchUploadSession({ async createBatch() { throw new ApiError(422, '清单无效。'); } }, { hash: async () => 'a'.repeat(64) });
  await assert.rejects(refused.start(files(1)), /^ApiError: 清单无效。$|清单无效。/u);
});

// Streaming: open batches register in chunks while files upload, then are sealed.
const { FIRST_CHUNK, PROGRESS_MS, formatEta, formatBytes } = await import('../public/batch-upload.mjs');
const { uploadProgressHtml } = await import('../public/wiki-workspace.mjs');
const shaHex = async file => createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
/** An in-memory open-batch server with the Java service's append rules (replay, conflict, gap, seal, dedupe). */
function openServer({ registered = [], expected = 0, sealedAlready = false } = {}) {
  const entries = registered.map(entry => ({ ...entry })), calls = [], uploads = [];
  const server = { entries, calls, uploads, sealed: sealedAlready, expected, failAppend: [], uploadClock: null };
  server.api = {
    async createBatch(command) {
      calls.push(['create', command]);
      if (command.open !== true) throw new Error('streaming sessions open their batch');
      server.expected = command.expected_total;
      return { batch_id: 'open-1', open: true, expected_total: command.expected_total, state: 'awaiting_upload', total: entries.length, counts: {}, items: [] };
    },
    async appendBatchFiles(id, files) {
      calls.push(['append', files[0].ordinal, files.length]);
      const failure = server.failAppend.shift(); if (failure) throw failure;
      if (files[0].ordinal > entries.length) throw new ApiError(409, '登记顺序不连续', { errorCode: 'batch_manifest_gap' });
      for (const file of files) {
        const known = entries[file.ordinal];
        if (known) { if (known.filename !== file.filename || known.size_bytes !== file.size_bytes || known.source_sha256 !== file.source_sha256 || (known.relative_path ?? null) !== (file.relative_path ?? null)) throw new ApiError(409, '批次文件内容或处理状态已改变，请刷新批次。', { errorCode: 'batch_upload_conflict' }); continue; }
        if (server.sealed) throw new ApiError(409, '批次已结束登记，不能再追加文件。', { errorCode: 'batch_sealed' });
        if (file.ordinal >= server.expected) throw new ApiError(422, '请求字段、长度或取值无效。');
        const first = entries.find(entry => entry.source_sha256 === file.source_sha256 && entry.state !== 'duplicate');
        entries.push({ ...file, relative_path: file.relative_path ?? null, state: first ? 'duplicate' : 'awaiting_upload', duplicate_of_ordinal: first ? first.ordinal : null, ingestion_task_id: null });
      }
      return { batch_id: id, registered: entries.length, expected_total: server.expected, open: !server.sealed,
        items: files.map(file => ({ ordinal: file.ordinal, state: entries[file.ordinal].state, duplicate_of_document_id: null, duplicate_of_ordinal: entries[file.ordinal].duplicate_of_ordinal })) };
    },
    async sealBatch(id) { calls.push(['seal']); server.sealed = true; return { batch_id: id, action: 'seal', affected: 1 }; },
    async cancelBatch(id) { calls.push(['cancel', id]); return { batch_id: id, action: 'cancel', affected: 0 }; },
    async uploadBatchFile(id, ordinal, file) {
      calls.push(['upload', ordinal]); uploads.push(ordinal); await server.uploadClock?.(ordinal);
      const entry = entries[ordinal];
      if (!entry || entry.state !== 'awaiting_upload' && !entry.ingestion_task_id) throw new ApiError(409, '已存在', { errorCode: 'batch_file_duplicate' });
      Object.assign(entry, { state: 'queued', ingestion_task_id: `t${ordinal}` });
      return { task_id: `t${ordinal}`, filename: file.name };
    },
    async getBatch(id, { offset = 0, limit = 100 } = {}) {
      return { batch_id: id, state: 'awaiting_upload', open: !server.sealed, expected_total: server.expected, total: entries.length, offset, items: entries.slice(offset, offset + limit) };
    },
  };
  return server;
}
const tedFiles = count => Array.from({ length: count }, (_, i) => inFolder(`<doc>${i}</doc>`, `zh_cn/ted2020-${i}.xml`));

test('3827 files: the first upload starts after one chunk is hashed, not after all of them', async () => {
  const input = tedFiles(3827), server = openServer();
  let hashed = 0, hashedAtFirstUpload = null, registeredAtFirstUpload = null;
  const hash = async file => { await new Promise(resolve => setTimeout(resolve, 1)); hashed++; return shaHex(file); };
  const upload = server.api.uploadBatchFile;
  server.api.uploadBatchFile = async (...args) => { if (hashedAtFirstUpload === null) { hashedAtFirstUpload = hashed; registeredAtFirstUpload = server.entries.length; } return upload(...args); };
  const session = new BatchUploadSession(server.api, { streaming: true, hash });
  await session.start(input);
  assert.ok(hashedAtFirstUpload <= FIRST_CHUNK + session.hashConcurrency, `hashed before the first upload: ${hashedAtFirstUpload}`);
  assert.equal(registeredAtFirstUpload, FIRST_CHUNK, 'the first chunk is registered on its own');
  const appends = server.calls.filter(([kind]) => kind === 'append');
  assert.deepEqual(appends[0], ['append', 0, FIRST_CHUNK]);
  assert.ok(appends.length > 2, 'the manifest grows in several chunks');
  assert.ok(appends.every(([, , count]) => count <= 500));
  // Consecutive ordinals in selection order, every file once, sealed once after the last chunk.
  assert.deepEqual(server.entries.map(entry => entry.ordinal), input.map((_, i) => i));
  assert.deepEqual(server.entries.map(entry => entry.relative_path), input.map(file => relativePathOf(file)));
  assert.deepEqual([...server.uploads].sort((a, b) => a - b), input.map((_, i) => i));
  const kinds = server.calls.map(([kind]) => kind);
  assert.equal(kinds.filter(kind => kind === 'seal').length, 1);
  assert.ok(kinds.indexOf('seal') > kinds.lastIndexOf('append'));
  assert.ok(kinds.indexOf('upload') < kinds.lastIndexOf('append'), 'uploads overlap registration');
  assert.equal(server.calls[0][1].expected_total, 3827); assert.equal('files' in server.calls[0][1], false);
  const view = session.view();
  assert.equal(view.counts.submitted, 3827); assert.equal(view.percent, 100); assert.equal(view.registered, 3827);
  assert.equal(session.sealed, true);
});

test('an open batch is sealed only after its last chunk; a refused chunk stops registration without sealing', async () => {
  const input = tedFiles(120), server = openServer();
  server.failAppend.push(undefined, new ApiError(409, '批次文件内容或处理状态已改变，请刷新批次。', { errorCode: 'batch_upload_conflict' }));
  const session = new BatchUploadSession(server.api, { streaming: true, hash: shaHex });
  await assert.rejects(session.start(input), error => error.status === 409 && /已改变/u.test(error.message));
  assert.equal(server.calls.some(([kind]) => kind === 'seal'), false, 'never sealed after a refused chunk');
  assert.equal(server.entries.length, FIRST_CHUNK);
  assert.ok(server.uploads.every(ordinal => ordinal < FIRST_CHUNK));
  // What is left to send after the failure: everything not received, for "确认导入" to continue with.
  const left = session.unsettledFiles();
  assert.equal(left.length, input.length - server.uploads.length);
});

test('appends are repeated after a lost reply and replays are idempotent; a retried import never re-registers or re-sends', async () => {
  const input = tedFiles(80), server = openServer(), waits = [];
  // The second chunk's reply is lost after the server recorded it: the repeat is a replay.
  const append = server.api.appendBatchFiles;
  let lost = false;
  server.api.appendBatchFiles = async (id, files, options) => { const result = await append(id, files, options); if (files[0].ordinal > 0 && !lost) { lost = true; throw new ApiError(504, '知识库服务暂不可用。'); } return result; };
  const session = new BatchUploadSession(server.api, { streaming: true, hash: shaHex, delay: async ms => { waits.push(ms); } });
  await session.start(input, { requestId: 'same-request' });
  assert.deepEqual(waits, [500]);
  assert.equal(server.entries.length, 80); assert.equal(new Set(server.uploads).size, 80); assert.equal(server.uploads.length, 80);
  // The whole import again with the same request ID: the open batch is returned, chunks replay, nothing is re-sent.
  server.sealed = false; const before = server.uploads.length;
  server.api.createBatch = async command => ({ batch_id: 'open-1', open: true, expected_total: command.expected_total, total: server.entries.length, items: [] });
  await new BatchUploadSession(server.api, { streaming: true, hash: shaHex }).start(input, { requestId: 'same-request' });
  assert.equal(server.uploads.length, before, 'received files are never sent twice');
  assert.equal(server.entries.length, 80);
  // A different entry at a registered ordinal is a conflict, not a silent overwrite.
  const changed = [...input]; changed[3] = inFolder('<doc>changed</doc>', 'zh_cn/ted2020-3.xml');
  await assert.rejects(new BatchUploadSession(server.api, { streaming: true, hash: shaHex }).start(changed, { requestId: 'same-request' }), error => error.errorCode === 'batch_upload_conflict');
});

test('duplicates found while appending are skipped and never uploaded', async () => {
  const input = [inFolder('same', 'a/1.txt'), inFolder('same', 'b/2.txt'), inFolder('other', 'a/3.txt')], server = openServer();
  const session = new BatchUploadSession(server.api, { streaming: true, hash: shaHex });
  await session.start(input);
  assert.deepEqual(server.uploads.sort(), [0, 2]);
  assert.equal(session.snapshot().items[1].state, 'duplicate'); assert.equal(session.snapshot().items[1].duplicateOrdinal, 0);
  assert.equal(session.view().counts.duplicate, 1); assert.equal(session.view().percent, 100);
});

test('an entry server without the append route falls back to one manifest under a new request ID', async () => {
  const input = tedFiles(5), server = openServer(), creates = [];
  server.api.appendBatchFiles = async () => { throw new ApiError(404, '开发请求不符合安全约束。'); };
  server.api.createBatch = async command => { creates.push(command); return command.open ? { batch_id: 'open-1', open: true, expected_total: command.expected_total, total: 0, items: [] } : { batch_id: 'legacy-1', total: command.files.length, counts: {}, items: [] }; };
  const session = new BatchUploadSession(server.api, { streaming: true, hash: shaHex });
  await session.start(input, { requestId: 'first' });
  assert.equal(creates.length, 2); assert.equal(creates[0].open, true); assert.equal(creates[1].files.length, 5);
  assert.notEqual(creates[1].request_id, 'first'); assert.equal(session.requestId, creates[1].request_id);
  assert.deepEqual(server.calls.filter(([kind]) => kind === 'cancel'), [['cancel', 'open-1']]);
  assert.equal(session.batchId, 'legacy-1'); assert.equal(session.streaming, false); assert.equal(server.uploads.length, 5);
  // A refusal by the service itself (with its error code) is not a missing route.
  const strict = openServer(); strict.api.appendBatchFiles = async () => { throw new ApiError(404, '资源不存在。', { errorCode: 'not_found' }); };
  await assert.rejects(new BatchUploadSession(strict.api, { streaming: true, hash: shaHex }).start(input), /资源不存在/u);
});

test('resume of a partly registered open batch uploads the registered rest, appends the unregistered files and seals', async () => {
  const input = tedFiles(20), registered = [];
  for (let ordinal = 0; ordinal < 10; ordinal++) registered.push({ ordinal, filename: input[ordinal].name, size_bytes: input[ordinal].size, source_sha256: await shaHex(input[ordinal]),
    relative_path: relativePathOf(input[ordinal]), state: ordinal < 4 ? 'queued' : 'awaiting_upload', ingestion_task_id: ordinal < 4 ? `old-${ordinal}` : null });
  const server = openServer({ registered, expected: 20 });
  const session = new BatchUploadSession(server.api, { hash: shaHex });
  await session.resume('open-1', input);
  assert.deepEqual([...server.uploads].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 4), 'received files are not sent again');
  assert.deepEqual(server.calls.filter(([kind]) => kind === 'append').map(([, ordinal]) => ordinal), [10], 'the rest continues right after the registered entries');
  assert.deepEqual(server.entries.map(entry => entry.relative_path), input.map(file => relativePathOf(file)));
  assert.equal(server.sealed, true); assert.equal(session.unmatched, 0);
  // Only up to the announced count is appended; the rest is reported as not belonging.
  const fuller = openServer({ registered: registered.map(entry => ({ ...entry })), expected: 12 });
  const capped = new BatchUploadSession(fuller.api, { hash: shaHex });
  await capped.resume('open-1', input);
  assert.equal(fuller.entries.length, 12); assert.equal(capped.unmatched, 8);
  // A folder that has nothing to do with the batch is refused and the batch stays open.
  const untouched = openServer({ registered: registered.map(entry => ({ ...entry })), expected: 10 });
  await assert.rejects(new BatchUploadSession(untouched.api, { hash: shaHex }).resume('open-1', [new File(['unrelated'], 'other.txt')]), /尚未上传的原文件/u);
  assert.equal(untouched.sealed, false);
  // A changed file at a registered path is skipped, never appended a second time.
  const changed = openServer({ registered: registered.map(entry => ({ ...entry })), expected: 20 });
  const edited = [...input]; edited[5] = inFolder('<doc>5!</doc>', 'zh_cn/ted2020-5.xml');
  const result = new BatchUploadSession(changed.api, { hash: shaHex });
  await result.resume('open-1', edited);
  assert.equal(changed.uploads.includes(5), false); assert.equal(changed.entries.length, 20); assert.equal(result.unmatched, 1);
});

test('progress reports are throttled to five a second and carry counters and a few rows, never every file', async () => {
  const input = tedFiles(600), server = openServer(), reports = [];
  let clock = 0;
  const session = new BatchUploadSession(server.api, { streaming: true, now: () => clock,
    // Trailing reports never fire here, so only the throttle decides what is sent.
    timers: { set: () => 1, clear: () => {} },
    hash: async file => { clock += 3; return shaHex(file); }, onProgress: progress => reports.push(progress) });
  server.uploadClock = async () => { clock += 5; };
  await session.start(input);
  // Phase changes and the end are always reported; everything else at most once per PROGRESS_MS.
  assert.ok(reports.length <= Math.ceil(clock / PROGRESS_MS) + 6, `${reports.length} reports over ${clock} ms`);
  assert.ok(reports.length >= 5);
  for (const report of reports) {
    assert.equal('items' in report, false);
    assert.ok(report.active.length <= 8 && report.recent.length <= 8);
  }
  assert.equal(reports.at(-1).counts.submitted, 600);
});

test('the progress bar shows uploaded / total, stage counts, speed and the estimate', async () => {
  const input = Array.from({ length: 10 }, (_, i) => new File([new Uint8Array(1000).fill(i)], `f${i}.bin`)), server = openServer();
  let clock = 0, seen = null, html = '';
  server.uploadClock = async ordinal => { if (ordinal === 4) seen = session.view(); clock += 500; };
  const session = new BatchUploadSession(server.api, { streaming: true, concurrency: 1, hashConcurrency: 1, now: () => clock, hash: shaHex, onProgress: () => {} });
  await session.start(input);
  // Four files finished at 0.5 s intervals within the first two seconds of uploading.
  assert.equal(seen.settled, 4); assert.equal(seen.percent, 40); assert.equal(seen.total, 10);
  assert.equal(seen.counts.submitted, 4); assert.equal(seen.counts.uploading, 1); assert.equal(seen.counts.awaiting_upload, 5); assert.equal(seen.counts.preparing, 0);
  assert.equal(seen.filesPerSecond, 2); assert.equal(seen.bytesPerSecond, 2000); assert.equal(seen.etaSeconds, 3);
  assert.equal(seen.active[0].state, 'uploading'); assert.equal(seen.recent[0].label, 'f3.bin');
  html = uploadProgressHtml({ ...seen, batchId: 'open-1' });
  assert.match(html, /已上传 4 \/ 10 份（40%）/u);
  assert.match(html, /<progress class="upload-progress" max="100" value="40"/u);
  assert.match(html, /校验中 0<\/span><span>待上传 5<\/span><span>上传中 1<\/span><span>已提交 4<\/span><span>跳过 0<\/span><span>失败 0/u);
  assert.match(html, /速度 2\.0 份\/秒 · 2\.0 KB\/秒/u); assert.match(html, /预计剩余 约 3 秒/u);
  assert.match(html, /href="#\/imports\/open-1">查看批次处理进度/u);
  const done = uploadProgressHtml({ ...session.view(), phase: 'done' });
  assert.match(done, /上传完成 10 \/ 10 份（100%）/u); assert.match(done, /上传完成，正在后台解析和索引 → <a class="text-link" href="#\/imports\/open-1">查看批次进度/u);
  // Names are escaped; no estimate before anything finished.
  const early = uploadProgressHtml({ phase: 'uploading', streaming: true, total: 3, settled: 0, percent: 0, counts: { preparing: 3 }, filesPerSecond: null, etaSeconds: null, active: [{ label: '<b>x</b>.txt', state: 'hashing' }], recent: [] });
  assert.match(early, /&lt;b&gt;x&lt;\/b&gt;\.txt/u); assert.match(early, /速度统计中/u); assert.doesNotMatch(early, /预计剩余/u);
  assert.equal(formatEta(3), '约 3 秒'); assert.equal(formatEta(125), '约 2 分钟'); assert.equal(formatBytes(1536), '1.5 KB'); assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});
