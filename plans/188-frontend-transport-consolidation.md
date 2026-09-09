# Plan 188: 前端传输收敛——统一 request、config-client、组件裸 fetch 入 client、删除 compat shim

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/lib/capability-client.ts src/lib/outline-client.ts src/lib/capability-configuration-client.ts src/lib/capability-migration-client.ts src/components/WelcomeView.tsx src/components/SettingsModal.tsx src/components/ProjectCockpitView.tsx src/components/EditorView.tsx src/components/WorldBibleView.tsx src/components/IdeaFragmentBoard.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED（传输层替换触及所有视图的错误分支）
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

同一仓库三种前端传输风格并存且已漂移：

1. 四个近似 `request<T>` 包装（capability/outline/capability-configuration/capability-migration client）各自实现「读 json → 查 `payload.code/error` → 抛各自 Error」，默认 message 各不相同；
2. 五个组件各自裸 fetch `/api/config`，错误处理四种写法（有的静默吞错、有的部分置状态）；
3. 15+ 组件绕过既有 client 模块直连 `fetch`（WorldBibleView 一个文件 6 处，甚至有组件内私有 `fetchGovernance` 封装）；
4. 22 个单行 compat shim（`src/lib/*.ts` 转发 `shared/lib`），其中 15 个仅被 tests/ 引用——双 import 路径让「谁在用这个模块」的检索失真。

收敛方向与仓库近期趋势一致（011/014 计划持续把组件逻辑下沉 store + client）。

## Current state

相关文件与角色：

- `src/lib/capability-client.ts:14-20`、`src/lib/outline-client.ts:33-39`、`src/lib/capability-configuration-client.ts:20`、`src/lib/capability-migration-client.ts:19` — 四个复制的 `request<T>`
- `src/lib/db-transport.ts` — RPC `call()` 通道（保留，是第五种合法通道）
- `src/lib/continuation-client.ts:26-40` — 同文件混用 `call()` 与裸 fetch
- `src/components/WelcomeView.tsx:140-149`、`SettingsModal.tsx:194,338`、`ProjectCockpitView.tsx:135`、`EditorView.tsx:1203-1218` — 五处裸 fetch /api/config
- `src/components/WorldBibleView.tsx:251,266,281,554,659,683`（含 :278 组件内 `fetchGovernance`）、`src/components/IdeaFragmentBoard.tsx:85` — 组件直连
- `src/lib/slop-scorer.ts` 等 22 个单行 shim — `grep -l "export \* from '../../shared/lib" src/lib/*.ts | wc -l` 计数

现状摘录：

```ts
// capability-client.ts:14-20（四个复制的代表）
async function request<T>(...): Promise<T> {
  const res = await fetch(...);
  const json = await res.json();
  if (json?.code) throw new ...Error(json.message || '<各不相同的默认文案>');
  ...
}
```

```tsx
// WelcomeView.tsx:140-149 — 裸 fetch + 静默吞错
fetch('/api/config').then(...).catch(() => setLlmAvailability('unknown'));
```

```ts
// src/lib/slop-scorer.ts（22 个 shim 的样子）
export * from '../../shared/lib/slop-scorer';
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 后端全量 | `npm test` | 全绿（shim 删除涉及 tests/ 引用） |
| Lint | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**：

- `src/lib/http.ts`（新建：统一 request）
- 四个 client 文件（改薄封装）
- `src/lib/config-client.ts`（新建）
- Step 3 清单中的组件文件（仅网络段替换）
- 22 个 shim 文件删除 + 引用方 import 更新（含 tests/）
- 相关测试

**Out of scope**：

- `src/lib/db-transport.ts` 的 RPC 通道（保留）
- `sse-client.ts` / `draft-stream` / `production-client` 的流式读取（另一套合法机制）
- WorldBibleView 等组件的状态机重构（只换网络调用，不动组件逻辑）

## Git workflow

每步一次提交；消息如 `refactor(client): single request helper for REST clients`；完成即提交，不 push。

## Steps

### Step 1: 统一 request 助手

新建 `src/lib/http.ts`：

```ts
export class HttpApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly traceId?: string) { super(message); }
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => null);
  if (!res.ok || (payload && typeof payload === 'object' && 'code' in payload && payload.code)) {
    throw new HttpApiError(payload?.error || payload?.message || `HTTP ${res.status}`, res.status, payload?.code, payload?.traceId);
  }
  return payload as T;
}
```

四个 client 的私有 `request<T>` 改为薄封装（保留各自的 Error 类型若测试依赖其类名：`class OutlineApiError extends HttpApiError {}`）。逐文件替换后跑其对应测试。

**Verify**: `grep -rn "async function request" src/lib/*.ts` 仅剩 `http.ts` 一处；typecheck 0 错误

### Step 2: config-client

新建 `src/lib/config-client.ts`：

```ts
import { deriveLlmAvailability } from './llm-availability';
export async function fetchLlmConfig(): Promise<{ config: LlmConfig; availability: LlmAvailabilityState }> {
  const config = await request<LlmConfig>('/api/config');
  return { config, availability: deriveLlmAvailability(config) };
}
```

（导出形态以 `src/lib/llm-availability.ts` 的实际函数签名为准：`grep -n "export" src/lib/llm-availability.ts`。）五个组件的裸 fetch 替换为 `fetchLlmConfig()`，错误分支统一「catch → availability='unknown'」（`docs/specs/llm-status-honesty.md` 的既定语义；EditorView.tsx:1203-1218 的 AbortController/connectionState 特殊逻辑保留其 UI 语义，但底层请求走 client——若无法无损合并，保留该处并在报告说明）。

**Verify**: `grep -rn "fetch('/api/config'" src/components/ | wc -l` → 0；`npm run test:frontend` 全绿

### Step 3: 组件裸 fetch 入 client

1. `WorldBibleView.tsx` 六处 + 组件内 `fetchGovernance`（:278-287）：把 `fetchGovernance` 的逻辑并入 `src/lib/` 既有 world/governance client（`grep -rn "governance" src/lib/*.ts | head` 找目标文件；无则新建 `src/lib/world-governance-client.ts`），组件 import 之。
2. `IdeaFragmentBoard.tsx:85`、`continuation-client.ts:26-40` 的裸 fetch 分支同法归入对应 client。
3. 每替换一处即跑该组件的测试（`ls src/tests | grep -iE "world|fragment"`）。

**Verify**: `grep -rn "= await fetch(" src/components/ | wc -l` 较改前显著下降；剩余处逐一在报告中列出理由（如流式/下载等合法直连）

### Step 4: 删除 compat shim

1. 列出 shim：`grep -rln "export \* from '../../shared/lib" src/lib/*.ts`。
2. 对每个 shim 找引用方：`grep -rln "lib/<shim-name>" src/ tests/ --include="*.ts*"`；把引用方 import 改指 `shared/lib/<name>`。
3. 删除 shim 文件；`grep -rn "from '.*lib/slop-scorer'" src/lib/` 等逐一确认无残留（src/lib 内部互引 shim 的也要改直连）。

**Verify**: `grep -rln "export \* from '../../shared/lib" src/lib/ | wc -l` → 0；`npm run test:frontend`、`npm test` 全绿

### Step 5: 守卫

`tests/architecture-boundaries.test.ts` 或新增轻量测试断言：`src/components/` 下 `fetch(` 直连仅允许出现在白名单文件（流式/导出类）。白名单以 Step 3 报告为准。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/architecture-boundaries.test.ts` 全过

## Test plan

每步的定向命令见各步；全量回归 `npm run test:frontend` + `npm test`（shim 删除影响 tests/ import）。

## Done criteria

- [ ] typecheck 0 错误；前后端测试全绿
- [ ] `grep -rn "fetch('/api/config'" src/components/` 无命中
- [ ] `grep -rln "export \* from '../../shared/lib" src/lib/` 无命中
- [ ] 守卫测试通过
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 四个 client 的 Error 类型被 store/reducer 以 `instanceof` 之外的方式区分（如 message 字符串匹配）——报告匹配点。
- 某组件的裸 fetch 有浏览器流式/下载语义（blob、ReadableStream）——保留并记录白名单，不算失败。
- shim 删除后出现循环依赖（shared ↔ src）——报告环路径。

## Maintenance notes

- 评审关注点：`HttpApiError` 统一后，UI 层按 `status` 分支（422/409/403）的地方语义不变；`code` 字段透传保持 409 style 确认链路（Plan 177）可用。
- 新 client 一律 `import { request } from './http'`；评审把组件内新裸 fetch 列为拒绝项。
- Plan 191 的文档批次应把「前端网络层约定」补进 AGENTS.md 或 docs（若其范围允许）。
