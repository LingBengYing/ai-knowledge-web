/** Shared helpers for the proxy transport tests; not a test file itself (npm test only runs *.test.mjs). */
import http from 'node:http';
import { once } from 'node:events';
import { startDevServer } from '../scripts/dev-server.mjs';
import { startExternalServer } from '../scripts/external-server.mjs';

export const closeServer = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

/** One plain HTTP exchange; the body is returned as a string. */
export function raw(origin, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(origin, { path, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

export const publicOrigin = 'https://knowledge.example.invalid';
export const cookie = 'rag_session=fixture';

/**
 * Starts a synthetic Java backend plus either proxy. For the external entry, the backend also answers the
 * startup entry policy, /v1/config and the per-request session check; `request` then adds Host and Cookie.
 */
export async function proxyFixture(t, external, handler, settings = {}) {
  const backend = http.createServer((req, res) => {
    if (external && req.url === '/health/entry-policy') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ enabled: true, public_origin: publicOrigin, auth_mode: 'jwt' }));
    } else if (external && req.url === '/v1/config') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ auth_mode: 'jwt', capabilities: [] }));
    } else if (external && req.url === '/v1/session') {
      res.setHeader('Content-Type', 'application/json');
      res.statusCode = req.headers.cookie === cookie ? 200 : 401;
      res.end(JSON.stringify({ status: res.statusCode === 200 ? 'authenticated' : 'unauthenticated' }));
    } else handler(req, res);
  });
  backend.listen(0, '127.0.0.1'); await once(backend, 'listening');
  t.after(() => closeServer(backend));
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
  const server = await (external ? startExternalServer({ publicOrigin, backendOrigin, port: 0, ...settings })
    : startDevServer({ backendOrigin, port: 0, ...settings }));
  t.after(() => closeServer(server));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { backendOrigin, request: (path, { method = 'GET', body, headers = {} } = {}) => raw(origin, path, { method, body, headers: {
    ...(external ? { Host: new URL(publicOrigin).host, Cookie: cookie } : {}),
    ...(!['GET', 'HEAD'].includes(method) ? { Origin: external ? publicOrigin : origin } : {}), ...headers,
    ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }),
  } }) };
}
