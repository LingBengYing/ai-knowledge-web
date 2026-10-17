import http from 'node:http';

/**
 * Upload admission and streaming shared by the development and external entries. The production
 * external-server.mjs is customized separately and must mirror this module (see docs/BATCH_IMPORT.md).
 */
export const UPLOAD_PER_CLIENT = 4;
export const UPLOAD_GLOBAL = 8;

/**
 * Concurrent uploads per client (one signed-in principal) and in total. Replaces the single global
 * limit of two, so one browser's four batch transfers fit while two clients still cannot exhaust
 * the entry.
 */
export function createUploadAdmission({ perClient = UPLOAD_PER_CLIENT, global = UPLOAD_GLOBAL } = {}) {
  if (!Number.isInteger(perClient) || !Number.isInteger(global) || perClient < 1 || global < perClient || global > 64) throw new TypeError('Invalid upload admission');
  const clients = new Map(); let total = 0;
  return {
    /** A release function, or null when the client or the entry is at capacity. */
    enter(client) {
      const key = String(client ?? '');
      const current = clients.get(key) ?? 0;
      if (total >= global || current >= perClient) return null;
      clients.set(key, current + 1); total += 1;
      let released = false;
      return () => {
        if (released) return; released = true; total -= 1;
        const left = clients.get(key) - 1;
        if (left > 0) clients.set(key, left); else clients.delete(key);
      };
    },
    get active() { return total; },
  };
}

/** The declared body length, or null for a body without Content-Length (chunked). */
export function declaredLength(req, Failure) {
  const value = req.headers['content-length'];
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/u.test(value)) throw new Failure(400, 'invalid_content_length');
  return Number(value);
}

/**
 * Forwards an upload with a declared length as a stream: the size cap and the empty-body check are
 * decided from Content-Length before any byte reaches the backend, and the body then flows through
 * with backpressure, so the entry never holds a whole file. Node's parser delivers exactly the
 * declared bytes; a client that stops early aborts the upstream request. Returns the backend
 * response, or null when the body has no declared length (the caller then buffers it with its cap).
 * `Failure` is the entry's own TransportError class.
 */
export function streamUpload({ req, backend, headers, limit, signal, Failure, request = http.request }) {
  const length = declaredLength(req, Failure);
  if (length === null) return null;
  if (length > limit) throw new Failure(413, 'request_too_large');
  if (length === 0) throw new Failure(400, 'empty_upload');
  headers['Content-Length'] = String(length);
  delete headers['Transfer-Encoding']; delete headers['transfer-encoding'];
  return new Promise((resolveResponse, rejectResponse) => {
    let settled = false, sent = 0;
    // A broken body always tears the upstream request down, even after the backend answered early.
    const fail = error => { req.unpipe(upstream); upstream.destroy(); if (!settled) { settled = true; rejectResponse(error); } };
    const upstream = request(backend, { method: req.method, path: req.url, headers, signal }, response => {
      if (settled) { response.destroy(); return; }
      settled = true; resolveResponse(response);
    });
    upstream.once('error', () => fail(new Failure(signal.aborted ? 504 : 502, signal.aborted ? 'request_deadline' : 'backend_unavailable')));
    req.on('data', chunk => { sent += chunk.length; if (sent > length) fail(new Failure(400, 'invalid_content_length')); });
    req.once('aborted', () => fail(new Failure(502, 'connection_failed')));
    req.once('error', () => fail(new Failure(502, 'connection_failed')));
    req.once('end', () => { if (sent !== length) fail(new Failure(502, 'connection_failed')); });
    req.pipe(upstream);
  });
}
