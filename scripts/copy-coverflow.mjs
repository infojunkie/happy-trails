import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = path.join(
  root,
  'node_modules',
  '@northstarxyzz',
  'coverflow',
);
const target = path.join(root, 'public', 'vendor', 'coverflow');

const dist = path.join(packageDir, 'dist');
try {
  await fs.access(path.join(dist, 'index.js'));
} catch {
  throw new Error(
    'Cover Flow is not built. Run "npm install" (allow-git=all is set in .npmrc).',
  );
}

await fs.rm(target, { recursive: true, force: true });
await fs.mkdir(target, { recursive: true });
await fs.cp(dist, target, { recursive: true });

// The MIT license and upstream notices must ship with the copied code.
for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
  await fs.copyFile(path.join(packageDir, name), path.join(target, name));
}

console.log(`[vendor] copied Cover Flow to ${path.relative(root, target)}`);
