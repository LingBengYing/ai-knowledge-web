import test from 'node:test';
import assert from 'node:assert/strict';
import { PdfPreviewSession } from '../public/pdf-preview.mjs';
import { AnswerSession } from '../public/answers.mjs';
import { knowledgeAnswerFixture } from './knowledge-answer-fixture.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(done => setImmediate(done));
const canvas = () => ({ width: 0, height: 0, getContext: () => ({}) });
const pdf = () => new Blob(['%PDF synthetic verified bytes'], { type: 'application/pdf' });

test('unified source gives the renderer the same SHA-verified PDF Blob without a second download', async () => {
  const material = knowledgeAnswerFixture(), calls = [], urls = [];
  const session = new AnswerSession(async (path, options) => { calls.push(path); return material.read(path, options); }, {
    canReadOriginal: () => true,
    objectUrls: { createObjectURL(blob) { urls.push(blob); return 'blob:verified-pdf'; }, revokeObjectURL() {} },
  });
  await session.ask('如何开启夜间模式？', ['manual', 'tutorial'], 'knowledge');
  await session.readSource(1);
  assert.equal(session.value.sourcePhase, 'ready');
  assert.equal(session.value.source.pdfBlob, urls[0]);
  assert.equal(session.value.source.pdfBlob.type, 'application/pdf');
  assert.equal(calls.filter(path => path.endsWith('/content')).length, 1);
  session.closeSource(); assert.equal(session.value.source, null);
});

function fixture({ pages = 3, naturalWidth = 612, naturalHeight = 792, loading = null, rendering = null } = {}) {
  const calls = [], changes = []; let destroyed = 0, cancelled = 0, cleaned = 0;
  const page = { getViewport: ({ scale }) => ({ width: naturalWidth * scale, height: naturalHeight * scale }),
    render(options) { calls.push(['render', options]); return { promise: rendering?.promise ?? Promise.resolve(), cancel() { cancelled++; } }; },
    cleanup() { cleaned++; } };
  const document = { numPages: pages, async getPage(number) { calls.push(['page', number]); return page; } };
  const engine = { getDocument(options) { calls.push(['document', options]); return {
    promise: loading?.promise ?? Promise.resolve(document), async destroy() { destroyed++; },
  }; } };
  const session = new PdfPreviewSession({ loadEngine: async () => engine, onChange: value => changes.push(value) });
  return { session, calls, changes, document, counts: () => ({ destroyed, cancelled, cleaned }) };
}

test('renders exactly the server-selected page from verified Blob using local resources', async () => {
  const f = fixture(), target = canvas();
  await f.session.open({ blob: pdf(), page: 2, canvas: target, width: 720, pixelRatio: 2 });
  assert.deepEqual(f.session.value, { phase: 'ready', page: 2, pages: 3, error: null });
  assert.equal(new TextDecoder().decode(f.calls[0][1].data), '%PDF synthetic verified bytes');
  assert.equal(f.calls[0][1].url, undefined);
  assert.equal(f.calls[0][1].cMapUrl, '/vendor/pdfjs/cmaps/');
  assert.equal(f.calls[0][1].standardFontDataUrl, '/vendor/pdfjs/standard_fonts/');
  assert.equal(f.calls[0][1].isEvalSupported, false);
  assert.equal(f.calls[0][1].useWasm, false);
  assert.deepEqual(f.calls[1], ['page', 2]);
  assert.equal(target.width, 1440);
  assert.ok(target.height > 0);
  assert.deepEqual(f.counts(), { destroyed: 1, cancelled: 0, cleaned: 1 });
  f.session.close(); assert.equal(target.width, 0); assert.equal(target.height, 0);
});

test('invalid authority page never falls back to another PDF page', async () => {
  const f = fixture({ pages: 1 });
  await f.session.open({ blob: pdf(), page: 2, canvas: canvas() });
  assert.equal(f.session.value.phase, 'error');
  assert.match(f.session.value.error, /页码无效/);
  assert.equal(f.calls.some(call => call[0] === 'page'), false);
  assert.equal(f.counts().destroyed, 1);
});

test('unverified URL strings, wrong MIME and malformed page numbers are rejected before loading the engine', async () => {
  let loaded = 0;
  const session = new PdfPreviewSession({ loadEngine: async () => { loaded++; } });
  for (const [blob, page] of [['https://provider.invalid/private.pdf', 1], ['blob:verified', 1],
    [new Blob(['PDF'], { type: 'text/plain' }), 1], [pdf(), 0], [pdf(), 1.5], [pdf(), '1']]) {
    await session.open({ blob, page, canvas: canvas() });
    assert.equal(session.value.phase, 'error');
  }
  assert.equal(loaded, 0);
});

test('canvas allocation remains bounded for tall pages and large display density', async () => {
  const f = fixture({ naturalWidth: 100, naturalHeight: 100_000 }), target = canvas();
  await f.session.open({ blob: pdf(), page: 1, canvas: target, width: 10_000, pixelRatio: 20 });
  assert.equal(f.session.value.phase, 'ready');
  assert.ok(target.width <= 4096 && target.height <= 4096);
  assert.ok(target.width * target.height <= 4_000_000);
});

test('close destroys loading task and suppresses late document or page publication', async () => {
  const loading = deferred(), f = fixture({ loading }), target = canvas();
  const opening = f.session.open({ blob: pdf(), page: 2, canvas: target });
  await tick(); f.session.close(); loading.resolve(f.document); await opening;
  assert.equal(f.session.value.phase, 'idle');
  assert.equal(f.calls.some(call => call[0] === 'page'), false);
  assert.equal(f.counts().destroyed, 1);
  assert.equal(target.width, 0);
});

test('switching source cancels prior render and old completion cannot overwrite the new page', async () => {
  const rendering = deferred(), f = fixture({ rendering }), oldCanvas = canvas(), nextCanvas = canvas();
  const first = f.session.open({ blob: pdf(), page: 1, canvas: oldCanvas });
  await tick();
  const second = f.session.open({ blob: pdf(), page: 2, canvas: nextCanvas });
  await tick(); rendering.resolve(); await Promise.all([first, second]);
  assert.equal(f.session.value.page, 2);
  assert.equal(f.session.value.phase, 'ready');
  assert.equal(f.changes.some(value => value.phase === 'ready' && value.page === 1), false);
  assert.equal(f.counts().cancelled, 1);
  assert.equal(oldCanvas.width, 0);
  assert.ok(nextCanvas.width > 0);
});

test('engine failure gives a reading fallback without retaining blank canvas pixels', async () => {
  const session = new PdfPreviewSession({ loadEngine: async () => { throw new Error('synthetic loader failure'); } });
  const target = canvas(); await session.open({ blob: pdf(), page: 1, canvas: target });
  assert.equal(session.value.phase, 'error');
  assert.match(session.value.error, /打开或下载原文件/);
  assert.equal(target.width, 0);
});
