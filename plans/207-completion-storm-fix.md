# Plan 207: 完成风暴修复——fact 面板自动补跑限次（P1）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 95aefc3..HEAD -- src/components/EditorView.tsx src/lib/chapter-completion-client.ts server/helpers/chapter-completion.ts tests/e2e/unified-creation-new-project.spec.ts tests/e2e/unified-creation-imported-project.spec.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MEDIUM（触碰 EditorView 章节完成流程——本仓库最敏感区，靠组件回归测试 + 既有三个完成流测试套件 + E2E 兜底）
- **Depends on**: none
- **Category**: bug-fix（正确性/前端自激循环）
- **Planned at**: commit `95aefc3`, 2026-09-14

## Why this matters

**完成风暴**：事实待确认场景下，前端在 10 秒内自动重跑约 283 次 `POST /api/chapters/:id/complete`（E2E 探测实测）。每次循环便宜（后端幂等 attempt 缓存直接返回同一结果，`server/helpers/chapter-completion.ts:154-176`），但恒定返回非 ready 门 + `factCandidateRunId`，使循环自我维持；生产中每轮还写 attempt/version/workflowMeta 多行并触发多次 SSE notify（`server/lib/db-crud.ts:76,92,99` → 探针阈值 120/分钟，`server/lib/db-instance.ts:207-270`）。它同时是 plan199 两个 unified-new E2E 用例被阻塞的直接原因——解阻塞后 plan199 才有条件转 DONE。

## Current state（2026-09-14 勘察，锚点基于 `95aefc3`）

风暴是**纯前端 useEffect 自激循环**，链条如下（均在 `src/components/EditorView.tsx`）：

1. `factPanelNeedsGate`（:1245-1251，派生布尔）：候选存在 && 候选章节为当前章 && 门不是 `'ready'` 也不是 `'accepted-risk'`。**条件只排除后两个**——`'review-required'`/`'needs-action'`（已评估但有问题/AI 不可用）被永久视为「需要补跑」。
2. 自动补跑 effect（:1252-1262，commit `8eaf51b` 引入）：依赖 `[factPanelNeedsGate, isCompletingChapter]`，条件通过即 `setTimeout(0)` 调 `handleCompleteChapter()`。注释宣称 "run once"，但**没有「本候选已自动跑过」的任何标记**。
3. `handleCompleteChapter`（:1150-1239）成功路径：清候选（:1165）→ 客户端乐观写门（:1166-1185）→ `getChapterById` 刷新整体覆盖 `currentChapter`（:1186-1204，乐观门可被旧值冲掉）→ 若返回 `factCandidateRunId` 则**重新 preview 并 set 候选**（:1208-1215，循环再装填点）→ `finally setCompletionInFlight(false)`（:1227，effect 再触发）。错误路径（如 409 `CHAPTER_COMPLETION_STALE`）同样不改变 needsGate 条件，也循环。
4. 门枚举：`shared/types/creative-artifacts.ts:85` = `'drafting' | 'review-required' | 'needs-action' | 'ready' | 'accepted-risk'`。面板确认按钮 `canConfirm` 要求 `ready`/`accepted-risk`（:2681-2688；`src/lib/workflow-state.ts:140-144`）——这正是 effect 的动机：让门变 actionable。但 `review-required` 的正确出路是用户在面板处理事实候选，不是重跑完成审阅。

单轮 ~35ms（POST → 状态更新 → effect → setTimeout(0) → POST），串行不并发。唯一客户端调用封装：`src/lib/chapter-completion-client.ts:3-15`；唯一同步在飞写点：EditorView :208-218（`setCompletionInFlight`）。服务端对重复 POST 无限流/冷却（`server/routes/chapter-completion.ts:5-28`；通用限流器 `server/middleware/rate-limit.ts` 只挂 LLM 端点），幂等缓存 key = novelId+chapterId+databaseGeneration+contentHash+planHash（`server/lib/db/chapter-completion-attempts.ts:96-134`）。

被阻塞的 E2E：`tests/e2e/unified-creation-new-project.spec.ts`（mock :15 固定返回 `completionGate:'review-required'` + `factCandidateRunId:'run-1'`——正是触发循环的载荷；风暴探测器 ：185 `expect(provider.completionCalls).toBe(1)`）；`tests/e2e/unified-creation-imported-project.spec.ts`（mock :74-75 返回 `'ready'`，同类旅程）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 新增组件回归测试 | `npx vitest run src/tests/editor-completion-auto-gate.test.tsx`（命名按实际） | 全绿 |
| 既有完成流套件 | `npx vitest run src/tests/editor-completion-flow.test.tsx src/tests/chapter-fact-candidate-review.test.tsx src/tests/project-cockpit-content-gating.test.tsx` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿（当前基线 889/889） |
| 定向 E2E | `npx playwright test tests/e2e/unified-creation-new-project.spec.ts tests/e2e/unified-creation-imported-project.spec.ts` | 2 spec 全绿 |
| typecheck | `npm run typecheck` | 0 错误 |

## Scope

**In scope**：

- `src/components/EditorView.tsx`：`factPanelNeedsGate` 触发语义收窄 + 自动补跑 once-per-candidate 兜底标记（ref，按 candidateRunId/章节身份键控，章节或候选变更时重置）
- 新增组件级回归测试（mock `chapter-completion-client`，仿 `src/tests/chapter-fact-candidate-review.test.tsx` 的 mock 方式）
- `tests/e2e/unified-creation-new-project.spec.ts` / `unified-creation-imported-project.spec.ts`：解阻塞验证（断言不改或仅按新契约微调）
- `plans/README.md` 本行 + 199 行备注更新

**Out of scope**：

- 服务端限流/冷却（根因在前端循环；后端已有幂等缓存使风暴便宜——防御性兜底若需要，另行立项）
- `:1186-1204` GET 刷新与乐观写的整体语义重构（once-per-candidate 标记已使循环不可能，重构不必要）
- plan150 start-stream 场景重排、full-browser 元素不稳定（维持缓议）
- 199 行其余缓议项

## Steps

### Step 1: 触发语义收窄

`factPanelNeedsGate` 改为仅当门**未被评估**（`workflowMeta?.completionGate === undefined || === 'drafting'`）时为 true；`'review-required'`/`'needs-action'` 属已评估，交给面板确认流程（`canConfirm` 门控不变）。同步修订 ：1241-1244 注释，使注释与语义一致（当前注释已写 "hasn't been evaluated yet"，收窄即回归注释本意）。

**Verify**: 新增组件回归测试：`review-required` 门 + 候选存在 + complete mock 返回同门 → `completeChapter` 恰被调 **1** 次；既有完成流三套件全绿。

### Step 2: once-per-candidate 兜底标记

新增 ref 标记（键 = candidateRunId 或「章节 id + 候选身份」），effect 触发前检查、触发后写入；章节切换或候选变更时重置。即使未来门值再次被 GET 刷新（:1186-1204 整体覆盖）冲回未评估态，同一候选也不会自动补跑第二次。错误路径（409 STALE 等）同样只允许一次自动重试，其后交还用户。

**Verify**: 回归测试加第二条：GET 刷新覆盖门后仍不重跑（mock getChapterById 返回旧门，断言调用数不变）。

### Step 3: E2E 解阻塞验证 + 台账

跑定向 E2E：unified-new 的 `completionCalls toBe(1)`（:185）应自然转绿（mock 门为 `review-required`，收窄后 effect 不再补跑）；imported-project 同绿。若 unified-new 仍有其他陈旧断言，对照现行契约重锚（语义不变）。完成后更新 `plans/README.md`：本行转 DONE；199 行备注补「完成风暴已由 207 修复、unified-new×2 转绿」（plan150/full-browser 缓议保留，199 是否转 DONE 视其余项当时状态在执行时判定）。

**Verify**: 定向 E2E 全绿；台账落账

## Test plan

新增组件回归测试（只断言外部行为：`completeChapter` 调用次数 + 面板确认可用性，不断言内部 state）+ 既有完成流三套件回归 + 前端全量 + 定向 E2E + typecheck。前端改动不触后端，后端全量不强制（E2E 全链路已覆盖）。

## Done criteria

- [ ] `review-required`/`needs-action` 门不再触发自动补跑；同一候选至多自动补跑一次
- [ ] unified-new ×2 E2E 转绿，`completionCalls` 探测断言通过
- [ ] 前端全量 + typecheck 绿；台账 207/199 行已更新

## STOP conditions

- 收窄后发现存在依赖「review-required 时自动补跑」的合法产品路径（如驾驶舱自动审计静默链依赖它触发）→ 停止并报告调用面（对照 `docs/specs/cockpit-routing.md` 不变式核实 launchState 链路）。
- once-ref 方案与既有 `completionRequestInFlightRef`（:208-218）语义冲突导致互斥破坏 → 停止报告。
- unified-new spec 除风暴外暴露新的产品级缺陷（非陈旧断言）→ 停止归因，另立不并入本计划。

## Maintenance notes

199 行转 DONE 需同时满足：本计划落地 + 其余缓议项（plan150 start-stream、full-browser）有明确处置结论。服务端限流若未来立项，直接引用本文件 Current state 的后端锚点。
