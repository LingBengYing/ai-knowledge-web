import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const version = '6.4.299';
const source = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const target = new URL('../public/vendor/pdfjs/', import.meta.url);
const metadata = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
if (metadata.version !== version) throw new Error('PDF.js version does not match the pinned dependency');
const resources = [
  ['build/pdf.min.mjs', 'pdf.min.mjs', 'text/javascript; charset=utf-8'],
  ['build/pdf.worker.min.mjs', 'pdf.worker.min.mjs', 'text/javascript; charset=utf-8'],
  ['LICENSE', 'LICENSE', 'text/plain; charset=utf-8'],
  ['cmaps/LICENSE', 'cmaps/LICENSE', 'text/plain; charset=utf-8'],
  ['standard_fonts/LICENSE_FOXIT', 'standard_fonts/LICENSE_FOXIT', 'text/plain; charset=utf-8'],
  ['standard_fonts/LICENSE_LIBERATION', 'standard_fonts/LICENSE_LIBERATION', 'text/plain; charset=utf-8'],
];
for (const [directory, extension, contentType] of [['cmaps', '.bcmap', 'application/octet-stream'],
  ['standard_fonts', '.pfb', 'application/octet-stream'], ['standard_fonts', '.ttf', 'font/ttf']]) {
  for (const filename of (await readdir(new URL(`${directory}/`, source))).sort()) {
    if (!filename.endsWith(extension) || !/^[A-Za-z0-9_.-]+$/u.test(filename)) continue;
    resources.push([`${directory}/${filename}`, `${directory}/${filename}`, contentType]);
  }
}
await mkdir(target, { recursive: true });
const assets = [];
for (const [original, filename, contentType] of resources) {
  const output = new URL(filename, target);
  await mkdir(new URL('./', output), { recursive: true });
  await copyFile(new URL(original, source), output);
  // Keep license wording intact; normalize upstream trailing spaces for repository hygiene.
  if (contentType.startsWith('text/plain')) {
    const license = await readFile(output, 'utf8');
    await writeFile(output, license.replace(/[\t ]+$/gm, ''));
  }
  const bytes = await readFile(output);
  assets.push({ path: `/vendor/pdfjs/${filename}`, file: `vendor/pdfjs/${filename}`, content_type: contentType,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(new URL('manifest.json', target), JSON.stringify({ version,
  source: `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-${version}.tgz`, assets }, null, 2) + '\n');
process.stdout.write(`Vendored PDF.js ${version}: ${assets.length} explicit local assets.\n`);
