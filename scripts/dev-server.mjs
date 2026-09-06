#!/usr/bin/env node
/** Local development transport only. Authentication and ACL remain Java-owned. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const DEFAULT_PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/api.mjs', ['api.mjs', 'text/javascript; charset=utf-8']],
  ['/notices.mjs', ['notices.mjs', 'text/javascript; charset=utf-8']],
  ['/workbench-state.mjs', ['workbench-state.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const ROUTES = [
  [/^\/v1\/documents$/, ['POST'], 'upload'],
  [/^\/v1\/ingestions\/[A-Za-z0-9_-]{1,128}$/, ['GET']],
  [/^\/v1\/ingestions\/[A-Za-z0-9_-]{1,128}\/(?:cancel|retry)$/, ['POST'], 'empty'],
  [/^\/v1\/config$/, ['GET']],
  [/^\/v1\/session$/, ['POST', 'DELETE']],
  [/^\/health\/(?:live|ready)$/, ['GET']],
  [/^\/v1\/management\/documents$/, ['GET']],
  [/^\/v1\/management\/documents\/[A-Za-z0-9_-]{1,128}$/, ['PATCH']],
  [/^\/v1\/management\/document-actions$/, ['POST']],
  [/^\/v1\/management\/folders$/, ['GET', 'POST']],
  [/^\/v1\/management\/folders\/[A-Za-z0-9_-]{1,128}$/, ['PATCH', 'DELETE']],
  [/^\/v1\/management\/tags$/, ['GET']],
];
const SAFE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

class TransportError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function backendAddress(value) {
  if (typeof value !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value)) {
    throw new TransportError(500, 'invalid_backend_origin');
  }
  const parsed = new URL(value);
  if (Number(value.slice(value.lastIndexOf(':') + 1)) > 65535) throw new TransportError(500, 'invalid_backend_origin');
  return parsed;
}

export function readConfiguration(env = process.env) {
  if (env.NODE_ENV && !['development', 'test'].includes(env.NODE_ENV)) throw new TransportError(500, 'development_only');
  const backendOrigin = env.RAG_WEB_BACKEND_ORIGIN ?? 'http://127.0.0.1:18084';
  backendAddress(backendOrigin);
  const value = env.RAG_WEB_PORT ?? '18085';
  if (!/^[1-9][0-9]{0,4}$/.test(value) || Number(value) === 80 || Number(value) > 65535) throw new TransportError(500, 'invalid_port');
  return { backendOrigin, port: Number(value) };
}

function singleHeader(req, name, status = 400) {
  const values = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() === name) values.push(req.rawHeaders[index + 1]);
  }
  if (values.length > 1) throw new TransportError(status, 'duplicate_header');
  return values[0];
}

function validateBrowserBoundary(req, port) {
  const host = `127.0.0.1:${port}`;
  if (singleHeader(req, 'host', 403) !== host) throw new TransportError(403, 'host_denied');
  const origin = singleHeader(req, 'origin', 403);
  if (origin !== undefined && origin !== `http://${host}`) throw new TransportError(403, 'origin_denied');
  const site = singleHeader(req, 'sec-fetch-site', 403);
  if (site !== undefined && !['same-origin', 'none'].includes(site)) throw new TransportError(403, 'origin_denied');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !origin) throw new TransportError(403, 'origin_required');
  return origin;
}

function forwardedHeaders(req, backend, origin, requestId) {
  // Do not drop an explicit Bearer and accidentally fall back to a valid Cookie.
  if (singleHeader(req, 'authorization') !== undefined) throw new TransportError(400, 'authorization_header_not_supported');
  const headers = { Accept: 'application/json', 'Accept-Encoding': 'identity', 'X-Request-Id': requestId };
  for (const name of ['content-type', 'x-principal-id', 'x-workspace-id']) {
    const value = singleHeader(req, name);
    if (value !== undefined) headers[name] = value;
  }
  const cookies = singleHeader(req, 'cookie');
  const sessions = cookies?.split(';').map(value => value.trim()).filter(value => value.startsWith('rag_session=')) ?? [];
  if (sessions.length > 1) throw new TransportError(400, 'duplicate_session');
  if (sessions.length) {
    if (!/^rag_session=[A-Za-z0-9._~-]{0,4096}$/.test(sessions[0])) throw new TransportError(400, 'invalid_session');
    headers.Cookie = sessions[0];
  }
  if (origin) headers.Origin = backend.origin;
  return headers;
}

function collect(stream, limit, signal, sizeError) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    const finish = (error, body) => {
      stream.removeListener('data', data);
      stream.removeListener('end', end);
      stream.removeListener('error', failed);
      stream.removeListener('aborted', aborted);
      signal.removeEventListener('abort', abort);
      if (error) { stream.resume(); rejectBody(error); } else resolveBody(body);
    };
    const data = chunk => {
      size += chunk.length;
      if (size > limit) finish(sizeError);
      else chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks));
    const failed = () => finish(new TransportError(502, 'connection_failed'));
    const aborted = () => finish(new TransportError(502, 'connection_failed'));
    const abort = () => finish(new TransportError(504, 'request_deadline'));
    stream.on('data', data); stream.on('end', end); stream.on('error', failed); stream.on('aborted', aborted);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function sessionCookies(values = []) {
  return values.filter(value => {
    const [pair, ...attributes] = value.split(';').map(part => part.trim());
    const lower = attributes.map(part => part.toLowerCase());
    return /^rag_session=[A-Za-z0-9._~-]{0,4096}$/.test(pair)
      && lower.includes('httponly') && lower.includes('samesite=strict') && lower.includes('path=/')
      && lower.every(part => part === 'httponly' || part === 'secure' || part === 'samesite=strict'
        || part === 'path=/' || /^max-age=-?\d+$/.test(part) || part.startsWith('expires='));
  });
}

function validateUploadTarget(target) {
  try {
    decodeURIComponent(target);
    const parameters = new URL(target, 'http://127.0.0.1').searchParams;
    const filename = parameters.get('filename');
    if ([...parameters].length !== 1 || !parameters.has('filename') || !filename || filename.length > 255
      || /[/\\\u0000-\u001f\u007f]/u.test(filename) || !/\.(?:pdf|txt|md)$/iu.test(filename)) throw new Error('invalid upload target');
  } catch { throw new TransportError(400, 'invalid_upload_filename'); }
}

async function proxy(req, res, backend, headers, limits, signal, kind) {
  if (kind === 'upload') {
    validateUploadTarget(req.url);
    if (headers['content-type']?.toLowerCase() !== 'application/octet-stream') throw new TransportError(415, 'binary_file_required');
  } else if (kind !== 'empty' && !['GET', 'DELETE'].includes(req.method) && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '')) {
    throw new TransportError(415, 'json_required');
  }
  const body = await collect(req, limits.requestBytes, signal, new TransportError(413, 'request_too_large'));
  if (kind === 'upload' && !body.length) throw new TransportError(400, 'empty_upload');
  if (kind === 'empty' && body.length) throw new TransportError(400, 'request_body_denied');
  if (req.method === 'GET' && body.length) throw new TransportError(400, 'get_body_denied');
  headers['Content-Length'] = String(body.length);
  const response = await new Promise((resolveResponse, rejectResponse) => {
    const upstream = http.request(backend, { method: req.method, path: req.url, headers, signal }, resolveResponse);
    upstream.once('error', () => rejectResponse(new TransportError(signal.aborted ? 504 : 502, signal.aborted ? 'request_deadline' : 'backend_unavailable')));
    upstream.end(body);
  });
  response.on('error', () => {}); // collect handles active errors; consume late teardown errors safely.
  if (response.statusCode >= 300 && response.statusCode < 400) {
    response.destroy();
    throw new TransportError(502, 'backend_redirect_denied');
  }
  let payload;
  try { payload = await collect(response, limits.responseBytes, signal, new TransportError(502, 'backend_response_too_large')); }
  catch (error) { response.destroy(); throw error; }
  const output = {};
  for (const name of ['content-type', 'www-authenticate']) if (response.headers[name]) output[name] = response.headers[name];
  if (req.url.split('?')[0] === '/v1/session') {
    const cookies = sessionCookies(response.headers['set-cookie']);
    if (cookies.length === 1) output['Set-Cookie'] = cookies;
  }
  res.writeHead(response.statusCode, output);
  res.end(payload);
}

async function serveAsset(res, asset, publicDirectory, head) {
  let file;
  try {
    const directory = resolve(publicDirectory);
    if (await realpath(directory) !== directory) throw new Error('unsafe asset root');
    file = await open(join(directory, asset[0]), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('unsafe asset');
    const body = await file.readFile();
    res.writeHead(200, { 'Content-Type': asset[1] });
    res.end(head ? undefined : body);
  } catch { throw new TransportError(404, 'asset_not_found'); }
  finally { await file?.close(); }
}

export async function startDevServer({ backendOrigin = 'http://127.0.0.1:18084', port = 18085,
  publicDirectory = DEFAULT_PUBLIC, requestBytes = 128 * 1024, responseBytes = 4 * 1024 * 1024,
  deadlineMs = 10_000, uploadBytes = 20 * 1024 * 1024, uploadDeadlineMs = 30_000 } = {}) {
  const backend = backendAddress(backendOrigin);
  if (!Number.isInteger(port) || port < 0 || port === 80 || port > 65535) throw new TransportError(500, 'invalid_port');
  for (const [value, max] of [[requestBytes, 128 * 1024], [responseBytes, 4 * 1024 * 1024], [deadlineMs, 10_000], [uploadBytes, 20 * 1024 * 1024], [uploadDeadlineMs, 30_000]]) {
    if (!Number.isInteger(value) || value < 1 || value > max) throw new TransportError(500, 'invalid_limit');
  }
  let activeUploads = 0;
  const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 10_000 }, async (req, res) => {
    const requestId = randomUUID();
    for (const [name, value] of Object.entries(SAFE_HEADERS)) res.setHeader(name, value);
    res.setHeader('X-Request-Id', requestId);
    const controller = new AbortController();
    req.on('error', () => controller.abort());
    const upload = req.method === 'POST' && req.url.split('?')[0] === '/v1/documents';
    const timer = setTimeout(() => controller.abort(), upload ? uploadDeadlineMs : deadlineMs);
    let reservedUpload = false;
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const origin = validateBrowserBoundary(req, server.address().port);
      const path = req.url.split('?')[0];
      if (!req.url.startsWith('/') || /[\\#\x00-\x20]/.test(req.url)) throw new TransportError(404, 'route_not_found');
      const asset = ASSETS.get(path);
      if (asset) {
        if (!['GET', 'HEAD'].includes(req.method)) throw new TransportError(405, 'method_not_allowed');
        await serveAsset(res, asset, publicDirectory, req.method === 'HEAD');
      } else {
        const route = ROUTES.find(([pattern]) => pattern.test(path));
        if (!route) throw new TransportError(404, 'route_not_found');
        if (!route[1].includes(req.method)) throw new TransportError(405, 'method_not_allowed');
        const headers = forwardedHeaders(req, backend, origin, requestId);
        if (route[2] === 'upload') {
          if (activeUploads >= 2) throw new TransportError(429, 'upload_capacity_reached');
          activeUploads += 1;
          reservedUpload = true;
        }
        await proxy(req, res, backend, headers, { requestBytes: route[2] === 'upload' ? uploadBytes : requestBytes, responseBytes }, controller.signal, route[2]);
      }
    } catch (error) {
      const known = error instanceof TransportError;
      if (!res.headersSent && !res.destroyed) {
        const status = known ? error.status : 500;
        res.writeHead(status, { 'Content-Type': 'application/problem+json; charset=utf-8' });
        res.end(JSON.stringify({ type: 'about:blank', title: known ? error.code : 'request_failed', status,
          detail: status >= 500 ? '开发连接未完成，请确认 Java 服务后重试。' : '开发请求不符合安全约束。', request_id: requestId }));
      }
      req.resume();
    } finally { clearTimeout(timer); if (reservedUpload) activeUploads -= 1; }
  });
  server.maxHeadersCount = 40;
  await new Promise((resolveListening, rejectListening) => {
    server.once('error', rejectListening);
    server.listen(port, '127.0.0.1', () => { server.removeListener('error', rejectListening); resolveListening(); });
  });
  if (server.address().port === Number(backend.port || 80)) {
    await new Promise(resolveClosed => server.close(resolveClosed));
    throw new TransportError(500, 'proxy_loop_denied');
  }
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const server = await startDevServer(readConfiguration());
    process.stdout.write(`Local frontend: http://127.0.0.1:${server.address().port}\nDevelopment only; Java backend required.\n`);
    for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => {
      server.close(() => { process.exitCode = 0; });
      server.closeAllConnections();
    });
  } catch {
    process.stderr.write('Development server could not start; check loopback configuration and port availability.\n');
    process.exitCode = 1;
  }
}
