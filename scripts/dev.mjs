import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => path.join(root, 'node_modules', '.bin', name);
const children = [];
let stopping = false;

function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    // Each child runs in its own process group, so this also stops
    // grandchildren such as the tsx worker and tsc watcher.
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopChild(child);
  setTimeout(() => process.exit(code), 250).unref();
}

function run(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (!stopping && code !== 0 && signal === null) {
      console.error(`[dev] ${path.basename(command)} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });
  child.on('error', (error) => {
    console.error(`[dev] could not start ${path.basename(command)}:`, error.message);
    shutdown(1);
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run(bin('tsc'), ['-p', 'tsconfig.client.json', '--watch', '--preserveWatchOutput']);
run(bin('tsx'), ['watch', 'src/server/index.ts']);
