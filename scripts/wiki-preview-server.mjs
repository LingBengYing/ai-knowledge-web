#!/usr/bin/env node
/** Isolated frontend review only. No API, credentials, provider or backend connection. */
import http from 'node:http';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const ASSETS = new Map([
  ['/', ['wiki-preview.html', 'text/html; charset=utf-8']],
  ['/wiki-preview.mjs', ['wiki-preview.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-preview-data.mjs', ['wiki-preview-data.mjs', 'text/javascript; charset=utf-8']],
  ['/wiki-preview.css', ['wiki-preview.css', 'text/css; charset=utf-8']],
]);
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "font-src 'self'", "connect-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
  "form-action 'none'", "object-src 'none'",
].join('; ');

function reply(response, status, text) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(text);
}

async function serve(request, response, server, publicDirectory) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.headers.host !== `127.0.0.1:${server.address().port}`) {
    reply(response, 403, 'Forbidden');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    reply(response, 405, 'Method not allowed');
    return;
  }
  const asset = ASSETS.get(request.url);
  if (!asset) {
    reply(response, 404, 'Not found');
    return;
  }
  let file;
  try {
    file = await open(join(publicDirectory, asset[0]), constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await file.stat()).isFile()) {
      reply(response, 404, 'Not found');
      return;
    }
    const body = await file.readFile();
    response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (response.headersSent) response.destroy();
    else reply(response, ['ENOENT', 'ELOOP'].includes(error.code) ? 404 : 503,
      ['ENOENT', 'ELOOP'].includes(error.code) ? 'Not found' : 'Preview asset unavailable');
  } finally {
    await file?.close();
  }
}

/** Starts a loopback-only server; port 0 is supported for isolated HTTP tests. */
export async function createPreviewServer({ port = 18090, publicDirectory = DEFAULT_PUBLIC } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid preview port');
  const directory = resolve(publicDirectory);
  const server = http.createServer((request, response) => {
    serve(request, response, server, directory).catch(() => response.destroy());
  });
  await new Promise((resolveListening, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolveListening();
    });
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const configuredPort = process.env.WIKI_PREVIEW_PORT;
  const port = configuredPort === undefined ? 18090
    : /^\d+$/.test(configuredPort) ? Number(configuredPort) : Number.NaN;
  createPreviewServer({ port }).then(server => {
    console.log(`Wiki frontend preview: http://127.0.0.1:${server.address().port}/`);
    console.log('Synthetic examples only; no backend or model connection.');
  }).catch(() => {
    console.error('Wiki preview could not start. Check WIKI_PREVIEW_PORT and port availability.');
    process.exitCode = 1;
  });
}
