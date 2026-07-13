# Plan 110: InkFlow 核心接口异步化改写与前后端不兼容缺陷治理设计图 (Timeout Reconstruction & Payload Fix Blueprint)

## 1. 战役背景 & 问题定义
在经过专属代码库子 Agent 配合 `improve` 技能的像素级深挖、RCA 根因分析后，我们发现：
1. **全局 Express 120s 超时瓶颈**：当前大纲生成（`POST /api/generate-outline`）、设定文档全量解析（`POST /api/extract-world-setup`）、网文节奏分析（`POST /api/analyze-pacing`）等大 Token 输入输出任务，依然采用**同步阻塞式 `generateText` HTTP 请求**。大模型网络波动或高负载时，几乎必定挂起，直至触发 120s 超时熔断，向用户抛出 `Request timed out — server too long to respond` 错误。
2. **局部精修链式串行阻塞灾难**：在 `useAuditPolishActions.ts` 钩子中，前端循环体中串行调用 `await fetch('/api/rewrite')`。如果有 3 个改写句，每次改写耗时 40s，总阻塞耗时 $3 \times 40s = 120s$，极其容易触发 120s 超时网关。
3. **扩写接口严重不兼容功能完全失效 (Critical Bug)**：`/api/expand-fragment` 接口前后端协议不匹配：后端等待 `{ text, context }` 而前端发送 `{ content, type }`；后端返回 `{ text: result }` 而前端解析期待 `data.expansion`。导致扩写片段功能完全废弃，从未正常工作过。

本图纸旨在指导 **Executor Subagent** 或未来的模型进行外科手术式重构，通过 **SSE 流式通道** 和 **Async Background Job 队列** 彻底封杀系统中的超时黑洞。

---

## 2. 战役 1：接口协议对齐与扩写去超时化 (`/api/expand-fragment`)

### 2.1 待修改文件
* [`/server/routes/simple-llm.ts`](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/simple-llm.ts)

### 2.2 逻辑重构方案
重构该端点，兼容前端发送的参数，并对齐返回字段。由于扩写是长 prose 生成任务，加入 `SSE (Server-Sent Events)` 实时流式传输：

```typescript
// server/routes/simple-llm.ts 物理重构代码规范
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';

app.post('/api/expand-fragment', async (req, res) => {
  // 1. 建立 SSE 流式传输标头，杜绝 120s 超时封印
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  req.socket.setTimeout(0); // 禁用 Socket 超时熔断

  try {
    // 兼容历史参数和前端发送的 `{ content, type }` 参数
    const { content, type, text, context } = req.body;
    const targetContent = content || text || '';
    const targetType = type || context || '综合创意';

    if (!targetContent.trim()) {
      res.write(`data: ${JSON.stringify({ error: '内容不能为空' })}\n\n`);
      res.end();
      return;
    }

    const prompt = `请将以下网文创意片段进行扩写，融入丰富的感官细节与文学张力:\n【片段类型】: ${targetType}\n【片段内容】: \n${targetContent}\n\n【扩写要求】: 保持原有文风，字数扩充 2-3 倍，结构紧凑。`;

    // 采用 generateTextStream 或是 generateText 的 onToken 钩子进行流式输出
    await generateText(getConfig(), {
      prompt,
      onToken: (token) => {
        // 向前端实时吐出 Token 兼容段落
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e: unknown) {
    res.write(`data: ${JSON.stringify({ error: e instanceof Error ? e.message : String(e) })}\n\n`);
    res.end();
  }
});
```

---

## 3. 战役 2：改写接口流式改造与前端串行链式解耦 (`/api/rewrite`)

### 3.1 待修改文件
* [`/server/routes/audit.ts`](file:///Users/Zhuanz/Documents/dodo-inkflow/server/routes/audit.ts)
* [`/src/lib/hooks/generation/useAuditPolishActions.ts`](file:///Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/generation/useAuditPolishActions.ts)

### 3.2 逻辑重构方案
1. **服务端 `/api/rewrite` 升级为 SSE 流**：
   改用 `res.setHeader('Content-Type', 'text/event-stream')` 并通过 `onToken` 吐出 Token，免除 Express 全局 120s 限制。
2. **前端精修钩子链式串行改为流式并发/串行流处理**：
   在精修时，不再无限等待同步 HTTP 响应，而是处理 EventSource 流：
   ```typescript
   // useAuditPolishActions.ts 重构示意
   for (const { snippet } of actionableTargets) {
     // 建立流式解析通道，让精修过程可视化、打字机化
     await new Promise<void>((resolve, reject) => {
       const eventSource = new EventSource(`/api/rewrite?...`);
       eventSource.onmessage = (event) => {
         if (event.data === '[DONE]') {
           eventSource.close();
           resolve();
         } else {
           const parsed = JSON.parse(event.data);
           // 渐进式拼装润色结果，更新编辑器选区文本
         }
       };
       eventSource.onerror = (err) => {
         eventSource.close();
         reject(err);
       };
     });
   }
   ```

---

## 4. 战役 3：重计算与大 Token 接口异步化 (Job Queue 落地)

### 4.1 涉及路由
* **小说大纲生成**：`POST /api/generate-outline` inside `server/routes/world.ts`
* **长篇世界观设定脑图解析**：`POST /api/extract-world-setup` inside `server/routes/onboarding.ts`
* **网文节奏分析 (限制50章)**：`POST /api/analyze-pacing` inside `server/routes/world.ts`

### 4.2 逻辑重构方案
全面采用与 `POST /api/audit` 完全一致的 **Async Job Queue** 方案：
1. 服务端收到请求后，立刻生成 `jobId`（例如 `outline-gen-${generateId()}`），初始化内存 Job 状态。
2. 立即向客户端返回 `{ jobId }`，结束 HTTP 请求。
3. 后台独立 Promise 线程起飞，静默调度大模型：
   - 包含多步重试与自检门禁（Input/Output Gates）。
   - 将最终解析出的标准化 JSON 写入 SQLite 或更新 Job 状态结果。
4. 客户端引入轻量级定时器，通过 `GET /api/world-bible/jobs/:jobId` 轮询进度，并辅以 `Slow Creep` 插值算法平滑显示 1% 到 100% 的进度。

---

## 5. 验证标准 & 自检门禁 (Verification & Quality Gates)

在 Executor Subagent 完成上述战役的编码实施后，必须运行以下三层验证防线以确保零功能退化：

1. **类型安全检查 (Typecheck Gateway)**:
   ```bash
   npm run typecheck
   ```
2. **代码规范检查 (Lint Gateway)**:
   ```bash
   npm run lint
   ```
3. **单元测试回归套件 (Regression Gate)**:
   ```bash
   npm run test
   ```
   需要专门补充对扩写 SSE 接口、异步任务 Job 状态流转的单元测试，保证覆盖率，确保 SQLite 事务无死锁。
