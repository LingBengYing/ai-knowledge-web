import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import * as data from '../public/wiki-preview-data.mjs';

// Render/event smoke checks, not a browser or RAG quality substitute.
const script = readFileSync(new URL('../public/wiki-preview.mjs', import.meta.url), 'utf8')
  .replace(/^import [^\n]+\n/u, '');
function fixture(hash = '#/home', saved = {}) {
  const nodes = new Map(), events = {}, windowEvents = {}, store = new Map();
  store.set('ai-knowledge:wiki-preview:v1', JSON.stringify(saved));
  class Form { constructor(id, values) { this.id = id; this.values = values; } }
  const context = vm.createContext({
    ...data, crypto: webcrypto, HTMLFormElement: Form, FormData: class { constructor(form) { return new Map(form.values); } },
    localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    document: { title: '', querySelector: selector => {
      if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', focus() {} });
      return nodes.get(selector);
    }, addEventListener: (name, callback) => { events[name] = callback; } },
    location: { hash }, window: { addEventListener: (name, callback) => { windowEvents[name] = callback; }, scrollTo() {} },
    setTimeout: () => 1, clearTimeout() {}, requestAnimationFrame: callback => callback(),
  });
  vm.runInContext(script, context);
  return { context, nodes, events, windowEvents, store, Form,
    html: () => nodes.get('#content').innerHTML,
    navigate: route => { context.location.hash = route; windowEvents.hashchange(); },
    submit: (id, values) => events.submit({ target: new Form(id, values), preventDefault() {} }),
  };
}

test('wiki preview renders all workflows and independently addressed knowledge/source details', () => {
  const f = fixture();
  for (const [route, text] of [
    ['#/home', '从资料，到彼此关联的知识'], ['#/knowledge', '新建草稿'], ['#/knowledge/new', '保存本地草稿'],
    ['#/sources', '搜索文件名或示例全文'], ['#/ask', '不进行真实检索'], ['#/graph', '示例知识关系图'],
    ['#/review', '采纳到本地预览'], ['#/settings', 'Top K'],
  ]) {
    f.navigate(route);
    assert.ok(f.html().includes(text), route);
  }
  for (const p of data.pages) { f.navigate(`#/knowledge/${p.id}`); assert.ok(f.html().includes(p.title)); }
  for (const s of data.sources) { f.navigate(`#/sources/${s.id}`); assert.ok(f.html().includes(s.title)); }
});

test('local question rendering keeps document and video links and returning does not lose the answer', () => {
  const f = fixture('#/ask');
  f.submit('question-form', [['question', '灯塔设备怎么开机？']]);
  assert.match(f.html(), /#\/sources\/device-guide/u);
  assert.match(f.html(), /#\/sources\/device-video/u);
  assert.doesNotMatch(f.html(), /#\/sources\/cedar-budget/u);
  f.navigate('#/sources/device-video');
  f.navigate('#/ask');
  assert.match(f.html(), /灯塔设备怎么开机/u);
  assert.match(f.html(), /不是后台执行日志/u);
});

test('draft text is escaped, stored locally and reloadable at its own route', () => {
  const f = fixture('#/knowledge/new');
  f.submit('draft-form', [['title', '预览草稿'], ['text', '<script>example</script>']]);
  f.windowEvents.hashchange();
  assert.match(f.html(), /&lt;script&gt;example&lt;\/script&gt;/u);
  assert.doesNotMatch(f.html(), /<script>/u);
  const saved = JSON.parse(f.store.get('ai-knowledge:wiki-preview:v1'));
  const reloaded = fixture(f.context.location.hash, saved);
  assert.match(reloaded.html(), /预览草稿/u);
  assert.match(reloaded.html(), /未经原文核验/u);
});

test('saved preview settings restore without calling a server', () => {
  const f = fixture('#/settings');
  f.submit('settings-form', [['method', 'hybrid'], ['ranking', 'rerank'], ['topK', '6'], ['thresholdEnabled', 'on'], ['threshold', '0.35']]);
  const reloaded = fixture('#/settings', JSON.parse(f.store.get('ai-knowledge:wiki-preview:v1')));
  assert.match(reloaded.html(), /id="top-k"[^>]*value="6"/u);
  assert.match(reloaded.html(), /id="threshold-enabled"[^>]*checked/u);
  assert.match(reloaded.html(), /id="threshold"[^>]*value="0.35"/u);
});

test('preview import records names and sizes only and never pretends they were parsed', () => {
  const f = fixture('#/sources');
  f.events.change({ target: { id: 'preview-files', files: [{ name: 'local-demo.pdf', size: 2048 }] } });
  assert.match(f.nodes.get('#upload-list').innerHTML, /local-demo.pdf/u);
  assert.match(f.nodes.get('#upload-list').innerHTML, /不上传文件/u);
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
});
