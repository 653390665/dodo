import { spawn } from 'child_process';

// Start the dev server (tsx server.ts)
const serverProc = spawn('npx', ['tsx', 'server.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
  shell: true,
});

// Give the server time to start, then launch Electron
setTimeout(() => {
  const electronProc = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
    shell: true,
  });

  electronProc.on('exit', (code) => {
    serverProc.kill();
    process.exit(code || 0);
  });
}, 4000);
