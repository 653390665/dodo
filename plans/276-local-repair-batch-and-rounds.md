# Plan 276 — 定点修复：批量调用 · 两轮收敛 · P2 残留可见

- **Status**: ✅ 已完成（2026-10-02）
- **前置**: Plan 269（门禁命中 → 段落级定点修复，留 R-269-1 / R-269-2 / R-269-3）
- **残余**: R-276-1 / R-276-2 / R-276-3（新增）；沿用 R-269-3 / R-272-1 / R-273-3 / R-275-1..3

## 问题

### R-269-1（每处一次调用）

`repairGateHitsLocally` 逐目标调用一次 LLM：3 处命中 = 3 次请求（真机与夹具读数均为「调用数 = 目标数」）。批量可把 N 次压成 1 次。

### R-269-2（P2 残留不可见）

修复写回后若仍有 P2 级残留（如 `repeated-opening`），复检通过，但残留信息只存在于报告对象里，日志与交付物都看不见。

### R-269-3（失败即整章重写）

定点修复不通过时直接回落整章重写（最贵的退路：真机弱模型下 writer 4 次调用 ≈ 40 s，整章重写还要再走 critic）。

## 方案

`shared/lib/local-repair.ts`

- `MAX_LOCAL_REPAIR_ROUNDS = 2`（:39）、`LOCAL_REPAIR_BATCH_MARKER = '@@FIX'`（:42）。
- `parseLocalRepairBatchResponse(raw, count): string[]`（:350）：按 `^[ \t]*@@FIX[ \t]*(\d+)[ \t]*@@[ \t]*$`（`gm`）切槽；`stripReplacementDecorations`（:325）去掉代码块围栏与 `替换后：` 一类装饰；缺号/错号保空串，由调用侧补漏。
- 段界修正：`matches` 记 `{slot, start, markerAt, end}`，段 = `text.slice(entry.start, next ? next.markerAt : entry.end)`（早先用 `next.start` = 下一标记行**之后**，上一段会吞掉下一个标记行）。
- `residualP2Codes(findings): string[]`（:386）：只取 `severity === 'P2'` 的 code 去重。

`server/helpers/ai-production-pipeline.ts`

- `buildLocalRepairBatchPrompt(targets, contextStr)`（:553）：每处一块 `【第 n 处】/ 原句：/ 前文衔接：/ 后文衔接：/ 本处问题：`；整段含 `【整体世界观与上下文背景】`、`【修补原则——必须严格遵守】`（= `LOCAL_REPAIR_INSTRUCTION`）、`【输出格式（共 N 段，顺序与下面给出的编号一致）】`、`【需要定点修复的段落】`。
- `requestBatchLocalRepairs`（:598，operation `production-pipeline-local-repair-batch`，`maxTokens = max(2048, 3072)`）：失败 warn（`Local gate repair batch call failed; falling back to per-sentence calls`）+ 返回全空串数组。
- 逐槽补漏（:712-718）：`const replacement = batchReplacements[index] || (await requestSingleLocalRepair(callContext, target));`
- 两轮（:788 `for (let round = 0; round < MAX_LOCAL_REPAIR_ROUNDS; round += 1)`）：首轮修完若复检通过 → 返回（带上 `residualCodes`）；否则用新报告的 findings/hits 再挑目标修第二轮；`summary.rounds` 计数。
- 交付日志（:1407-1416）：`[pipeline] local gate repair passed the prose quality gate {novelId, rounds, targets, applied, skipped, ...(residualCodes.length ? {residualCodes} : {})}`。

## 关键洞察：批量回执自己也要过散文守卫

- 批量响应走同一条 `generateText` 通路，输出会被 `checkOutputGuard` 审：回执含 ≥3 条高置信软命中即判负（`server/helpers/prompt-guard.ts:165 pass = score >= MIN_COMPLETE_CHAPTER_SLOP_SCORE && violations.length <= GUARD_TOLERANT_VIOLATIONS(=2)`，常量 `:5`）→ 追加一次 `[SYSTEM CORRECTION GATE …]` 纠错调用 → 纠错稿不再是 `@@FIX` 格式 → 解析全空 → 逐处回落单句调用。
- 夹具阈值实测（`/tmp/p276-residue-diag2.py`，三场景拼稿）：

| 残句数 | 章程门 `validateCompleteChapterDraftQuality` | 门禁 findings | 守卫 `checkOutputGuard` |
|---|---|---|---|
| 0 | ok | `[repeated-opening/P2]` | — |
| 1 | ok | `[…literary-polish/P2]` | pass（score 85 / violations 1） |
| 2 | ok | `[…literary-polish/P2]` | **fail**（70 / 2） |
| 3 | **fail** | `[…literary-slop/P1]` | **fail**（55 / 3） |

  ⇒ 单次响应 ≥3 条高置信软命中必被守卫拒；而拼稿要 ≥3 条命中才升 P1 —— 两轮场景必须把残句拆到多次调用（首轮批量 + 若干单句补齐）。

## 真机取证（隔离 3301，作品 `d23eef68` / 章节 `99b28a6e`）

| 跑 | 模型 | run | 耗时 | 审计 | 修复路径 |
|---|---|---|---|---|---|
| A | gemini-3.8-flash-high | `ccb01433` | 256.9 s | 84 pass（critic 重试 1 次） | 未触发（干净过门） |
| B | gemini-3.8-flash-high | `3990d755` | 69.0 s | 92 pass | 未触发 |
| C | gemini-3.1-flash-lite | `01a68994` | 221.4 s | 70 fail | 第 1 次：4 目标 → `{rounds:1, targets:4, applied:4, skipped:0}`（无 `residualCodes`）；第 2 次含 `duplicate-paragraph` → 不在可定点集合 → 拒绝本地修复 → 整章重写 |
| D | gemini-3.1-flash-lite（仪表化） | `c837e318` | 256.5 s | 48 fail（3 attempts） | **批量 1 次（0/3 可用槽）→ 单句回落 3 次 → `{rounds:1, targets:3, applied:3}`** |

- D 的插桩读数（事后从 `/tmp/p276-pipeline-clean.ts` 还原为 75066 B、sha256 前缀 `915b2393d4e94b09`）：`[p276dbg] batch repair response{"targets":3,"filled":0,"empty":3}` + `[p276dbg] single top-ups {"topUps":3,"repairs":3}` ⇒ 批量调用确实发出，但弱模型回执一个槽都不可用，退化路径逐处补单句，修复仍过门。
- 代理侧呼叫对齐（run C，窗口 18 次）：启动 liveness 1 + planner 1 + writer1 4（9.65/7.93/13.98/9.31 s）+ **修复 5（1 批量 + 4 单句）** + audit1 1 + writer2 4 + audit2 2 = 17 ✓（修复与 critic 调用没有 `[llm-usage]` 行，只能从代理日志对齐）。

## 门禁

- `tsc --noEmit` 0、`eslint server src shared tests scripts --max-warnings=0` 0、定向 `tests/local-repair.test.ts` + `tests/writer-local-repair.test.ts` **17/17**（`/tmp/p276-gates.log`）。
- 后端全量：**1506 tests / 1504 pass / 0 fail / 2 cancelled**（`tests/quota-generation-fifo.test.ts`、`tests/quota-guard.test.ts` 在 45 s 超时下取消，`/tmp/p276-be.log`）；两文件独立重跑（`--test-timeout=120000`）**19/19 pass** ⇒ 取消是负载所致，非真失败。
- 未触及前端代码。

## 残余

- **R-276-1**：弱模型（gemini-3.1-flash-lite）批量回执 0/3 槽可用（守卫判负或未按契约）→ 批量当前不省调用（1 + N）。待查根因：补可判别日志（回执长度、是否走过纠错门、各槽解析长度）。
- **R-276-2**：第二轮收敛在真机未观测到（两轮场景目前只在夹具里覆盖）。
- **R-276-3**：P2 残留只进服务器日志，未进交付物/UI（作者仍看不见 R-269-2 的读数）。
- **沿用未动工**：R-269-3（点修失败回落整章重写）/ R-272-1（split-scene 场景衔接）/ R-273-3（reset 触发面）/ R-275-1..3。

## 证据与复现

- 补丁：`/tmp/p276-patch3c.py`、`/tmp/p276-patch4.py`、`/tmp/p276-patch5.py`（lib 段）、`/tmp/p276-patch5b.py`（夹具）、`/tmp/p276-fix-literals.py`。
- 诊断：`/tmp/p276-probe-gate.py`（门禁探针）、`/tmp/p276-residue-diag2.py`（守卫/门禁阈值表）、`/tmp/p276-diag-sig.py`（请求签名，暴露 `GATE+BATCH` 纠错调用）、`/tmp/p276-diag-round2.py`（mock 插桩）、`/tmp/p276-instrument.py` / `/tmp/p276-revert-instrument.py`（真机插桩与还原，备份 `/tmp/p276-pipeline-clean.ts`）。
- 门禁：`/tmp/p276-gates.sh` → `/tmp/p276-gates.log`、`/tmp/p276-tests.log`、`/tmp/p276-be.log`、`/tmp/p276-quota.log`。
- 真机：`/tmp/p276-launch3.py`（起隔离 3301 + 切模型）、`/tmp/p276-drive.py` → `/tmp/p276-drive.log`、`/tmp/p276-server.log`、`/tmp/p276-launch.log`。
