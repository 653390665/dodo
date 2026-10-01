# Plan 268 —— high 档超时与预算截断（推理档位可用性修复）

- Status: ✅ 已完成（2026-10-01）
- Labels: `ready-for-agent`
- 上游：Plan 267（写作档位真机对照 → 发现 high 不可用）、Plan 265（OpenAI 兼容端点思考控制）、Plan 266（正文质量门与保底稿）

## 0. 摘要

Plan 267 实测结论是「应用内 high 档不可用」（更慢、稿更短、critic 审计不可用）。本轮定位到两处真因**都在超时/预算层，不在模型质量层**，并逐项修掉：

1. **critic 70 s 被掐断**：`CRITIC_LLM_OPTIONS.timeoutMs = 35_000`，失败后重试 ×2（`Math.min(criticTimeoutMs * 2, CRITIC_MAX_TIMEOUT_MS=120_000)`）= 70 s；high 档单次审稿常需 >70 s → `Critic request failed (unknown) — retrying once with 70000ms timeout` → `Critic fell back — accepting draft { code: 'timeout' }` → 审计不可用。
2. **writer 预算耗尽被当「无效输出」**：`server/lib/server-llm.ts:153-159` 的默认 `retriable` 把 `reasoning_only` / `length_exhausted` 排除（Plan 265 前旧契约），high 档思考耗尽 `maxTokens`（8192）时直接判死 → 回退保底稿。

修复只动**超时与 token 预算**，不动模型行为、不动质量门与审计合同：

- **档位超时缩放**：`high` 3×、`xhigh`/`max` 4×、`medium` 1.5×、`minimal`/`low` 1× → high 档下 writer 180 s→540 s、critic 35 s→105 s、重试上限 120 s→360 s。
- **预算类重试**：把 `reasoning_only` / `length_exhausted` 视为「预算不足、可放大重试」，重试前 `max_tokens` ×2（封顶 `BUDGET_RETRY_TOKEN_CEILING = 32_768`）并记 `[llm] budget-exhausted retry (<reason>) with maxTokens=…`；`ProviderError.retriable` 语义保持不变（仍 false），重试在调用层完成。

## 1. 变更

- `server/lib/server-llm.ts`
  - `:404-416`：`const REASONING_EFFORT_TIMEOUT_SCALES: Record<string, number> = { minimal: 1, low: 1, medium: 1.5, high: 3, xhigh: 4, max: 4 }` + `export function reasoningEffortTimeoutScale(env: NodeJS.ProcessEnv = process.env): number`（非法/缺省 → 1）。
  - `:419-423`：`export function scaleTimeoutForReasoningEffort(baseMs: number, env: NodeJS.ProcessEnv = process.env): number` → `Math.round(baseMs * reasoningEffortTimeoutScale(env))`。
  - `:682-690`：`const BUDGET_RETRY_TOKEN_CEILING = 32_768;`、`function isBudgetExhaustedReason(reason?: string): boolean`、`function escalateBudgetRetryTokens(current?: number): number | undefined`（`Math.min(current * 2, Math.max(current, 32_768))`）。
  - `:1151-1165`（Gemini 流式重试）与 `:1597-1624`（OpenAI 兼容重试）在重试前放大预算并打日志；`generateTextRaw` 的 `maxTokens` 改为可变（局部 `let maxTokens = requestedMaxTokens`）。
- `server/helpers/ai-production-pipeline.ts`
  - `:202-208`：`export function resolveWriterTimeoutMs(env)`（`INKFLOW_WRITER_TIMEOUT_MS` > 0 时优先，否则 `scaleTimeoutForReasoningEffort(180_000, env)`）；`WRITER_LLM_OPTIONS.timeoutMs` 改用它。
  - `:353-382`：`resolveCriticTimeoutMs(env)`（35_000×系数，env 优先）、`resolveCriticMaxTimeoutMs(env)`（120_000×系数）；`CRITIC_LLM_OPTIONS.timeoutMs` 与 `const CRITIC_MAX_TIMEOUT_MS` 改用它俩。
- 测试
  - `tests/server-llm.test.ts`：旧契约（reasoning_only / length_exhausted 只调一次）改为断言 `calls === 3` 与 `max_tokens` 序列 `[2000, 4000, 8000]`；新增 `budget-exhausted output retries with a larger token budget and can recover (Plan 268)`。
  - 新文件 `tests/reasoning-effort-timeouts.test.ts`（3 例）：档位系数映射；基线缩放（35 000→105 000、120 000→360 000）；`resolveWriterTimeoutMs`/`resolveCriticTimeoutMs`/`resolveCriticMaxTimeoutMs` 的 env 覆盖优先与「上限 > 基线」。

## 2. 验证读数

- 门禁（`/tmp/p268-gates.log`）：`TSC_EXIT=0`、`LINT_EXIT=0`、后端全量 **1488 tests / 1488 pass / 0 fail**；定向 `tests/server-llm.test.ts` + `tests/reasoning-effort-timeouts.test.ts` = **34/34**。
- 真机复验（隔离 3301，`INKFLOW_REASONING_EFFORT=high`，同一作品 `d23eef68-ae47-4ca5-9e5d-cf6ab23bb1df` / 章 `99b28a6e-0404-4197-ad63-e43d0be69b37`，n=2，驱动 `/tmp/p268-high-run.py`）：

| run | elapsed | model 稿 | fallback 稿 | critic |
| --- | --- | --- | --- | --- |
| `1bcac272-4452-4bf8-ac9e-d61b370f1b8f` | 617.6 s | 4740 字 | 4186 字 | 结构化五维 JSON（可读性 6） |
| `3521c72b-7444-43d5-b616-33ea14ade46b` | 491.6 s | 5894 字 | 4186 字 | 结构化五维 JSON（可读性 5） |

- 服务端统计（两跑累计）：`budgetRetry 0`、`writerGateFallback 2`、`criticUnknown 0`、`criticFellBack 0`、`criticRetry 0`、`reasoningOnly 0` → **critic 超时降级归零**（修复前 high 档必然出现）；反代日志实证 `provider=antigravity model=gemini-3.8-flash-high mode=level budget=0 level=high`。
- 结论：**high 档超时问题已解决**；默认档位是否改成 high 是另一件事（见残余）。

## 3. 决策理由

- **只缩放超时与预算，不降低门禁**：high 档失败在「等得不够久 / token 给得不够」，不在输出不合格；降低质量门或审计合同会掩盖真问题。
- **预算重试不改变 `ProviderError.retriable`**：该字段是上游错误分类契约（Plan 265 引入 `compatibilityMode` 同族），改它会把「预算不足」混进「参数不兼容/端点半途」的诊断面；重试改由调用层按 reason 判定，诊断报文保持原样。
- **env 覆盖优先且不参与缩放**：`INKFLOW_WRITER_TIMEOUT_MS` / `INKFLOW_CRITIC_TIMEOUT_MS` 是排障用的硬覆盖，若再乘档位系数会让「我设了 60000」变得不可预测。

## 4. 残余 / 后续

- **R-268-1**：high 档模型稿**在本轮验证跑**触发过正文质量门硬门（`duplicate-paragraph` + `literary-slop`）——★ 见 §7 修正：同日 A/B 复跑（n=2）未复现，属运行方差，需更多样本定性。
- **R-268-2**：`budgetRetry` 本次为 0（未触发该分支）——两条新用例与既有单测覆盖了该路径，但真机尚未复现 reasoning_only 场景，属「防御性修复」。
- **R-267-1（未定位）**：草稿尾部混入无关「年代戏」片段（同臂跨 rep 逐字相同，全库检索只命中 run/version 草稿）仍开。

## 5. 复现

- 门禁：`bash /tmp/p268-gates.sh`（tsc + eslint + 后端全量）。
- 真机：`INKFLOW_REASONING_EFFORT=high bash /tmp/launch-3301-effort.sh` → `python3 /tmp/p268-high-run.py`。
- 定向：`NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/server-llm.test.ts tests/reasoning-effort-timeouts.test.ts`。

## 6. 证据文件

`/tmp/p268-patch.py`、`/tmp/p268-tsc1.log`、`/tmp/p268-test1.log`、`/tmp/p268-gates.log`、`/tmp/p268-high-driver.log`、`/tmp/p268-high-server.log`、`/tmp/p268-high-result.json`、`/tmp/gate-fail-effort-high.jsonl`。

## 7. 补记：修复后 low/high 真机对照（2026-10-01，n=2/档）

同一隔离实例（3301）、同一作品/章节，`INKFLOW_REASONING_EFFORT` 控制档位（反代日志 `level=high|low` 实证）。驱动 `/tmp/effort-ab-run.py`，读数 `/tmp/effort-ab/result.json`/`/tmp/effort268-analysis.json`。

| arm | rep | elapsed | model 稿 | 本轮门禁 | 审计总分 | 审计维度（可读/分镜/冲突/风格/网文感） | auditMeta |
| --- | --- | --- | --- | --- | --- | --- | --- |
| high | r1 | 335.2 s | 5034 字 | pass（无拒稿） | 42 | 8/9/8/9/8 | pass / score 84 |
| high | r2 | 164.1 s | 5296 字 | pass | 42 | 8/9/8/9/8 | pass / 84 |
| low | r1 | 65.0 s | 5720 字 | pass | 46 | 9/10/9/9/9 | pass / 92 |
| low | r2 | 63.1 s | 4958 字 | pass | 44 | 9/9/8/9/9 | pass / 88 |

- 管线层：四跑均 `auditMeta.status='pass'`、`degradation={beatsSource:'model', draftSource:'model'}`（无降级），critic 全部产出结构化五维 JSON（high 3267 / 2155 B，low 1912 / 1698 B）；high 档本轮 `Critic fell back` / `Critic audit unknown` 均为 0（修复前必然出现）。
- 文体读数（`scripts/report-card-ab-metrics.ts /tmp/effort-drafts268`）：high 5165 字均 / 89 段 / 套话 1.5 / 均句 32.2；low 5339 字均 / 112.5 段 / 套话 1.5 / 均句 29.14；两档门禁 2/2，唯一 finding 均为 `literary-polish`（P2）。
- 盲评（4 稿匿名 X1..X4；claude-sonnet-4-6 strict `json_schema` + gpt-oss-120b-medium；映射 X1=`low-r2` / X2=`high-r2` / X3=`high-r1` / X4=`low-r1`）：claude `X1 > X4 > X3 > X2`（低档占 1、2 名），gpt-oss `X1 > X2 > X3 > X4`；合并 8 个名次 **low 均 2.0 vs high 均 3.0** → 低档不劣，且产品审计（46/44 vs 42/42）与盲评方向一致。
- **R-268-1 修正**：本 A/B 中 high 档两跑均**未触发**正文质量门硬门（`/tmp/gate-fail-effort-high.jsonl` 未新增行，mtime 仍 19:34）；「high 更易触硬门」来自修复前那次验证跑（即该 dump 文件的两行 `duplicate-paragraph + literary-slop`），属**运行方差**而非档位必然，需更多样本才能定性。
- 结论：修复后 high 档**可用**（超时/降级归零、审计结构化、模型稿落库），但代价仍是 2.5–5× 延迟（335/164 s vs 65/63 s），且审计总分与盲评都不优于 low → **默认仍保持 `low`**。
