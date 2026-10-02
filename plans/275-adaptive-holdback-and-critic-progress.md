# Plan 275 — 自适应 holdback 窗口 + critic 实时进度

- **Status**: ✅ 已完成（2026-10-01）
- **前置**: Plan 273（分段透传，留 R-273-1 / R-273-2）；Plan 269（定点修复，未批量）
- **残余**: R-275-1 / R-275-2 / R-275-3（新增）；R-273-3 / R-269-1..3 / R-272-1 沿用

## 问题

### R-273-1（窗口固定 64 字）

Plan 273 的透传窗口是常量：`server/lib/server-llm.ts` 里 `STREAM_HOLDBACK_CHARS = 64`，`createHoldbackSink` 在 `push` 里只按「pending 超出 configured 窗口」回发。对 gemini 一类 27–38 字/块的上游够用（≈2 块出一次），但对 sonnet 一类 **1–3 字/块** 的上游就是 64 块 ≈ 2 s 静默；真机 Plan 273 两跑的末块均恰好 64 字，就是这个固定窗口的指纹。

### R-273-2（critic 阶段无实时反馈）

critic 阶段（真机 6–8 s，含一次传输/解析重试时更长）只有一个 `model_audit` 终态事件，期间 UI 只有一句静态文案（`AI critic 进行中...`）。作者无法区分「正在审」「正在重试」「已出分正在整理」。

## 方案 W1：窗口按上游块大小自适应

`server/lib/server-llm.ts`

- 新增 `export const STREAM_HOLDBACK_MIN_CHARS = 16;`（下限，保证细粒度上游不至于两三字就回发一次）；
- 新增 `export function holdbackWindowForChunk(chunkChars: number, configuredChars: number): number`：

```ts
const ceiling = Math.max(1, configuredChars);
const floor = Math.min(STREAM_HOLDBACK_MIN_CHARS, ceiling);
return Math.max(floor, Math.min(ceiling, chunkChars * 2));
```

- `createHoldbackSink` 改为 **逐 push 重算窗口**：`let window = Math.max(1, holdbackChars);` → `push` 内 `window = holdbackWindowForChunk(token.length, holdbackChars);` 之后才判断 `pending.length <= window`。
- 语义：粗粒度上游（35 字/块）仍是 64–70 字窗口（≤ 上限 64），细粒度上游（2 字/块）窗口降到 16 字 → 首块到达时间从「64 块」缩到「16 块」量级；`flush` / `discard` 语义不变。

## 方案 W2：critic 阶段实时进度

- `server/helpers/ai-production-pipeline.ts`：`PipelineProgress` 增
  `onCriticProgress?: (update: { attempt: number; stage: 'start' | 'retry' | 'parsed' | 'unknown'; reason?: string; score?: number }) => void;`；
- critic 循环顶（`criticRound += 1`）上报 `stage: 'start' | 'retry'`（重试轮带上一轮失败原因）、循环后上报 `stage: 'parsed' | 'unknown'`（带分数）；三段原因文案分别覆盖 **传输失败**（超时加倍重试）、**解析失败**（`审计未按结构化契约返回（<code>），收紧格式重试`）、**证据不足**（`审计结论不可验证（证据四类不全），补强证据要求重试`）；
- `server/routes/production.ts`：新增 SSE 事件 `model_critic_progress`（白名单 + 联合类型同步）；
- 前端：`src/lib/production-client.ts` 白名单/联合类型加该事件；新增 `src/lib/production-critic-progress.ts`（`criticProgressMessage` 生成状态条文案：`AI 正在审稿（第 N 轮）…` / `AI 审稿重试中（第 N 轮）：<原因>…` / `AI 审稿出分（第 N 轮）：<score>/100，正在整理结论…` / `AI 审稿未能定分（第 N 轮）：<原因>…`）；`useChapterProductionFlow.ts` 的 `model_critic_progress` 分支写入 `setProductionStatusMessage`（作者可见通道即 `ProductionRunReview.tsx:267-270` 的状态条）。

## 真机取证（隔离 3301，gemini-3.8-flash-high，同作品/章节）

run `2b479c85-413d-422a-926b-435ee8477d49`（elapsed 85.5 s）

| 事件 | 时刻 | 读数 |
|---|---|---|
| beats | 12,701 ms | 1,175 字 |
| model_draft_start | 12,724 ms | — |
| 首正文块 | 16,184 ms | 21 字 |
| model_draft_reset | 77,374 ms | 1 次（重放 24 字/块） |
| `model_critic_progress` | **77,414 ms** | `{attempt:1, stage:'start'}` |
| `model_critic_progress` | **85,511 ms** | `{attempt:1, stage:'parsed', score:90}` |
| model_audit / score / done | 85,516–85,521 ms | `{score:90, attempts:1, status:'pass'}` |

- **W1 生效指纹**：本次 407 块中自然流段落大小为 18–36 字（直方图 `[[24,234],[33,17],[34,16],[32,15],[29,13],[31,13],[36,12],[30,12]]`；其中 24 字 ×234 是 reset 后 `emitChunks` 的重放块，固定 24 字属既有实现）——**不再出现 Plan 273 那种「末块/多数块恰好 64 字」的整齐分布**，说明窗口按上游块大小在动。
- **W2 生效指纹**：critic 静默的 8.1 s（77,414 → 85,511 ms）被两条进度事件覆盖（start → parsed 带 score 90）；文案生成与事件接线另有单测覆盖（重试轮、unknown 轮）。
- 落库（只读副本读 `chapter_production_run_versions`）：run `2b479c85` 两行版本 = `fallback` 4179 字（`a523346b…`，起跑占位）+ **`model` 5,466 字（`0c621f58…`）**；`chapter_production_runs.status = review_required`（等作者裁决）；章节正文 6,565 字。

## 门禁

- `tsc --noEmit` 0（`/tmp/p275-tsc.log` 空）；`eslint server src shared tests scripts --max-warnings=0` 0（`/tmp/p275-lint.log` 空）。首轮曾 `LINT_EXIT=1`：`server/helpers/ai-production-pipeline.ts:1330:9 no-useless-assignment`（`let criticRound = 1;` 初值恒被覆盖）→ 改 `let criticRound = 0;` + 循环顶 `criticRound += 1;`。
- 定向后端 **28/28**（`tests/llm-stream-holdback.test.ts` + `tests/critic-parse-retry.test.ts` + `tests/production-client.test.ts` + `tests/writer-live-stream.test.ts`）+ **7/7**（`tests/production-stream-disconnect.test.ts`）。
- 定向前端 **21/21**（`src/tests/production-critic-progress.test.ts` 4 + `src/tests/production-run-review.test.tsx` 17）。
- 新增/扩展测试：`holdbackWindowForChunk` clamp 表（`f(2,64)=f(8,64)=16`、`f(35,64)=f(1000,64)=64`、`f(1,4)=4`、`f(9,8)=8`）+ 细粒度用例（2 字/块 ×9 时第 9 次 push 即回发 `['ab']`，固定 64 字窗口此刻仍为空）；`runPipelineWithCriticScript` 采集 `criticProgress` 断言 `start/attempt 1` → `retry/attempt 2`（原因含「结构化契约」）→ `parsed`（score 为 number）；`production-client` 断言新事件可解析。

## 残余

- **R-275-1**：critic 进度只到「轮次 + 阶段 + 原因」，尚未透传五维结论片段；作者仍要等终态才能看到审计内容。
- **R-275-2**：真机这一跑仍触发 1 次 `model_draft_reset`（已送出 12,159 字 = 自然流 ≈6,543 + 重放 5,616），即作者会看到一次整段重放；成因仍是「最终稿与已送出正文非前缀关系」（R-273-3 的具体表现），未消除。
- **R-275-3**：自适应窗口只按上游块大小定窗，与守门重放路径（`emitChunks` 固定 24 字）未联动。
- **沿用未动工**：R-269-1（定点修复未批量）/ R-269-2（P2 残留原样交付）/ R-269-3（点修失败回落整章重写）/ R-272-1（split-scene 场景衔接）/ R-273-3（reset 触发面）。

## 证据与复现

- 补丁：`/tmp/p275-patch-w1.py`、`/tmp/p275-patch-w2.py`、`/tmp/p275-tests.py`、`/tmp/p275-fix-lint.py`。
- 门禁：`/tmp/p275-gates.sh` → `/tmp/p275-gates.log`（`TSC_EXIT=0` / `LINT_EXIT=0` / `TEST_EXIT=0` / `TEST2_EXIT=0`）；`/tmp/p275-tests.log`、`/tmp/p275-tests2.log`；前端 `/tmp/p275-fe.sh` → `/tmp/p275-fe-gates.log`、`/tmp/p275-fe.log`。
- 真机：`/tmp/p275-launch.py`（宿主侧起隔离 3301 + 探代理 + 起驱动）、`/tmp/p275-drive.py`（逐事件打点，含 critic 进度与块大小直方图）→ `/tmp/p275-launch.log`、`/tmp/p275-drive.log`、`/tmp/p275-server.log`；落库核对 `/tmp/p275-verify2.py`（只读副本 `/tmp/ro275/data.db`）。
