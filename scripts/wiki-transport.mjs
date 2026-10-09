/** Exact shared Wiki transport surface; Java remains the authority for identities and versions. */
export const WIKI_ASSETS = [
  ['/wiki/', ['wiki-workspace.html', 'text/html; charset=utf-8']],
  ['/wiki-workspace.html', ['wiki-workspace.html', 'text/html; charset=utf-8']],
  ['/wiki-workspace.mjs', ['wiki-workspace.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-workspace-api.mjs', ['wiki-workspace-api.mjs', 'text/javascript; charset=utf-8']],
  ['/knowledge-agent.mjs', ['knowledge-agent.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-workspace.css', ['wiki-workspace.css', 'text/css; charset=utf-8']],
  ['/wiki-preview.css', ['wiki-preview.css', 'text/css; charset=utf-8']],
  ['/classic/', ['index.html', 'text/html; charset=utf-8']],
];

export const WIKI_ROUTES = [
  [/^\/v1\/knowledge-agent\/config$/, ['GET'], 'wiki-agent'],
  [/^\/v1\/knowledge-agent\/runs$/, ['POST'], 'wiki-agent'],
  [/^\/v1\/knowledge-agent\/runs\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'wiki-agent'],
  [/^\/v1\/knowledge-agent\/runs\/[A-Za-z0-9_-]{1,128}\/cancel$/, ['POST'], 'wiki-agent'],
  [/^\/v1\/wiki\/(?:catalog|pages)$/, ['GET'], 'wiki-list'],
  [/^\/v1\/wiki\/drafts$/, ['GET', 'POST'], 'wiki-list'],
  [/^\/v1\/wiki\/proposals$/, ['GET', 'POST'], 'wiki-list'],
  [/^\/v1\/wiki\/drafts\/[A-Za-z0-9_-]{1,128}$/, ['GET', 'PUT', 'DELETE'], 'wiki-draft'],
  [/^\/v1\/wiki\/pages\/[A-Za-z0-9_-]{1,128}(?:\/versions\/[1-9][0-9]*)?$/, ['GET'], 'source'],
  [/^\/v1\/wiki\/proposals\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'source'],
  [/^\/v1\/wiki\/proposals\/[A-Za-z0-9_-]{1,128}\/(?:accept|dismiss)$/, ['POST'], 'wiki-review'],
  [/^\/v1\/wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'source'],
  [/^\/v1\/wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128}\/content$/, ['GET'], 'media'],
  [/^\/v1\/wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128}\/frame$/, ['GET'], 'content'],
];
export function wikiQueryAllowed(target, method) {
  const url = new URL(target, 'http://127.0.0.1');
  if (!target.includes('?')) return true;
  let allowed = [];
  if (method === 'GET') {
    if (url.pathname === '/v1/wiki/catalog') allowed = ['offset', 'limit', 'q', 'kind'];
    if (url.pathname === '/v1/wiki/pages') allowed = ['offset', 'limit', 'q'];
    if (url.pathname === '/v1/wiki/proposals') allowed = ['offset', 'limit', 'status'];
    if (url.pathname === '/v1/wiki/drafts') allowed = ['offset', 'limit'];
  }
  if (method === 'DELETE' && /^\/v1\/wiki\/drafts\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) allowed = ['version'];
  if (!allowed.length) return false;
  return [...url.searchParams].every(([key]) => allowed.includes(key) && url.searchParams.getAll(key).length === 1);
}
