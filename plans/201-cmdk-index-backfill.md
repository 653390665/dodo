# Plan 201: Cmd+K 后续——手写正文入索引 + 索引代际过期提示

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat f39b597..HEAD -- server/routes/production.ts server/vector-store.ts server/routes/search.ts src/components/QuickSearchOverlay.tsx src/lib/editor-write-queue.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P3（方向类，Cmd+K spike 的最高价值后续）
- **Effort**: M
- **Risk**: MED（embedding 计算在低端机的耗时未实证；写放大需要节流设计）
- **Depends on**: Plan 194（竖切片已 DONE）
- **Category**: direction→feature
- **Planned at**: commit `f39b597`, 2026-09-12

## Why this matters

Plan 194 spike 实测发现：向量索引唯一写入点是「生产 run 被接受」（server/routes/production.ts:1642（2026-09-12 复核，192 PRD 时代的 1269 为 format 前旧址），每章 1 chunk）——**编辑器手写、自动保存、助手改写均不入索引**。Cmd+K 的核心用户故事「我写到过 XX 的那段在哪」对百万字手写作者当前是空承诺（面板会诚实提示 unindexed，但功能面只是「AI 写过的章」）。本计划落地 194 §6 开放问题 #1（手写正文入索引）与 #4（索引代际过期提示）。

## Current state

- `server/vector-store.ts`：`addChunk(novelId, chapterId, index, text)`（40 行起，upsert 语义 `${novelId}_${chapterId}_${index}`，`runInSerializedWriteForGeneration` 守卫）；`searchSimilar`（80 行，modelId+dimensions 兼容过滤，兼容失败的 chunk 被静默排除）；`getChunkCount`（134 行）。
- 索引现状：`addChunk` 唯一调用点 production.ts:1642（apply 时 `addChunk(run.novelId, chapterId!, 0, applyRun.draftContent)`——index 恒 0，全文单 chunk）。
- embedding：`server/embedding.ts` `embedWithMetadata`（165 行，本地 `local:Xenova/bge-small-zh-v1.5`）；`getEmbeddingStatus`（61 行，ready/initializing/fallback/unavailable）。
- 前端：`QuickSearchOverlay.tsx` 的 `unindexed` 态文案「本书还没有可检索的索引。当前索引仅覆盖…手写正文暂不入库」；`src/lib/editor-write-queue.ts` 为编辑器写队列（自动保存去抖已存在）。
- 删除时点：章节删除走 `deleteNovel(novelId)`；**单章删除/重写是否清 chunk 需勘察**（grep deleteChunk/vector_chunks 的 DELETE 语句）——Step 1 事项。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 向量层单测 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/vector-store.test.ts tests/embedding*.test.ts` | 全绿 |
| 检索端点契约 | `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/search-similar*.test.ts`（无则 Step 3 新建） | 全绿 |
| E2E 冒烟 | `npx playwright test tests/e2e/real-pipeline-journey.spec.ts` | 全绿（apply 索引路径不受扰） |

## Scope

**In scope**：

- `server/lib/db/chapters.ts` 或编辑器保存链路：章级 upsert 回填触发点（服务端侧，挂在 updateChapter 的序列化写后）
- `server/vector-store.ts`（章级 upsert helper：delete by chapter + addChunk，或 UPDATE 语义）
- `server/routes/search.ts` + `QuickSearchOverlay.tsx`（代际过期提示态）
- 单测 + 手工冒烟文档

**Out of scope**：

- 分块策略（仍每章 1 chunk；开放问题 #3 另立）
- 设定库双源检索（#2）、命令面板化（#5）
- 前端触发侧改造（服务端在 updateChapter 后回填，前端零改动）

## Steps

### Step 1: 勘察 + 设计定稿

①单章删除/重写时 vector_chunks 的清理现状；②updateChapter 的服务端调用链（确定回填挂点，必须在 `runInSerializedWrite` 事务外、embedding 失败不得阻塞正文保存）；③embedding 计划内的策略选型：**防抖批量回填**（如 60s 窗口聚合脏章节）+ 仅在章节内容长度 ≥ 阈值时回填。结论写进本文件。

**Verify**: 设计结论（挂点/节流参数/失败语义）落入 Maintenance notes

### Step 2: 章级回填实现

`upsertChapterChunk(novelId, chapterId, text)`：delete by `${novelId}_${chapterId}_*` → addChunk(index 0)；embedding 失败记日志不抛出；由 updateChapter 挂点经防抖队列调用。单测：upsert 幂等、删章清理、embedding 不可用时不阻塞正文保存、代际冲突（VectorIndexGenerationMismatchError）静默降级。

**Verify**: 向量层单测全绿

### Step 3: 代际过期提示

检索响应与 overlay 增加「索引已过期」诚实态：`searchSimilar` 命中数显著低于 chunk 总数（兼容过滤排除比例 > 50%）时，`/api/search-similar` 返回 `stale: true`（或附排除计数）；overlay 琥珀提示「检测到 X 条旧代际索引未参与检索，建议重建」。

**Verify**: search-similar 契约单测（混入 legacy chunk 场景）+ overlay 文案

### Step 4: 冒烟 + 文档

手工冒烟（194 文档 §5 步骤扩展一条：手写正文 → 保存 → 等待回填窗口 → Cmd+K 命中手写内容）；更新 `docs/prd/2026-09-cmdk-semantic-search.md` §2/§6 状态。

**Verify**: E2E 冒烟绿 + 文档更新

## Test plan

向量层/契约单测 + apply 路径 E2E 回归 + 手工冒烟；前端全量（overlay 改动）。

## Done criteria

- [ ] 手写正文保存后（回填窗口内）可被 Cmd+K 检索命中
- [ ] 索引过期有诚实提示（不假装空结果）
- [ ] 正文保存永不因 embedding 失败而阻塞/失败
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 实测单章 embedding 耗时 > 2s（写入负载影响保存体验的迹象）→ 停止报告实测，改为更低频策略（仅章节完成态）供拍板。
- updateChapter 挂点无法满足「embedding 失败不阻塞保存」的隔离要求 → 报告调用链约束。

## Maintenance notes

落地后 194 §6 的 #1/#4 标记已解决；分块（#3）若立项可直接复用 upsertChapterChunk 的 index 维度。
