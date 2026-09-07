import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectFile, PreviewResource, mountPreview } from '../public/preview.mjs';
const file = (bytes, name, type = '') => new File([Uint8Array.from(bytes)], name, { type });
const png = () => file([137,80,78,71,13,10,26,10,0,0,0,0], '合成.png', 'image/png');
test('supported files are classified using file signatures, not a renamed extension', async () => {
  assert.equal((await inspectFile(png())).kind, 'image');
  await assert.rejects(inspectFile(new File(['<script>alert(1)</script>'], 'bad.png', { type: 'image/png' })), /格式/u);
  await assert.rejects(inspectFile(new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })), /不支持/u);
  assert.equal((await inspectFile(new File(['%PDF-1.4\n'], 'test.pdf'))).kind, 'pdf');
  assert.equal((await inspectFile(file([82,73,70,70,0,0,0,0,87,65,86,69], 'test.wav'))).kind, 'audio');
  assert.equal((await inspectFile(file([0,0,0,24,102,116,121,112,105,115,111,109], 'test.mp4'))).kind, 'video');
});
test('empty, mismatched mime and oversized files are refused before content reads', async () => {
  await assert.rejects(inspectFile(new File([], 'empty.txt')), /空文件/u);
  await assert.rejects(inspectFile(file([137,80,78,71,13,10,26,10], 'x.png', 'text/html')), /类型/u);
  const large = new File(['a'], 'large.txt'); Object.defineProperty(large, 'size', { value: 3 * 1024 * 1024 });
  await assert.rejects(inspectFile(large), /2 MiB/u);
});
test('text stays text and invalid binary text is rejected', async () => {
  const input = '<script>not executed</script>\n# 标题';
  assert.equal((await inspectFile(new File([input], 'test.md'))).text, input);
  await assert.rejects(inspectFile(file([0,1,2,3], 'binary.txt')), /文本/u);
});
test('resource replacement and clear revoke every created URL', async () => {
  const revoked = []; let count = 0;
  const resource = new PreviewResource({ createObjectURL: () => `blob:test-${++count}`, revokeObjectURL: value => revoked.push(value) });
  assert.equal((await resource.load(png())).url, 'blob:test-1');
  await resource.load(png());
  assert.deepEqual(revoked, ['blob:test-1']);
  resource.clear(); resource.clear();
  assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
});
test('late content cannot revive a closed preview or replace a newer file', async () => {
  let resolve; const slow = png();
  slow.slice = () => ({ arrayBuffer: () => new Promise(done => { resolve = done; }) });
  let count = 0;
  const resource = new PreviewResource({ createObjectURL: () => `blob:${++count}`, revokeObjectURL() {} });
  const pending = resource.load(slow); resource.clear();
  resolve(Uint8Array.from([137,80,78,71,13,10,26,10]).buffer);
  assert.equal(await pending, null); assert.equal(count, 0);
  const pending2 = resource.load(slow);
  await resource.load(new File(['新文件'], 'new.txt'));
  resolve(Uint8Array.from([137,80,78,71,13,10,26,10]).buffer);
  assert.equal(await pending2, null);
  assert.equal(resource.current.text, '新文件');
});


test('closed viewer ignores a late file selection before reading or creating resources', async () => {
  const nodes = new Map();
  const node = () => ({ open: false, addEventListener() {}, removeAttribute() {}, replaceChildren() {}, setAttribute() {}, focus() {}, close() {}, style: {} });
  const doc = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, addEventListener() {}, createElement: node };
  const viewer = mountPreview(doc);
  let reads = 0;
  const late = png(); late.slice = () => { reads++; throw new Error('must not read a closed viewer selection'); };
  await viewer.load(late);
  assert.equal(reads, 0);
});

function previewDom() {
  const nodes = new Map(); const events = new Map(); const created = [];
  const node = tag => {
    const handlers = new Map(); const attrs = new Map();
    const value = { tag, open: false, children: [], style: {}, pauseCount: 0, loadCount: 0,
      addEventListener(name, fn) { handlers.set(name, fn); },
      emit(name, extra = {}) { handlers.get(name)?.({ preventDefault() {}, target: value, ...extra }); },
      setAttribute(key, content) { attrs.set(key, content); }, getAttribute: key => attrs.get(key),
      removeAttribute(key) { attrs.delete(key); if (key === 'src') delete value.src; },
      append(...children) { value.children.push(...children); }, replaceChildren(...children) { value.children = children; },
      focus() {}, showModal() { value.open = true; }, close() { value.open = false; },
      pause() { value.pauseCount++; }, load() { value.loadCount++; },
    }; created.push(value); return value;
  };
  const doc = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node(id)); return nodes.get(id); },
    createElement: node, addEventListener: (name, fn) => events.set(name, fn) };
  return { doc, created, emit: name => events.get(name)?.(), get: doc.getElementById };
}

test('closing and identity reset stop playback and detach the local media source', async () => {
  const dom = previewDom(); const viewer = mountPreview(dom.doc);
  const wav = () => file([82,73,70,70,0,0,0,0,87,65,86,69], 'test.wav');
  viewer.open(); await viewer.load(wav());
  const first = dom.created.find(node => node.tag === 'audio');
  assert.ok(first.src.startsWith('blob:'));
  viewer.close();
  assert.equal(first.pauseCount, 1); assert.equal(first.loadCount, 1); assert.equal(first.src, undefined);
  viewer.open(); await viewer.load(wav());
  const second = dom.created.filter(node => node.tag === 'audio')[1];
  dom.emit('knowledge-context-reset');
  assert.equal(second.pauseCount, 1); assert.equal(second.src, undefined);
  assert.equal(dom.get('preview-dialog').open, false);
});

test('actual input change after closing cannot allocate or read the selected file', async () => {
  const dom = previewDom(); const viewer = mountPreview(dom.doc);
  viewer.open(); viewer.close();
  let reads = 0; const late = png(); late.slice = () => { reads++; throw new Error('unexpected read'); };
  dom.get('preview-input').files = [late]; dom.get('preview-input').emit('change');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 0);
  assert.equal(dom.get('preview-stage').children.length, 0);
});
