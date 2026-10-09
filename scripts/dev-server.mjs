#!/usr/bin/env node
/** Local development transport only. Authentication and ACL remain Java-owned. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import pdfBundle from '../public/vendor/pdfjs/manifest.json' with { type: 'json' };
import { WIKI_ASSETS, WIKI_ROUTES, wikiQueryAllowed } from './wiki-transport.mjs';

const DEFAULT_PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const ASSETS = new Map([
  ...WIKI_ASSETS,
  ['/pdf-preview.mjs', ['pdf-preview.mjs', 'text/javascript; charset=utf-8']],
  ...pdfBundle.assets.map(asset => [asset.path, [asset.file, asset.content_type, asset.bytes]]),
  ['/model-rebuild.mjs', ['model-rebuild.mjs', 'text/javascript; charset=utf-8']],
  ['/document-replacements.mjs', ['document-replacements.mjs', 'text/javascript; charset=utf-8']],
  ['/model-configuration.mjs', ['model-configuration.mjs', 'text/javascript; charset=utf-8']],
  ['/retrieval-tests.mjs', ['retrieval-tests.mjs', 'text/javascript; charset=utf-8']],
  ['/retrieval-settings.mjs', ['retrieval-settings.mjs', 'text/javascript; charset=utf-8']],
  ['/product-help.mjs', ['product-help.mjs', 'text/javascript; charset=utf-8']],
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/api.mjs', ['api.mjs', 'text/javascript; charset=utf-8']],
  ['/answers.mjs', ['answers.mjs', 'text/javascript; charset=utf-8']],
  ['/query-attachments.mjs', ['query-attachments.mjs', 'text/javascript; charset=utf-8']],
  ['/voice-question.mjs', ['voice-question.mjs', 'text/javascript; charset=utf-8']],
  ['/file-synopsis.mjs', ['file-synopsis.mjs', 'text/javascript; charset=utf-8']],
  ['/document-cleanup.mjs', ['document-cleanup.mjs', 'text/javascript; charset=utf-8']],
  ['/tag-suggestions.mjs', ['tag-suggestions.mjs', 'text/javascript; charset=utf-8']],
  ['/image-vectors.mjs', ['image-vectors.mjs', 'text/javascript; charset=utf-8']],
  ['/audio-vectors.mjs', ['audio-vectors.mjs', 'text/javascript; charset=utf-8']],
  ['/sound-library.mjs', ['sound-library.mjs', 'text/javascript; charset=utf-8']],
  ['/video-av.mjs', ['video-av.mjs', 'text/javascript; charset=utf-8']],
  ['/media-sources.mjs', ['media-sources.mjs', 'text/javascript; charset=utf-8']],
  ['/document-originals.mjs', ['document-originals.mjs', 'text/javascript; charset=utf-8']],
  ['/preview.mjs', ['preview.mjs', 'text/javascript; charset=utf-8']],
  ['/notices.mjs', ['notices.mjs', 'text/javascript; charset=utf-8']],
  ['/workbench-state.mjs', ['workbench-state.mjs', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);
const ROUTES = [
  ...WIKI_ROUTES,
  [/^\/v1\/model-configuration\/rebuild$/, ['GET', 'POST'], 'model-configuration'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/replacement$/, ['GET', 'POST'], 'replacement'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/replacement\/index$/, ['POST'], 'replacement-index'],
  [/^\/v1\/model-configuration$/, ['GET', 'PUT'], 'model-configuration'],
  [/^\/v1\/model-configuration\/(?:test|activate)$/, ['POST'], 'model-configuration'],
  [/^\/v1\/retrieval-tests$/, ['POST'], 'retrieval'],
  [/^\/v1\/retrieval-settings$/, ['GET', 'PUT'], 'model-configuration'],
  [/^\/v1\/product-help\/search$/, ['POST'], 'retrieval'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/cleanup$/, ['GET', 'POST'], 'cleanup'],
  [/^\/v1\/management\/document-cleanups$/, ['GET', 'POST'], 'cleanup-list'],
  [/^\/v1\/video-av-documents$/, ['POST'], 'video-av-upload'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/video-av-index$/, ['GET', 'POST'], 'video-av-index'],
  [/^\/v1\/video-av-answers$/, ['POST'], 'answer'],
  [/^\/v1\/video-av-query-answers$/, ['POST'], 'attachment'],
  [/^\/v1\/video-av-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])$/, ['GET'], 'source'],
  [/^\/v1\/video-av-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/content$/, ['GET'], 'media'],
  [/^\/v1\/sound-documents$/, ['POST'], 'sound-upload'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/sound-index$/, ['GET', 'POST'], 'sound-index'],
  [/^\/v1\/sound-answers$/, ['POST'], 'answer'],
  [/^\/v1\/sound-query-answers$/, ['POST'], 'attachment'],
  [/^\/v1\/sound-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])$/, ['GET'], 'source'],
  [/^\/v1\/sound-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/content$/, ['GET'], 'media'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/image-vector$/, ['GET', 'POST'], 'image-vector'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/audio-vector$/, ['GET', 'POST'], 'audio-vector'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/tag-suggestions$/, ['GET'], 'source'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/tag-suggestions\/apply$/, ['POST'], 'tag'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/synopsis$/, ['GET', 'POST'], 'synopsis'],
  [/^\/v1\/synopsis-tasks\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'synopsis'],
  [/^\/v1\/synopsis-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/[1-8]$/, ['GET'], 'source'],
  [/^\/v1\/synopsis-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/[1-8]\/content$/, ['GET'], 'media'],
  [/^\/v1\/synopsis-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/[1-8]\/frame$/, ['GET'], 'content'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/original$/, ['GET'], 'source'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/revisions\/[A-Za-z0-9_-]{1,128}\/content$/, ['GET'], 'media'],
  [/^\/v1\/answers$/, ['POST'], 'answer'],
  [/^\/v1\/knowledge-answers$/, ['POST'], 'answer'],
  [/^\/v1\/knowledge-sources\/[A-Za-z0-9_-]{1,128}\/[1-9][0-9]*$/, ['GET'], 'source'],
  [/^\/v1\/attachment-answers$/, ['POST'], 'attachment'],
  [/^\/v1\/voice-questions$/, ['POST'], 'voice'],
  [/^\/v1\/visual-answers$/, ['POST'], 'answer'],
  [/^\/v1\/(?:audio|video)-answers$/, ['POST'], 'answer'],
  [/^\/v1\/(?:audio|video)-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])$/, ['GET'], 'source'],
  [/^\/v1\/(?:audio|video)-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/content$/, ['GET'], 'media'],
  [/^\/v1\/video-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/frame$/, ['GET'], 'content'],
  [/^\/v1\/visual-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])$/, ['GET'], 'source'],
  [/^\/v1\/(?:sources|visual-sources)\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/content$/, ['GET'], 'content'],
  [/^\/v1\/sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])$/, ['GET'], 'source'],
  [/^\/v1\/documents$/, ['POST'], 'upload'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/index$/, ['POST'], 'index'],
  [/^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/reindex$/, ['POST'], 'reindex'],
  [/^\/v1\/indexings\/[A-Za-z0-9_-]{1,128}$/, ['GET'], 'index'],
  [/^\/v1\/indexings\/[A-Za-z0-9_-]{1,128}\/(?:cancel|retry)$/, ['POST'], 'index'],
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
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self' blob:; worker-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; object-src blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
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
  if (req.method === 'POST' && ['/v1/sound-documents', '/v1/video-av-documents'].includes(req.url)) {
    const filename = singleHeader(req, 'x-filename');
    if (filename !== undefined) headers['X-Filename'] = filename;
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

function validateUploadTarget(target, contentType, replacement = false) {
  try {
    decodeURIComponent(target);
    const parameters = new URL(target, 'http://127.0.0.1').searchParams;
    const filename = parameters.get('filename');
    if ([...parameters].length !== (replacement ? 2 : 1) || parameters.getAll('filename').length !== 1
      || (replacement && (parameters.getAll('base_revision_id').length !== 1 || !/^[A-Za-z0-9_-]{1,128}$/u.test(parameters.get('base_revision_id') ?? ''))) || !parameters.has('filename') || !filename || filename.length > 255
      || /[/\\\u0000-\u001f\u007f]/u.test(filename)) throw new Error('invalid upload target');
    const extension = filename.split('.').at(-1).toLowerCase();
    const videoTypes = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };
    if (contentType?.startsWith('video/')) {
      if (videoTypes[extension] !== contentType) throw new Error('invalid video type');
    } else if (!/\.(?:pdf|properties|html?|vtt|csv|msg|markdown|eml|pptx?|docx?|txt|mdx?|xlsx?|odt|xml|epub|png|jpe?g|wav|mp3|flac|ogg|m4a|mp4|webm)$/iu.test(filename)) throw new Error('invalid upload target');
    return /\.(?:png|jpe?g)$/iu.test(filename);
  } catch { throw new TransportError(400, 'invalid_upload_filename'); }
}

function validateSoundFilename(encoded) {
  try {
    if (typeof encoded !== 'string' || !/^[\x21-\x7e]+$/u.test(encoded)) throw new Error('invalid filename');
    const filename = decodeURIComponent(encoded);
    if (!filename.trim() || filename.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(filename)
      || !/\.(?:wav|mp3|flac|ogg|m4a|mp4|webm)$/iu.test(filename)) throw new Error('invalid filename');
  } catch { throw new TransportError(400, 'invalid_upload_filename'); }
}

function validateVideoAvFilename(encoded) {
  try {
    if (typeof encoded !== 'string' || !/^[\x21-\x7e]+$/u.test(encoded)) throw new Error('invalid filename');
    const filename = decodeURIComponent(encoded);
    if (!filename.trim() || filename.length > 255 || /[/\\\u0000-\u001f\u007f]/u.test(filename)
      || !/\.(?:mp4|mov|webm|mkv)$/iu.test(filename)) throw new Error('invalid filename');
  } catch { throw new TransportError(400, 'invalid_upload_filename'); }
}

async function proxy(req, res, backend, headers, limits, signal, kind) {
  if (kind?.startsWith('wiki-') && !wikiQueryAllowed(req.url, req.method)) throw new TransportError(400, 'query_denied');
  if ((kind === 'wiki-draft' && req.method === 'PUT') || (req.url === '/v1/wiki/drafts' && req.method === 'POST')) limits.requestBytes = 512 * 1024;
  if (kind === 'cleanup-list') {
    if (req.method === 'POST' && req.url.includes('?')) throw new TransportError(400, 'query_denied');
    const parameters = new URL(req.url, 'http://127.0.0.1').searchParams;
    for (const [key, value] of parameters) {
      if (!['page', 'page_size'].includes(key) || parameters.getAll(key).length !== 1 || !/^[1-9][0-9]*$/u.test(value)
          || !Number.isSafeInteger(Number(value)) || Number(value) > (key === 'page_size' ? 100 : 2147483647)) throw new TransportError(400, 'query_denied');
    }
  }
  const bodyless = ['wiki-draft', 'wiki-page'].includes(kind) && req.method === 'DELETE' || kind === 'cleanup' || kind === 'empty' || kind === 'index' || kind === 'synopsis' || kind === 'image-vector' || kind === 'audio-vector' || kind === 'sound-index' || kind === 'video-av-index';
  if (['replacement-index', 'model-configuration', 'retrieval', 'cleanup', 'index', 'reindex', 'synopsis', 'answer', 'attachment', 'voice', 'source', 'content', 'media', 'tag', 'image-vector', 'audio-vector', 'sound-index', 'sound-upload', 'video-av-index', 'video-av-upload'].includes(kind) && req.url.includes('?')) throw new TransportError(400, 'query_denied');
  if (kind === 'replacement' && req.method === 'GET' && req.url.includes('?')) throw new TransportError(400, 'query_denied');
  if (['sound-upload', 'video-av-upload'].includes(kind)) {
    if (kind === 'sound-upload') validateSoundFilename(headers['X-Filename']);
    else validateVideoAvFilename(headers['X-Filename']);
    if (headers['content-type']?.toLowerCase() !== 'application/octet-stream') throw new TransportError(415, 'binary_file_required');
  } else if (kind === 'upload' || (kind === 'replacement' && req.method === 'POST')) {
    const type = headers['content-type']?.toLowerCase();
    if (validateUploadTarget(req.url, type, kind === 'replacement')) limits.requestBytes = Math.min(limits.requestBytes, limits.imageUploadBytes);
    if (!['application/octet-stream', 'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'].includes(type)) throw new TransportError(415, 'binary_file_required');
  } else if (!bodyless && !['GET', 'DELETE'].includes(req.method) && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type'] ?? '')) {
    throw new TransportError(415, 'json_required');
  }
  const body = await collect(req, limits.requestBytes, signal, new TransportError(413, 'request_too_large'));
  if ((['upload', 'sound-upload', 'video-av-upload'].includes(kind) || kind === 'replacement' && req.method === 'POST') && !body.length) throw new TransportError(400, 'empty_upload');
  if (bodyless && body.length) throw new TransportError(400, 'request_body_denied');
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
  const originalContent = req.method === 'GET' && /^\/v1\/(?:documents\/[A-Za-z0-9_-]{1,128}\/revisions\/[A-Za-z0-9_-]{1,128}|synopsis-sources\/[A-Za-z0-9_-]{1,128}\/(?:[1-9]|[12][0-9]|3[0-2])\/[1-8]|wiki\/(?:pages\/[A-Za-z0-9_-]{1,128}\/versions\/[1-9][0-9]*|proposals\/[A-Za-z0-9_-]{1,128})\/sources\/[A-Za-z0-9_-]{1,128})\/content$/u.test(req.url);
  if (originalContent && [200, 206].includes(response.statusCode)) {
    if (response.headers['content-disposition'] === 'attachment') output['content-disposition'] = 'attachment';
    if (response.headers['content-security-policy'] === "sandbox; default-src 'none'") output['content-security-policy'] = "sandbox; default-src 'none'";
  }
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
    const assetPath = join(directory, asset[0]);
    if (await realpath(assetPath) !== assetPath) throw new Error('unsafe asset path');
    file = await open(assetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > (asset[2] ?? 1024 * 1024)) throw new Error('unsafe asset');
    const body = await file.readFile();
    res.writeHead(200, { 'Content-Type': asset[1] });
    res.end(head ? undefined : body);
  } catch { throw new TransportError(404, 'asset_not_found'); }
  finally { await file?.close(); }
}

export async function startDevServer({ backendOrigin = 'http://127.0.0.1:18084', port = 18085,
  publicDirectory = DEFAULT_PUBLIC, wikiEntry = false, requestBytes = 128 * 1024, responseBytes = 4 * 1024 * 1024,
  deadlineMs = 10_000, uploadBytes = 20 * 1024 * 1024, uploadDeadlineMs = 30_000,
  attachmentBytes = 28 * 1024 * 1024, voiceBytes = 28 * 1024 * 1024, voiceDeadlineMs = 180_000, imageVectorDeadlineMs = 180_000, audioVectorDeadlineMs = 180_000,
  modelTestDeadlineMs = 70_000, retrievalDeadlineMs = 180_000, answerDeadlineMs = 180_000, imageUploadBytes = 10 * 1024 * 1024, contentBytes = 10 * 1024 * 1024, mediaBytes = 20 * 1024 * 1024 } = {}) {
  const backend = backendAddress(backendOrigin);
  if (!Number.isInteger(port) || port < 0 || port === 80 || port > 65535) throw new TransportError(500, 'invalid_port');
  for (const [value, max] of [[requestBytes, 128 * 1024], [responseBytes, 4 * 1024 * 1024], [deadlineMs, 10_000],
    [uploadBytes, 20 * 1024 * 1024], [uploadDeadlineMs, 30_000], [answerDeadlineMs, 180_000], [modelTestDeadlineMs, 70_000], [retrievalDeadlineMs, 180_000], [attachmentBytes, 28 * 1024 * 1024], [voiceBytes, 28 * 1024 * 1024], [voiceDeadlineMs, 180_000], [imageVectorDeadlineMs, 180_000], [audioVectorDeadlineMs, 180_000],
    [imageUploadBytes, 10 * 1024 * 1024], [contentBytes, 10 * 1024 * 1024], [mediaBytes, 20 * 1024 * 1024]]) {
    if (!Number.isInteger(value) || value < 1 || value > max) throw new TransportError(500, 'invalid_limit');
  }
  let activeUploads = 0;
  let activeReplacementIndexes = 0;
  let activeAttachments = 0;
  let activeVoices = 0;
  const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 30_000, headersTimeout: 10_000 }, async (req, res) => {
    const requestId = randomUUID();
    for (const [name, value] of Object.entries(SAFE_HEADERS)) res.setHeader(name, value);
    res.setHeader('X-Request-Id', requestId);
    const controller = new AbortController();
    req.on('error', () => controller.abort());
    const replacementUpload = req.method === 'POST' && /^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/replacement$/.test(req.url.split('?')[0]);
    const replacementIndex = req.method === 'POST' && /^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/replacement\/index$/.test(req.url);
    const upload = replacementUpload || req.method === 'POST' && ['/v1/documents', '/v1/sound-documents', '/v1/video-av-documents'].includes(req.url.split('?')[0]);
    const answer = req.method === 'POST' && ['/v1/wiki/proposals', '/v1/knowledge-answers', '/v1/answers', '/v1/attachment-answers', '/v1/visual-answers', '/v1/audio-answers', '/v1/video-answers', '/v1/sound-answers', '/v1/sound-query-answers', '/v1/video-av-answers', '/v1/video-av-query-answers'].includes(req.url);
    const voice = req.method === 'POST' && req.url === '/v1/voice-questions';
    const imageVector = req.method === 'POST' && /^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/image-vector$/.test(req.url);
    const audioVector = req.method === 'POST' && /^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/audio-vector$/.test(req.url);
    const soundIndex = req.method === 'POST' && /^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/sound-index$/.test(req.url);
    const videoAvIndex = req.method === 'POST' && /^\/v1\/documents\/[A-Za-z0-9_-]{1,128}\/video-av-index$/.test(req.url);
    const modelTest = req.method === 'POST' && req.url === '/v1/model-configuration/test';
    const retrieval = req.method === 'POST' && ['/v1/retrieval-tests', '/v1/product-help/search'].includes(req.url);
    const timer = setTimeout(() => controller.abort(), modelTest ? modelTestDeadlineMs : retrieval ? retrievalDeadlineMs : upload ? uploadDeadlineMs : voice ? voiceDeadlineMs : imageVector ? imageVectorDeadlineMs : audioVector ? audioVectorDeadlineMs : (answer || soundIndex || videoAvIndex || replacementIndex) ? answerDeadlineMs : deadlineMs);
    let reservedUpload = false;
    let reservedReplacementIndex = false;
    let reservedAttachment = false;
    let reservedVoice = false;
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const origin = validateBrowserBoundary(req, server.address().port);
      const path = req.url.split('?')[0];
      if (!req.url.startsWith('/') || /[\\#\x00-\x20]/.test(req.url)) throw new TransportError(404, 'route_not_found');
      const asset = ASSETS.get(wikiEntry && path === '/' ? '/wiki/' : path);
      if (asset) {
        if (WIKI_ASSETS.some(([assetPath]) => assetPath === path) && req.url.includes('?')) throw new TransportError(400, 'query_denied');
        if ((path === '/pdf-preview.mjs' || path.startsWith('/vendor/pdfjs/')) && req.url.includes('?')) throw new TransportError(400, 'query_denied');
        if (['/model-rebuild.mjs', '/document-replacements.mjs', '/model-configuration.mjs', '/retrieval-tests.mjs', '/retrieval-settings.mjs', '/product-help.mjs', '/query-attachments.mjs', '/voice-question.mjs', '/file-synopsis.mjs', '/tag-suggestions.mjs', '/image-vectors.mjs', '/audio-vectors.mjs', '/sound-library.mjs', '/video-av.mjs'].includes(path) && req.url.includes('?')) throw new TransportError(400, 'query_denied');
        if (!['GET', 'HEAD'].includes(req.method)) throw new TransportError(405, 'method_not_allowed');
        await serveAsset(res, asset, publicDirectory, req.method === 'HEAD');
      } else {
        const route = ROUTES.find(([pattern]) => pattern.test(path));
        if (!route) throw new TransportError(404, 'route_not_found');
        if (!route[1].includes(req.method)) throw new TransportError(405, 'method_not_allowed');
        const headers = forwardedHeaders(req, backend, origin, requestId);
        if (['upload', 'sound-upload', 'video-av-upload'].includes(route[2]) || replacementUpload) {
          if (activeUploads >= 2) throw new TransportError(429, 'upload_capacity_reached');
          activeUploads += 1;
          reservedUpload = true;
        }
        if (route[2] === 'replacement-index') {
          if (activeReplacementIndexes >= 2) throw new TransportError(429, 'replacement_index_capacity_reached');
          activeReplacementIndexes += 1; reservedReplacementIndex = true;
        }
        if (route[2] === 'attachment') {
          if (activeAttachments >= 2) throw new TransportError(429, 'attachment_capacity_reached');
          activeAttachments += 1;
          reservedAttachment = true;
        }
        if (route[2] === 'voice') {
          if (activeVoices >= 2) throw new TransportError(429, 'voice_capacity_reached');
          activeVoices += 1; reservedVoice = true;
        }
        await proxy(req, res, backend, headers, { requestBytes: (['upload', 'sound-upload', 'video-av-upload'].includes(route[2]) || replacementUpload) ? uploadBytes : route[2] === 'attachment' ? attachmentBytes : route[2] === 'voice' ? voiceBytes : requestBytes,
          imageUploadBytes, responseBytes: route[2] === 'media' ? mediaBytes : route[2] === 'content' ? contentBytes : responseBytes }, controller.signal, route[2]);
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
    } finally { clearTimeout(timer); if (reservedUpload) activeUploads -= 1; if (reservedReplacementIndex) activeReplacementIndexes -= 1; if (reservedAttachment) activeAttachments -= 1; if (reservedVoice) activeVoices -= 1; }
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
