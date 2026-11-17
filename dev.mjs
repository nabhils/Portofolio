import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const children = [
  spawn(process.execPath, [join(root, 'server.mjs')], { cwd: root, stdio: 'inherit', env: process.env }),
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--strictPort'], { cwd: root, stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 100);
}
for (const child of children) child.on('exit', code => { if (!stopping && code !== 0) stop(code || 1); });
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
