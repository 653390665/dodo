# Plan 273 — strict 守门下的分段透传（首章正文边写边看）

- **Status**: ✅ 已完成（2026-10-01）
- **前置**: Plan 272（首章即时可见：beats 提前 + 正文回放）
- **残余**: R-273-1 / R-273-2 / R-273-3

## 问题（R-272-4）

Plan 272 让首章 beats 与正文都能提前到达，但真机一次交付的正文仍是 **4 块/章**（3 个场景 + 1 次续写），首块落在 19.0–26.7 s。上游本身是真流式：

| 上游探针（直连 8317，`stream:true`） | 块数 | 字数 | 首块 | 块大小 |
|---|---|---|---|---|
| gemini-3.8-flash-high | 21 | 630 | 11.3 s | 27–38 字 |
| claude-sonnet-4-6 | 373 | 720 | 2.5 s | 1–3 字 |

所以瓶颈不在上游，而在我们自己的 strict 守门：

- `server/lib/server-llm.ts:897` `deferQualityGuardedTokens = guardLevel === 'strict' && isCreativeWritingRequest(...) && typeof options.onToken === 'function'`；
- 命中后 `effectiveOptions.onToken = deferredTokenSink`（吞掉所有上游块），生成结束才整段回发（过门分支 `:929`、纠正分支 `:950`）；
- 生产实例 `promptGuardLevel = strict` → writer 每次调用只吐 1 块。

守门的初衷（不把未过门的正文暴露给作者）是对的，但「整段」粒度过粗：一段 4600 字的正文要等到最后一次调用结束才出现。

## 方案：holdback 分段透传

`server/lib/server-llm.ts`

- 新增 `STREAM_HOLDBACK_CHARS = 64`（默认窗口）、`STREAM_HOLDBACK_MAX_CHARS = 2_048`（clamp 上界）；
- 新增 `createHoldbackSink(onToken, holdbackChars)`：`push` 只回发「除末尾窗口之外」的内容，`flush` 补发尾部，`discard` 丢弃尾部；
- `GenerateTextOptions.streamHoldback?: number`；`deferQualityGuardedTokens` 且窗口 > 0 时用包装 sink 取代 `deferredTokenSink`（未开窗仍是 `deferredTokenSink`，身份判定不变）；
- 出口：过门 `holdbackSink.flush()`；纠正失败 / 判负 `holdbackSink?.discard()` 后再走既有整段回发（被否决那一稿的尾部永不外泄）。

`server/helpers/ai-production-pipeline.ts`

- `WRITER_LLM_OPTIONS` 与场景截断续写调用都带 `streamHoldback: STREAM_HOLDBACK_CHARS`；
- `emitFinalDraft` 增前缀续传：最终正文若以「已送出的正文（去空白后）」为前缀，只补发后缀，不再整段 reset + 回放（降低闪烁；非前缀差异仍走 reset）。

## 权衡（有意接受）

包装 sink 让 `generateTextRaw` 的 `tokensReachClient = onToken !== deferredTokenSink` 判真 → **一旦有正文到达客户端，传输层重试被抑制**（`server/lib/server-llm.ts:1585 if (everEmittedTokens) throw error;`，因为重试会把完整文本经同一个 onToken 再发一遍）。代价是首块之后的上游抖动不再由传输层兜底，改由管线的 reset + 定向重写 + 保底稿兜住；收益是作者从第 13–19 s 起就能看到正文逐段增长。

## 真机 A/B（隔离 3301，gemini-3.8-flash-high，同作品/章节）

| 版本 | run | beats | 首正文 | 正文块数 | draft_done | 审计 | 备注 |
|---|---|---|---|---|---|---|---|
| Plan 272 基线 | `05541c0c` | 9.0 s | 19.0 s | 4 | — | 88 pass | 交付 == model 版本 |
| Plan 272 基线 | `83bff6c8` | 17.9 s | 26.7 s | 4（@26.7/36.2/52.9/69.7 s） | — | 88 pass | 无重复投递 |
| Plan 273 | `20e31880` | 15.3 s | **18.5 s** | **173**（6–64 字，典型 28–35） | 63.2 s | 82 pass | RESETS 0，chars 5267 |
| Plan 273 | `cb0f9a39` | 9.8 s | **13.2 s** | **166**（4–64 字，典型 28–35） | 46.7 s | 88 pass | RESETS 0，chars 5018 |

- 两跑的**末块都是 64 字**（= holdback 窗口本身）——透传路径生效的直接指纹：末尾窗口在过门后由 `flush()` 一次补齐。
- 两跑 `model_draft_reset = 0`：最终正文与已送出的正文逐字一致，没有触发 reset（与 Plan 272「无重复投递」结论一致）。
- 块间隔约 260 ms（上游块大小 28–35 字），正文从首块到收稿连续增长约 30–45 s。

## 门禁

- `tsc --noEmit` = 0；`eslint server src shared tests scripts --max-warnings=0` = 0；
- 定向 7 文件 **72/72**：`tests/llm-stream-holdback.test.ts`（新，5 例：sink 语义 / 默认窗口在 clamp 内 / 过门分段可见且拼接逐字一致 / 判负丢弃尾部后整段回发纠正稿 / 未开窗维持整段回发）+ `llm-stream-retry` + `prompt-guard` + `writer-live-stream` + `writer-quality-gate-retry` + `production-stream-disconnect` + `draft-quality`。

## 残余

- **R-273-1**：holdback 窗口固定 64 字，未按上游块大小自适应（sonnet 类 1–3 字/块的上游，64 字约等于 2 s 静默）；
- **R-273-2**：critic 阶段仍无实时反馈（沿用 R-272-2）；
- **R-273-3**：reset 只在最终稿与已送出正文非前缀关系时触发，闪烁只是降频不是消除（R-272-3 的弱化版）。

## 证据与复现

- 上游粒度探针：`/tmp/p272-probe-stream.py`（直连 8317 逐块计时）。
- 真机：`/tmp/p272-launch2.py`（起隔离实例）+ `/tmp/p272-timeline2.py`（逐块打点驱动）→ `/tmp/p273-run1.log`（run `20e31880`）、`/tmp/p272-timeline2.log`（run `cb0f9a39`）。
- 门禁：`/tmp/p273-gates.sh` → `/tmp/p273-gates.log`、`/tmp/p273-tsc.log`、`/tmp/p273-lint.log`、`/tmp/p273-tests.log`。
