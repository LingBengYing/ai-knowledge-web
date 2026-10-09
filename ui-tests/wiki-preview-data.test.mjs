import assert from 'node:assert/strict';
import test from 'node:test';
import {
  sources, pages, proposals, searchCatalog, createExampleAnswer, escapeHtml, parseRoute,
} from '../public/wiki-preview-data.mjs';

test('wiki preview fixtures are explicitly synthetic and internally linked', () => {
  assert.ok(sources.length >= 6 && sources.length <= 8);
  assert.ok(pages.length >= 5 && pages.length <= 6);
  assert.equal(proposals.length, 2);
  const sourceIds = new Set(sources.map((source) => source.id));
  const pageIds = new Set(pages.map((page) => page.id));
  assert.equal(sourceIds.size, sources.length);
  assert.equal(pageIds.size, pages.length);
  for (const source of sources) {
    assert.match(source.summary, /合成|虚构/);
    assert.ok(['pdf', 'video', 'audio', 'image', 'text'].includes(source.kind));
    assert.ok(['ready', 'review'].includes(source.status));
    assert.ok(source.content.length > 0);
    assert.ok(source.content.every((part) => part.locator && part.text));
    assert.ok(source.wikiIds.every((id) => pageIds.has(id)));
  }
  for (const page of pages) {
    assert.ok(['项目', '概念', '指南'].includes(page.type));
    assert.ok(page.sourceIds.every((id) => sourceIds.has(id)));
    assert.ok(page.relatedIds.every((id) => pageIds.has(id)));
    assert.ok(page.sections.every((section) => section.sourceIds.every((id) => sourceIds.has(id))));
  }
  for (const proposal of proposals) {
    assert.ok(pageIds.has(proposal.pageId));
    assert.ok(sourceIds.has(proposal.sourceId));
    assert.notEqual(proposal.before, proposal.after);
  }
});

test('catalog search returns all for empty query and only lexical matches for a term', () => {
  assert.equal(searchCatalog('').sources.length, sources.length);
  assert.equal(searchCatalog('   ').pages.length, pages.length);
  const result = searchCatalog('灯塔');
  assert.ok(result.pages.some((page) => page.id === 'cedar-project'));
  assert.ok(result.pages.some((page) => page.id === 'device-start'));
  assert.ok(result.sources.some((source) => source.id === 'device-video'));
  assert.equal(searchCatalog('完全不存在的资料').sources.length, 0);
  assert.equal(searchCatalog('完全不存在的资料').pages.length, 0);
  assert.equal(searchCatalog('CEDAR').sources[0].id, 'cedar-overview');
});

test('catalog media filter does not silently retain other media or knowledge pages', () => {
  const result = searchCatalog('灯塔', { kind: 'video' });
  assert.equal(result.pages.length, 0);
  assert.deepEqual(result.sources.map((source) => source.id), ['device-video']);
  assert.equal(searchCatalog('', { kind: 'knowledge' }).sources.length, 0);
  assert.equal(searchCatalog('', { kind: 'sources' }).pages.length, 0);
  assert.deepEqual(searchCatalog('', { kind: 'not-a-kind' }), { pages: [], sources: [] });
});

test('file discovery returns source-level results without claiming complete real-library coverage', () => {
  const result = createExampleAnswer('有哪些文件包含灯塔，这个讲了啥');
  assert.equal(result.kind, 'answer');
  assert.equal(result.intent, '查找资料');
  assert.match(result.summary, /示例|合成/);
  assert.match(result.summary, /不是|不代表/);
  assert.equal(result.paragraphs.length, result.sourceIds.length);
  assert.ok(result.paragraphs.every((paragraph) => paragraph.sourceIds.length === 1));
  assert.ok(result.steps.length >= 3);
});

test('file discovery narrows a named project or device instead of pooling both topics', () => {
  const project = createExampleAnswer('哪些文件包含青榆灯塔项目？');
  const device = createExampleAnswer('哪些资料介绍灯塔设备？');
  assert.equal(project.sourceIds.length, 3);
  assert.ok(project.sourceIds.every((id) => id.startsWith('cedar-')));
  assert.equal(device.sourceIds.length, 4);
  assert.ok(device.sourceIds.every((id) => id.startsWith('device-')));
});

test('each exact synthetic filename can open its own source overview without mixing other files', () => {
  for (const source of sources) {
    const result = createExampleAnswer(`${source.title}讲了什么？`);
    assert.equal(result.kind, 'answer', source.title);
    assert.equal(result.intent, '阅读来源概览');
    assert.match(result.summary, /^合成源概览/);
    assert.ok(result.summary.includes(source.title));
    assert.ok(result.summary.includes(source.summary));
    assert.deepEqual(result.sourceIds, [source.id]);
    assert.deepEqual(result.pageIds, source.wikiIds);
    assert.ok(result.paragraphs.length >= 1 && result.paragraphs.length <= 2);
    assert.ok(result.paragraphs.every((part) => part.sourceIds.length === 1 && part.sourceIds[0] === source.id));
    assert.ok(result.paragraphs.every((part) => source.content.some((segment) => part.text.includes(segment.text))));
  }
});

test('source overview is not inferred from a partial filename, a different extension, or added instructions', () => {
  for (const question of [
    '青榆灯塔 · 预算说明讲了什么？',
    '青榆灯塔 · 预算说明.pdf讲了什么？',
    '青榆灯塔 · 预算说明.md讲了什么？请估算真实支出',
    '灯塔设备 · 快速使用指南.pdf副本讲了什么？',
  ]) {
    const result = createExampleAnswer(question);
    assert.equal(result.kind, 'not_found', question);
    assert.deepEqual(result.sourceIds, []);
  }
});

test('a bare lighthouse keyword presents the two known meanings, not an all-source dump', () => {
  const result = createExampleAnswer('灯塔');
  assert.equal(result.kind, 'answer');
  assert.equal(result.intent, '辨别主题');
  assert.match(result.summary, /两|2/);
  assert.equal(result.paragraphs.length, 2);
  assert.deepEqual(result.pageIds, ['cedar-project', 'device-start']);
  assert.ok(result.sourceIds.length < sources.length);
});

test('budget question cites project documents without device instructions', () => {
  const result = createExampleAnswer('青榆灯塔项目预算是多少？');
  assert.equal(result.kind, 'answer');
  assert.match(result.summary, /48,600/);
  assert.ok(result.sourceIds.includes('cedar-budget'));
  assert.ok(result.sourceIds.every((id) => id.startsWith('cedar-')));
  assert.ok(result.paragraphs.every((part) => part.sourceIds.every((id) => result.sourceIds.includes(id))));
});

test('device question cites both the instruction document and the tutorial video', () => {
  const result = createExampleAnswer('灯塔设备怎么开机使用？');
  assert.equal(result.kind, 'answer');
  assert.ok(result.sourceIds.includes('device-guide'));
  assert.ok(result.sourceIds.includes('device-video'));
  assert.ok(!result.sourceIds.includes('cedar-budget'));
  assert.match(result.summary, /合成|示例/);
});

test('unknown questions are not served a fabricated generic answer', () => {
  for (const question of ['', '明天天气如何', '火星项目预算是多少', '青榆灯塔首席工程师是谁', '灯塔设备预算是多少']) {
    const result = createExampleAnswer(question);
    assert.equal(result.kind, 'not_found', question);
    assert.deepEqual(result.sourceIds, []);
    assert.deepEqual(result.pageIds, []);
    assert.match(result.summary, /后端|示例/);
  }
});

test('route parsing permits the preview routes and rejects malformed path details', () => {
  assert.deepEqual(parseRoute(''), { view: 'home', id: null });
  assert.deepEqual(parseRoute('#/knowledge/cedar-project'), { view: 'knowledge', id: 'cedar-project' });
  assert.deepEqual(parseRoute('#/sources/device-guide'), { view: 'sources', id: 'device-guide' });
  for (const view of ['home', 'knowledge', 'sources', 'ask', 'graph', 'review', 'settings']) {
    assert.deepEqual(parseRoute(`#/${view}`), { view, id: null });
  }
  for (const route of ['#/settings/extra', '#/unknown', '#/sources/%E0%A4%A', '#/sources/../x', '#/sources/%3Cscript%3E']) {
    assert.deepEqual(parseRoute(route), { view: 'home', id: null });
  }
});

test('HTML escaping preserves plain strings and never emits user markup', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'alert(1)\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(42), '42');
});
