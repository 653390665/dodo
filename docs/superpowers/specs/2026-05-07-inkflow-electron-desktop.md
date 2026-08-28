# InkFlow Electron Desktop App — Design Spec

> **Goal:** 将 InkFlow React+Express 网页应用封装为独立 Electron 桌面应用，生成 macOS .dmg 和 Windows .exe 安装包，可分发给他人使用。

**Architecture:** Electron 主进程 spawn Express server 子进程（编译后的 JS），BrowserWindow 加载前端。子进程模式避免 better-sqlite3 原生模块与 Electron 的 Node 版本冲突。server 通过 stdout 向主进程报告端口号，主进程端口就绪后再加载页面。

**Tech Stack:** Electron 33 + electron-builder + esbuild（server 编译）+ Vite（前端构建）

---

## 架构图

```
┌──────────────────────────────────────────┐
│           Electron App                    │
│                                           │
│  main.cjs (Electron 主进程)               │
│  ├─ spawn('node', ['server.cjs'])        │
│  ├─ 监听 stdout 获取端口号                │
│  ├─ 创建 BrowserWindow                   │
│  └─ 窗口就绪 → loadURL(localhost:PORT)   │
│                                           │
│  ┌────────────────┐  ┌─────────────────┐  │
│  │ server.cjs     │  │ dist/ (Vite)    │  │
│  │ Express + AI   │  │ React SPA       │  │
│  │ SQLite         │  │                 │  │
│  └────────────────┘  └─────────────────┘  │
└──────────────────────────────────────────┘
```

## 组件设计

### 1. Electron 主进程 (`electron.cjs` 重写)

**职责：** 管理应用生命周期、启动 server 子进程、创建窗口

**关键行为：**
- 开发模式（`NODE_ENV=development`）：spawn server.cjs 等待端口，加载 localhost:PORT，可选打开 DevTools
- 生产模式：spawn 同目录下的 server.cjs，读取端口号，加载 localhost:PORT
- server 子进程输出 JSON 行 `{"port":3000}` 到 stdout
- 收到端口号后才创建 BrowserWindow 并加载
- 窗口关闭时 kill server 子进程
- macOS：dock 图标点击时无窗口则新建
- 隐藏默认菜单栏（Menu.setApplicationMenu(null)）

### 2. Server 编译 (`scripts/build-server.mjs`)

**职责：** 用 esbuild 将 server.ts 打包为单文件 server.cjs

**关键行为：**
- 入口：`server.ts`
- 输出：`dist-electron/server.cjs`（CJS 格式，因为 electron.cjs 用 require）
- 外部依赖：`better-sqlite3`（原生模块，不打包）、`mammoth`（原生依赖链，不打包）
- 打包依赖：express、@google/genai、jszip 等纯 JS 依赖内联
- 注入端口通知代码：在 server.listen 成功后打印 `{"port":PORT}` 到 stdout

### 3. Electron 主进程编译 (`scripts/build-electron.mjs`)

**职责：** 用 esbuild 将 electron.cjs 从 CJS/require 转换为兼容格式

**关键行为：**
- 入口：`electron.cjs`
- 输出：`dist-electron/main.cjs`
- 外部依赖：`electron`（Electron 运行时提供，不打包）
- 格式：CJS

### 4. electron-builder 配置 (`electron-builder.yml`)

**职责：** 定义打包行为

```yaml
appId: com.inkflow.app
productName: InkFlow
directories:
  output: release
  buildResources: build
files:
  - dist-electron/**/*
  - dist/**/*
  - node_modules/better-sqlite3/**/*
  - node_modules/mammoth/**/*
  - node_modules/**/*.node
extraResources:
  - from: node_modules/better-sqlite3/build
    to: better-sqlite3/build
mac:
  target: dmg
  category: public.app-category.productivity
  icon: build/icon.icns
win:
  target: nsis
  icon: build/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### 5. 前端适配 (`vite.config.ts`)

**职责：** 确保 Vite 构建产物可在 Electron file:// 协议下加载

**关键改动：**
- `base: './'`：相对路径，适配 file:// 和 localhost 两种加载方式
- 无需改路由（React SPA 默认 hash 路由即可，或 History 路由需回退到 hash）

### 6. 依赖清理

**移除：**
- `firebase`：已迁移到 SQLite，僵尸依赖
- `cross-env`、`concurrently`、`wait-on`：不在 package.json 中则不加，改用更轻量的方案

**新增：**
- `electron`：运行时
- `electron-builder`：打包工具（devDependency）
- `esbuild`：server 编译（devDependency）

**修复：**
- 删除 `package-lock.json`，全新 `npm install` 解决 LangChain import 卡死

## 构建流程

```
npm run build:electron
  ├─ npm run build (vite build → dist/)
  ├─ node scripts/build-server.mjs (server.ts → dist-electron/server.cjs)
  └─ node scripts/build-electron.mjs (electron.cjs → dist-electron/main.cjs)

npm run package
  └─ electron-builder (读取 electron-builder.yml → release/InkFlow-1.0.0.dmg)
```

## 开发流程

```
npm run electron:dev
  ├─ npm run dev (tsx server.ts → localhost:3000)
  ├─ vite (HMR 前端)
  └─ electron . (加载 localhost:3000)
```

## 不做的

- Tauri 方案：重写量大，现有 Express+better-sqlite3 无法直接迁移
- 自动更新：electron-updater 后期补
- 代码签名：需 Apple Developer 账号，后期补
- Linux 包：AppImage/snap 后期补
- 原生菜单栏：先隐藏，后期按需加

## 验证标准

- [ ] `npm run electron:dev` 启动 Electron 窗口，正常显示 InkFlow
- [ ] `npm run build:electron` 完整构建无报错
- [ ] `npm run package` 生成 macOS .dmg
- [ ] 安装 .dmg 后启动，不依赖系统安装的 Node.js
- [ ] SQLite 数据持久化到 `~/.inkflow/`
- [ ] API Key 配置可从设置面板正常读写
