import { once } from 'node:events';

/** This is the only long-lived public stream; other API routes keep their existing limits. */
export const isAgentEventStream = (method, target) => method === 'GET'
  && /^\/v1\/knowledge-agent\/runs\/[A-Za-z0-9_-]{1,128}\/events$/u.test(target);

export function validAgentEventStream(response) {
  return response.statusCode === 200
    && /^text\/event-stream(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers['content-type'] ?? '')
    && (!response.headers['content-encoding'] || response.headers['content-encoding'] === 'identity');
}

/** Flush each upstream chunk with backpressure; never buffer an entire model response. */
export async function forwardAgentEventStream(response, res, signal) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'private, no-cache, no-store', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  try {
    for await (const chunk of response) {
      if (signal.aborted) throw signal.reason;
      if (!res.write(chunk)) await once(res, 'drain', { signal });
    }
    res.end();
  } catch (error) {
    response.destroy();
    res.destroy();
    throw error;
  }
}
