# Plan 218: start-stream 流收尾 promise 收口——防收尾写失败杀进程（CORR-03）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat d6c2ed2..HEAD -- server/routes/production.ts server.ts tests/production-stream-disconnect.test.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。（若 216 已先行落地，以 216 之后的现状为准核对。）

## Status

- **Priority**: P1（正确性：局部可降级故障被放大为整进程退出）
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none（与 216 改同一 catch 链，建议 216 先行合并后再动，避免同段冲突）
- **Category**: bug-fix（后端正确性/进程健壮性）
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计 CORR-03）

## Why this matters

start-stream 的 `.then().catch()` 终态 promise 无人接住；catch 处理器内部的 DB 写（`runInSerializedWriteForGeneration` → `db.updateChapterProductionRun`）与 `refundQuota` 都可能抛错（如 DB 切换窗口的 not initialized、SQLite 约束错）。一旦抛出即成为 unhandledRejection，而 `server.ts:199-201` 对其的处理是 `shutdownAfterFatalError` → `process.exit(1)`——**一次本可降级为单次生成错误事件的收尾写失败，会杀掉整个服务器进程**（Electron 场景 = 全应用闪重启、所有在途生成丢失）。

## Current state（2026-09-15 亲读核实，锚点基于 `d6c2ed2`）

- `server/routes/production.ts:1118-1183` — 内部 `.catch(async (err) => {...})` 内含至少 4 个 await 点可抛：`:1122`（abort 路径标记 failed）、`:1131`（refundQuota）、`:1144`（失败标记）、`:1150`（refundQuota）；该 catch 返回的 promise 是 `.then().catch()` 链的终态，无后续 `.catch`。
- `server.ts:199-201` — `process.on('unhandledRejection', ...)` → `shutdownAfterFatalError(...)` → drain + `process.exit(1)`。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向测试 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/production-stream-disconnect.test.ts` | 全绿 + 新增用例绿 |
| 后端全量 | `npm run test:coverage:backend` | 门槛通过 |

## Scope

**In scope**：

- `server/routes/production.ts` 终态 promise 收口 + catch 处理器内部写失败降级
- `tests/production-stream-disconnect.test.ts` 新增「收尾写失败不杀进程」用例

**Out of scope**：

- `server.ts` 的 unhandledRejection 全局策略（它对**真**未处理 rejection 的 fail-fast 是合理底线，本计划只保证流收尾不再产生 unhandledRejection）
- 其他路由的同类模式排查（可作为后续 sweep，见 Maintenance notes）

## Steps

### Step 1: 终态收口

`.catch(async (err) => {...})` 之后追加 `.catch((hookError) => { logger.error('production stream finalizer failed:', hookError); })`；同时把 catch 处理器内的 `runInSerializedWriteForGeneration`/`refundQuota` 调用点分别包 try/catch（写失败记日志、refund 失败记日志——两者都不应向上抛）。注意与 216 的交接分支共存：交接内部的 persistError 已有 fall-through 兜底，保持不变。

**Verify**: 新增用例——注入 `db.updateChapterProductionRun` 在收尾阶段抛错的场景（test hooks 或 mock），断言：响应以 error/done 事件正常收尾（或连接干净关闭）、进程存活（无 unhandledRejection）、错误被 logger 记录

### Step 2: 回归与台账

**Verify**: 既有 4+ 用例（216 后为 5+）零回归；后端全量绿；台账 218 行转 DONE

## Done criteria

- [ ] 流收尾阶段的任何写失败都不再产生 unhandledRejection（新增用例钉死）
- [ ] 既有测试零回归；后端全量绿
- [ ] 台账落账

## STOP conditions

- 实测发现收尾写失败存在「必须 fail-fast」的业务理由（如写失败意味着数据已不一致）→ 停止报告，重新评估降级策略。

## Maintenance notes

其他路由存在同款 `.then().catch()` 内含 await 的模式（agents.ts 等），本计划只修 start-stream；全仓 sweep 可作为独立小额计划。
