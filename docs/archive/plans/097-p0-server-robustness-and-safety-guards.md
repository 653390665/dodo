# Plan 097: P0 服务端安全、日志、SSE 挂起与 Prompt 注入防护

本计划旨在全面加固服务端在异常处理、用户输入防注入、安全头部响应及导出故障 Trace 方面的底层安全性。这是系统高杠杆、低工作量的 P0 级黄金防御动作。

## 适用 Commit
`56efee49`

## User Review Required

> [!IMPORTANT]
> - 本计划会对全局大模型接口传入的原始用户意图 `userIntent` / `fewShots` / `ideaSeed` / `concept` 等暴露于 AI 的入参进行 XML 隔离防御。
> - 在 `server.ts` 中激活 `helmet` 可能会在 Electron 沙盒或高版本浏览器中改变默认安全头部。已确认该应用绑定在 localhost，安全头部的启用不影响本地 IPC 交互。

## Proposed Changes

### 1. 核心 AI 调用管道注入防御
将 `server/helpers/prompt-helpers.ts` 中定义的 `wrapUserInput` 注入到大模型输入路径：
- `server/helpers/ai-production-pipeline.ts`
- `server/routes/agents.ts`
- `server/routes/onboarding.ts`
- `server/routes/skills.ts`

#### [MODIFY] [ai-production-pipeline.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/helpers/ai-production-pipeline.ts)
在第 83 行左右，渲染 `plannerPrompt` 模板时对 `userIntent` 进行 XML 包裹：
```diff
+import { wrapUserInput } from './prompt-helpers.js';
...
   const plannerPrompt = renderPromptTemplate(plannerAsset.template, {
     PLANNER_SOUL,
     contextStr: augmentedContext,
-    userIntent,
+    userIntent: wrapUserInput(userIntent),
   });
```

同时，在调用 `writerPrompt` 和 `criticPrompt` 拼接处也应用此安全隔离（若其含有 `userIntent` 或用户自定义输入片段）。

#### [MODIFY] [agents.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/agents.ts)
对调用 `resolveChainPrompt` 处传入的 `userIntent` 等字段进行 Zod 或 XML 级别转义包装：
```diff
+import { wrapUserInput } from '../helpers/prompt-helpers.js';
...
     const { prompt } = resolveChainPrompt(module, {
       contextStr: effectiveContextStr,
       sceneBeats: '',
       draftContent: '',
-      userIntent,
+      userIntent: wrapUserInput(userIntent),
-      ideaSeed: userIntent,
+      ideaSeed: wrapUserInput(userIntent),
-      concept: userIntent,
+      concept: wrapUserInput(userIntent),
     });
```

---

### 2. 修复 SSE HTTP 异常挂起
修复 `/api/chapter-production-runs/start-stream` 初始化异常捕获未 res.end() 的 Bug，防止加载假死。

#### [MODIFY] [production.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/production.ts)
在第 348 行左右的 `catch (e)` 中，显式增加未输出 headers 时的 500 JSON 降级：
```diff
     } catch (e) {
       if (heartbeat) {
         clearInterval(heartbeat);
         heartbeat = null;
       }
       logger.error('Chapter production stream fatal error:', e);
       const message = e instanceof Error ? e.message : String(e);
       if (runId) {
         try {
           db.updateChapterProductionRun(runId, {
             status: 'failed',
             errorMessage: message,
           });
         } catch (e) { logger.error('Decision record failed:', e); }
       }
+      if (!res.headersSent) {
+        res.status(500).json({ error: message });
+      } else if (!res.writableEnded) {
-      if (res.headersSent && !res.writableEnded) {
         sseWrite(res, { type: 'error', message });
         res.end();
       }
     }
```

---

### 3. Helmet 安全响应中间件挂载

#### [MODIFY] [server.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server.ts)
在 Express 入口引入 `helmet` 拦截：
```diff
 import express from 'express';
 import path from 'path';
+import helmet from 'helmet';
 import { initDb } from './server/lib/db.js';
...
 async function startServer() {
   const app = express();
+  // Register helmet for secure headers (CSP, XSS, MIME Sniffing, Clickjacking)
+  app.use(helmet({
+    contentSecurityPolicy: false, // Disable default restrictive CSP in local Dev Vite overlay mode
+  }));
   const PORT = parseInt(process.env.PORT || '3000', 10);
```

---

### 4. 导出 TXT 路由 Silent Catch 记录

#### [MODIFY] [export.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/export.ts)
在大范围 `catch` 中加入 `logger.error` 记录，保证排障 Trace。
```diff
-    } catch {
+    } catch (e) {
+      logger.error('Export txt failed:', e);
       res.status(500).json({ error: "Internal server error" });
     }
```

---

## Verification Plan

### Automated Tests
1. 运行 API 编译检查与冒烟测试验证：
   `npm run typecheck && npm run lint`
2. 运行后端全量测试套件确保无阻断异常：
   `npm run test`

### Manual Verification
1. 在 SSE 端点触发抛错（如传入不存在的 novelId），验证接口立刻返回 500 JSON 而非永久等待加载挂起。
2. 启动服务，发送 curl 请求：`curl -I http://localhost:3000`，确认响应头包含 `X-Frame-Options`, `X-Content-Type-Options` 等 Helmet 注入的经典头部。
