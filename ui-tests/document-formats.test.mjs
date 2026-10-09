import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as apiModule from '../public/api.mjs';
import { replacementAccept } from '../public/document-replacements.mjs';
import { DocumentOriginalSession } from '../public/document-originals.mjs';
import { formatLocator } from '../public/wiki-workspace.mjs';

const formats = { pdf: 'application/pdf', properties: 'text/x-java-properties', html: 'text/html', vtt: 'text/vtt', csv: 'text/csv',
  msg: 'application/vnd.ms-outlook', markdown: 'text/markdown', eml: 'message/rfc822', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', txt: 'text/plain',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mdx: 'text/markdown', xls: 'application/vnd.ms-excel',
  odt: 'application/vnd.oasis.opendocument.text', md: 'text/markdown', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml', epub: 'application/epub+zip', htm: 'text/html' };
const config = { capabilities: ['ingestions', 'text_upload', 'document_replacements'] };
test('all 21 requested document formats upload and replace exact original bytes', async () => {
  const calls = [];
  const api = apiModule.createApi(config, () => '', async (path, options) => { calls.push({ path, options }); return new Response('{}'); });
  for (const [extension, type] of Object.entries(formats)) {
    const file = new File(['synthetic original'], `合成.${extension.toUpperCase()}`, { type });
    assert.equal(apiModule.validateUpload(file, config), file, extension);
    assert.equal(apiModule.validateReplacementUpload(file, 'document'), file, extension);
    assert.ok(replacementAccept('document').split(',').includes(`.${extension}`), extension);
    await api(`/v1/documents?filename=${encodeURIComponent(file.name)}`, { method: 'POST', file });
    assert.equal(calls.at(-1).options.body, file);
    assert.equal(calls.at(-1).options.headers['Content-Type'], 'application/octet-stream');
    await api(`/v1/documents/doc/replacement?filename=${encodeURIComponent(file.name)}&base_revision_id=rev`, { method: 'POST', file, replacement: { documentType: 'document', documentId: 'doc', baseRevisionId: 'rev' } });
    assert.equal(calls.at(-1).options.body, file);
  }
  assert.equal(calls.length, 42);
});
test('upload rejection explains format, selected type, capability, empty bytes, name and size separately', () => {
  const sample = name => new File(['x'], name);
  const cases = [[sample('x.zip'), config, 'document', /不支持.*格式/u], [sample('x.docx'), config, 'audio', /上传类型/u],
    [sample('x.docx'), { capabilities: [] }, 'document', /未启用.*上传/u], [new File([], 'x.txt'), config, 'document', /空文件/u],
    [sample('../x.txt'), config, 'document', /文件名/u], [new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'x.docx'), config, 'document', /20MiB/u]];
  for (const [file, capabilities, kind, message] of cases) assert.throws(() => apiModule.validateUpload(file, capabilities, kind), message);
});
test('new document originals retain MIME and SHA while active and binary files use inert download URLs', async () => {
  const bytes = new TextEncoder().encode('<script>untrusted document text</script>');
  const sha = createHash('sha256').update(bytes).digest('hex');
  for (const [extension, type] of Object.entries(formats)) {
    const filename = `synthetic.${extension}`, path = '/v1/documents/doc/revisions/rev/content';
    const metadata = { document_id: 'doc', revision_id: 'rev', filename, document_type: 'document', media_type: type,
      size_bytes: bytes.length, source_sha256: sha, content_url: path };
    const api = apiModule.createApi({}, () => '', async () => new Response(bytes, { headers: { 'Content-Type': type } }));
    assert.equal((await api(path, { binary: true })).type, type);
    let urlBlob;
    const session = new DocumentOriginalSession(async url => url.endsWith('/content') ? new Blob([bytes], { type }) : metadata,
      { objectUrls: { createObjectURL(blob) { urlBlob = blob; return 'blob:safe'; }, revokeObjectURL() {} } });
    await session.open({ document_id: 'doc', active_revision_id: 'rev', filename, document_type: 'document',
      media_info: { mime_type: type, size_bytes: bytes.length, sha256: sha } });
    assert.equal(session.value.phase, 'ready', extension);
    assert.equal(session.value.original.media_type, type);
    const onlyDownload = !['application/pdf', 'text/plain', 'text/markdown'].includes(type);
    assert.equal(session.value.original.downloadOnly, onlyDownload, extension);
    assert.equal(urlBlob.type, onlyDownload ? 'application/octet-stream' : type);
    assert.deepEqual(new Uint8Array(await urlBlob.arrayBuffer()), bytes);
    session.close();
  }
});
test('non-PDF document locators are parsed text positions, not fabricated physical pages', () => {
  assert.match(formatLocator({ page: 1, start: 0, end: 12, media_type: formats.docx, filename: 'sample.docx' }), /解析文本.*0–12/u);
  assert.doesNotMatch(formatLocator({ page: 1, media_type: formats.docx }), /第.*页/u);
  assert.match(formatLocator({ page: 2, media_type: formats.pdf }), /第 2 页/u);
});
