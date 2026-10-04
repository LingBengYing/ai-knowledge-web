import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { ImageVectorSession, canReadImageVector } from '../public/image-vectors.mjs';
import { AudioVectorSession, canReadAudioVector } from '../public/audio-vectors.mjs';

const configurations = [
  { kind: 'image', mime: 'image/png', Session: ImageVectorSession, canRead: canReadImageVector },
  { kind: 'audio', mime: 'audio/wav', Session: AudioVectorSession, canRead: canReadAudioVector },
];
const publishedRow = (kind, mime, state) => ({ document_id: 'doc-one', active_revision_id: 'rev-one',
  index_publication_id: 'publication-old', document_type: kind, index_status: state, status: 'parsed',
  synthetic_fixture: false, can_edit: true, media_info: { mime_type: mime, sha256: 'a'.repeat(64), size_bytes: 32 },
  latest_job: { document_id: 'doc-one', revision_id: 'rev-one', state: 'parsed' },
  latest_index_job: { document_id: 'doc-one', revision_id: 'rev-one', state },
});
const response = row => ({ status: 'available', document_id: row.document_id,
  publication_id: row.index_publication_id, source_revision_id: row.active_revision_id,
  source_sha256: row.media_info.sha256, profile_fingerprint: 'b'.repeat(64), model_revision: 'synthetic-model',
  dimensions: 4, vector_generation_id: 'generation-old', manifest_sha256: 'c'.repeat(64),
});

for (const { kind, mime, Session, canRead } of configurations) {
  for (const state of ['queued', 'processing', 'failed', 'cancelled']) {
    test(`${kind} retained publication ${state} requires explicit read permission and never widens media build eligibility`, async () => {
      const row = publishedRow(kind, mime, state), calls = [];
      const session = new Session(async (path, options = {}) => { calls.push({ path, options }); return response(row); });
      assert.equal(canRead(row), false); assert.equal(canRead(row, { allowPublishedDuringReindex: false }), false);
      await assert.rejects(session.open(row), error => error instanceof ApiError && error.status === 502);
      assert.equal(calls.length, 0, 'default strict rejection must precede dispatch');
      assert.equal(canRead(row, { allowPublishedDuringReindex: true }), true);
      await session.open(row, { allowPublishedDuringReindex: true });
      assert.equal(calls.length, 1); assert.equal(calls[0].path, `/v1/documents/doc-one/${kind}-vector`);
      assert.equal(calls[0].options.method, undefined);
      assert.equal(session.matches(row), true); assert.equal(row.index_status, state, 'no fake indexed row');
      assert.equal(session.value.phase, 'ready'); assert.equal(session.value.vector.publication_id, 'publication-old');
      assert.equal(session.value.vector.vector_generation_id, 'generation-old');
      await assert.rejects(session.build(row), error => error instanceof ApiError && error.status === 502);
      assert.equal(calls.length, 1, 'read permission cannot dispatch a media POST');
    });
  }

  test(`${kind} retained publication permission cannot replace source and active task identity checks`, async () => {
    const valid = publishedRow(kind, mime, 'processing');
    const invalidRows = [
      { ...valid, index_publication_id: null },
      { ...valid, active_revision_id: null },
      { ...valid, status: 'processing' },
      { ...valid, latest_job: { ...valid.latest_job, state: 'processing' } },
      { ...valid, latest_job: { ...valid.latest_job, document_id: 'doc-other' } },
      { ...valid, latest_job: { ...valid.latest_job, revision_id: 'rev-other' } },
      { ...valid, latest_index_job: { ...valid.latest_index_job, document_id: 'doc-other' } },
      { ...valid, latest_index_job: { ...valid.latest_index_job, revision_id: 'rev-other' } },
      { ...valid, latest_index_job: { ...valid.latest_index_job, state: 'queued' } },
      { ...valid, index_status: 'not_indexed' },
      { ...valid, synthetic_fixture: true },
    ];
    let calls = 0;
    const session = new Session(async () => { calls++; return response(valid); });
    for (const row of invalidRows) {
      assert.equal(canRead(row, { allowPublishedDuringReindex: true }), false);
      await assert.rejects(session.open(row, { allowPublishedDuringReindex: true }), error => error instanceof ApiError && error.status === 502);
    }
    assert.equal(canRead(valid, { allowPublishedDuringReindex: 'true' }), false);
    assert.equal(calls, 0);
  });

  test(`${kind} retained publication read still rejects an old or unrelated receipt`, async () => {
    const row = publishedRow(kind, mime, 'failed');
    const session = new Session(async () => ({ ...response(row), publication_id: 'publication-unrelated' }));
    await session.open(row, { allowPublishedDuringReindex: true });
    assert.equal(session.value.phase, 'error'); assert.equal(session.value.vector, null);
    assert.ok(session.value.error instanceof ApiError); assert.equal(session.value.error.status, 502);
  });
}
