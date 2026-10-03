import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEntryConfiguration } from '../scripts/render-entry-config.mjs';
const env = { RAG_PUBLIC_ORIGIN: 'https://knowledge.example.invalid', RAG_TLS_CERTIFICATE_PATH: '/run/tls/certificate.pem', RAG_TLS_KEY_PATH: '/run/tls/key.pem' };

test('external TLS vhost proxies only internal Node, preserves original origin and never retries writes', () => {
  const config = renderEntryConfiguration(env);
  assert.match(config, /listen 443 ssl;/);
  assert.match(config, /proxy_pass http:\/\/127\.0\.0\.1:18085;/);
  assert.match(config, /proxy_set_header Origin \$http_origin;/);
  assert.match(config, /proxy_set_header Host \$http_host;/);
  assert.match(config, /proxy_next_upstream off;/);
  assert.doesNotMatch(config, /18084|Milvus|api-key/);
  assert.match(config, /access_log off;/);
});

test('rendering rejects config injection and collisions without reading certificates or keys', () => {
  for (const path of ['/run/tls/key.pem; injected', 'relative.pem', '/run/../private.pem', '/run/tls/\nkey.pem']) {
    assert.throws(() => renderEntryConfiguration({ ...env, RAG_TLS_KEY_PATH: path }));
  }
  assert.throws(() => renderEntryConfiguration({ ...env, RAG_PUBLIC_ORIGIN: 'https://knowledge.example.invalid:18085' }));
  assert.throws(() => renderEntryConfiguration({ ...env, RAG_PUBLIC_ORIGIN: 'http://knowledge.example.invalid' }));
});
