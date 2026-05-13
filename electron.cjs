const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow;
let serverProcess;
let serverPort = 3000;
let watchdogTimer = null;

function waitForServer(port, maxRetries = 50) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      http.get(`http://localhost:${port}`, () => {
        resolve();
      }).on('error', () => {
        retries++;
        if (retries >= maxRetries) {
          reject(new Error(`Server not ready on port ${port} after ${maxRetries} retries`));
        } else {
          setTimeout(check, 200);
        }
      });
    };
    check();
  });
}

function startWatchdog(port) {
  serverPort = port;
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    http.get(`http://localhost:${serverPort}/api/config`, (res) => {
      if (res.statusCode !== 200) restartServer();
    }).on('error', () => {
      restartServer();
    });
  }, 10_000);
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

async function restartServer() {
  stopWatchdog();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  try {
    const port = await startServer();
    serverPort = port;
    await waitForServer(port);
    if (mainWindow) {
      mainWindow.loadURL(`http://localhost:${port}`);
    }
    startWatchdog(port);
    console.log('[watchdog] Server restarted on port', port);
  } catch (err) {
    console.error('[watchdog] Failed to restart server:', err.message);
    // Retry after 5s
    setTimeout(() => restartServer(), 5000);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const isDev = process.env.NODE_ENV === 'development';
    const serverPath = isDev
      ? path.join(__dirname, 'server.ts')
      : path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'server.cjs');

    const cmd = isDev ? 'npx' : process.execPath;
    const args = isDev
      ? ['tsx', serverPath]
      : [serverPath];

    serverProcess = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: isDev ? 'development' : 'production' },
    });

    let resolved = false;

    serverProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.port && !resolved) {
            resolved = true;
            resolve(msg.port);
          }
        } catch {}
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[server]', data.toString());
    });

    serverProcess.on('exit', (code) => {
      if (!resolved) {
        reject(new Error(`Server exited with code ${code} before reporting port`));
      } else {
        console.error(`[server] Process exited with code ${code} (will be restarted by watchdog)`);
      }
    });

    setTimeout(() => {
      if (!resolved) reject(new Error('Server start timeout'));
    }, 30000);
  });
}

async function createWindow() {
  Menu.setApplicationMenu(null);

  let port;
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    port = 3000;
    try {
      await waitForServer(port);
    } catch {
      console.error('Dev server not running on port 3000. Run "npm run dev" first.');
      app.quit();
      return;
    }
  } else {
    port = await startServer();
    await waitForServer(port);
    startWatchdog(port);
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'InkFlow',
    backgroundColor: '#faf9f6',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  stopWatchdog();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
