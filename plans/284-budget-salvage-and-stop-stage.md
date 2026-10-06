# Plan 284：预算兜底稿收口 —— 裁到完整句 · 反挂死回归 · 停止阶段可回看（R-283-1/2/3）

**Status**：代码 / 测试 / 门禁 ✅；真机 ✅（R-283-3 端到端落库 + R-283-1 由确定性集成测试取证）（2026-10-06）
**前置**：[`plans/283-run-budget-and-watchdog.md`](283-run-budget-and-watchdog.md)
**触发**：Plan 283 登记的三条残余（R-283-1 短稿/半句、R-283-2 934.8 s 挂死无回归保护、R-283-3 无历史回看）

## 1 问题

| 残余 | 现象 | 证据 |
| --- | --- | --- |
| R-283-1 | 预算到点交付的兜底稿可能停在半句（流被 abort，`streamedWriterText` 收在半句中间）；触发格 2 834 / 4 133 字低于 4 000 字合同却无任何标注 | Plan 283 §5 + `/tmp/p283-budget.json` |
| R-283-2 | 单次调用曾 934.8 s（`LLM operation production-pipeline-writer timed out`，治理超时 180 s）⇒ per-call 超时不是硬上界；机制未定性、无回归保护 | Plan 283 §1 + dump `scene 4 ms 934774` |
| R-283-3 | `budgetExhaustedAt` 只在 `PipelineResult`（`server/helpers/ai-production-pipeline.ts:235`）与生成中的 SSE 事件里，不落库、不进历史回看 | 全仓 grep：除管线声明与 return（`:2264`）外零消费 |

## 2 方案

### 2.1 裁到完整句（R-283-1）

`shared/lib/draft-quality.ts`：

```ts
export const DRAFT_TAIL_TRIM_MIN_RETAINED_RATIO = 0.6;
const DRAFT_SENTENCE_END = '。！？!?…；;';
export function trimDanglingTail(text: string): string
```

- 已以句末标点结尾 → 原样返回；否则左扫最后一个句末标点、切到其后；
- 保留量 < 原长 × 0.6 或找不到标点 → 原样返回（宁可交半句，也不把正文掏空）；
- 只回退、不补写任何内容。

`server/helpers/ai-production-pipeline.ts` 的 `salvageOnBudget`：

```ts
const salvaged = trimDanglingTail(candidate);
const salvagedChars = compactForCompare(salvaged).length;
noteBudgetExhausted(stage);
currentDraft = salvaged;
draftSource = 'model';
```

裁剪生效时 `logger.info('[pipeline] trimmed the salvaged draft back to its last complete sentence', { … })`；仍低于 `minDraftChars` 时 `logger.warn('[pipeline] salvaged draft is below the chapter contract after the run budget ran out', { … })`（如实标注、不退回模板保底稿）。

### 2.2 反挂死回归（R-283-2）

`tests/writer-quality-gate-retry.test.ts` harness 两个新开关：

- `writerHangs?: boolean`：writer 请求返回「只随 abort 拒绝」的挂起 promise；
- `writerPartialThenHangs?: boolean` + `partialDraft?: string`：先按 40 字/块推 SSE 增量、不发结束帧、随后挂住；`init.signal` abort 时 `controller.error()`。

两条用例：

- `a hung writer call cannot outlive the run budget (plan 284 R-283-2)`：`runBudgetMs: 1500`，断言整跑 **< 4 000 ms**（严于 `clampToBudget` 的 5 s 下限 ⇒ 只有看门狗 abort 经 `runSignal` 传到治理门的 `Promise.race` 才可能通过），且 `budgetExhaustedAt` 有值；
- `a budget-salvaged draft is trimmed back to its last complete sentence (plan 284 R-283-1)`：断言 `source === 'model'`、`budgetExhaustedAt === 'writer-error'`、交付稿以「。」结尾、半句尾巴被丢、流式正文保留。

### 2.3 停止阶段落库与回看（R-283-3）

- 库：`server/lib/db-init.ts:720` `ensureColumn('chapter_production_runs', 'budget_exhausted_at', 'TEXT')`（存停止阶段，正常跑完为 NULL）；
- 类型 / 映射 / 写入：`shared/types/novel.ts:259` 的 `budgetExhaustedAt?: string`、`server/lib/db-mappers.ts:344`/`:684` 双向映射、`server/lib/db/production.ts:24`/`:37` 的 `insertColumns`/`updateColumns`、`server/routes/production.ts:1192-1196` 守卫式展开（无值不下发，避免清掉既有值）；
- UI：`src/lib/production-budget-progress.ts` 的 `budgetStageLabel()`（before-retry 重写前 / gate-fail 正文质量门失败后 / local-repair 局部修复 / critic-retry 审稿重试 / before-critic 审稿前 / writer-error 写作调用异常后），`src/components/ProductionRunReview.tsx` 在 run 带该字段时渲染 `role="status"` 横幅：「本次生成到时间上限（<阶段>）：交付的是当时最好的一稿，可能不完整，请审阅后再决定是否接受。」

## 3 验证

- **R-283-3 真机端到端**（隔离 3301，`INKFLOW_RUN_BUDGET_MS=45000`，gemini-3.1-flash-lite）：SSE 收到 `model_run_budget {stage:'before-critic', elapsedMs:741254, budgetMs:45000}`，库行读回 `budgetExhaustedAt: 'before-critic'`（run `33caed9f` / `7738e1b1`）⇒ 列、映射、路由写入、回读全通。
- 上游不可用：本机代理客户端 7897 `Connection refused` → CLIProxyAPI（8317）全模型 `503 auth_unavailable`（antigravity OAuth 刷新失败）⇒「上游真流式 + 预算」臂无法复跑。
- 假 provider 试验（`/tmp/p284-fake-provider.py` 端口 8399 + `/tmp/p284-trim.py`）：修好响应框架后 run 确能流式（firstToken 2.0 s），但 **abort 未能立即解除「连接已建立但不再返回数据」的流读取**（仍约 700 s、两次 300 s 挂住后回落保底稿）⇒ 该路线放弃，R-283-1 改由确定性集成测试取证。

## 4 门禁

- `tsc --noEmit` 0；`eslint server src shared tests scripts --max-warnings=0` 0。
- 定向后端 5 文件 **83 / 83**（8.0 s；`/tmp/p284-g-tests.log`）；前端定向 2 文件 **24 / 24**（`/tmp/p284-g-fe.log`）。
- 后端全量 **1 530 pass / 0 fail**（`/tmp/p284-be-full.log`：1 533 tests、3 cancelled 文件包装、764 s）；3 个 cancelled（`tests/continuation-pack*.test.ts`）单跑 **28 / 28**（1.04 s）⇒ 负载型文件包装超时，非回归。
- 前端全量 **166 files / 1 049 tests 全过**（`/tmp/p284-fe-full.log`）；退出码 1 来自 1 条 vitest worker 启动超时的 unhandled error（`src/tests/project-assistant-drawer.test.tsx`），该文件单跑 **4 / 4**（1.16 s）⇒ 池负载抖动。

## 5 残余（登记）

- **R-284-1**：挂死流上 abort 的**即时性未定性**——真机 45 s 用例能按时收口（46.8 s），假 provider 的「已建连但不再返回数据」场景却拖到约 700 s；R-283-2 的根因仍未定位（看门狗是兜底而非根因修复）。
- **R-284-2**：`--test-concurrency=1` 下 `tests/production-stream-disconnect.test.ts` 会挂住不退出（干净树同样复现，=4 时正常）⇒ 预存在的测试挂起，已在本次门禁排查中确认与本次改动无关。
- 沿用：R-283-1 的「短稿」策略本身（宁可交短稿并标注）、R-283-2（机制未定性）、R-282-1/R-282-2、R-279-1..4、R-280-1..3、R-277-2、R-276-1、R-275-1..3、R-273-3、R-272-1、R-269-1/3。

## 6 证据与复现

- 补丁脚本：`/tmp/p284-p1.py`（裁句 + 管线）、`p2a.py`/`p2b.py`/`p2b2.py`（落库）、`p2c.py`/`p2c2.py`（反挂死测试）、`p3.py`（UI 横幅）、`p2d.py`（确定性集成用例）。
- 门禁：`/tmp/p284-gates.sh` → `/tmp/p284-gates-run.log`、`/tmp/p284-g-tests.log`、`/tmp/p284-g-fe.log`；全量：`/tmp/p284-suites.sh` → `/tmp/p284-suites.log`、`/tmp/p284-be-full.log`、`/tmp/p284-fe-full.log`。
- 真机：`/tmp/p284-budget.py` + `/tmp/p284-budget.json`（预算格）、`/tmp/p284-fake-provider.py` + `/tmp/p284-trim.py`（假 provider 试验）。
- 复现裁句：`node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/writer-quality-gate-retry.test.ts`；复现预算落库：`INKFLOW_RUN_BUDGET_MS=45000` 起隔离实例跑一次成章，看 SSE `model_run_budget` 与库内 `chapter_production_runs.budget_exhausted_at`。
