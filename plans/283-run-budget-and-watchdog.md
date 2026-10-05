# Plan 283：run 墙钟预算与看门狗 —— 一次成章不再被拖到 33 分钟（R-282-3）

**Status**：代码 / 测试 / 门禁 ✅；真机验证 ✅（2026-10-05，预算 45 s 两跑触发 + 预算 300 s 控制两跑不触发）
**前置**：[`plans/282-scene-scoped-retry-feedback.md`](282-scene-scoped-retry-feedback.md)
**触发**：Plan 282 真机重试臂 `lite-p282` rep3（run `71188cef-aa75-469a-be56-01e2c209ce63`）

## 1 问题：单次 run 可能远超任何单次调用超时

真机读数（隔离 3301，gemini-3.1-flash-lite @ low）：

| 量 | 读数 | 来源 |
| --- | --- | --- |
| run 墙钟 | **1 991.1 s** | `chapter_production_runs.created_at` → `updated_at` 差 1 991 091 ms；`[ACCESS] POST /api/chapter-production-runs/start-stream ms=1991138` |
| 单次场景调用 | **934.8 s** | dump 记录 `attempt 1 / kind scene-call-error / scene 4 / ms 934774 / error LLM operation production-pipeline-writer timed out / streamedTokens 4907` |
| 该调用的治理超时 | 180 s | 插桩实测 `gate-start op=production-pipeline-writer timeoutMs=180000` |
| 真实 LLM 调用合计 | 约 612 s（三 rep） | `llm-usage` 44 条 `ms` 合计 2 603 s（含上面那条 1 991 s） |

即 `server/helpers/llm-execution-gate.ts` 的 per-call 超时（`setTimeout(() => controller.abort(timeoutError), options.timeoutMs)` 与 `Promise.race([workPromise, abortPromise])`）不是硬上界：这次 934.8 s 的调用最终仍以 `LLM operation production-pipeline-writer timed out` 收场，但 run 已被拖到 33 分钟，期间作者只看到「AI writer 进行中」。

复现尝试：`lite-p283`（4 reps）与 `lite-p284`（6 reps）均未复现；`lite-p284` 全程只出现一次正常的 `gate-timeout-fire`（开场 planner 45 s）。⇒ 属低频事件，不能靠「等它复现」来验证修复，只能给 run 加一道与单次调用无关的墙钟上界。

机制未定性（候选：`OperationSemaphore` 排队等待、流读取卡住、定时器被事件循环延迟）；看门狗是兜底，不依赖根因。

## 2 方案：run 级墙钟预算 + 调用夹紧 + 看门狗兜底交付

### 2.1 预算与解析（`server/helpers/ai-production-pipeline.ts`）

```ts
const DEFAULT_RUN_BUDGET_MS = 900_000;  // 15 分钟
const RUN_BUDGET_TAIL_MS = 20_000;     // 预算尾巴：只剩这么多就不再开新调用
export function resolveRunBudgetMs(env: NodeJS.ProcessEnv = process.env): number  // INKFLOW_RUN_BUDGET_MS 覆盖
```

run 内脚手架：`runStartedAt` / `runDeadline` / `remainingBudgetMs()` / `budgetGone()`（剩余 ≤ `RUN_BUDGET_TAIL_MS`）/ `clampToBudget(ms)`（下限 5 s，上限剩余预算）/ `noteBudgetExhausted(stage)`（一次性 `logger.warn('[pipeline] run wall-clock budget exhausted; stopping retries')` + `progress.onRunBudget?.(…)`）。参数新增可注入的 `runBudgetMs?: number; now?: () => number`，测试可用 0 预算与假时钟确定性触发。

### 2.2 调用夹紧（5 个 writer 点 + 1 个 critic 点 + 定点修复）

- writer 三个治理调用点（`production-pipeline-writer` 场景、`production-pipeline-writer-continue` 续写、`production-pipeline-writer-continue-length` 篇幅续写）的 `timeoutMs` 由 `WRITER_LLM_OPTIONS.timeoutMs`（180 s × 档位缩放）改为 `clampToBudget(WRITER_LLM_OPTIONS.timeoutMs)`；
- critic 的 `timeoutMs: criticTimeoutMs` 改为 `clampToBudget(criticTimeoutMs)`，翻倍行改 `clampToBudget(Math.min(criticTimeoutMs * 2, CRITIC_MAX_TIMEOUT_MS))`；
- 定点修复：`LocalRepairCallContext` 新增 `deadlineMs?`，批量/单句两处超时过 `clampRepairTimeoutMs(params)`（`Math.max(5_000, Math.min(base, params.deadlineMs - Date.now()))`）。

### 2.3 四个停止点（每个 stage 都如实上报）

| stage | 位置 | 语义 |
| --- | --- | --- |
| `before-retry` | attempt 循环首（`attempt > 0`） | 不再开新一轮整章重写 |
| `gate-fail` | 门失败分支记账之后、修复/续写/重写之前 | 交付手上这份（model 稿优先），不再构造保底稿覆盖 |
| `before-critic` | `// --- Critic ---` 之后 | 先 `emitFinalDraft(currentDraft)` 把稿子交出去，不等审稿 |
| `critic-retry` | critic 重试判定处 | 不再做第二次审稿 |

### 2.4 看门狗与兜底交付（`/tmp/p283-p5.py`）

- run 级 `AbortController`：`runAbort` / `runSignal`，run 体内 13 处 `signal: progress.signal` 全部改指 `runSignal`（`throwIfAborted(progress.signal)` 保持客户端语义）；`bridgeClientAbort` 把客户端取消桥接到 `runAbort`；
- `budgetWatchdog = runBudgetMs > 0 ? setTimeout(…) : null`：到点打 `[pipeline] run wall-clock budget ran out; aborting in-flight LLM calls { novelId, runBudgetMs }` 并 `runAbort.abort(new Error('RUN_BUDGET_EXHAUSTED'))`（定时器 `unref()`）；
- `salvageOnBudget(stage)`：候选取 `currentDraft` > 已流出正文（`compactForCompare(streamedWriterText).length >= 800`）> `lastModelDraft`；命中则 `currentDraft = candidate; draftSource = 'model'; emitFinalDraft(currentDraft)`；writer 阶段 catch 内 `if (budgetGone() && salvageOnBudget('writer-error')) break;`（先于 `DRAFT_QUALITY_GATE_FAILED` 重抛与模板保底稿降级）；
- 收尾：`clearTimeout(budgetWatchdog)` + `progress.signal?.removeEventListener('abort', bridgeClientAbort)`；
- 收尾路径复核：循环后的「最优稿营救」要求 `auditStatus === 'fail' && bestAttemptScore >= 60`、「fallback → model 营救」要求 `draftSource === 'fallback'`，都**不会**在预算 break 时命中 ⇒ 兜底交付的 model 稿不会被覆盖。

### 2.5 可见性

- `PipelineProgress.onRunBudget?: (update: { stage; elapsedMs; budgetMs }) => void`；`PipelineResult.budgetExhaustedAt?: string`；
- SSE 新帧 `model_run_budget`（`server/routes/production.ts`）→ `src/lib/production-client.ts` 联合类型 + `allowedTypes` → `src/lib/production-budget-progress.ts` 的 `runBudgetMessage`（如「已到本次生成的时间上限（15.1 分钟 / 上限 15 分钟）：停止再次重写，交付当前最好的一稿供你审阅。」）→ `src/lib/hooks/useChapterProductionFlow.ts` 状态条。

预算是「何时收口」的上界，不改产品不变式：AI 仍只提议，终态仍是 `review_required` 交人审。

## 3 真机验证（隔离 3301，同一隔离库/作品，gemini-3.1-flash-lite @ low）

| 格（预算） | rep | run | 耗时 | 首 token | 交付 | 版本行 | 审计 | budget 事件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `lite-budget45`（45 s） | 1 | `f26aba9e` | 46.8 s | 25.2 s | 2 834 字 | model 2 834 + fallback 4 119 | 无（未开审稿） | `writer-error@45008/45000` |
| `lite-budget45`（45 s） | 2 | `64b246e4` | 46.8 s | 22.4 s | 4 133 字 | model 4 133 + fallback 4 119 | 无 | `writer-error@45020/45000` |
| `lite-budget300`（300 s，控制） | 1 | `c731bbe3` | 130.6 s | 17.3 s | 5 068 字 | model 5 068 + fallback 4 119 | `{74, attempts 2, fail}` | 无 |
| `lite-budget300`（300 s，控制） | 2 | `a825e8d3` | 267.1 s | 37.6 s | 4 475 字 | model 4 475 + fallback 4 119 | `{58, attempts 3, fail}` | 无 |

- 触发格：看门狗到点 abort（服务日志 `run wall-clock budget ran out; aborting in-flight LLM calls` + `budget exhausted; stopping retries` 各两条）→ writer catch 的 `salvageOnBudget('writer-error')` 把已流出的 model 正文交出去 → 落库 model 版本行、终态 `review_required`，比预算晚约 1.8 s 收口（46.8 s）。
- 控制格：预算 300 s 不触发（`budgets: []`，服务日志 0 条 budget 标记），两次都跑完整流程（含 resets / 定点修复轮 / 多轮审稿）⇒ 预算不影响正常运行。

## 4 门禁

- `tsc --noEmit` 0；`eslint server src shared tests scripts --max-warnings=0` 0（`/tmp/p283-gates3.log`，插桩移除后重跑）。
- 定向 6 文件 **61 / 61**（`tests/writer-quality-gate-retry.test.ts`（含两条新预算用例）、`tests/production-client.test.ts`、`tests/production-stream-disconnect.test.ts`、`tests/writer-live-stream.test.ts`、`tests/local-repair.test.ts`、`tests/writer-local-repair.test.ts`）。
- 后端全量 **1 555 / 1 555（36 suites，0 fail）**。
- 前端定向（预算/修复/审稿三条进度文案）**12 / 12**（`/tmp/p283-fe2.log`）。

## 5 残余（登记）

- **R-283-1**：预算到点交付的可能是**短稿**（触发格 2 834 / 4 133 字，低于 4 000 字章级合同）——刻意的取舍：宁可交半截真稿并标 `review_required`，也不再拖 33 分钟；未做「预算内优先续写」策略。
- **R-283-2**：934.8 s 挂死的**机制未定性**（只证明了 per-call 超时不是硬上界）；看门狗是兜底而非根因修复。
- **R-283-3**：`model_run_budget` 只在生成中的状态条可见，历史 run 无回看（同 R-272-2 / R-273-2 一类）。
- 沿用：R-282-1（片段归属靠字符串相等）、R-282-2（范围说明是提示词级约束）、R-279-1..4、R-280-1..3、R-277-2、R-276-1、R-275-1..3、R-273-3、R-272-1、R-269-1/3 等。

## 6 证据与复现

- 诊断：失败 run 库行 + ACCESS 行 + dump 记录（`/tmp/p282-lite.log`、`/tmp/writer-prompts-lite-p282*.jsonl`）；插桩与相位分析 `/tmp/p283-inst.py`、`/tmp/p283-lag.py`、`/tmp/p283-phases.py`（已在提交前移除插桩）。
- 预算真机：`/tmp/p283-budget.py`（两格 × 2 reps，`INKFLOW_RUN_BUDGET_MS` 注入），结果 `/tmp/p283-budget.json`、日志 `/tmp/p283-budget.log`、服务日志 `/tmp/p278-server-lite-budget45.log` / `-budget300.log`；汇总脚本 `/tmp/p283-budsum2.py`。
- 门禁：`/tmp/p283-gates.sh` → `/tmp/p283-gates3.log`；后端 `/tmp/p283-be.sh` → `/tmp/p283-be.log`；前端 `/tmp/p283-fe.sh` → `/tmp/p283-fe2.log`。
- 复现触发格：`INKFLOW_RUN_BUDGET_MS=45000` 起隔离实例，跑一次成章，观察 SSE `model_run_budget`（stage `writer-error` / `gate-fail` / `before-critic`）与库内 `chapter_production_run_versions` 的 model 版本行。
