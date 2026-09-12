# Plan 202: config/sync 死代码移除

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- server/routes/config.ts tests/config-route-contract.test.ts server/lib/config.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW（0 生产调用方已实证）
- **Depends on**: none
- **Category**: dead-code
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 186 附带发现：`POST /api/config/sync` 疑似无调用方。2026-09-12 复核确认：src/、scripts/、electron 入口 0 处引用；唯一消费者是它自己的契约测试。死路由留在攻击面清单与契约测试里，制造「这是 Electron 主进程同步通道」的错觉（真正的 Electron 侧配置写入走的是 `updateCachedApiKey` 函数直调，tests/user-flows-integration.test.ts:24,183 已实证）。移除以缩小 API 面。

## Current state

- 路由：`server/routes/config.ts:77` `app.post('/api/config/sync', validate(configSchema), ...)`——内部调 `updateCachedApiKey(apiKey)`（81 行，仅当 apiKey !== undefined）+ `reloadConfig()`（83 行）。
- 注册：`registerConfigRoutes` → server/routes/index.ts:34。
- 引用面：`tests/config-route-contract.test.ts:95-96`（`postConfig({...}, '/api/config/sync')`）是唯一测试引用；`tests/user-flows-integration.test.ts:24,183` 走 `updateCachedApiKey` 函数直调，不经该 URL；plans/ 文档提及为历史记录。
- `updateCachedApiKey` 定义于 server/lib/config.ts:274，**保留**（server 侧 config.ts:81 之外无其他路由调用，但 user-flows 测试直调 + Electron 链路语义需要它）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 引用复核 | `grep -rn "config/sync" src/ scripts/ tests/ server/ --include="*.ts" --include="*.tsx" --include="*.cjs" \| grep -v plans` | 仅 server/routes/config.ts 定义处 + 契约测试 |
| 契约测试 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/config-route-contract.test.ts` | 全绿 |
| 后端全量 | `npm run test:coverage:backend` | 门槛通过 |

## Scope

**In scope**：

- `server/routes/config.ts`：删除 /api/config/sync 路由
- `tests/config-route-contract.test.ts`：删除该路由的用例（95-96 行附近），补一条「路由已不存在 → 404/405」的断言防回归复活

**Out of scope**：

- `updateCachedApiKey`、`reloadConfig`、configSchema 的任何改动
- plans/ 历史文档（不回改）

## Steps

### Step 1: 删路由 + 契约测试适配

删 config.ts:77 起的 sync 路由；契约测试删对应用例、补「/api/config/sync 不再注册（404）」断言。

**Verify**: 契约测试全绿；grep 复核 0 生产引用

### Step 2: 全量回归

后端全量 + 前端全量（应零影响）。

**Verify**: 后端 1179+/全绿；前端 884/884

## Test plan

见 Steps。

## Done criteria

- [ ] 路由移除且防复活断言就位
- [ ] 后端全量绿
- [ ] `plans/README.md` 状态行已更新（186 行「待另立」标注已收口）

## STOP conditions

- 删除前 grep 复核发现新的生产引用（>0）→ 停止并报告引用方（说明 186 结论已过时）。

## Maintenance notes

无。
