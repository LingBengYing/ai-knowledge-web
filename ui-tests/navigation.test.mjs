import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
test('workflow navigation exposes three real destinations and isolated views', () => {
  for (const page of ['documents', 'tasks', 'settings']) {
    assert.match(html, new RegExp(`href="#/${page}"`));
    assert.match(html, new RegExp(`id="view-${page}"`));
  }
});
test('detail uses native modal and batch/filter tools start collapsed', () => {
  assert.match(html, /<dialog id="details"/u);
  assert.match(html, /id="batch-tools"[^>]*hidden/u);
  assert.match(html, /id="advanced-filters"[^>]*hidden/u);
});
