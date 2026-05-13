import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Disable update notifier — the most common cause of electron-builder hangs
process.env.ELECTRON_BUILDER_NO_UPDATE_NOTIFIER = 'true';
process.env.ELECTRON_BUILDER_UPDATE_NOTIFIER = 'false';
process.env.NO_UPDATE_NOTIFIER = 'true';

const builderBin = resolve(
  root,
  process.platform === 'win32'
    ? 'node_modules/.bin/electron-builder.cmd'
    : 'node_modules/.bin/electron-builder',
);

const PLATFORM_MAP = { darwin: 'mac', win32: 'win', linux: 'linux' };

const args = process.argv.slice(2);
if (args.length === 0) {
  // Default: build for current platform only
  const target = PLATFORM_MAP[process.platform] || process.platform;
  args.push('--' + target);
}

const child = spawn(builderBin, args, {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
  shell: process.platform === 'win32',
});

child.on('close', (code) => {
  process.exit(code);
});
