import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ApiError, createApi } from '../public/api.mjs';
import { mountWikiRetrieval } from '../public/wiki-retrieval.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const text = '合成灯塔预算 48,600 元。';
const defaults = { version: 3, search_method: 'hybrid', ranking_mode: 'rerank', dense_weight: 0.5, top_k: 5, score_threshold_enabled: false, score_threshold: 0.5 };
const match = { rank: 1, document_id: 'doc-one', revision_id: 'revision-one', filename: 'source.txt', source_sha256: hash(text), parser_revision: 'java-text-v1', page: 1, start: 0, end: [...text].length, text, text_sha256: hash(text), retrieval_score: 0.032522, rerank_score: 0.89123 };
const result = (changes = {}) => ({ test_id: '00000000-0000-0000-0000-000000000001', configuration_version: 6, effective_settings: defaults, status: 'completed', reason: null, scope_count: 9, score_kind: 'rrf', matches: [match], ...changes });
const metadata = changes => ({ document_id: match.document_id, revision_id: match.revision_id, filename: match.filename, source_sha256: match.source_sha256, document_type: 'document', media_type: 'text/plain', size_bytes: Buffer.byteLength(text), content_url: '/v1/documents/doc-one/revisions/revision-one/content', ...changes });
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ respond, apiRequest, config = { capabilities: ['retrieval_test', 'retrieval_settings', 'document_originals'] } } = {}) {
  const nodes = new Map(), listeners = new Map(), calls = [], urls = [], revoked = [];
  const node = id => { if (!nodes.has(id)) nodes.set(id, { id, value: '', checked: false, disabled: false, hidden: false, textContent: '', innerHTML: '', focus() {}, width: 0, height: 0 }); return nodes.get(id); };
  const container = { innerHTML: '', querySelector: selector => node(selector.slice(1)), addEventListener: (type, listener) => listeners.set(type, listener), removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); }, contains: () => true };
  const request = async (path, options = {}) => {
    calls.push([path, options]);
    if (apiRequest) return apiRequest(path, options);
    if (respond) { const answer = await respond(path, options); if (answer !== undefined) return answer; }
    if (path === '/v1/retrieval-settings') return defaults;
    if (path === '/v1/retrieval-tests') return result();
    if (path === '/v1/documents/doc-one/original') return metadata();
    if (path.endsWith('/content')) return new Blob([text], { type: 'text/plain' });
    throw new Error('Unexpected path');
  };
  const window = { URL: { createObjectURL: () => { const url = `blob:retrieval-${urls.length + 1}`; urls.push(url); return url; }, revokeObjectURL: url => revoked.push(url) } };
  const mounted = mountWikiRetrieval({ container, document: {}, window, api: request, config, route: { view: 'retrieval' }, confirm: () => { throw new Error('No cost confirmation'); } });
  const event = async (type, id, extra = {}) => listeners.get(type)?.({ target: { ...node(id), closest: () => ({ dataset: extra }) }, preventDefault() {} });
  return { mounted, node, calls, container, listeners, urls, revoked,
    input: async (id, value) => { node(id).value = value; return event('input', id); },
    change: async (id, value) => { if (typeof value === 'boolean') node(id).checked = value; else node(id).value = value; return event('change', id); },
    submit: () => event('submit', 'wiki-retrieval-form'),
    click: (action, rank) => event('click', '', { retrievalAction: action, ...(rank ? { rank: String(rank) } : {}) }),
  };
}

test('native retrieval opens with server defaults, no model request or classic link', async () => {
  const f = fixture(); await f.mounted.ready;
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], '/v1/retrieval-settings');
  assert.match(f.container.innerHTML, /召回测试/u); assert.doesNotMatch(f.container.innerHTML, /\/classic|iframe/u);
  assert.equal(f.node('wiki-retrieval-top-k').value, '5');
  assert.equal(f.node('wiki-retrieval-run').disabled, true);
  f.mounted.destroy(); assert.equal(f.listeners.size, 0);
});

test('explicit submit uses production retrieval session once and displays actual scores and new source link', async () => {
  const f = fixture(); await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit();
  const post = f.calls.filter(([, options]) => options.method === 'POST');
  assert.equal(post.length, 1); assert.deepEqual(post[0][1].body, { question: '灯塔' });
  const html = f.node('wiki-retrieval-results').innerHTML;
  assert.match(html, /0\.032522/u); assert.match(html, /0\.89123/u); assert.match(html, /#\/sources\/doc-one/u);
  assert.match(html, /合成灯塔预算/u); assert.match(f.node('wiki-retrieval-status').textContent, /9.*1/u);
  f.mounted.destroy();
});

test('temporary parameters include method weights top K threshold without saving settings', async () => {
  const custom = { search_method: 'hybrid', ranking_mode: 'weighted', dense_weight: 0.7, top_k: 2, score_threshold_enabled: true, score_threshold: 0.4 };
  const f = fixture({ respond: path => path === '/v1/retrieval-tests' ? result({ effective_settings: { version: 3, ...custom }, score_kind: 'weighted_score', matches: [{ ...match, rerank_score: null }] }) : undefined });
  await f.mounted.ready; await f.change('wiki-retrieval-override', true);
  for (const [key, value] of [['method', 'hybrid'], ['ranking', 'weighted'], ['dense-weight', '0.7'], ['top-k', '2'], ['threshold-enabled', true], ['threshold', '0.4']]) await f.change(`wiki-retrieval-${key}`, value);
  await f.input('wiki-retrieval-question', '灯塔'); await f.submit();
  assert.deepEqual(f.calls.find(([path]) => path === '/v1/retrieval-tests')[1].body, { question: '灯塔', retrieval_settings: custom });
  assert.equal(f.calls.some(([, options]) => options.method === 'PUT'), false);
  assert.match(f.node('wiki-retrieval-effective').textContent, /临时/u);
  f.mounted.destroy();
});

test('empty and failed searches differ; service exceptions are not exposed or retried', async () => {
  let failed = false;
  const f = fixture({ respond: path => { if (path !== '/v1/retrieval-tests') return; if (failed) throw new ApiError(502, 'SECRET internal provider content'); return result({ status: 'empty', reason: 'no_matches', matches: [] }); } });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit();
  assert.match(f.node('wiki-retrieval-results').innerHTML, /没有找到匹配片段/u);
  failed = true; await f.submit(); await tick();
  assert.match(f.node('wiki-retrieval-error').textContent, /未完成/u);
  assert.doesNotMatch(f.node('wiki-retrieval-error').textContent, /SECRET/u);
  assert.equal(f.calls.filter(([path]) => path === '/v1/retrieval-tests').length, 2);
  f.mounted.destroy();
});

test('duplicate submit is ignored and leaving suppresses late retrieval and aborts waiting', async () => {
  let deliver, signal;
  const f = fixture({ respond: (path, options) => path === '/v1/retrieval-tests' ? new Promise(resolve => { deliver = resolve; signal = options.signal; }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); const pending = f.submit(); await tick(); await f.submit();
  assert.equal(f.calls.filter(([path]) => path === '/v1/retrieval-tests').length, 1);
  f.mounted.destroy(); const old = f.node('wiki-retrieval-results').innerHTML; deliver(result()); await pending;
  assert.equal(signal.aborted, true); assert.equal(f.node('wiki-retrieval-results').innerHTML, old);
});

test('same-version original is verified before URL is displayed and is released on new input', async () => {
  const f = fixture(); await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit(); await f.click('original', 1);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /blob:retrieval-1/u);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /download="source.txt"/u);
  await f.input('wiki-retrieval-question', '预算'); assert.deepEqual(f.revoked, ['blob:retrieval-1']);
  assert.equal(f.node('wiki-retrieval-original').hidden, true); f.mounted.destroy();
});

test('changed current revision cannot masquerade as retrieval original or fetch its content', async () => {
  const f = fixture({ respond: path => path.endsWith('/original') ? metadata({ revision_id: 'revision-two' }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit(); await f.click('original', 1);
  assert.equal(f.calls.some(([path]) => path.endsWith('/content')), false); assert.equal(f.urls.length, 0);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /版本不一致/u); f.mounted.destroy();
});

test('malicious snippets remain escaped; parsed Office text does not claim physical page', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const f = fixture({ respond: path => path === '/v1/retrieval-tests' ? result({ matches: [{ ...match, filename: 'source.docx', text: malicious, end: [...malicious].length, text_sha256: hash(malicious), parser_revision: 'java-document-parser-v1-tika-3.3.2-text-units' }] }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit();
  assert.match(f.node('wiki-retrieval-results').innerHTML, /&lt;img/u);
  assert.match(f.node('wiki-retrieval-results').innerHTML, /解析文本/u); assert.doesNotMatch(f.node('wiki-retrieval-results').innerHTML, /<img|第 1 页/u);
  f.mounted.destroy();
});

test('missing capability does not issue any retrieval request', async () => {
  const f = fixture({ config: { capabilities: [] } }); await f.mounted.ready;
  await f.input('wiki-retrieval-question', '灯塔'); await f.submit();
  assert.equal(f.calls.length, 0); assert.equal(f.node('wiki-retrieval-run').disabled, true); f.mounted.destroy();
});

test('invalid temporary Top K does not leave browser and turning override off restores global settings', async () => {
  const f = fixture(); await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔');
  await f.change('wiki-retrieval-override', true); await f.change('wiki-retrieval-top-k', '21'); await f.submit();
  assert.equal(f.calls.some(([path]) => path === '/v1/retrieval-tests'), false);
  assert.match(f.node('wiki-retrieval-error').textContent, /参数/u);
  await f.change('wiki-retrieval-override', false); assert.equal(f.node('wiki-retrieval-top-k').value, '5');
  await f.submit(); assert.deepEqual(f.calls.find(([path]) => path === '/v1/retrieval-tests')[1].body, { question: '灯塔' });
  f.mounted.destroy();
});

test('original bytes with the wrong SHA never gain an open or download URL', async () => {
  const f = fixture({ respond: path => path.endsWith('/content') ? new Blob(['X'.repeat(Buffer.byteLength(text))], { type: 'text/plain' }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit(); await f.click('original', 1);
  assert.equal(f.urls.length, 0); assert.match(f.node('wiki-retrieval-original').innerHTML, /核对失败/u);
  assert.doesNotMatch(f.node('wiki-retrieval-original').innerHTML, /download=|href="blob:/u); f.mounted.destroy();
});

test('HTML original remains escaped and download-only after complete SHA verification', async () => {
  const html = '<script>untrusted()</script>', hit = { ...match, filename: 'sample.html', source_sha256: hash(html) };
  const f = fixture({ respond: path => path === '/v1/retrieval-tests' ? result({ matches: [hit] })
    : path.endsWith('/original') ? metadata({ filename: hit.filename, source_sha256: hit.source_sha256, media_type: 'text/html', size_bytes: Buffer.byteLength(html) })
      : path.endsWith('/content') ? new Blob([html], { type: 'text/html' }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit(); await f.click('original', 1);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /download="sample.html"/u);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /&lt;script&gt;/u);
  assert.doesNotMatch(f.node('wiki-retrieval-original').innerHTML, /<script>|打开原文件|target="_blank"/u);
  f.mounted.destroy();
});

test('PDF open link uses server page and native PDF renderer rather than a fake text page', async () => {
  const pdf = '%PDF-1.7 synthetic bytes', hit = { ...match, filename: 'sample.pdf', source_sha256: hash(pdf), page: 4 };
  const f = fixture({ respond: path => path === '/v1/retrieval-tests' ? result({ matches: [hit] })
    : path.endsWith('/original') ? metadata({ filename: hit.filename, source_sha256: hit.source_sha256, media_type: 'application/pdf', size_bytes: Buffer.byteLength(pdf) })
      : path.endsWith('/content') ? new Blob([pdf], { type: 'application/pdf' }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit(); await f.click('original', 1);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /blob:retrieval-1#page=4/u);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /<canvas id="wiki-retrieval-pdf-canvas"/u);
  f.mounted.destroy();
});

test('leaving during original metadata read cancels it without fetching content later', async () => {
  let deliver, signal;
  const f = fixture({ respond: (path, options) => path.endsWith('/original') ? new Promise(resolve => { deliver = resolve; signal = options.signal; }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); await f.submit(); const pending = f.click('original', 1); await tick();
  f.mounted.destroy(); deliver(metadata()); await pending;
  assert.equal(signal.aborted, true); assert.equal(f.calls.some(([path]) => path.endsWith('/content')), false); assert.equal(f.urls.length, 0);
});

test('changing input cancels in-flight retrieval and rejects its late result', async () => {
  let deliver, signal;
  const f = fixture({ respond: (path, options) => path === '/v1/retrieval-tests' ? new Promise(resolve => { deliver = resolve; signal = options.signal; }) : undefined });
  await f.mounted.ready; await f.input('wiki-retrieval-question', '灯塔'); const pending = f.submit(); await tick();
  await f.input('wiki-retrieval-question', '新问题'); deliver(result()); await pending;
  assert.equal(signal.aborted, true); assert.doesNotMatch(f.node('wiki-retrieval-results').innerHTML, /合成灯塔预算/u);
  f.mounted.destroy();
});

test('settings GET failure does not become a failed retrieval or automatically issue a POST', async () => {
  const f = fixture({ respond: path => { if (path === '/v1/retrieval-settings') throw new ApiError(502, 'internal detail'); } });
  await f.mounted.ready; assert.equal(f.calls.length, 1); assert.equal(f.node('wiki-retrieval-override').disabled, true);
  assert.match(f.node('wiki-retrieval-global').textContent, /默认参数/u);
  await f.input('wiki-retrieval-question', '灯塔'); await f.submit();
  assert.match(f.node('wiki-retrieval-results').innerHTML, /合成灯塔预算/u); f.mounted.destroy();
});

test('native mount sends actual HTTP through createApi and verifies binary source, no generation request', async t => {
  const seen = [];
  const server = createServer((request, response) => {
    const chunks = []; request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8'); seen.push({ path: request.url, method: request.method, body });
      response.setHeader('Content-Type', request.url.endsWith('/content') ? 'text/plain; charset=utf-8' : 'application/json');
      if (request.url === '/v1/retrieval-settings' && request.method === 'GET') response.end(JSON.stringify(defaults));
      else if (request.url === '/v1/retrieval-tests' && request.method === 'POST') response.end(JSON.stringify(result()));
      else if (request.url === '/v1/documents/doc-one/original' && request.method === 'GET') response.end(JSON.stringify(metadata()));
      else if (request.url === metadata().content_url && request.method === 'GET') response.end(text);
      else { response.statusCode = 404; response.end('{}'); }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const apiRequest = createApi({ capabilities: ['retrieval_test', 'retrieval_settings', 'document_originals'] }, null, (path, options) => fetch(origin + path, options));
  const f = fixture({ apiRequest }); t.after(() => f.mounted.destroy());
  await f.mounted.ready; assert.equal(seen.length, 1);
  await f.input('wiki-retrieval-question', '灯塔'); await f.submit(); await f.click('original', 1);
  assert.deepEqual(seen.filter(request => request.method === 'POST'), [{ path: '/v1/retrieval-tests', method: 'POST', body: '{"question":"灯塔"}' }]);
  assert.equal(seen.some(request => /answers|knowledge-agent|index|compile/u.test(request.path)), false);
  assert.match(f.node('wiki-retrieval-original').innerHTML, /download="source.txt"/u);
  assert.deepEqual(f.urls, ['blob:retrieval-1']);
});
