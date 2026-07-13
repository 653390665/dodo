const { app, BrowserWindow, Menu, ipcMain, dialog, safeStorage, shell } = require('electron');
const {
  getAppOrigin,
  isAppOrigin,
  resolveExternalUrl,
  isTrustedIpcSender,
} = require('./electron-security.cjs');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const {
  createJsonLineChunkParser,
  getDevSpawnCommand,
  getServerRestartDelay,
  getWatchdogRetryDelay,
} = require('./electron-startup-utils.cjs');
const { createCloseHandshake } = require('./electron-close-handshake.cjs');

// Legacy API Key decryption helper
function deriveKey() {
  const seed = `${os.hostname()}:${os.userInfo().username}:inkflow-v1`;
  return crypto.createHash('sha256').update(seed).digest();
}

function decryptApiKey(encoded) {
  if (!encoded) return '';
  if (!encoded.startsWith('enc:')) return encoded;
  const parts = encoded.split(':');
  if (parts.length !== 4) return '';
  const key = deriveKey();
  const iv = Buffer.from(parts[1], 'hex');
  const tag = Buffer.from(parts[2], 'hex');
  const encrypted = Buffer.from(parts[3], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

// Startup migration logic for API Key
function migrateAndGetApiKey() {
  const configDir = path.join(app.getPath('home'), '.inkflow');
  const configPath = path.join(configDir, 'config.json');
  const secureKeyPath = path.join(configDir, 'secure-key.bin');

  let activeApiKey = '';

  // 1. Try to read from config.json first (migration case or fallback dev case)
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (parsed.apiKey) {
        // We found an apiKey in config.json! Try to migrate it
        const decryptedKey = decryptApiKey(parsed.apiKey);
        if (decryptedKey) {
          if (safeStorage.isEncryptionAvailable()) {
            try {
              const encrypted = safeStorage.encryptString(decryptedKey);
              fs.mkdirSync(configDir, { recursive: true });
              fs.writeFileSync(secureKeyPath, encrypted);

              // Clear apiKey from config.json and save it back
              parsed.apiKey = '';
              parsed.hasApiKey = true;
              fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2));
              writeStartupLog('API Key migrated successfully to safeStorage.');
              activeApiKey = decryptedKey;
            } catch (err) {
              writeStartupLog(`密钥迁移失败，仍使用旧配置: ${err.message}`);
              activeApiKey = decryptedKey; // fallback to decrypted legacy key
            }
          } else {
            writeStartupLog('safeStorage encryption not available during migration, using legacy key.');
            activeApiKey = decryptedKey;
          }
        }
      }
    }
  } catch (err) {
    writeStartupLog(`Error parsing config.json during migration: ${err.message}`);
  }

  // 2. If config.json didn't have apiKey, try to read from secure-key.bin
  if (!activeApiKey) {
    try {
      if (fs.existsSync(secureKeyPath)) {
        if (safeStorage.isEncryptionAvailable()) {
          const encryptedData = fs.readFileSync(secureKeyPath);
          activeApiKey = safeStorage.decryptString(encryptedData);
          writeStartupLog('API Key loaded from safeStorage successfully.');
        } else {
          writeStartupLog('safeStorage encryption not available, cannot decrypt secure-key.bin.');
        }
      }
    } catch (err) {
      writeStartupLog(`Error reading secure-key.bin: ${err.message}`);
    }
  }

  return activeApiKey;
}

// Windows GUI has no console; prevent EPIPE from crashing the app
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return;
  throw err;
});
process.stderr.on('error', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') return;
  throw err;
});

let mainWindow = null;
let serverProcess = null;
let serverPort = 3000;
let currentAppOrigin = '';
let watchdogTimer = null;
let isQuitting = false;
let restartAttemptCount = 0;
let closeHandshake = null;
let quitRequested = false;

// ── Startup Diagnostics ──────────────────────────────────────────────

const startupLogPath = path.join(app.getPath('userData'), 'startup.log');

function writeStartupLog(message) {
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {}
}

process.on('uncaughtException', (err) => {
  writeStartupLog(`uncaughtException: ${err.stack || err.message}`);
  dialog.showErrorBox('InkFlow 启动失败', err.stack || err.message);
  app.quit();
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  writeStartupLog(`unhandledRejection: ${message}`);
  dialog.showErrorBox('InkFlow 启动失败', message);
  app.quit();
});

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

function rejectUntrustedIpc(event) {
  if (!isTrustedIpcSender(event, mainWindow, currentAppOrigin)) {
    console.warn('[ipc] Rejected call from untrusted frame:', event.senderFrame?.url);
    return true;
  }
  return false;
}

ipcMain.on('set-title', (event, title) => {
  if (rejectUntrustedIpc(event)) return;
  if (typeof title !== 'string') return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title ? `${title} — InkFlow` : 'InkFlow');
  }
});

ipcMain.on('renderer-ready-to-close', (event) => {
  if (rejectUntrustedIpc(event)) return;
  closeHandshake?.rendererReady();
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
    const isDev = !app.isPackaged;
    const serverPath = isDev
      ? path.join(__dirname, 'server.ts')
      : path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'server.cjs');
    const staticDir = isDev
      ? path.join(__dirname, 'dist')
      : path.join(process.resourcesPath, 'app.asar', 'dist');

    const cmd = isDev ? getDevSpawnCommand(process.platform) : process.execPath;
    const args = isDev
      ? ['tsx', serverPath]
      : [serverPath];

    writeStartupLog(`starting server: cmd=${cmd} script=${serverPath} staticDir=${staticDir}`);

    const serverStderrLines = [];

    const activeApiKey = migrateAndGetApiKey();
    serverProcess = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: isDev ? 'development' : 'production',
        INKFLOW_STATIC_DIR: staticDir,
        INKFLOW_ELECTRON_MODE: 'true',
        INKFLOW_SECURE_API_KEY: activeApiKey,
        ...(isDev ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
      },
    });
    const child = serverProcess;

    let resolved = false;
    let startTimeout = null;
    const handleStdoutChunk = createJsonLineChunkParser(
      (msg) => {
        if (msg.port && !resolved) {
          resolved = true;
          if (startTimeout) {
            clearTimeout(startTimeout);
            startTimeout = null;
          }
          resolve(msg.port);
        }
      },
      (line) => {
        writeStartupLog(`[server stdout] ${line}`);
      },
    );

    serverProcess.stdout.on('data', handleStdoutChunk);

    serverProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      serverStderrLines.push(message);
      if (serverStderrLines.length > 50) serverStderrLines.shift();
      writeStartupLog(`[server stderr] ${message}`);
      console.error('[server]', message);
    });

    serverProcess.on('exit', (code) => {
      writeStartupLog(`server exited: code=${code} resolved=${resolved}`);
      const wasCurrentProcess = serverProcess === child;
      if (wasCurrentProcess) {
        serverProcess = null;
      }
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
      if (!resolved) {
        const stderrTail = serverStderrLines.slice(-5).join('\n');
        const reason = stderrTail || `Exit code ${code}`;
        writeStartupLog(`server start failed: ${reason}`);
        reject(new Error(reason));
      } else if (isQuitting || !wasCurrentProcess) {
        return;
      } else {
        const restartDelay = getServerRestartDelay(restartAttemptCount);
        console.error(`[server] Process exited (code ${code}), restarting in ${restartDelay}ms`);
        setTimeout(() => restartServer(), restartDelay);
      }
    });

    startTimeout = setTimeout(() => {
      if (resolved) return;
      if (serverProcess === child) {
        serverProcess = null;
      }
      try {
        child.kill();
      } catch {}
      reject(new Error('Server start timeout (30s)'));
    }, 30000);
  });
}

function startWatchdog(port) {
  serverPort = port;
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    http.get(`http://localhost:${serverPort}`, (res) => {
      if (res.statusCode >= 500) restartServer();
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
  restartAttemptCount += 1;
  stopWatchdog();
  stopServer();
  try {
    const port = await startServer();
    restartAttemptCount = 0;
    serverPort = port;
    await waitForServer(port);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL(`http://localhost:${port}`);
    }
    startWatchdog(port);
  } catch (err) {
    console.error('[watchdog] Failed to restart server:', err.message);
    if (!isQuitting) {
      const retryDelay = getWatchdogRetryDelay(restartAttemptCount);
      setTimeout(() => restartServer(), retryDelay);
    }
  }
}

// ── Window Creation ──────────────────────────────────────────────────

async function createWindow() {
  buildAppMenu();
  closeHandshake = null;

  let port;
  const isDev = !app.isPackaged;

  try {
    if (isDev) {
      port = 3000;
      await waitForServer(port);
    } else {
      port = await startServer();
      serverPort = port;
      await waitForServer(port);
      startWatchdog(port);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = isDev
      ? 'Dev server not running on port 3000. Run "npm run dev" first.'
      : `InkFlow could not start its local server.\n\n${message}`;
    writeStartupLog(`createWindow failed: ${detail}`);
    console.error(detail);
    dialog.showErrorBox('InkFlow 启动失败', detail);
    app.quit();
    return;
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
  closeHandshake = createCloseHandshake({
    sendPrepare: () => mainWindow?.webContents.send('prepare-close'),
    allowClose: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    },
    logTimeout: () => writeStartupLog('ERROR: Editor flush timed out after 5000ms; allowing window close.'),
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 5000);

  let saveTimer = null;
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWindowState, 500);
  };

  mainWindow.on('close', (event) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState();
    closeHandshake?.requestClose(event);
  });
  mainWindow.on('resize', debouncedSave);
  mainWindow.on('move', debouncedSave);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[window] Failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
  });

  currentAppOrigin = getAppOrigin(port);
  const appOrigin = currentAppOrigin;

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppOrigin(url, appOrigin)) return;
    event.preventDefault();
    const external = resolveExternalUrl(url, appOrigin);
    if (external) shell.openExternal(external);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppOrigin(url, appOrigin)) {
      return { action: 'allow' };
    }
    const external = resolveExternalUrl(url, appOrigin);
    if (external) {
      shell.openExternal(external);
    }
    return { action: 'deny' };
  });

  mainWindow.loadURL(appOrigin);

  if (isDev && !mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (quitRequested) app.quit();
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

app.on('before-quit', (event) => {
  quitRequested = true;
  if (mainWindow && !mainWindow.isDestroyed() && !closeHandshake?.isComplete()) {
    event.preventDefault();
    mainWindow.close();
    return;
  }
  isQuitting = true;
  stopWatchdog();
  stopServer();
});

// ── IPC Handlers ─────────────────────────────────────────────────────

const TOKEN_PATH = path.join(process.env.HOME || require('os').homedir(), '.inkflow', '.auth-token');
function getLocalAuthToken() {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      return fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    }
  } catch {}
  return '';
}

ipcMain.handle('get-auth-token', (event) => {
  if (rejectUntrustedIpc(event)) return '';
  return getLocalAuthToken();
});

ipcMain.handle('save-config', async (event, config) => {
  if (rejectUntrustedIpc(event)) {
    return { success: false, error: 'Untrusted IPC caller' };
  }
  if (!config || typeof config !== 'object') {
    return { success: false, error: 'Invalid config payload' };
  }
  const apiKey = config.apiKey || '';
  let migrationError = null;

  const configDir = path.join(app.getPath('home'), '.inkflow');
  const configPath = path.join(configDir, 'config.json');
  const secureKeyPath = path.join(configDir, 'secure-key.bin');

  const secureKeyExists = fs.existsSync(secureKeyPath);

  // 1. Save apiKey securely if present
  if (apiKey) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(apiKey);
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(secureKeyPath, encrypted);
      } else {
        throw new Error('safeStorage encryption not available');
      }
    } catch (e) {
      migrationError = e.message;
    }
  }

  // 2. Save the rest of the configuration parameters to config.json
  try {
    const keyIsPresent = !!apiKey || secureKeyExists;
    const safeConfig = {
      ...config,
      apiKey: '', // DO NOT write key to config.json
      hasApiKey: keyIsPresent
    };
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2));
  } catch (e) {
    migrationError = migrationError || e.message;
  }

  // 3. Resolve key to sync with backend server
  let keyToSync = apiKey;
  if (!apiKey && secureKeyExists) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encryptedData = fs.readFileSync(secureKeyPath);
        keyToSync = safeStorage.decryptString(encryptedData);
      }
    } catch {}
  }

  // 4. Sync hot configuration state to backend server in memory
  if (serverPort) {
    try {
      await new Promise((resolve, reject) => {
        const token = getLocalAuthToken();
        const req = http.request(
          {
            hostname: 'localhost',
            port: serverPort,
            path: '/api/config/sync',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            timeout: 3000
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              if (res.statusCode === 200) {
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.ok) {
                    resolve({ success: true });
                  } else {
                    reject(new Error(parsed.error || 'Server returned failure'));
                  }
                } catch {
                  resolve({ success: true }); // Fallback if 200 OK but not JSON
                }
              } else {
                reject(new Error(`Server responded with status code ${res.statusCode}`));
              }
            });
          }
        );
        req.on('error', (err) => {
          reject(err);
        });
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timed out'));
        });
        req.write(JSON.stringify({ apiKey: keyToSync }));
        req.end();
      });
    } catch (e) {
      migrationError = migrationError || `同步配置到后端失败: ${e.message}`;
    }
  }

  if (migrationError) {
    return { success: false, error: `密钥保存失败: ${migrationError}` };
  }
  return { success: true };
});
