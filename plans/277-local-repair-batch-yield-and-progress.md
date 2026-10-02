# Plan 277 — 定点修复：批量回执可用性 · patch 输出模式 · 修复进度可见

- **Status**: ✅ 已完成（2026-10-02）
- **前置**: Plan 276（定点修复：批量调用 · 两轮收敛 · P2 残留可见），留 R-276-1 / R-276-2 / R-276-3
- **残余**: R-277-1 / R-277-2（新增）；沿用 R-269-3 / R-272-1 / R-273-3 / R-275-1..3

## 问题

### R-276-1（批量回执 0 槽可用）

真机 run `d106cbee-ce54-4d23-8857-ca26d09332b1`（gemini-3.1-flash-lite，151.1 s）：命中 4 处 → 分块 2 次（每块 2 槽）→ 两块回执都是 `filled: 0` → 4 处全由单句补齐（`batchCalls 2 / singleCalls 4 / applied 4 / status passed`）。批量没省下调用，反倒多花两次请求。

### R-276-2（残句驱动第二轮真机未观测）

第一轮修完已过门、但报告里仍有 P2 级可定位残句（如 `repeated-opening`）时，`attemptLocalRepairs` 直接返回——第二轮只在「没过门」时才会跑。夹具里已能构造，但真机没读数。

### R-276-3（修复过程对作者不可见）

定点修复要花几秒到几十秒（每处一次 LLM 调用），但这段时间状态条停在「AI critic 进行中」，作者看不到「正在修哪几句」。P2 残留也只进服务器日志。

## 方案

### W1 批量回执可用性（三条）

`shared/lib/local-repair.ts`

- `MAX_LOCAL_REPAIR_BATCH_TARGETS = 2`：每次批量调用只送 2 处，回到散文守卫的容忍带（`GUARD_TOLERANT_VIOLATIONS = 2`）。
- `parseLooseSlotResponse(text, total, results): boolean`：先按 `【第\s*(\d+)\s*处】` 切块，再按 `^(?:第\s*)?(\d+)\s*[.、）)]\s*(.+?)$`（`gm`）收编号行；`parseLocalRepairBatchResponse` 在找不到 `@@FIX` 标记时先试 loose，失败且 `total === 1` 才退回「整段取用」。
- 段界：`matches` 记 `{slot, start, body}`，段 = `text.slice(entry.body, next ? next.start : text.length)`（原按 `next.start` = 下一标题**末尾**切片会把下一标题吞进正文）。

`server/helpers/ai-production-pipeline.ts`

- `requestBatchLocalRepairs(params, targets, stats)` 逐块调用（每块独立 `buildLocalRepairBatchPrompt` + `parseLocalRepairBatchResponse(chunk, chunk.length)`），`BatchRepairStats { calls, filled }`，逐块日志 `[INFO] [pipeline] local gate repair batch chunk { novelId, offset, size, filled }`。
- 逐槽补漏：`let replacement = batchReplacements[index]; if (!replacement) { singleCalls += 1; replacement = await requestSingleLocalRepair(callContext, target); }`。
- **patch 输出模式**：`server/lib/server-llm.ts` 的 `GenerateTextOptions.outputMode` 扩为 `'prose' | 'audit-json' | 'patch'`，在 audit-json 分支后新增 `if (outputMode === 'patch') { return generateTextRaw(config, options); }`——批量/单句修复回执是补丁载荷（不是正文），不交给散文输出门；质量把关交给写回后的整章门复检。`LOCAL_REPAIR_LLM_OPTIONS` 增 `outputMode: 'patch' as const`（`LOCAL_REPAIR_BATCH_LLM_OPTIONS` 经展开继承）。

### W2 残句驱动第二轮

- 新增 `countLocalizableResidue(text, report, minDraftChars): number`：用与选目标同一套门槛（`selectLocalRepairTargets` 对象入参，`{ text, findings, hits, minChars }`；`selection.repair` 为假即 0），避免用原始命中数开出「注定被拒」的一轮。
- `attemptLocalRepairs`：累计 `batchCalls / singleCalls`，留底 `bestPassingText / bestPassingReport / bestResidualCodes`；过门分支不再直接 `return`——`round + 1 < MAX_LOCAL_REPAIR_ROUNDS && residue > 0` 时继续第二轮；空轮与尾部失败出口都优先返回 best-passing（第二轮变差也不丢已过门正文）。

### W3 修复进度可见

- `PipelineProgress.onWriterRepair?: (update: { round; targets; applied; batchCalls; singleCalls; status: 'passed'|'residual'|'failed'; residualCodes?: string[] }) => void`；`server/routes/production.ts` 在 `onWriterDone` 后接 `onWriterRepair` → SSE `model_writer_repair`（`src/lib/production-client.ts` 联合类型 + 白名单）。
- 新增 `src/lib/production-repair-progress.ts`：`writerRepairMessage(update)` → 「已局部修好门禁命中的句子（第 N 轮 · 修补 a/t 处），继续审稿…」/ `residual` 带 `（code1、code2）` / 「局部修复未通过门禁（…），转为整章重写…」；`useChapterProductionFlow` 进状态条。

## 根因链（为什么批量回执会 0 槽）

- 回执被当成正文管：`generateText` 对 creative 请求的输出过 `checkOutputGuard`，判负即用 `[SYSTEM CORRECTION GATE / 去AI俗套自动纠错重写]` 把整份回执改写成干净场景 → `@@FIX` 标记全丢 → 解析 0 槽。
- 模型本身能守格式：探针 `/tmp/p277-guard-probe.ts`（1:1 复制批量版式、2 槽）在 `strict`（4.9 s）与 `disabled`（3.4 s）下都拿到 `MARKERS=["@@FIX","@@FIX"]`。
- 第二因是格式漂移（编号行 / `【第 n 处】` 块而非 `@@FIX n@@`）——用 loose 解析兜住。

## 测试与门禁

- 新增 `tests/llm-patch-output-mode.test.ts`：patch 模式原样返回含软命中的补丁（1 次 fetch）、prose 模式仍纠错重写（2 次 fetch）。
- `tests/local-repair.test.ts` 补 loose 解析（`【第 n 处】` 块与编号行）与段界用例；`tests/writer-local-repair.test.ts` 夹具适配分块（test1 `batchCalls 2 / singleCalls 0`；test4 `rounds 2 / targets 5 / applied 5 / batchCalls 3 / singleCalls 0 / residualCodes ['repeated-opening']`；test5 同形 `singleCalls 0`）。
- 门禁（`/tmp/p277b-gates.log`）：`tsc --noEmit` 0 / `eslint server src shared tests scripts --max-warnings=0` 0 / 定向 **22/22**（`tests/llm-patch-output-mode.test.ts` + `tests/writer-local-repair.test.ts` + `tests/local-repair.test.ts`）。
- 套件：前端 **2 files / 8 tests**（新 `src/tests/production-repair-progress.test.ts` 4 例 + `production-critic-progress` 4 例，`/tmp/p277-fe.log`）；后端全量 **1525 tests / 1525 pass / 36 suites / 0 fail**（`/tmp/p277-be.log`，270877 ms）。**patch 模式改动后复跑**：后端 **1527 tests / 1527 pass / 36 suites / 0 fail**（`/tmp/p277-be2.log`，347.9 s）；前端全量 1 file / 2 tests 失败（`src/tests/continuation-import-view.test.tsx` 的 `waitFor` 1.5 s 超时，与本次改动无关，且与后端套件并发运行）——单文件独立重跑 **12/12 pass**（`/tmp/p277-fe3.log`，16.4 s）⇒ 负载型抖动。

## 真机取证（隔离 3301，作品 d23eef68 / 章节 99b28a6e）

| 阶段 | run | 模型 | 耗时 | 命中与结果 |
| --- | --- | --- | --- | --- |
| 修复前 | `d106cbee` | flash-lite | 151.1 s | 4 目标 / `batchCalls 2 / singleCalls 4` / 两块 `filled: 0` / 修复通过；`model_writer_repair` 帧端到端可见 + `SCORE 80 pass` |
| 修复后 | `76465702` `a5fea6fd` `aa7eae37` `1b14fb69` `76a47535` `fb4b35b5` `0b6f2906` | flash-lite / 3.5-flash-lite / gpt-oss-120b-medium | 85–331 s | 均未触发可定位软命中（`REPAIR_COUNT 0`） |
| 修复后（拒修） | `aa7eae37` | 3.5-flash-lite | 85.0 s | `WRITER_REPAIR {round:1, targets:0, applied:0, batchCalls:0, singleCalls:0, status:'failed'}` = 无可定位目标的拒修路径 |
| 强制触发 | `22ff34bc`（阈值临时 92）/ `5444976f`（临时 99） | flash-lite | 82.5 s / 220.9 s | 92 仍过门；99 强制失败但只得到拒修（`targets 0`）——阈值型失败不产生可定位分类命中 |

结论：R-276-3 已用真机关闭（SSE 帧 + 状态条）；批量回执 0 槽的两条成因（散文守卫改写、格式漂移）各有独立证据（探针 + 单元/夹具 + 根因读码），但**修复后未再遇到可定位软命中样本**，`filled > 0` 与残句第二轮的真机读数仍缺（登记为 R-277-1）。真机软命中本身是稀有事件（12 跑 1 命中）。

## 残余

- **R-277-1**：修复后真机未复现「可定位软命中」→ 分块批量的 `filled > 0` 与残句驱动第二轮在真机未观测（机制由单元/夹具覆盖）。
- **R-277-2**：拒修（无可定位目标）时 SSE 仍是 `status: 'failed'`，UI 文案说「转为整章重写…」——口径不准（实际是「这章没有可点修的句子」）。
- **沿用未动工**：R-269-3（点修失败回落整章重写）/ R-272-1（split-scene 场景衔接）/ R-273-3（reset 触发面）/ R-275-1..3。

## 教训（工程）

- 补丁脚本的 `@BS@` 占位符必须逐文件替换：只替换了管线文件，`shared/lib/local-repair.ts` 里残留 11 处字面 `@BS@`，正则全废、loose 解析一度是死代码。
- Python 写 JS 测试时不要在字符串里写 `\n`：两层转义会塌成真实换行（`TS1002: Unterminated string literal`）——一律用 `String.fromCharCode(10)`。
- 想强制触发修复路径不能只抬起 `MIN_COMPLETE_CHAPTER_SLOP_SCORE`：阈值型失败没有可定位的分类命中，只会走拒修。

## 证据与复现

- 补丁：`/tmp/p277-patch1.py`、`/tmp/p277-patch2a.py`、`/tmp/p277-patch2b.py`、`/tmp/p277-patch3.py`、`/tmp/p277-patch4.py`、`/tmp/p277-patch4c.py`、`/tmp/p277-patch6.py`、`/tmp/p277-fix-tests.py`、`/tmp/p277-fix-slop-driver.py`。
- 门禁：`/tmp/p277-gates.log`、`/tmp/p277b-gates.log`、`/tmp/p277-tests.log`、`/tmp/p277b-tests.log`、`/tmp/p277-be.log`、`/tmp/p277-fe.log`、`/tmp/p277-be2.log`（修复后复跑）。
- 真机：`/tmp/p277-launch3.py`、`/tmp/p277-drive.py` → `/tmp/p277-drive.log`、`/tmp/p277-server.log`；狩猎 `/tmp/p277-hunt*.py` + `-launch.py`；强制触发 `/tmp/p277-forced-repair-run.py`、`/tmp/p277-forced-repair99.py`；探针 `/tmp/p277-guard-probe.ts` + `/tmp/p277-guard-probe.sh`。
