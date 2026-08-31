/* global queueMicrotask */

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
const { createSingleFlight, probeHttp, terminateChild } = require('./electron-server-restart.cjs');

function getConfigDir() {
  return process.env.INKFLOW_CONFIG_DIR || path.join(app.getPath('home'), '.inkflow');
}

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
  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');
  const secureKeyPath = path.join(configDir, 'secure-key.bin');

  let activeApiKey = '';

  // 1. Try to read from config.json first (migration case or fallback dev case)
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Repair permissions on legacy config files; new writes are 0600.
      try { fs.chmodSync(configPath, 0o600); } catch {}

      if (parsed.apiKey) {
        // We found an apiKey in config.json! Try to migrate it
        const decryptedKey = decryptApiKey(parsed.apiKey);
        if (decryptedKey) {
          if (safeStorage.isEncryptionAvailable()) {
            try {
              const encrypted = safeStorage.encryptString(decryptedKey);
              fs.mkdirSync(configDir, { recursive: true });
              fs.writeFileSync(secureKeyPath, encrypted, { mode: 0o600 });

              // Clear apiKey from config.json and save it back
              parsed.apiKey = '';
              parsed.hasApiKey = true;
              fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), { mode: 0o600 });
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
        // Repair permissions on legacy key files; new writes are 0600.
        try { fs.chmodSync(secureKeyPath, 0o600); } catch {}
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
function getInitialServerPort() {
  const raw = process.env.INKFLOW_PACKAGED_PORT;
  if (!raw) return 3000;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 3000;
}

let serverPort = getInitialServerPort();
let currentAppOrigin = '';
let serverIdentityVerified = false;
let watchdogTimer = null;
let isQuitting = false;
let restartAttemptCount = 0;
let closeHandshake = null;
let quitRequested = false;
let closeRecoveryDialogPromise = null;
let latestCloseBlockedDetails = null;
let createWindowInFlight = false;

// ── Startup Diagnostics ──────────────────────────────────────────────

const startupLogPath = path.join(app.getPath('userData'), 'startup.log');

// The startup log captures raw server stdout/stderr. Redact credential-shaped
// strings (API keys, bearer tokens, JWTs) before they ever touch disk.
const STARTUP_LOG_REDACTION = /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{20,})/g;

function writeStartupLog(message) {
  try {
    const redacted = String(message).replace(STARTUP_LOG_REDACTION, '[redacted]');
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    fs.appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${redacted}\n`);
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
        // DevTools stay out of the packaged app's menu; they remain available
        // in dev builds where detached DevTools open automatically.
        ...(isMac || app.isPackaged ? [] : [
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
              detail: `版本 ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}\nChrome ${process.versions.chrome}`,
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
  if (!serverIdentityVerified) {
    console.warn('[ipc] Rejected call before server identity was verified');
    return true;
  }
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

ipcMain.handle('renderer-ready-to-close', (event, attemptId) => {
  if (rejectUntrustedIpc(event)) return false;
  if (!Number.isSafeInteger(attemptId)) return false;
  return closeHandshake?.rendererReady(attemptId) === true;
});

function normalizeCloseSnapshot(snapshot) {
  try {
    const serialized = JSON.stringify(snapshot);
    if (serialized.length > 10 * 1024 * 1024) return null;
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}

ipcMain.on('renderer-close-snapshot', (event, attemptId, snapshot) => {
  if (rejectUntrustedIpc(event)) return;
  if (!Number.isSafeInteger(attemptId)) return;
  closeHandshake?.rendererSnapshot(attemptId, normalizeCloseSnapshot(snapshot));
});

ipcMain.on('renderer-close-save-failed', (event, attemptId, details) => {
  if (rejectUntrustedIpc(event)) return;
  if (!Number.isSafeInteger(attemptId)) return;
  const reason = typeof details?.reason === 'string'
    ? details.reason.slice(0, 500)
    : 'Editor writes could not be persisted';
  closeHandshake?.rendererFailed(attemptId, reason);
});

ipcMain.on('request-close', (event) => {
  if (rejectUntrustedIpc(event)) return;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

// ── Server Lifecycle ─────────────────────────────────────────────────

// The server persists a 0600 identity token (see server/middleware/auth.ts).
// Probing /api/identity with it proves the responder on the port is the real
// InkFlow server, not an unrelated process that grabbed the port after a crash.
const IDENTITY_TOKEN_PATH = path.join(process.env.HOME || os.homedir(), '.inkflow', '.server-identity');
const IDENTITY_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function readIdentityToken() {
  try {
    if (fs.existsSync(IDENTITY_TOKEN_PATH)) {
      const value = fs.readFileSync(IDENTITY_TOKEN_PATH, 'utf-8').trim();
      if (IDENTITY_TOKEN_PATTERN.test(value)) return value;
    }
  } catch {}
  return '';
}

async function probeServerIdentity(port, timeoutMs = 2500) {
  const token = readIdentityToken();
  if (!token) throw new Error('identity token unavailable');
  const headers = { 'x-inkflow-identity': token };
  const statusCode = await probeHttp(http.get, `http://localhost:${port}/api/identity`, timeoutMs, headers);
  if (statusCode !== 200) {
    throw new Error(`identity probe rejected (status ${statusCode})`);
  }
}

function waitForServer(port, maxRetries = 50) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      probeServerIdentity(port, 1500).then(() => {
        serverIdentityVerified = true;
        resolve();
      }).catch(() => {
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

function startServer(preferredPort) {
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
        ...(preferredPort ? { PORT: String(preferredPort), INKFLOW_FIXED_PORT: 'true' } : {}),
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
    void runWatchdogCheck();
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

async function stopServerAndWait() {
  const processToStop = serverProcess;
  if (!processToStop) return true;
  serverProcess = null;
  const exited = await terminateChild(processToStop);
  if (!exited) {
    serverProcess = processToStop;
    writeStartupLog('ERROR: old server process survived SIGKILL timeout; replacement start aborted.');
    throw new Error('Old server process did not exit; refusing to start a replacement');
  }
  return true;
}

async function performServerRestart() {
  if (isQuitting) return;
  restartAttemptCount += 1;
  stopWatchdog();
  try {
    const previousPort = serverPort;
    await stopServerAndWait();
    if (isQuitting) return;
    // Preserve the renderer origin across watchdog recovery. This keeps the
    // existing page and its in-memory pending-write queue alive; a direct
    // loadURL here could either be blocked by beforeunload or discard edits.
    const port = await startServer(previousPort);
    if (port !== previousPort) {
      throw new Error(`Server restarted on unexpected port ${port}; refusing unsafe renderer reload`);
    }
    restartAttemptCount = 0;
    serverPort = port;
    await waitForServer(port);
    startWatchdog(port);
  } catch (err) {
    console.error('[watchdog] Failed to restart server:', err.message);
    if (!isQuitting) {
      const retryDelay = getWatchdogRetryDelay(restartAttemptCount);
      setTimeout(() => restartServer(), retryDelay);
    }
  }
}

const restartServer = createSingleFlight(performServerRestart);
const runWatchdogCheck = createSingleFlight(async () => {
  try {
    await probeServerIdentity(serverPort, 2500);
  } catch {
    await restartServer();
  }
});

// ── Single-server guarantee for Dock re-activation ───────────────────
// Decides whether the packaged window should reuse the live server child,
// restart an unhealthy one, or start fresh. Single-flight so concurrent
// activate events coalesce into a single backend decision and never spawn
// a second orphaned child. Never nulls/overwrites serverProcess while a
// live child exists; the restart path uses stopServerAndWait which waits
// for exit before reassigning.

async function performEnsurePackagedServer() {
  if (isQuitting) throw new Error('app is quitting');
  const child = serverProcess;
  const childAlive = !!child && child.exitCode === null;
  if (childAlive) {
    // Probe the existing port with the identity challenge. Only the real
    // InkFlow server (holding the identity token) counts as healthy; a
    // squatter answering 2xx on the bare port is treated as dead.
    try {
      await probeServerIdentity(serverPort, 2500);
      serverIdentityVerified = true;
      // Healthy: reuse process, port, origin. Do NOT overwrite serverProcess.
      return serverPort;
    } catch {
      // probe failed -> fall through to restart path
    }
    // Child alive but unhealthy: the single-flight restart handles stop+wait+restart.
    await restartServer();
    return serverPort;
  }
  // No live child: start fresh, preserve last port preference.
  const port = await startServer(serverPort || undefined);
  serverPort = port;
  await waitForServer(port);
  startWatchdog(port);
  return port;
}
const ensurePackagedServerForWindow = createSingleFlight(performEnsurePackagedServer);

async function exportPendingCloseSnapshot(snapshot, reason) {
  if (!snapshot) {
    dialog.showErrorBox('无法导出', '渲染器尚未提供可导出的未保存内容快照。请返回编辑器复制内容或重试保存。');
    return false;
  }
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出未保存内容',
    defaultPath: `inkflow-unsaved-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return false;
  try {
    fs.writeFileSync(result.filePath, JSON.stringify({ ...snapshot, closeReason: reason }, null, 2), 'utf8');
    return true;
  } catch (error) {
    writeStartupLog(`ERROR: Failed to export unsaved editor snapshot: ${error.message}`);
    dialog.showErrorBox('导出失败', '未保存内容无法写入所选文件，请更换位置后重试。');
    return false;
  }
}

function showCloseRecoveryDialog(details) {
  latestCloseBlockedDetails = details;
  if (closeRecoveryDialogPromise) return closeRecoveryDialogPromise;
  const isTimeout = details.reason === 'timeout';
  const reason = isTimeout ? '保存操作等待超过 5 秒。' : details.message;
  writeStartupLog(`ERROR: ${isTimeout ? 'Editor flush timed out after 5000ms' : 'Editor flush failed'}; close remains blocked.`);

  closeRecoveryDialogPromise = (async () => {
    while (closeHandshake?.getState() === 'blocked') {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '内容尚未安全保存',
        message: 'InkFlow 尚未确认最后一次编辑已保存。',
        detail: `${reason}\n\n请选择重试保存、导出未保存内容，或明确放弃并退出。`,
        buttons: ['重试保存', '导出未保存内容', '放弃并退出', '取消退出'],
        defaultId: 0,
        cancelId: 3,
        noLink: true,
      });
      if (result.response === 0) {
        closeHandshake?.retry();
        break;
      }
      if (result.response === 1) {
        await exportPendingCloseSnapshot(details.snapshot, reason);
        continue;
      }
      if (result.response === 2) {
        closeHandshake?.abandon();
        break;
      }
      closeHandshake?.cancel();
      quitRequested = false;
      break;
    }
  })().finally(() => {
    closeRecoveryDialogPromise = null;
    if (closeHandshake?.getState() === 'blocked' && latestCloseBlockedDetails) {
      queueMicrotask(() => { void showCloseRecoveryDialog(latestCloseBlockedDetails); });
    }
  });
  return closeRecoveryDialogPromise;
}

// ── Window Creation ──────────────────────────────────────────────────

async function createWindow() {
  // Concurrent-activate guard: coalesce rapid Dock clicks into one window
  // creation and one backend decision.
  if (createWindowInFlight) return;
  createWindowInFlight = true;

  buildAppMenu();
  closeHandshake = null;

  let port;
  const isDev = !app.isPackaged;

  try {
    if (isDev) {
      port = 3000;
      await waitForServer(port);
    } else {
      // Reuse a live backend or start fresh — never spawns a second child.
      port = await ensurePackagedServerForWindow();
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
  } finally {
    createWindowInFlight = false;
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
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'electron-preload.cjs'),
    },
    title: 'InkFlow',
    backgroundColor: '#faf9f6',
    show: false,
  });
  closeHandshake = createCloseHandshake({
    sendPrepare: (attemptId) => mainWindow?.webContents.send('prepare-close', attemptId),
    allowClose: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    },
    abandonClose: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    },
    onBlocked: (details) => { void showCloseRecoveryDialog(details); },
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

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppOrigin(url, currentAppOrigin)) return;
    event.preventDefault();
    const external = resolveExternalUrl(url, currentAppOrigin);
    if (external) shell.openExternal(external);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppOrigin(url, currentAppOrigin)) {
      return { action: 'allow' };
    }
    const external = resolveExternalUrl(url, currentAppOrigin);
    if (external) {
      shell.openExternal(external);
    }
    return { action: 'deny' };
  });

  mainWindow.loadURL(currentAppOrigin);

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

  const configDir = getConfigDir();
  const configPath = path.join(configDir, 'config.json');
  const secureKeyPath = path.join(configDir, 'secure-key.bin');

  const secureKeyExists = fs.existsSync(secureKeyPath);

  // 1. Save apiKey securely if present
  if (apiKey) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(apiKey);
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(secureKeyPath, encrypted, { mode: 0o600 });
      } else {
        throw new Error('safeStorage encryption not available');
      }
    } catch (e) {
      migrationError = e.message;
    }
  }

  // 2. Save the rest of the configuration parameters to config.json.
  //    Keys are whitelisted to match the server's configSchema; anything else
  //    in the renderer payload is dropped instead of landing on disk.
  try {
    const keyIsPresent = !!apiKey || secureKeyExists;
    const whitelisted = ['baseUrl', 'model', 'promptGuardLevel', 'promptTemplates']
      .filter((key) => config[key] !== undefined)
      .map((key) => [key, config[key]]);
    const safeConfig = {
      ...Object.fromEntries(whitelisted),
      apiKey: '', // DO NOT write key to config.json
      hasApiKey: keyIsPresent
    };
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(safeConfig, null, 2), { mode: 0o600 });
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
