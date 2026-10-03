import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ApiError } from '../public/api.mjs';
import { SynopsisSession, synopsisEnabled, canGenerateSynopsis } from '../public/file-synopsis.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const stamp = '2026-10-03T00:00:00Z';
const receipt = (state = 'queued', overrides = {}) => ({ task_id: 'synopsis-one', document_id: 'doc-one', publication_id: 'publication-one',
  state, error_code: ['unavailable', 'cancelled'].includes(state) ? 'model_refused' : null, created_at: stamp, updated_at: stamp, ...overrides });

export function synopsisFixture(kind = 'text') {
  const content = Buffer.from(`synthetic original ${kind}`), frame = Buffer.from('synthetic frame');
  const text = 'Synthetic original statement.';
  const documentType = kind === 'text' ? 'document' : kind.startsWith('image') ? 'image' : kind.startsWith('audio') ? 'audio' : 'video';
  const mediaType = { document: 'application/pdf', image: 'image/png', audio: 'audio/wav', video: 'video/mp4' }[documentType];
  const item = { document_id: 'doc-one', index_publication_id: 'publication-one', active_revision_id: 'revision-one', filename: `synthetic.${{ document: 'pdf', image: 'png', audio: 'wav', video: 'mp4' }[documentType]}`,
    document_type: documentType, can_edit: true, synthetic_fixture: false, media_info: { mime_type: mediaType, size_bytes: content.length, sha256: sha(content) } };
  const timed = ['audio', 'video'].includes(documentType), visual = ['image', 'video_frame'].includes(kind);
  const time = timed ? { start_us: 1_000_000, end_us: 2_000_000 } : null;
  const reference = { ordinal: 1, evidence_id: 'physical-one', kind, sha256: sha(visual ? kind === 'image' ? content : frame : text), time,
    source_url: '/v1/synopsis-sources/synopsis-one/1/1' };
  const synopsis = { synopsis_id: 'synopsis-one', document_id: item.document_id, publication_id: item.index_publication_id,
    revision_id: item.active_revision_id, source_sha256: item.media_info.sha256, input_fingerprint: 'a'.repeat(64), model_revision: 'synthetic-model', policy_revision: 'synthetic-policy', status: 'available',
    entries: [...['overview', 'topic', 'term'], ...(timed ? ['timeline'] : [])].map((section, index) => ({ ordinal: index + 1, section, text: '<b>Derived navigation</b>', interval: section === 'timeline' ? time : null,
      evidence: [{ ...reference, source_url: `/v1/synopsis-sources/synopsis-one/${index + 1}/1` }] })) };
  const regions = [{ start_code_point: 0, end_code_point: text.length, left: 0, top: 0, right: 2, bottom: 2 }];
  const locators = {
    text: { type: 'page', page: 2, start_code_point: 0, end_code_point: text.length, width: null, height: null, regions: [] },
    image_ocr: { type: 'page', page: 1, start_code_point: 0, end_code_point: text.length, width: 2, height: 2, regions },
    image: { type: 'image', width: 2, height: 2 },
    audio_transcript: { type: 'audio_span', span_ordinal: 0, ...time },
    video_frame: { type: 'video_frame', frame_id: 'frame-one', frame_ordinal: 0, width: 2, height: 2, ...time },
    video_transcript: { type: 'video_transcript', span_id: 'span-one', span_ordinal: 0, ...time },
    video_ocr: { type: 'video_ocr', frame_id: 'frame-one', frame_ordinal: 0, width: 2, height: 2, start_code_point: 0, end_code_point: text.length, regions, ...time },
    video_subtitle: { type: 'video_subtitle', cue_id: 'cue-one', track_id: 'track-one', stream_index: 2, codec: 'subrip', language: 'en', cue_ordinal: 0, pts: 1000, duration: 1000, time_base_numerator: 1, time_base_denominator: 1000,
      start_code_point: 0, end_code_point: text.length, payload_sha256: 'b'.repeat(64), subtitle_manifest_sha256: 'c'.repeat(64), native_manifest_sha256: 'd'.repeat(64), track_text_sha256: 'e'.repeat(64), decoder_revision: 'synthetic-decoder', text_format: 'synthetic-text', ...time },
  };
  const source = { synopsis_id: 'synopsis-one', entry_ordinal: 1, source_ordinal: 1, evidence_id: reference.evidence_id, kind, sha256: reference.sha256, filename: item.filename, media_type: mediaType,
    text: visual ? null : text, proof_origin: kind.includes('ocr') ? 'machine_ocr' : kind.includes('transcript') ? 'machine_asr' : kind === 'video_subtitle' ? 'embedded_subtitle' : visual ? 'machine_vlm' : 'original_text',
    time_precision: !timed ? null : kind === 'video_subtitle' ? 'subtitle_cue' : ['video_frame', 'video_ocr'].includes(kind) ? 'frame_interval' : 'server_chunk', locator: locators[kind], content_url: reference.source_url + '/content', frame_url: ['video_frame', 'video_ocr'].includes(kind) ? reference.source_url + '/frame' : null };
  return { item, synopsis, source, content, frame };
}

function harness(request) {
  const jobs = new Map(), revoked = []; let serial = 0;
  const session = new SynopsisSession(request, { setTimer(callback, delay) { assert.equal(delay, 1500); const id = ++serial; jobs.set(id, callback); return id; }, clearTimer(id) { jobs.delete(id); },
    objectUrls: { createObjectURL: () => `blob:synthetic-${++serial}`, revokeObjectURL: value => revoked.push(value) } });
  return { session, jobs, revoked, async poll() { const [id, callback] = [...jobs][0]; jobs.delete(id); await callback(); } };
}

test('synopsis capability and generation eligibility use current publication and edit permission', () => {
  const { item } = synopsisFixture();
  assert.equal(synopsisEnabled({ capabilities: ['file_synopsis'] }), false);
  assert.equal(synopsisEnabled({ capabilities: ['file_synopsis', 'synopsis_sources'] }), true);
  assert.equal(canGenerateSynopsis(item), true);
  for (const change of [{ can_edit: false }, { active_revision_id: null }, { index_publication_id: null }, { synthetic_fixture: true }]) assert.equal(canGenerateSynopsis({ ...item, ...change }), false);
});

test('existing current synopsis reads without a POST and keeps literal derived text', async () => {
  const { item, synopsis } = synopsisFixture(); const calls = [];
  const { session, jobs } = harness(async (path, options) => { calls.push({ path, options }); return synopsis; });
  await session.open(item);
  assert.equal(session.value.phase, 'ready'); assert.equal(session.matches(item), true);
  assert.equal(session.value.synopsis.entries[0].text, '<b>Derived navigation</b>');
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/documents/doc-one/synopsis');
  assert.notEqual(calls[0].options.method, 'POST'); assert.equal(jobs.size, 0);
});

test('explicit creation polls queued and processing once each, then reads and binds available synopsis', async () => {
  const { item, synopsis } = synopsisFixture(); let state = 'missing'; const calls = [];
  const { session, jobs, poll } = harness(async (path, options) => {
    calls.push({ path, options });
    if (options.method === 'POST') { state = 'queued'; return receipt(); }
    if (path.startsWith('/v1/synopsis-tasks/')) { state = state === 'queued' ? 'processing' : 'available'; return receipt(state); }
    if (state === 'missing') throw new ApiError(404, '当前无摘要。');
    return synopsis;
  });
  await session.open(item); assert.equal(session.value.phase, 'unavailable');
  const pending = session.create(item); await session.create(item); await pending;
  assert.equal(session.value.task.state, 'queued'); assert.equal(jobs.size, 1);
  await poll(); assert.equal(session.value.task.state, 'processing'); assert.equal(jobs.size, 1);
  await poll(); assert.equal(session.value.phase, 'ready'); assert.equal(jobs.size, 0);
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(calls.find(call => call.options.method === 'POST').options.body, undefined);
});

test('failed task is independent and requires explicit creation; polling errors pause for refresh', async () => {
  const { item } = synopsisFixture(); let failNetwork = true, posts = 0;
  const { session, jobs, poll } = harness(async (path, options) => {
    if (options.method === 'POST') { posts++; return receipt(); }
    if (path.startsWith('/v1/synopsis-tasks/')) { if (failNetwork) throw new TypeError('synthetic transport'); return receipt('unavailable'); }
    throw new ApiError(404, '当前无摘要。');
  });
  await session.open(item); await session.create(item); await poll();
  assert.equal(session.value.phase, 'error'); assert.equal(jobs.size, 0); assert.equal(posts, 1);
  failNetwork = false; await session.refresh();
  assert.equal(session.value.phase, 'unavailable'); assert.equal(session.value.task.error_code, 'model_refused'); assert.equal(jobs.size, 0);
  await session.create(item); assert.equal(posts, 2); session.close(); assert.equal(jobs.size, 0);
});

test('read-only cannot create and late previous-publication responses never replace current detail', async () => {
  const { item, synopsis } = synopsisFixture(); let deliver, calls = 0;
  const { session } = harness(async () => { calls++; return new Promise(resolve => { deliver = resolve; }); });
  const pending = session.open(item); session.close(); deliver(synopsis); await pending;
  assert.equal(session.value.phase, 'idle');
  await session.create({ ...item, can_edit: false }); assert.equal(calls, 1);
  const other = harness(async () => ({ ...synopsis, publication_id: 'wrong-publication' }));
  await other.session.open(item); assert.equal(other.session.value.phase, 'error'); assert.equal(other.session.value.synopsis, null);
});

test('all eight typed sources open the complete original and retain page/time/frame locator', async () => {
  for (const kind of ['text', 'image_ocr', 'image', 'audio_transcript', 'video_frame', 'video_transcript', 'video_ocr', 'video_subtitle']) {
    const fixture = synopsisFixture(kind); const calls = [];
    const { session, revoked } = harness(async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('/synopsis')) return fixture.synopsis;
      if (path.endsWith('/content')) return new Blob([fixture.content], { type: fixture.source.media_type });
      if (path.endsWith('/frame')) return new Blob([fixture.frame], { type: 'image/png' });
      return fixture.source;
    });
    await session.open(fixture.item); await session.readSource(1, 1);
    assert.equal(session.value.sourcePhase, 'ready', kind); assert.equal(session.value.source.kind, kind);
    assert.ok(session.value.source.originalUrl.startsWith('blob:'));
    assert.equal(!!session.value.source.frameUrl, ['video_frame', 'video_ocr'].includes(kind));
    assert.equal(calls[1].path, '/v1/synopsis-sources/synopsis-one/1/1');
    session.close(); assert.equal(revoked.length, ['video_frame', 'video_ocr'].includes(kind) ? 2 : 1);
  }
});

test('source identity, text SHA and original bytes are checked before creating usable URLs', async () => {
  const fixture = synopsisFixture();
  for (const fault of ['identity', 'locator', 'url', 'text', 'bytes']) {
    const source = structuredClone(fixture.source);
    if (fault === 'identity') source.evidence_id = 'another-evidence';
    if (fault === 'locator') source.locator.end_code_point++;
    if (fault === 'url') source.content_url = '/v1/documents/free/content';
    if (fault === 'text') source.text = 'Tampered original statement.';
    const { session, revoked } = harness(async path => path.endsWith('/synopsis') ? fixture.synopsis : path.endsWith('/content')
      ? new Blob([fault === 'bytes' ? 'changed' : fixture.content], { type: source.media_type }) : source);
    await session.open(fixture.item); await session.readSource(1, 1);
    assert.equal(session.value.sourcePhase, 'error', fault); assert.equal(session.value.source, null); assert.equal(revoked.length, 0);
  }
});

test('a failed source reread clears the former source and releases URLs', async () => {
  const fixture = synopsisFixture(); let fail = false;
  const { session, revoked } = harness(async path => {
    if (fail) throw new ApiError(404, '来源已不可访问。');
    return path.endsWith('/synopsis') ? fixture.synopsis : path.endsWith('/content') ? new Blob([fixture.content], { type: fixture.source.media_type }) : fixture.source;
  });
  await session.open(fixture.item); await session.readSource(1, 1); fail = true; await session.readSource(1, 1);
  assert.equal(session.value.sourcePhase, 'error'); assert.equal(session.value.source, null); assert.equal(revoked.length, 1);
});

test('image evidence digest must also match the original image digest', async () => {
  const fixture = synopsisFixture('image');
  for (const entry of fixture.synopsis.entries) entry.evidence[0].sha256 = 'f'.repeat(64);
  fixture.source.sha256 = 'f'.repeat(64);
  const { session } = harness(async path => path.endsWith('/synopsis') ? fixture.synopsis : path.endsWith('/content')
    ? new Blob([fixture.content], { type: fixture.source.media_type }) : fixture.source);
  await session.open(fixture.item); await session.readSource(1, 1);
  assert.equal(session.value.sourcePhase, 'error'); assert.equal(session.value.source, null);
});
