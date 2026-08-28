import { spawn, execSync } from 'child_process';

// Ensure dist-electron/main.cjs and preload exist
try {
  console.log('Bootstrapping Electron main process compile...');
  execSync('node scripts/build-electron.mjs', { stdio: 'inherit' });
} catch (e) {
  console.error('Bootstrap compile failed:', e);
}

// Start the dev server using Electron runtime to match C++ module ABI version (NODE_MODULE_VERSION 148)
const serverProc = spawn('npx', ['electron', '--import', 'tsx', 'server.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    INKFLOW_ELECTRON_MODE: 'true',
    ELECTRON_RUN_AS_NODE: '1',
  },
  shell: true,
});

// Give the server time to start, then launch Electron
setTimeout(() => {
  const clientEnv = { ...process.env, NODE_ENV: 'development' };
  delete clientEnv.ELECTRON_RUN_AS_NODE; // Critical defense: ensure client app doesn't run as CLI node

  const electronProc = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    env: clientEnv,
    shell: true,
  });

  electronProc.on('exit', (code) => {
    serverProc.kill();
    process.exit(code || 0);
  });
}, 4000);
