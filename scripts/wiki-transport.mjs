/** Exact shared Wiki transport surface; Java remains the authority for identities and versions. */
export const WIKI_ASSETS = [
  ['/batch-upload.mjs', ['batch-upload.mjs', 'text/javascript; charset=utf-8']],
  ['/sha256-stream.mjs', ['sha256-stream.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki/', ['wiki-workspace.html', 'text/html; charset=utf-8']],
  ['/wiki-workspace.html', ['wiki-workspace.html', 'text/html; charset=utf-8']],
  ['/wiki-workspace.mjs', ['wiki-workspace.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-workspace-api.mjs', ['wiki-workspace-api.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-retrieval.mjs', ['wiki-retrieval.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-maintenance.mjs', ['wiki-maintenance.mjs', 'text/javascript; charset=utf-8']],
  ['/knowledge-agent.mjs', ['knowledge-agent.mjs', 'text/javascript; charset=utf-8']],
  ['/failure-reasons.mjs', ['failure-reasons.mjs', 'text/javascript; charset=utf-8']],
  ['/knowledge-conversations.mjs', ['knowledge-conversations.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-workspace.css', ['wiki-workspace.css', 'text/css; charset=utf-8']],
  ['/wiki-preview.css', ['wiki-preview.css', 'text/css; charset=utf-8']],
];

export const WIKI_ROUTES = [
  [/^\/v1\/document-batches$/, ['GET', 'POST'], 'wiki-batch'],
  [/^\/v1\/document-batches\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'wiki-batch'],
  [/^\/v1\/document-batches\/[A-Za-z0-9_-]{1,128}\/files\/(?:0|[1-9][0-9]{0,3})$/, ['POST'], 'batch-upload'],
  // Open batches: manifest entries appended while files upload, then the manifest is sealed.
  [/^\/v1\/document-batches\/[A-Za-z0-9_-]{1,128}\/files$/, ['POST'], 'wiki-batch'],
  [/^\/v1\/document-batches\/[A-Za-z0-9_-]{1,128}\/(?:retry-failed|cancel|resume|seal)$/, ['POST'], 'wiki-batch'],
  [/^\/v1\/knowledge-conversations$/, ['GET', 'POST'], 'wiki-conversation'],
  [/^\/v1\/knowledge-conversations\/[A-Za-z0-9_-]{1,128}$/, ['GET', 'PATCH', 'DELETE'], 'wiki-conversation'],
  [/^\/v1\/knowledge-agent\/config$/, ['GET'], 'wiki-agent'],
  [/^\/v1\/knowledge-agent\/runs$/, ['POST'], 'wiki-agent'],
  [/^\/v1\/knowledge-agent\/runs\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'wiki-agent'],
  [/^\/v1\/knowledge-agent\/runs\/[A-Za-z0-9_-]{1,128}\/events$/, ['GET'], 'wiki-agent-events'],
  [/^\/v1\/knowledge-agent\/runs\/[A-Za-z0-9_-]{1,128}\/cancel$/, ['POST'], 'wiki-agent'],
  [/^\/v1\/wiki\/(?:catalog|pages)$/, ['GET'], 'wiki-list'],
  [/^\/v1\/wiki\/drafts$/, ['GET', 'POST'], 'wiki-list'],
  [/^\/v1\/wiki\/proposals$/, ['GET', 'POST'], 'wiki-list'],
  [/^\/v1\/wiki\/drafts\/[A-Za-z0-9_-]{1,128}$/, ['GET', 'PUT', 'DELETE'], 'wiki-draft'],
  [/^\/v1\/wiki\/pages\/[A-Za-z0-9_-]{1,128}$/, ['GET', 'DELETE'], 'wiki-page'],
  [/^\/v1\/wiki\/pages\/[A-Za-z0-9_-]{1,128}\/restore$/, ['POST'], 'wiki-page'],
  [/^\/v1\/wiki\/pages\/[A-Za-z0-9_-]{1,128}\/purge$/, ['DELETE'], 'wiki-page'],
  [/^\/v1\/wiki\/pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*$/, ['GET'], 'source'],
  [/^\/v1\/wiki\/proposals\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'source'],
  [/^\/v1\/wiki\/proposals\/[A-Za-z0-9_-]{1,128}\/(?:accept|dismiss)$/, ['POST'], 'wiki-review'],
  [/^\/v1\/wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'source'],
  [/^\/v1\/wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128}\/content$/, ['GET'], 'media'],
  [/^\/v1\/wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128}\/frame$/, ['GET'], 'content'],
];
export function wikiQueryAllowed(target, method) {
  const url = new URL(target, 'http://127.0.0.1');
  if (method === 'DELETE' && /^\/v1\/wiki\/pages\/[A-Za-z0-9_-]{1,128}(?:\/purge)?$/.test(url.pathname)) {
    const values = url.searchParams;
    return [...values].length === 2 && values.getAll('version').length === 1 && values.getAll('lifecycle_version').length === 1
      && /^[1-9][0-9]*$/u.test(values.get('version')) && /^(0|[1-9][0-9]*)$/u.test(values.get('lifecycle_version'))
      && Number.isSafeInteger(Number(values.get('version'))) && Number.isSafeInteger(Number(values.get('lifecycle_version')));
  }
  if (!target.includes('?')) return true;
  let allowed = [];
  if (method === 'GET') {
    if (url.pathname === '/v1/document-batches') allowed = ['offset', 'limit'];
    // A batch page may be filtered by file state: lowercase names, comma-separated.
    if (/^\/v1\/document-batches\/[A-Za-z0-9_-]{1,128}$/u.test(url.pathname)) {
      allowed = ['offset', 'limit', 'state'];
      if (url.searchParams.has('state') && !/^[a-z_]{1,32}(?:,[a-z_]{1,32}){0,9}$/u.test(url.searchParams.get('state'))) return false;
    }
    if (/^\/v1\/knowledge-conversations(?:\/[A-Za-z0-9_-]{1,128})?$/u.test(url.pathname)) allowed = ['offset', 'limit'];
    if (url.pathname === '/v1/wiki/catalog') allowed = ['offset', 'limit', 'q', 'kind'];
    if (url.pathname === '/v1/wiki/pages') allowed = ['offset', 'limit', 'q', 'state'];
    if (url.pathname === '/v1/wiki/proposals') allowed = ['offset', 'limit', 'status'];
    if (url.pathname === '/v1/wiki/drafts') allowed = ['offset', 'limit'];
  }
  if (method === 'DELETE' && /^\/v1\/wiki\/drafts\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) allowed = ['version'];
  if (!allowed.length) return false;
  return [...url.searchParams].every(([key]) => allowed.includes(key) && url.searchParams.getAll(key).length === 1);
}
/** A batch manifest or an appended manifest chunk: up to 4 MiB of JSON, sent within the upload deadline. */
export function batchManifestRequest(method, target) {
  return method === 'POST' && (target === '/v1/document-batches' || /^\/v1\/document-batches\/[A-Za-z0-9_-]{1,128}\/files$/u.test(target));
}
