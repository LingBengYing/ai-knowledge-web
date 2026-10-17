import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchUploadSession } from '../public/batch-upload.mjs';
import { createApi } from '../public/api.mjs';
import { createWikiWorkspaceApi } from '../public/wiki-workspace-api.mjs';

const files = count => Array.from({ length: count }, (_, i) => new File([`Synthetic ${i}`], `source-${i}.txt`));
test('batch uploads have two actual overlapping transfers and preserve manifest order', async () => {
  let inFlight = 0, peak = 0, count = 0, manifest;
  const api = {
    async createBatch(command) { manifest = command.files; return { batch_id: 'batch-1', total: command.files.length }; },
    async uploadBatchFile(id, ordinal, file) { inFlight++; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 10)); inFlight--; count++; return { task_id: `task-${ordinal}`, filename: file.name }; },
    async getBatch() { return { batch_id: 'batch-1', total: count }; },
  };
  const session = new BatchUploadSession(api);
  await session.start(files(7));
  assert.equal(peak, 2); assert.equal(count, 7); assert.equal(manifest.length, 7);
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
