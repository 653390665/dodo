# InkFlow Electron Desktop App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 InkFlow 封装为独立 Electron 桌面应用，生成 macOS .dmg 和 Windows .exe 安装包

**Architecture:** Electron 主进程 spawn Express server 子进程（编译后的 CJS），BrowserWindow 加载前端。server 通过 stdout JSON 行报告端口号，主进程端口就绪后再加载页面。

**Tech Stack:** Electron 33 + electron-builder 25 + esbuild + Vite + better-sqlite3（子进程隔离）

**Design Spec:** docs/superpowers/specs/2026-05-07-inkflow-electron-desktop.md

---

### Task 1: 依赖修复与安装

**Files:**
- Modify: `package.json`
- Delete: `package-lock.json`
- Modify: `node_modules/` (via npm install)

**前提假设：** 当前 `@langchain/langgraph` 和 `@langchain/google-genai` import 卡死，根因是 package-lock.json 中传递依赖版本冲突。全新 npm install 可修复。

- [ ] **Step 1: 修改 package.json，移除僵尸依赖，新增 Electron 依赖**

```json
{
  "name": "inkflow",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "main": "dist-electron/main.cjs",
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist dist-electron release",
    "lint": "tsc --noEmit",
    "build:electron": "npm run build && node scripts/build-server.mjs && node scripts/build-electron.mjs",
    "package": "npm run build:electron && electron-builder",
    "electron:dev": "node scripts/dev-electron.mjs"
  },
  "dependencies": {
    "@google/genai": "^1.29.0",
    "@langchain/core": "^1.1.44",
    "@langchain/google-genai": "^2.1.30",
    "@langchain/langgraph": "^1.2.9",
    "@tailwindcss/vite": "^4.1.14",
    "@vitejs/plugin-react": "^5.0.4",
    "better-sqlite3": "^12.9.0",
    "clsx": "^2.1.1",
    "dotenv": "^17.2.3",
    "express": "^4.21.2",
    "jszip": "^3.10.1",
    "lucide-react": "^0.546.0",
    "mammoth": "^1.12.0",
    "motion": "^12.23.24",
    "react": "^19.0.1",
    "react-dom": "^19.0.1",
    "react-markdown": "^10.1.0",
    "tailwind-merge": "^3.5.0",
    "vite": "^6.2.3"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/express": "^4.17.21",
    "@types/node": "^22.14.0",
    "autoprefixer": "^10.4.21",
    "electron": "^33.4.0",
    "electron-builder": "^25.1.8",
    "esbuild": "^0.25.0",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.21.0",
    "typescript": "~5.8.2",
    "vite": "^6.2.3"
  },
  "build": {
    "appId": "com.inkflow.app",
    "productName": "InkFlow",
    "directories": {
      "output": "release",
      "buildResources": "build"
    },
    "files": [
      "dist-electron/**/*",
      "dist/**/*",
      "node_modules/better-sqlite3/**/*",
      "node_modules/mammoth/**/*",
      "node_modules/bindings/**/*",
      "node_modules/file-uri-to-path/**/*",
      "node_modules/prebuild-install/**/*",
      "node_modules/tar-fs/**/*",
      "node_modules/tunnel-agent/**/*",
      "node_modules/simple-get/**/*",
      "node_modules/napi-build-utils/**/*",
      "node_modules/node-abi/**/*",
      "node_modules/detect-libc/**/*",
      "node_modules/expand-template/**/*",
      "node_modules/github-from-package/**/*",
      "node_modules/minimist/**/*",
      "node_modules/mkdirp-classic/**/*",
      "node_modules/npmlog/**/*",
      "node_modules/pump/**/*",
      "node_modules/rc/**/*",
      "node_modules/simple-concat/**/*",
      "node_modules/tar-stream/**/*",
      "node_modules/are-we-there-yet/**/*",
      "node_modules/deep-extend/**/*",
      "node_modules/ini/**/*",
      "node_modules/strip-json-comments/**/*"
    ],
    "mac": {
      "target": "dmg",
      "category": "public.app-category.productivity"
    },
    "win": {
      "target": "nsis"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    },
    "asarUnpack": [
      "node_modules/better-sqlite3/**/*"
    ]
  }
}
```

关键变更：
- `"main"` 从 `electron.cjs` 改为 `dist-electron/main.cjs`（编译产物）
- `"firebase"` 移除
- `"electron"`, `"electron-builder"`, `"esbuild"` 新增
- `"build"` 字段内联 electron-builder 配置
- scripts 新增 `build:electron`, `package`, `electron:dev`
- `asarUnpack` 确保 better-sqlite3 原生 .node 文件不被压缩

- [ ] **Step 2: 删除 package-lock.json，全新安装**

```bash
rm -f package-lock.json && rm -rf node_modules && npm install
```

- [ ] **Step 3: 验证 LangChain import 不再卡死**

```bash
npx tsx -e "import '@langchain/langgraph'; console.log('OK')"
npx tsx -e "import '@langchain/google-genai'; console.log('OK')"
```

预期：两行都输出 OK，不再卡死。

- [ ] **Step 4: 验证 dev server 正常启动**

```bash
npm run dev
```

预期：`Server running on http://localhost:3000`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: fix dependencies, add electron/electron-builder/esbuild"
```

---

### Task 2: 重写 Electron 主进程

**Files:**
- Modify: `electron.cjs`

**当前问题：** 现有 electron.cjs 生产模式也加载 localhost:3000，不会 spawn server，不可分发。

- [ ] **Step 1: 重写 electron.cjs**

```javascript
const { app, BrowserWindow, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

let mainWindow;
let serverProcess;

function waitForServer(port, maxRetries = 50) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      http.get(`http://localhost:${port}`, (res) => {
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
      ? path.join(__dirname, 'server.ts')  // dev 模式用 tsx 直接跑
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
      }
    });

    // Timeout after 30s
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
  } else {
    port = await startServer();
    await waitForServer(port);
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
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
```

关键变更：
- `contextIsolation: true`, `nodeIntegration: false`（安全最佳实践，前端通过 HTTP 与 server 通信，不需要 Node 权限）
- 生产模式 spawn server.cjs 子进程，从 stdout 读取端口号
- `waitForServer()` 轮询直到 HTTP 200
- `show: false` + `ready-to-show` 避免白屏闪烁
- macOS dock 激活时重建窗口
- `before-quit` + `window-all-closed` 双保险 kill server

- [ ] **Step 2: 修改 server.ts，注入端口通知**

在 `server.ts` 的 `app.listen` 回调中加一行：

```typescript
// Replace line 722-724:
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Electron main process reads this to know when to load the window
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify({ port: PORT }));
  }
});
```

- [ ] **Step 3: 测试开发模式启动**

```bash
npm run electron:dev
```

- [ ] **Step 4: Commit**

```bash
git add electron.cjs server.ts
git commit -m "feat: rewrite electron main process with server spawn and port detection"
```

---

### Task 3: 创建构建脚本

**Files:**
- Create: `scripts/build-server.mjs`
- Create: `scripts/build-electron.mjs`
- Create: `scripts/dev-electron.mjs`

- [ ] **Step 1: 创建 server 编译脚本 `scripts/build-server.mjs`**

```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-electron/server.cjs',
  external: [
    'better-sqlite3',
    'mammoth',
    'electron',
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  minify: false,
  sourcemap: false,
});

console.log('server.cjs built');
```

- [ ] **Step 2: 创建 Electron 主进程编译脚本 `scripts/build-electron.mjs`**

```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['electron.cjs'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist-electron/main.cjs',
  external: [
    'electron',
    'better-sqlite3',
    'mammoth',
    'child_process',
    'path',
    'http',
  ],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  minify: false,
  sourcemap: false,
});

console.log('main.cjs built');
```

- [ ] **Step 3: 创建开发模式启动脚本 `scripts/dev-electron.mjs`**

```javascript
import { spawn } from 'child_process';

// Start Vite dev server
const viteProc = spawn('npx', ['tsx', 'server.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'development' },
});

// Wait for server to be ready, then start Electron
setTimeout(() => {
  const electronProc = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });

  electronProc.on('exit', () => {
    viteProc.kill();
    process.exit();
  });
}, 3000);
```

- [ ] **Step 4: 创建 build 输出目录**

```bash
mkdir -p dist-electron
```

- [ ] **Step 5: 测试构建**

```bash
npm run build && node scripts/build-server.mjs && node scripts/build-electron.mjs
ls -la dist-electron/
```

预期：`dist-electron/` 下有 `server.cjs` 和 `main.cjs`

- [ ] **Step 6: Commit**

```bash
git add scripts/ dist-electron/.gitkeep
git commit -m "feat: add esbuild scripts for server and electron main process"
```

---

### Task 4: 前端适配 Electron

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/components/SettingsModal.tsx`（如有 API 配置路径问题）
- Create: `build/` 目录和占位图标

- [ ] **Step 1: 修改 vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',  // Relative paths for Electron file:// protocol
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

- [ ] **Step 2: 创建占位图标目录**

```bash
mkdir -p build
```

创建 `build/icon.png`（1024x1024 占位，后期替换为正式图标）

- [ ] **Step 3: 更新 .gitignore**

确保 `dist-electron/`、`release/`、`dist/` 在 .gitignore 中（dist-electron 包含编译产物不应入库）

- [ ] **Step 4: 验证前端构建**

```bash
npm run build
ls dist/index.html && echo "Build OK"
```

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts build/ .gitignore
git commit -m "feat: adapt vite config for Electron (base: './')"
```

---

### Task 5: 端到端构建验证

**Files:** 无新增，验证构建管线

- [ ] **Step 1: 完整构建**

```bash
npm run build:electron
```

预期：
- `dist/` 下有 Vite 构建的 index.html 和 JS/CSS
- `dist-electron/` 下有 server.cjs 和 main.cjs

- [ ] **Step 2: 验证 server.cjs 可独立运行**

```bash
node dist-electron/server.cjs &
sleep 3
curl -s http://localhost:3000/api/db -X POST \
  -H 'Content-Type: application/json' \
  -d '{"method":"listNovels","args":[]}'
kill %1 2>/dev/null
```

预期：返回 JSON（可能是空数组 `{"result":[]}`）

- [ ] **Step 3: TypeScript 检查**

```bash
npx tsc --noEmit
```

预期：零错误

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: end-to-end build verification"
```

---

### Task 6: 打包验证

**Files:** 无新增

- [ ] **Step 1: 运行 electron-builder 打包**

```bash
npm run package
```

macOS 预期输出：`release/InkFlow-1.0.0.dmg`
Windows 预期输出：`release/InkFlow Setup 1.0.0.exe`

- [ ] **Step 2: 安装测试（macOS）**

打开 `release/InkFlow-1.0.0.dmg`，拖入 Applications，启动。验证：
- 应用窗口正常显示
- 灵感碎片板 / 伏笔系统 / 节奏诊断 三个标签可切换
- 导出功能正常
- 关闭窗口后进程退出

- [ ] **Step 3: Commit release notes**

```bash
git add -A
git commit -m "docs: add release notes for Electron desktop packaging"
```
