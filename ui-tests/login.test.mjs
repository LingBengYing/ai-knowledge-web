import test from 'node:test';
import assert from 'node:assert/strict';

let loaded = 0;
async function loginPage(t, { hash = '', respond }) {
  const calls = [];
  const replaced = [];
  let submit;
  const button = { disabled: false };
  const elements = {
    '#login': { addEventListener: (_type, listener) => { submit = listener; }, querySelector: () => button },
    '#token': { value: '' },
    '#status': { textContent: '' },
  };
  const saved = Object.fromEntries(['document', 'location', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => { for (const [name, descriptor] of Object.entries(saved)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: selector => elements[selector] } });
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hash, replace: url => replaced.push(url) } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async (url, options = {}) => { calls.push([url, options]); return respond(options.method ?? 'GET', options); } });
  await import(`../entry-public/login.mjs?case=${++loaded}`);
  await new Promise(resolve => setImmediate(resolve));
  const login = async token => { elements['#token'].value = token; await submit({ preventDefault() {} }); };
  return { calls, replaced, status: elements['#status'], login };
}
const reply = (status, body = {}) => ({ status, json: async () => body });

test('a signed-in visitor sent to login by a cross-site link re-enters same-origin with the deep link hash', async t => {
  const page = await loginPage(t, { hash: '#/wiki/pages/page-one', respond: () => reply(200, { status: 'authenticated' }) });
  assert.deepEqual(page.calls.map(([url, options]) => [url, options.method, options.credentials]), [['/v1/session', undefined, 'same-origin']]);
  assert.deepEqual(page.replaced, ['/#/wiki/pages/page-one']);
});

test('a signed-out visitor stays on login and a successful token login keeps the deep link hash', async t => {
  const page = await loginPage(t, { hash: '#/documents', respond: method => method === 'GET' ? reply(401, { status: 'unauthorized' }) : reply(200, { status: 'authenticated' }) });
  assert.deepEqual(page.replaced, []);
  await page.login('REPLACE_ME');
  assert.equal(page.calls[1][1].method, 'POST');
  assert.deepEqual(page.replaced, ['/#/documents']);
});

test('session recheck failures stay quiet and failed logins keep the Chinese guidance without leaving the page', async t => {
  const page = await loginPage(t, { respond: method => { if (method === 'GET') throw new Error('offline'); return reply(401); } });
  assert.deepEqual(page.replaced, []); assert.equal(page.status.textContent, '');
  await page.login('wrong');
  assert.equal(page.status.textContent, '登录失败，请确认令牌和有效期。');
  assert.deepEqual(page.replaced, []);
});
