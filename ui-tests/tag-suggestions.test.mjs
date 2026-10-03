import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../public/api.mjs';
import { TagSuggestionSession, tagSuggestionsEnabled, canReadTagSuggestions } from '../public/tag-suggestions.mjs';

const item = { document_id: 'doc-one', index_publication_id: 'pub-one', active_revision_id: 'rev-one', can_edit: true,
  synthetic_fixture: false, media_info: { sha256: 'a'.repeat(64) }, tags: ['manual'] };
const synopsis = { document_id: item.document_id, publication_id: item.index_publication_id, revision_id: item.active_revision_id,
  source_sha256: item.media_info.sha256, synopsis_id: 'syn-one', input_fingerprint: 'b'.repeat(64), model_revision: 'model-one',
  policy_revision: 'synopsis-one', status: 'available' };
const suggestions = () => ({ ...synopsis, synopsis_policy_revision: synopsis.policy_revision, policy_revision: 'java-synopsis-tags-v1',
  suggestion_fingerprint: 'c'.repeat(64), can_apply: true, existing_tags: ['manual'],
  candidates: [{ ordinal: 1, tag: '预算' }, { ordinal: 2, tag: '<b>保留原文</b>' }] });
const saved = () => ({ ...item, tags: ['manual', 'concurrent', '预算'] });

test('tag suggestion eligibility requires all capabilities and current saved synopsis identity', () => {
  assert.equal(tagSuggestionsEnabled({ capabilities: ['file_synopsis', 'synopsis_sources'] }), false);
  assert.equal(tagSuggestionsEnabled({ capabilities: ['file_synopsis', 'synopsis_sources', 'tag_suggestions'] }), true);
  assert.equal(canReadTagSuggestions(item, synopsis), true);
  assert.equal(canReadTagSuggestions({ ...item, can_edit: false }, synopsis), true);
  for (const change of [{ synthetic_fixture: true }, { document_id: 'other' }, { active_revision_id: null }, { media_info: { sha256: 'b'.repeat(64) } }]) {
    assert.equal(canReadTagSuggestions({ ...item, ...change }, synopsis), false);
  }
  for (const change of [{ status: 'unavailable' }, { synopsis_id: '../other' }, { input_fingerprint: 'wrong' }]) {
    assert.equal(canReadTagSuggestions(item, { ...synopsis, ...change }), false);
  }
});

test('read and selection do not write; apply sends only current fingerprint and explicit ordinals', async () => {
  const calls = [], session = new TagSuggestionSession(async (path, options) => { calls.push({ path, options }); return options.method === 'POST' ? saved() : suggestions(); });
  await session.load(item, synopsis);
  assert.equal(session.value.phase, 'ready'); assert.equal(session.value.suggestions.candidates[1].tag, '<b>保留原文</b>');
  assert.equal(await session.apply(item, synopsis), null); assert.equal(calls.length, 1);
  session.select(1, true); session.select(1, true); session.select(8, true);
  assert.deepEqual(session.value.selected, [1]); assert.equal(calls.length, 1);
  const row = await session.apply(item, synopsis);
  assert.deepEqual(row.tags, ['manual', 'concurrent', '预算']);
  assert.equal(calls[1].path, '/v1/documents/doc-one/tag-suggestions/apply');
  assert.deepEqual(calls[1].options.body, { suggestion_fingerprint: 'c'.repeat(64), ordinals: [1] });
  assert.equal(calls[1].options.signal, undefined);
  assert.deepEqual(session.value.selected, []); session.select(1, true); assert.deepEqual(session.value.selected, []);
});

test('identity, bounded candidate shape and duplicate tags fail closed before any write', async () => {
  for (const change of [{ document_id: 'other' }, { revision_id: 'other' }, { source_sha256: 'f'.repeat(64) }, { synopsis_id: 'other' },
    { model_revision: 'other' }, { synopsis_policy_revision: 'other' }, { policy_revision: 'other' }, { can_apply: false },
    { suggestion_fingerprint: 'wrong' }, { existing_tags: ['x', 'x'] },
    { candidates: [{ ordinal: 2, tag: '预算' }] }, { candidates: [{ ordinal: 1, tag: '😀'.repeat(41) }] },
    { candidates: [{ ordinal: 1, tag: 'a,b' }] }, { candidates: [{ ordinal: 1, tag: 'a\nb' }] },
    { candidates: [{ ordinal: 1, tag: '预算' }, { ordinal: 2, tag: '预算' }] }]) {
    let calls = 0;
    const session = new TagSuggestionSession(async () => { calls++; return { ...suggestions(), ...change }; });
    await session.load(item, synopsis); assert.equal(session.value.phase, 'error');
    assert.equal(session.value.error.status, 502); assert.equal(session.value.suggestions, null);
    assert.equal(await session.apply(item, synopsis), null); assert.equal(calls, 1);
  }
  const session = new TagSuggestionSession(async () => ({ ...suggestions(), candidates: [{ ordinal: 1, tag: '😀'.repeat(40) }] }));
  await session.load(item, synopsis); assert.equal(session.value.phase, 'ready');
});

test('reader, existing tags and empty candidates never become actionable selections', async () => {
  for (const [current, response] of [[{ ...item, can_edit: false }, { ...suggestions(), can_apply: false }],
    [item, { ...suggestions(), existing_tags: ['manual', '预算'] }], [item, { ...suggestions(), candidates: [] }]]) {
    let calls = 0;
    const session = new TagSuggestionSession(async () => { calls++; return response; });
    await session.load(current, synopsis); session.select(1, true);
    assert.deepEqual(session.value.selected, []); assert.equal(await session.apply(current, synopsis), null); assert.equal(calls, 1);
  }
});

test('leaving cancels a read and prevents both late read and committed write from reviving the old detail', async () => {
  let deliver, readSignal;
  const session = new TagSuggestionSession((_path, options) => new Promise(resolve => { deliver = resolve; readSignal = options.signal; }));
  const reading = session.load(item, synopsis); session.close(); assert.equal(readSignal.aborted, true);
  deliver(suggestions()); await reading; assert.equal(session.value.phase, 'idle');
  let complete;
  const writing = new TagSuggestionSession(async (_path, options) => options.method === 'POST' ? new Promise(resolve => { complete = resolve; }) : suggestions());
  await writing.load(item, synopsis); writing.select(1, true);
  const pending = writing.apply(item, synopsis); writing.close(); complete(saved());
  assert.equal(await pending, null); assert.equal(writing.value.phase, 'idle');
});

test('expired suggestion and unbound save errors require explicit refresh without automatic retry', async () => {
  for (const response of [new ApiError(409, '建议已变化'), { ...saved(), document_id: 'other' }, { ...saved(), tags: ['manual'] }]) {
    let calls = 0;
    const session = new TagSuggestionSession(async (_path, options) => {
      calls++; if (options.method !== 'POST') return suggestions();
      if (response instanceof Error) throw response; return response;
    });
    await session.load(item, synopsis); session.select(1, true);
    await assert.rejects(session.apply(item, synopsis));
    assert.equal(session.value.phase, 'error'); assert.equal(session.value.suggestions, null);
    assert.equal(await session.apply(item, synopsis), null); assert.equal(calls, 2);
  }
});

test('refresh aborts the old read and duplicate apply is not sent', async () => {
  let first, count = 0, finish;
  const session = new TagSuggestionSession((_path, options) => {
    count++;
    if (count === 1) return new Promise(resolve => { first = resolve; });
    if (options.method === 'POST') return new Promise(resolve => { finish = resolve; });
    return Promise.resolve(suggestions());
  });
  const initial = session.load(item, synopsis); await session.load(item, synopsis);
  first({ ...suggestions(), document_id: 'other' }); await initial; assert.equal(session.value.phase, 'ready');
  session.select(1, true); session.select(2, true); session.select(2, false); const pending = session.apply(item, synopsis);
  assert.equal(await session.apply(item, synopsis), null); finish(saved()); await pending; assert.equal(count, 3);
});
