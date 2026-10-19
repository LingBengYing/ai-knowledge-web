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
