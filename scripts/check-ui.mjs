/** Fail on any frontend syntax error; unlike find -exec, propagate the check's status. */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../public/assets/js/', import.meta.url));
let count = 0;
for (const entry of readdirSync(root, { recursive: true })) {
  if (!entry.endsWith('.js')) continue;
  const result = spawnSync(process.execPath, ['--check', path.join(root, entry)], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
  count++;
}
console.log(`Checked ${count} frontend modules`);
