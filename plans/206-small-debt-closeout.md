# Plan 206: 小额技术债收口——导出临时文件名 + SSE notify 负载埋点

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- server/routes/db.ts server/routes/db/events.ts server/lib/db-instance.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt + investigation
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

两笔挂账小额收口：

1. **导出临时文件名用 `Math.random`**：Plan 179 遗留——导入侧 `server/lib/db-import.ts:1054-1060` 的 `createImportTempPath()` 已迁 `randomUUID()`，导出侧 `server/routes/db.ts:380` 仍是 `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`。同一份敏感快照的两条临时路径生成策略不一致，Math.random 非密码学源（可预测性在此场景风险低，但策略统一消除审计噪音）。
2. **SSE notify 负载无数据**：Plan 183 的 Step 3（generation 抑制）经论证推迟，结论是「随 notify 负载化另立」——但 notify 链路至今没有负载数据，另立永远缺依据。仿 Plan 184 的 searchSimilar 阈值埋点先例，给 `/api/db/events` 广播链路埋负载观测，攒数据后再决定是否立项。

## Current state

- `server/routes/db.ts:376-383`：`/api/db/export-file` 内 `const uniqueId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`` → `${DB_PATH}-${uniqueId}.temp-export`；清理走流结束/异常同步清理（sqlite-backup 规范，`docs/specs/sqlite-backup.md`）。
- 导入侧先例：`server/lib/db-import.ts:1054-1060` `createImportTempPath()` = `${DB_PATH}${DB_IMPORT_TEMP_MARKER}${randomUUID()}`。
- SSE 广播：`server/lib/db-instance.ts` `advanceDatabaseGeneration` → `databaseGenerationListeners`；订阅端 `/api/db/events`（SSE，query token + 64 连接上限已治理）；`src/lib/db-transport.ts` 已有 500ms 合并窗口（Plan 183）。
- 埋点先例：`server/vector-store.ts:92-94`（`searchSimilar` rows ≥ 1000 时 `logger.info` 一次性规模记录，Plan 184）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 导出链路测试 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/db-export*.test.ts tests/backup*.test.ts`（按 ls 实际文件名） | 全绿 |
| 临时文件规范 | 对照 `docs/specs/sqlite-backup.md` 不变式逐条核对 | 一致 |
| 后端全量 | `npm run test:coverage:backend` | 门槛通过 |

## Scope

**In scope**：

- `server/routes/db.ts`（uniqueId 生成改 `randomUUID()`）
- SSE notify 埋点（`server/lib/db-instance.ts` 或 events 路由：广播次数/订阅连接数/合并窗口丢弃比的计数日志，阈值触发一次性输出，仿 searchSimilar 先例）
- 埋点观测结论写回 `plans/README.md` 本行备注

**Out of scope**：

- 导入/导出临时文件的清理语义（已由规范覆盖）
- generation 抑制的实施（183 推迟项——本计划只供数）
- SSE 传输层任何行为变化

## Steps

### Step 1: uniqueId 迁 randomUUID

对齐导入侧先例；临时文件名格式变化不影响清理逻辑（前缀/后缀匹配面核对一遍测试与规范）。

**Verify**: 导出链路测试全绿；`grep -n "Math.random" server/ --include="*.ts"` → 0 命中

### Step 2: SSE notify 负载埋点

计数器：广播 advance 次数、活跃订阅数、transport 合并窗口实际分派次数（前端已有的合并是否够用需要**服务端视角**的广播频率数据）。阈值触发单条 `logger.info`（如广播/分钟 > N 时输出一次汇总，进程级去重），避免每事件刷日志。

**Verify**: 单测或手工冒烟能触发埋点输出一次；常规流量下无日志噪音

### Step 3: 观测窗口 + 结论

本地跑一轮完整 E2E（自带高频写入），收集埋点输出，把结论（广播频率量级、是否接近抑制阈值判断所需的证据）写回 `plans/README.md` 本行备注；若数据支持，附一行「建议立项 generation 抑制」或「数据不足以立项」。

**Verify**: 备注落账

## Test plan

导出链路测试 + 后端全量 + E2E 观测窗口。

## Done criteria

- [ ] server/ 下 Math.random 归零（临时文件策略与导入侧统一）
- [ ] notify 负载数据落账，183 推迟项有立项依据或明确不立项
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 导出链路存在依赖临时文件名格式的测试/脚本（改名即破坏）→ 停止报告引用面。

## Maintenance notes

若 Step 3 数据支持立项，generation 抑制另立计划时直接引用本行备注的数据。
