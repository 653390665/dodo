const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Windows GUI has no console; prevent EPIPE from crashing the app
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  throw err;
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

let mainWindow = null;
let serverProcess = null;
let serverPort = 3000;
let watchdogTimer = null;
let isQuitting = false;

// ── Window State Persistence ────────────────────────────────────────

const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    if (fs.existsSync(windowStatePath)) {
      const data = JSON.parse(fs.readFileSync(windowStatePath, 'utf-8'));
      if (data.x != null && data.y != null && data.width && data.height) {
        return data;
      }
    }
  } catch {}
  return { width: 1280, height: 800 };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(windowStatePath, JSON.stringify({
      x: bounds.x, y: bounds.y,
      width: bounds.width, height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
    }));
  } catch {}
}

// ── App Menu ─────────────────────────────────────────────────────────

const isMac = process.platform === 'darwin';

function buildAppMenu() {
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `关于 ${app.name}` },
        { type: 'separator' },
        { role: 'services', label: '服务' },
        { type: 'separator' },
        { role: 'hide', label: `隐藏 ${app.name}` },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${app.name}` },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
        ...(isMac ? [] : [
          { type: 'separator' },
          { role: 'toggleDevTools', label: '开发者工具' },
        ]),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: `关于 ${app.name}`,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `关于 ${app.name}`,
              message: 'InkFlow — AI 协作小说写作工具',
              detail: `版本 1.0.0\nElectron ${process.versions.electron}\nNode ${process.versions.node}\nChrome ${process.versions.chrome}`,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── IPC ───────────────────────────────────────────────────────────────

ipcMain.on('set-title', (_event, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title ? `${title} — InkFlow` : 'InkFlow');
  }
});

// ── Server Lifecycle ─────────────────────────────────────────────────

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
    const child = serverProcess;

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
      console.error('[server]', data.toString().trim());
    });

    serverProcess.on('exit', (code) => {
      const wasCurrentProcess = serverProcess === child;
      if (wasCurrentProcess) {
        serverProcess = null;
      }
      if (!resolved) {
        reject(new Error(`Server exited with code ${code} before reporting port`));
      } else if (isQuitting || !wasCurrentProcess) {
        return;
      } else {
        console.error(`[server] Process exited (code ${code}), restarting immediately`);
        setImmediate(() => restartServer());
      }
    });

    setTimeout(() => {
      if (!resolved) reject(new Error('Server start timeout (30s)'));
    }, 30000);
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

function stopServer() {
  if (serverProcess) {
    const processToStop = serverProcess;
    serverProcess = null;
    processToStop.kill();
  }
}

async function restartServer() {
  if (isQuitting) return;
  stopWatchdog();
  stopServer();
  try {
    const port = await startServer();
    serverPort = port;
    await waitForServer(port);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://localhost:${port}`);
    }
    startWatchdog(port);
  } catch (err) {
    console.error('[watchdog] Failed to restart server:', err.message);
    if (!isQuitting) {
      setTimeout(() => restartServer(), 5000);
    }
  }
}

// ── Window Creation ──────────────────────────────────────────────────

async function createWindow() {
  buildAppMenu();

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
    serverPort = port;
    await waitForServer(port);
    startWatchdog(port);
  }

  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.cjs'),
    },
    title: 'InkFlow',
    backgroundColor: '#faf9f6',
    show: false,
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', () => { saveWindowState(); });
  mainWindow.on('resize', () => { saveWindowState(); });
  mainWindow.on('move', () => { saveWindowState(); });

  mainWindow.loadURL(`http://localhost:${port}`);

  if (isDev && !mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App Lifecycle ────────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
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
  isQuitting = true;
  stopWatchdog();
  stopServer();
});
