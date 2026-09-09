# Plan 189: 服务端架构收敛——db.ts 职责拆分、SSE 助手统一、continuation job 管理器、边界测试矩阵

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- server/routes/db.ts server/routes/continuation.ts server/routes/agents.ts server/routes/production.ts server/routes/audit.ts server/routes/world.ts server/routes/simple-llm.ts tests/architecture-boundaries.test.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED（导入校验是数据安全边界；job 恢复/取消语义微妙）
- **Depends on**: Plan 186（其 Step 3 的 HTTP 错误映射测试是 db.ts 拆分的安全网）
- **Category**: tech-debt
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

1. **db.ts（1136 行）至少五种职责**：章节能力校验、RPC 白名单分发表、导入 schema/索引/FK 清单、320 行导入校验器、SSE 助手。其中导入校验器**手写复制**了 `db-init.ts` 的全部 schema 知识（索引/外键清单两处各写一遍）——schema 演进漏改只会在用户导入备份时以运行时失败暴露。
2. **SSE 样板在 5 个路由文件 9 处手写且已漂移**：`db.ts:938-982` 已有正确封装 `startDbEventStream`，其余各处（agents×3、production、audit×2、world、simple-llm）各自实现 headers/心跳/writability 判断，行为不一致。
3. **continuation.ts（2061 行）是上帝路由**：8 个模块级可变容器管理 job 生命周期 + 与 DB 双写手工同步（`continuation-extraction-job-recovery.test.ts` 的存在说明重启丢态已发生过）。
4. **边界守护测试只挡单向**：`tests/architecture-boundaries.test.ts:6-31` 仅扫 server→src，漏根目录入口、src→server、shared 方向。

## Current state

相关文件与角色：

- `server/routes/db.ts:26-65,67-85,171-295,329-364,398-446,500-826,856-931,938-982` — 上述五职责的行号分布
- `server/lib/db-init.ts:687-698` — CREATE INDEX 清单（与 db.ts 的 ALLOWED_IMPORT_INDEXES 重复）
- `server/routes/agents.ts:295,603-621,850-860`、`production.ts:588-611`、`audit.ts:682,757`、`world.ts:592`、`simple-llm.ts:78` — 手写 SSE 各处
- `server/routes/continuation.ts:90-135` — 8 个模块级 Map/Set；`:340-430` — 内存态/持久态双写
- `tests/architecture-boundaries.test.ts:6-31` — 单向扫描
- `tests/db-import-serialization.test.ts`（30 子用例）、`tests/ordinary-sse-routes.test.ts`、`tests/production-stream-disconnect.test.ts` — 既有安全网

现状摘录：

```ts
// db.ts 中的漂移例：production.ts:592 与 db.ts:958 设 X-Accel-Buffering: no，agents.ts 三处不设；
// writability 判断一处 isResponseWritable(res)、一处内联 !res.writableEnded && !res.destroyed
```

```ts
// continuation.ts:90-135（节选其容器清单注释位）
// parseDocJobs / parseDocJobAbortControllers / entityExtractionJobs /
// entityExtractionAbortControllers / entityExtractionRerunners /
// pendingContinuationImports / continuationImportSessions / entityExtractionActiveRuns
```

```ts
// architecture-boundaries.test.ts:6-31（节选）
// 仅扫描 server/ 目录、仅匹配 ['"].*src\/.*['"] 一种 import 形态
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 后端定向 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/db-import-serialization.test.ts tests/export-route.test.ts tests/ordinary-sse-routes.test.ts` | 全过 |
| 后端全量 | `npm test` | 全绿 |

## Scope

**In scope**：

- `server/lib/db-import.ts`（新建：validateDatabaseImportFile / importDatabaseBuffer 迁入）
- `server/helpers/sse.ts`（新建：`openSseStream(req, res, opts)` 通用助手）
- `server/routes/db.ts`（瘦身为 RPC 代理 + 白名单）
- 五个路由文件的手写 SSE 段替换
- `server/helpers/continuation-extraction-jobs.ts`（新建：job 管理器一期）
- `tests/architecture-boundaries.test.ts`（四方向矩阵）
- `tests/db-schema-consistency.test.ts`（新建：两份清单一致性）

**Out of scope**：

- 导入校验器改为从 db-init.ts **派生**（M-L，本计划只加一致性测试锁漂移，合并另立计划）
- continuation.ts 的路由级三块拆分（job 管理器落地后另立）
- pendingContinuationImports / importSessions 的语义（只搬移不重构）

## Git workflow

每步一次提交；消息如 `refactor(server): extract db-import validator from routes/db.ts`；完成即提交，不 push。

## Steps

### Step 1: db.ts 拆出导入校验与 SSE 助手

1. 新建 `server/lib/db-import.ts`：整体搬移 `validateDatabaseImportFile`、`importDatabaseBuffer`（db.ts:500-931 段）及其私有 helper；`db.ts` import 之，删除原段。行为零改动——纯搬移 + import。
2. db.ts 的 `startDbEventStream`（:938-982）保持原位（Step 2 会泛化它）。
3. 新建 `tests/db-schema-consistency.test.ts`：import db.ts 的 `ALLOWED_IMPORT_INDEXES`/`EXPECTED_IMPORT_FOREIGN_KEYS` 与 db-init.ts 的实际 schema（`grep -n "CREATE INDEX\|FOREIGN KEY" server/lib/db-init.ts`；若 db-init 无结构化导出，则用 better-sqlite3 对内存库跑 initDb 后读 `sqlite_master` 断言 db.ts 清单与实际索引/外键集合一致）。失败信息指向「同步 db.ts 导入清单或 db-init」。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/db-import-serialization.test.ts tests/export-route.test.ts tests/db-schema-consistency.test.ts` 全过；`wc -l server/routes/db.ts` 显著下降

### Step 2: SSE 助手统一

1. `server/helpers/sse.ts` 新建 `openSseStream(req, res, opts: { heartbeatMs?, onAbort? }): (event: unknown) => boolean`——以 db.ts:938-982 的 `startDbEventStream` 为蓝本泛化：headers（含 `X-Accel-Buffering: no`、`retry: 3000`）、心跳 interval、writability 检查、`bindClientDisconnect` 清理。
2. 9 处手写替换：`agents.ts:295,603-621,850-860`、`production.ts:588-611`、`audit.ts:682,757`、`world.ts:592`、`simple-llm.ts:78`、`db.ts:938-982`（db.ts 改为调助手）。每处替换保留该路由原有的事件格式与 abort 语义（只换传输壳）。
3. 跑 `tests/ordinary-sse-routes.test.ts`、`tests/production-stream-disconnect.test.ts`、`tests/orchestrate-disconnect.test.ts`（`ls tests | grep -i sse` 全部）。

**Verify**: `grep -rn "text/event-stream" server/routes/ | grep -v helpers` 仅剩注释或零命中；相关 SSE 测试全过

### Step 3: continuation job 管理器（一期）

1. 新建 `server/helpers/continuation-extraction-jobs.ts`：把 8 个容器中**实体抽取相关**的（entityExtractionJobs / entityExtractionAbortControllers / entityExtractionRerunners / entityExtractionActiveRuns）收敛为一个 `EntityExtractionJobManager` 类：`create/get/abort/isActive/prune`，内存态与持久态双写的同步点集中到 `manager.touch(job)`（内部仍调既有 `touchEntityExtractionJob` 的落盘逻辑，搬迁不重写）。
2. `continuation.ts` 改用 manager 实例（模块级单例）；parseDoc / pendingImports / importSessions 容器**不动**（二期再收）。
3. `tests/continuation-extraction-job-recovery.test.ts`、`ls tests | grep extraction` 全部必须绿——恢复/取消语义锁死。

**Verify**: `grep -c "entityExtractionJobs" server/routes/continuation.ts` 较改前显著下降（容器声明移出）；`npm test` 全绿

### Step 4: 边界测试矩阵

扩展 `tests/architecture-boundaries.test.ts` 为四方向矩阵（沿用其文件遍历 + 正则断言风格）：

- server/**（含根 `server.ts`、`env-bootstrap.ts`）不得 import `src/`
- `src/**` 不得 import `server/`（任何子路径）
- `shared/**` 不得 import `src/` 或 `server/`
- `src/**` 与 `server/**` 不得 import `tests/`

排除既有合法例外（若有，先全量跑一遍记录失败项再逐一评估：`shared/` 若 import 了 `server/` 的类型即为此前未发现的现行违规——按 Playbook「现行违规也要报」处理，逐条列出）。

**Verify**: `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/architecture-boundaries.test.ts` 全过（或输出明确例外清单）

## Test plan

各步定向命令见步骤；全量 `npm test` + `npm run typecheck`。前端不受影响（纯服务端重构），跑一次 `npm run test:frontend` 确认无意外。

## Done criteria

- [ ] typecheck 0 错误；`npm test` 全绿
- [ ] `grep -rn "text/event-stream" server/routes/` 无直接 header 写入（统一走 helpers/sse）
- [ ] `wc -l server/routes/db.ts` < 700（导入校验迁出后）
- [ ] `tests/db-schema-consistency.test.ts`、扩展后的边界测试通过
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 搬移 `importDatabaseBuffer` 时发现其依赖 db.ts 的模块级状态（非纯函数）——报告依赖图。
- 任一路由的 SSE 替换后其流式测试失败且原因不是事件格式（即传输壳行为差异）——回退该处并记录。
- 边界矩阵跑出 5 处以上现行违规——先报告清单（这本身是审计级发现），获确认后再决定逐条修还是豁免登记。

## Maintenance notes

- 评审关注点：本计划是「搬移 + 锁漂移」，不是重写——diff 中不应出现逻辑变更（评审用 `git diff -w --stat` 辅助）。
- 二期（另立计划）：导入清单从 db-init 派生；parseDoc/importSessions 容器入 manager；continuation.ts 按域拆三块。
- Plan 176 的超时白名单键（`req.path`）在 db.ts 拆分后仍有效（路由路径未变）。
