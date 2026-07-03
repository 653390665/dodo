# 实施计划: 修复 API 运行期鉴权 (077)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development

**Goal:** 解决 Electron 环境下本地服务接口响应 401 鉴权失败的问题，打通 Electron 宿主与 Express 后端服务的安全令牌传递，并修复集成测试的鉴权阻断。
**Architecture:**1. **主进程/预加载桥接**：在主进程中读取本地存储在 `~/.inkflow/.auth-token` 的随机令牌，并在 `electron-preload.cjs` 中通过 `contextBridge` 暴露给渲染进程（`window.electronAPI.getAuthToken()`）。
2. **全局 Fetch 拦截器**：在前端入口 `src/main.tsx` 中重写 `window.fetch`。在向 `/api/` 路径（除 `/api/db/events` 外）发送请求时，自动附加 `Authorization: Bearer <token>` 头部，零侵入性地升级所有客户端（`db-transport`, `prompt-client` 等）。
3. **集成冒烟脚本支持**：改造 `scripts/runtime-smoke.mjs`，使其能够自动读取本地 `.auth-token` 文件并注入到测试请求中，避免本地冒烟测试被 401 拦截。
**Tech Stack:** Electron, Express, React, Node.js

---

## 任务分解 (Tasks)

### Task 1: 预加载脚本 (Preload) 暴露 Token 获取接口
**Files:**
- [MODIFY] [electron-preload.cjs](file:///Users/Zhuanz/Documents/dodo-inkflow/electron-preload.cjs)
- [MODIFY] [electron.cjs](file:///Users/Zhuanz/Documents/dodo-inkflow/electron.cjs)

**步骤：**
- [ ] 1. 在 `electron.cjs` 中，利用 `ipcMain.handle` 注册 `get-auth-token` 事件，调用后端已实现的 `getAuthToken()` 获取当前内存中的 `AUTH_TOKEN`。
- [ ] 2. 在 `electron-preload.cjs` 中，在 `contextBridge.exposeInMainWorld` 中添加：
  ```javascript
  getAuthToken: () => ipcRenderer.invoke('get-auth-token')
  ```

---

### Task 2: 前端入口注入全局 Fetch 拦截器
**Files:**
- [MODIFY] [main.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/main.tsx)

**步骤：**
- [ ] 1. 在 `src/main.tsx` 的最早期，重写 `window.fetch`：
  ```typescript
  const originalFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/') && !url.includes('/api/db/events')) {
      // 只有在 Electron 容器内且存在 API 时才尝试注入 token
      const token = await (window as any).electronAPI?.getAuthToken();
      if (token) {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return originalFetch(input, { ...init, headers });
      }
    }
    return originalFetch(input, init);
  };
  ```

---

### Task 3: 优化本地集成冒烟测试脚本
**Files:**
- [MODIFY] [runtime-smoke.mjs](file:///Users/Zhuanz/Documents/dodo-inkflow/scripts/runtime-smoke.mjs)

**步骤：**
- [ ] 1. 在 `runtime-smoke.mjs` 顶部，读取 `~/.inkflow/.auth-token`：
  ```javascript
  import path from 'node:path';
  import os from 'node:os';

  const tokenPath = path.join(os.homedir(), '.inkflow', '.auth-token');
  let authToken = '';
  try {
    if (fs.existsSync(tokenPath)) {
      authToken = fs.readFileSync(tokenPath, 'utf-8').trim();
    }
  } catch (e) {
    // 忽略读取错误，使用空 token
  }
  ```
- [ ] 2. 改造 `runtime-smoke.mjs` 中的 `fetch` 逻辑，除 `sse endpoint opens` 之外，所有接口请求均在 headers 中带上 `Authorization: Bearer ${authToken}`。

---

## 验证计划 (Verification)

### Drift Check
- 运行：
  ```bash
  git diff --stat ca53899..HEAD -- electron.cjs electron-preload.cjs src/main.tsx scripts/runtime-smoke.mjs
  ```

### 自动化与手动测试
- **安全拦截验证**：
  使用 `curl -I http://localhost:3000/api/config` 预期返回 `401 Unauthorized`。
  带上正确 Token：`curl -I -H "Authorization: Bearer <token>" http://localhost:3000/api/config` 预期返回 `200 OK`。
- **冒烟测试验证**：
  运行本地服务后执行 `npm run smoke:runtime` 预期 100% 通过（`ok config does not expose apiKey`, `ok db listSkills responds`）。
- **SSE 稳定性**：
  验证 `http://localhost:3000/api/db/events` 依然可正常豁免，无需认证即可建立 SSE 连接。
