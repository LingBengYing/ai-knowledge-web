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
