import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const directory of ['public', 'scripts', 'tests', 'ui-tests']) {
  for (const entry of readdirSync(new URL(`../${directory}/`, import.meta.url), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(?:mjs|js)$/.test(entry.name)) continue;
    const path = new URL(`../${directory}/${entry.name}`, import.meta.url);
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(path)], { stdio: 'inherit' });
    if (result.status !== 0 || result.error) process.exit(1);
  }
}
process.stdout.write('JavaScript syntax checks passed.\n');
