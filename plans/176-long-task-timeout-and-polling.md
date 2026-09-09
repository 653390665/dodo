# Plan 176: 长任务超时治理——解析路由豁免全局 120s 上限，审稿轮询加上限

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- server.ts server/routes/continuation.ts src/lib/hooks/generation/useAuditPolishActions.ts src/lib/poll-client.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED（改动请求生命周期中间件，需回归 SSE 路由）
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

`server.ts` 的全局 120 秒请求超时会在解析路由（最坏 180s，路由自身 `LlmExecution` 上限 180_000ms）进行到 2 分钟时给客户端回 504，但服务端继续执行并在完成后把资料包写入 DB——用户以为失败而重试，产生重复导入或 30 分钟孤儿任务，日志出现 headers-sent 二次错误。计划 110（超时治理）账面 DONE 但此路由漏网。同时，前端审稿轮询是 `while(true)` 无上限循环，服务端任务卡死时客户端永久轮询。本计划：给同步长任务路由建立按路由的超时白名单，并给审稿轮询补上与 `poll-client.ts` 一致的重试上限。

## Current state

相关文件与角色：

- `server.ts:77-87` — 全局请求超时中间件（所有路由 120s）
- `server/routes/continuation.ts:1090-1200` — `/api/continuation-packs/parse` 同步等待路由
- `src/lib/hooks/generation/useAuditPolishActions.ts:247-281` — 审稿轮询 `while (true)`
- `src/lib/poll-client.ts:31` — 仓库既有轮询上限先例（`maxRetries = 120`）

现状摘录：

```ts
// server.ts:77-87
app.use((_req, res, next) => {
  const timeoutMs = 120_000; // 2 minutes max for any request
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timed out — server took too long to respond' });
    }
  }, timeoutMs);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});
```

```ts
// server/routes/continuation.ts:1090-1096, 1103-1106 — 解析路由的执行框架与单次 LLM 上限
      timeoutMs: 180_000,          // LlmExecution 总上限 180s > 全局 120s
      concurrency: 1,
      signal: controller.signal,
    });
  const raw = await generateText(llmConfig, {
      ...
      timeoutMs: 90_000,
      maxAttempts: 3,
```

```ts
// src/lib/hooks/generation/useAuditPolishActions.ts:247-249 — 无上限轮询
let jobResult: Record<string, unknown> | null = null;
while (true) {
  if (controller.signal.aborted) throw new Error('AbortError');
```

```ts
// src/lib/poll-client.ts:31-32 — 既有上限先例
const { onProgress, intervalMs = 1500, maxRetries = 120 } = options;
let retries = 0;
while (retries < maxRetries) {
```

SSE 路由不受影响：全局定时器仅在 `!res.headersSent` 时响应 504，SSE 路由立即发出 headers。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 后端定向测试 | `NODE_ENV=test node --test --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/continuation-parse-doc.test.ts tests/audit-evidence-route.test.ts` | 全过（文件名以 `ls tests/ | grep -E "parse|audit"` 实际为准） |
| 后端全量 | `npm test` | 全绿 |
| Lint | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**：

- `server.ts`（全局超时中间件改造）
- `src/lib/hooks/generation/useAuditPolishActions.ts`（仅轮询循环段）
- `tests/` 下新增/扩展一个针对超时中间件的测试文件

**Out of scope**：

- 把 parse 路由改造成 202+jobId 轮询模式（涉及前端导入流程，另立计划；本计划只堵 504-但-仍落库的窗口）
- `server/routes/continuation.ts` 的解析逻辑本体
- SSE 心跳/断连逻辑（`bindClientDisconnect` 已有治理，计划 121 DONE）

## Git workflow

小步提交，消息如 `fix(server): per-route timeout allowlist for long synchronous LLM routes`；完成即提交，不 push。

## Steps

### Step 1: 全局超时中间件支持按路由白名单

把 `server.ts:77-87` 改为：

```ts
// Global request timeout safety net. Long synchronous LLM routes opt out via
// LONG_REQUEST_TIMEOUT_ROUTES and get the listed ceiling instead.
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const LONG_REQUEST_TIMEOUT_ROUTES = new Map<string, number>([
  // POST /api/continuation-packs/parse: LlmExecution self-caps at 180s (continuation.ts:1093).
  ['POST /api/continuation-packs/parse', 200_000],
]);

app.use((req, res, next) => {
  const timeoutMs = LONG_REQUEST_TIMEOUT_ROUTES.get(`${req.method} ${req.path}`) ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Request timed out — server took too long to respond' });
      logger.warn(`Request exceeded ${timeoutMs}ms: ${req.method} ${req.path}`);
    }
  }, timeoutMs);
  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));
  next();
});
```

（`logger` 在 server.ts 已有 import；若用 `console.warn` 亦可，与该文件现状一致即可。）

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误

### Step 2: 排查其他同步长路由

运行 `grep -rn "await generateText\|await execution.run" server/routes/ | grep -v "streamGeneration" | grep -v jobs` 并人工核对命中路由：凡「同步 await LLM 完成才 res.json、且无 202+job 兜底」的路由，按其自身超时上限 +20s 加入 `LONG_REQUEST_TIMEOUT_ROUTES`。已知候选：`/api/continuation-packs/parse-doc`（docx 本地解析，通常秒级，**不加**，除非其内部也 await LLM——以 grep 证据为准）。在计划执行报告中列出最终白名单与依据。

**Verify**: 报告中给出白名单终稿；typecheck 0 错误

### Step 3: 审稿轮询加上限

`useAuditPolishActions.ts:247-249` 的 `while (true)` 改为带上限循环，语义对齐 `poll-client.ts`：

```ts
const AUDIT_POLL_MAX_RETRIES = 120; // 120 × 1.5s ≈ 3 分钟，与服务端任务超时同量级
let pollRetries = 0;
let jobResult: Record<string, unknown> | null = null;
while (pollRetries < AUDIT_POLL_MAX_RETRIES) {
  pollRetries += 1;
  ... // 原循环体不变
}
if (!jobResult) throw new Error('智能审稿等待超时，请稍后重试。');
```

注意：原循环里 `break` 与 `throw` 分支保持不变；上限耗尽走循环后的 `if (!jobResult)` 分支，文案用户可读。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误；`grep -n "while (true)" src/lib/hooks/generation/useAuditPolishActions.ts` → 无命中

### Step 4: 中间件回归测试

新建 `tests/request-timeout-allowlist.test.ts`（仿照 `tests/production-stream-disconnect.test.ts:40-46` 的「起 express + 注册路由 + fetch」模式）：

1. 注册一个 150ms 后才 `res.json` 的测试路由，不带白名单 → fetch 该路由，断言 504 且响应体含 `timed out`。
2. 同一路由加入白名单 1000ms → 断言 200 正常返回（不会 120s 默认值提前 504；测试用短值注入，通过导出 `LONG_REQUEST_TIMEOUT_ROUTES` 或提供 `createTimeoutMiddleware(customMap)` 工厂——选工厂方案更可测，导出 `createRequestTimeoutMiddleware` 供 server.ts 与测试共用）。
3. SSE 行为回归：路由立即 `res.write` headers 再挂起 → 断言不触发 504（headersSent 保护）。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/request-timeout-allowlist.test.ts` → 全过

## Test plan

见 Step 4；另跑受影响路由的既有测试（`ls tests/ | grep -E "parse|continuation"` 全部）与前端 `audit-polish-actions` 相关测试：

**Verify**: `npm test` 全绿；`npm run test:frontend` 全绿

## Done criteria

- [ ] typecheck 0 错误；`npm test`、`npm run test:frontend` 全绿
- [ ] `grep -n "120_000" server.ts` 命中处位于 `DEFAULT_REQUEST_TIMEOUT_MS` 定义（硬编码超时不再散落）
- [ ] `grep -n "while (true)" src/lib/hooks/generation/useAuditPolishActions.ts` 无命中
- [ ] 新增 `tests/request-timeout-allowlist.test.ts` 通过
- [ ] 执行报告含白名单终稿及路由排查依据
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- Step 2 排查发现 3 个以上需要白名单的路由——说明「同步长路由」是系统性模式，停止加白名单并报告（应转向 202+job 化的专项计划）。
- 白名单命中逻辑与 express 挂载前缀不匹配（如路由挂载在 `/api` 子路由器导致 `req.path` 不含前缀）——用 `req.originalUrl` 校正后仍失败则 STOP。
- 轮询上限改动导致既有 audit 流程测试失败且原因不是超时文案。

## Maintenance notes

- 后续把 parse 路由 202+job 化时，从白名单删除对应条目。
- 评审关注点：白名单 key 用 `req.method + req.path`；若未来路由挂载加前缀需同步。
- 计划 110/121 已治理 SSE 与异步 job 超时；本计划是同步路由补丁，勿回改它们的机制。
