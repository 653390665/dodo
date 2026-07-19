import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

if (process.env.SKIP_ELECTRON_REBUILD === 'true') {
  console.log('SKIP_ELECTRON_REBUILD is active. Skipping reconstruction.');
  process.exit(0);
}

console.log('Starting white-box rebuild of better-sqlite3 for Electron 43.0.0...');

// We target node_modules/better-sqlite3 specifically
const betterSqlite3Dir = resolve(root, 'node_modules', 'better-sqlite3');

const args = [
  'node-gyp',
  'rebuild',
  '--target=43.0.0',
  `--arch=${process.arch}`,
  '--dist-url=https://www.electronjs.org/headers',
  '--runtime=electron',
  '--build-from-source',
  '--verbose'
];

console.log(`Executing: npx ${args.join(' ')} inside ${betterSqlite3Dir}`);

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  cwd: betterSqlite3Dir,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('close', (code) => {
  if (code !== 0) {
    console.error(`White-box rebuild failed with exit code: ${code}`);
    process.exit(code);
  }
  console.log('White-box rebuild of better-sqlite3 completed successfully!');
  process.exit(0);
});
