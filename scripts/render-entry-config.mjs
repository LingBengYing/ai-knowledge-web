import { readConfiguration } from './external-server.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function renderEntryConfiguration(env) {
  const { publicOrigin, port } = readConfiguration(env);
  const url = new URL(publicOrigin);
  const certificate = env.RAG_TLS_CERTIFICATE_PATH;
  const key = env.RAG_TLS_KEY_PATH;
  for (const path of [certificate, key]) {
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9_./-]+$/.test(path) || path.includes('/../')) {
      throw new Error('TLS certificate paths must be explicit absolute paths');
    }
  }
  const externalPort = Number(url.port || 443);
  if (externalPort === port || externalPort === Number(new URL(env.RAG_WEB_BACKEND_ORIGIN ?? 'http://127.0.0.1:18084').port)) {
    throw new Error('External and internal ports must be distinct');
  }
  // Include inside the existing nginx http block; no database or Java location is published.
  return `# Generated external entry; certificate contents are never read by this renderer.
limit_req_zone $binary_remote_addr zone=knowledge_entry_rate:1m rate=10r/s;
server {
    listen ${externalPort} ssl;
    server_name ${url.hostname};
    if ($http_host != "${url.host}") { return 444; }
    ssl_certificate ${certificate};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    access_log off;
    error_log /dev/null crit;
    client_max_body_size 20m;
    client_body_timeout 30s;
    location / {
        limit_req zone=knowledge_entry_rate burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header Origin $http_origin;
        proxy_set_header Connection "";
        proxy_set_header Forwarded "";
        proxy_set_header X-Forwarded-For "";
        proxy_set_header X-Forwarded-Proto "";
        proxy_set_header X-Forwarded-Host "";
        proxy_set_header X-Forwarded-Port "";
        proxy_set_header X-Real-IP "";
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 190s;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_next_upstream off;
        proxy_intercept_errors off;
    }
}
`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(renderEntryConfiguration(process.env)); }
  catch { process.stderr.write('Cannot render entry: check exact HTTPS origin, ports and certificate paths.\n'); process.exitCode = 1; }
}
