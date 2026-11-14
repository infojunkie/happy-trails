import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'public', 'client');
const noticesPath = path.join(root, 'public', 'third-party-notices.txt');
const watch = process.argv.includes('--watch');

/**
 * Third-party license notices are generated from installed packages so the
 * deployed assets always carry the notices required by their licenses.
 */
async function writeNotices() {
  const packages = [
    ['@northstarxyzz/coverflow', ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']],
    // Leaflet notices will be added here when the map view lands.
  ];
  const sections = [];
  for (const [name, files] of packages) {
    const dir = path.join(root, 'node_modules', ...name.split('/'));
    for (const file of files) {
      try {
        const text = await fs.readFile(path.join(dir, file), 'utf8');
        sections.push(`===== ${name} / ${file} =====\n\n${text.trim()}\n`);
      } catch {
        // Not every package ships every optional notice file.
      }
    }
  }
  if (sections.length > 0) {
    await fs.writeFile(noticesPath, `${sections.join('\n')}\n`, 'utf8');
  }
}

const options = {
  entryPoints: [path.join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir,
  entryNames: '[name]',
  chunkNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
  splitting: true,
  sourcemap: watch ? 'linked' : false,
  minify: !watch,
  charset: 'utf8',
  loader: {
    '.png': 'file',
    '.jpg': 'file',
    '.jpeg': 'file',
    '.gif': 'file',
    '.svg': 'file',
    '.webp': 'file',
    '.woff': 'file',
    '.woff2': 'file',
  },
  legalComments: 'eof',
  banner: {
    js: '/*! Happy Trails client bundle. Third-party notices: /third-party-notices.txt */',
  },
  logLevel: 'info',
};

await fs.rm(outdir, { recursive: true, force: true });
await fs.mkdir(outdir, { recursive: true });
await writeNotices();

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('[client] watching src/client/main.ts');
} else {
  await esbuild.build(options);
}
