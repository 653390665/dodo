# Plan 216: start-stream 质量拒绝交接修复——不可达分支激活（CORR-01）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat d6c2ed2..HEAD -- server/routes/production.ts server/helpers/ai-production-pipeline.ts tests/production-stream-disconnect.test.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1（正确性硬伤：付费生成的用户保障承诺未兑现）
- **Effort**: S
- **Risk**: LOW（改动集中于单一 catch 链，有 `__productionTestHooks` 确定性测试缝）
- **Depends on**: none
- **Category**: bug-fix（后端正确性）
- **Planned at**: commit `d6c2ed2`, 2026-09-15（发现：improve 四路审计 CORR-01）

## Why this matters

start-stream 的设计注释承诺：当保底草稿与全部模型尝试都未过质量门但存在模型草稿时，把模型草稿持久化为 `review_required` 预览交还用户（"the user keeps the paid-for material"）。实测该保障**不存在**：管线 rejection 永远到不了外层交接分支，模型草稿被静默丢弃，用户收到泛化的「正文生产暂不可用」。

## Current state（2026-09-15 亲读核实，锚点基于 `d6c2ed2`）

1. `server/routes/production.ts:1006` — `runProductionPipeline({...})` 调用**未 await**，仅其内部 `:1118` 起挂 `.then().catch()`；rejection 在内部 catch 终止，不会传播到外层 try/catch。
2. `server/helpers/ai-production-pipeline.ts:121` — `DraftQualityRejectionError` 的 message 前缀为 `DRAFT_QUALITY_REJECTED:`（`:502`、`:542` 两处 throw：模型草稿存在但未过质量门时抛出，draft 文本带在 `e.draft` 上）。
3. `server/routes/production.ts:1151-1152` — 内部 `.catch()` 的质量失败判定是 `err.message.startsWith('DRAFT_QUALITY_GATE_FAILED:')`——与实际前缀**错配**，`DraftQualityRejectionError` 落入 `if (!fallbackPersisted)` 分支：run 标 `failed` + `refundQuota`（`:1143-1150`），`e.draft` 丢弃。
4. `server/routes/production.ts:1196-1235` — 外层 catch 的「Quality-rejection handoff」（`e instanceof DraftQualityRejectionError && runId` → 持久化 `review_required` 预览 + `createProductionVersion` + `commitQuotaReservation` + SSE status/done）对本路由是**死代码**。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 定向测试 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/production-stream-disconnect.test.ts` | 全绿 + 新增用例绿 |
| 后端全量 | `npm run test:coverage:backend` | 门槛通过 |

## Scope

**In scope**：

- `server/routes/production.ts` 内部 `.catch()`（:1118-1183）与外层 catch（:1190-1240）的交接激活
- `tests/production-stream-disconnect.test.ts` 新增行为用例

**Out of scope**：

- `ai-production-pipeline.ts` 的抛错语义（前缀/字段不动）
- start-stream handler 的结构拆分（ ARCH-03 另立）

## Steps

### Step 1: 激活交接路径

内部 `.catch()` 中，在 `if (!fallbackPersisted)` 之前增加对 `DraftQualityRejectionError` 的识别分支，复用外层 :1196-1235 的交接逻辑（持久化 review_required + commit + SSE done）。两种实现任选其一并保持行为一致：(a) 把该错误重新抛出让外层 catch 接住；(b) 内联交接。推荐 (a)——外层已有完整实现与错误兜底（persistError fall through），避免逻辑复制。

**Verify**: 新增确定性测试（经 `__productionTestHooks` 使保底与模型尝试均被质量门拒且模型草稿非空）：断言 run 终态 `review_required`、`draftContent` 为模型草稿、响应含「已作为待改进草稿保存在预览中」status 与 done 事件、配额被 commit 而非 refund

### Step 2: 回归与台账

**Verify**: `tests/production-stream-disconnect.test.ts` 既有 4 用例不回归；后端全量绿；台账 216 行转 DONE

## Done criteria

- [ ] 全失败场景下模型草稿以 review_required 预览交付（新增用例钉死）
- [ ] 既有生产流测试零回归；后端全量绿
- [ ] 台账落账

## STOP conditions

- 测试发现 `DraftQualityRejectionError` 在 `fallbackPersisted=true` 路径也可能抛出（保底已交付后再拒）→ 交接语义需区分，停止报告方案。

## Maintenance notes

ARCH-03（start-stream 拆分）落地时本交接逻辑应随「精修重试与收尾」阶段整体迁移。
