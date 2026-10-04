# Plan 279：保底稿去年代化 · 长度续写两轮 · 确定性剥离的采用与交付

- Status：✅ 已完成（2026-10-04）——代码 + 测试 + 门禁 + 真机 flash 回归全绿
- 前置：`plans/278-setting-card-leak-and-length-continuation.md`（R-267-1 收口、设定卡泄漏门禁、长度续写首版、逐 attempt 标志重置）
- 触发：User said (m25317)「解决残留」

## 1. 问题

1. **保底稿仍带时代错位意象（登记项 R-278-1）**：`server/helpers/fallback-draft.ts` 的填充池（`expandDraftToMinimum`）里有 76 处古风道具/场景词（更鼓、更漏、梆子、马厩与青骡子、渡船与艄公、算命摊与签筒、布庄、银票、火盆、檐角的铁马、酒过三巡…）。保底稿是最后手段，但一旦交付就会与用户题材（现代/悬疑）错位；pro 系真机稿尾崩坏（R-267-1）就是这些句子被发现的地方。
2. **长度续写只允许一轮**：一轮续写补不到 4000 字下限时，短稿会直接交给下一道关卡（或走保底稿），而不是继续续写。
3. **确定性剥离「命中却不被采用」**：真机 pro 档位实测 strip 记录命中但 0 次采用——剥离后的稿子只要还剩任何非「篇幅不足」的缺陷（包含 P2 提示级）就被丢弃，泄漏正文照旧送审。
4. **剥离不穷尽**：`shared/lib/draft-quality.ts` 的 `detectSettingCardLeaks` 在第一条命中后 `break`，同一个名字在同一章里泄漏多次时只报一条 ⇒ 剥离只清第一条，剩余泄漏句既过不了干净稿标准、又因低于 ≥2 命中门槛而不触发门禁，被静默交付。
5. **剥离采用后没有授权交付**：交付分支要求 `(localRepairPassed || lengthContinuationPassed) && draftQuality.ok`；剥离采用只改了 `currentDraft/draftQuality`，没有置任何达标标志 ⇒ 已清门的脱敏稿被丢弃，落到保底稿分支（保底稿会把 context 里的档案句重新拼回正文）。

## 2. 方案与落地

### 2.1 保底稿填充池去年代化（`server/helpers/fallback-draft.ts`）
- 八个池提升到模块作用域并导出（原先定义在 `expandDraftToMinimum` 函数体内、与函数体语句交错，抽取必须按「`  const <name> = [` → 同缩进 `  ];`」逐数组取，不能按首尾锚点整段切片）：
  `hintSentence` :72、`export const FALLBACK_PARAGRAPH_TEMPLATES` :74、`FALLBACK_CADENCE_LINES` :157、`FALLBACK_DETAIL_HINTS` :184、`FALLBACK_TEXTURE_LINES` :234、`FALLBACK_REFLECTION_LINES` :261、`FALLBACK_TURN_LINES` :288、`FALLBACK_CYCLE_BRIDGES` :331、`FALLBACK_TEMPO_BEATS` :342；`export function expandDraftToMinimum(` 移到 :365；六套 `createDeck` :414-422 原地保留。
- 85 条替换把时代道具/场景改成中性描写（例：`檐角的铁马` → 檐下、`更漏/梆子/更鼓` → 远处的声音/硬物擦过、`马厩里那匹青骡子` → 车/牲口、`银票` → 纸张/信件、`刀鞘` → 硬物）；逐条断言 count==1，落地后 53 词时代词表全仓扫描 **零命中**（脚本 `/tmp/p279-checkA.py`）。
- 新增测试 `tests/fallback-draft-tone.test.ts`（2713 B）：`PERIOD_PROPS` 53 词表 + 两例——八个池渲染拼接零命中且 >2000 字；`buildFallbackSceneBeats + buildFallbackDraft(beats, context, 6000)` 端到端零命中且 ≥6000 字。

### 2.2 长度续写改为两轮上限（`server/helpers/ai-production-pipeline.ts`）
- `const MAX_LENGTH_CONTINUATION_ROUNDS = 2;` :491；循环 :1613-1704：`for (let continuationRound = 1; continuationRound <= MAX_LENGTH_CONTINUATION_ROUNDS; continuationRound += 1)`，每轮进门先判 `localRepairPassed || lengthContinuationPassed`、`draftQuality.findings` 里是否仍有 `chapter-below-contract`、`currentDraft.trim().length >= 800`；两条日志各加 `round` 字段；循环后新增 `length continuation rounds finished` 汇总日志 :1706-1713。

### 2.3 确定性剥离：判据放宽 + 穷尽扫描 + 授权交付
- **采用判据放宽**（:1544-1550）：`strippedBlockers = findings.filter(f => f.severity !== 'P2')` + `stripClearsContentOnly = every(code === 'chapter-below-contract')` ⇒ `if (strippedQuality.ok || stripClearsContentOnly)`。依据：`validateCompleteChapterDraftQuality` 的 ok 判定（`shared/lib/draft-quality.ts:430/490/821`）本来就把 P2 视为不阻交付。
- **穷尽扫描**（`shared/lib/draft-quality.ts:617`）：删掉命中后的 `break`，同一个名字的每一处泄漏都上报（`seen` 仍按整句起点去重）；新增测试 `every leak of the same name is reported and stripped`（同一名字泄漏两次 → 2 命中、剥掉 2 条）。
- **授权交付**（:1224 / :1559 / :1784）：新增 `let stripAdopted = false;`，采用块里置 true，交付条件改为 `(stripAdopted || localRepairPassed || lengthContinuationPassed) && draftQuality.ok`。

### 2.4 定点修复名额逐 attempt 重置（登记项 R-278-4 的对应实现）
- Plan 278 已把四个标志移入 attempt 循环体内；本轮在 :1715-1718 补注释记录原因（陈旧标志会把新产生的短稿当成「已修好」直接交付，真机 pro-low8 rep3 复现），并靠真机复证：flash-p279 rep1 的修复发生在 attempt 0、目标 3 处一次通过。

## 3. 真机读数（隔离 3301，作品 d23eef68 / 章节 99b28a6e，gemini-3.8-flash-high @ low）

| rep | 耗时 | 审计 | 交付字数（model 版本行） | 门禁/修复 |
|---|---|---|---|---|
| 1 | 73.0 s | 88 / pass | 6285 | 1 次 literary-slop 门禁失败 → 批量分块（chunk1 offset0 size2 filled0；chunk2 offset2 size1 filled1）+ 2 次单句补齐 → `local gate repair passed`（rounds 1 / targets 3 / applied 3 / skipped 0 / batchCalls 2 / singleCalls 2），resets 1 |
| 2 | 51.7 s | 88 / pass | 5088 | 干净过门，无修复 |
| 3 | 58.3 s | 90 / pass | 4978 | 干净过门，无修复 |

- 对照基线（Plan 278 同环境同模型）：60.7 / 57.4 / 58.2 s，88 / 90 / 86 分 ⇒ **无回归**；三跑均落 model 版本行（6285 / 5088 / 4978），fallback 行仅为快照。
- 保底稿不再被模版填充污染：本轮 flash 三跑稿尾无时代道具词（对照 R-267-1 时期出现的青骡子/算命摊/更漏）。
- 上游：`http://127.0.0.1:8317/v1`（反代），key `/tmp/cliproxy.key`，探针 200 / 4.5 s。

## 4. 门禁读数

- `/tmp/p279-gates2.log`：`TSC_EXIT=0` / `LINT_EXIT=0` / `TEST_EXIT=0`；定向 8 文件 **109 tests / 109 pass**（fallback-draft-tone、writer-quality-gate-retry、draft-quality、draft-target-length、flow-step-gate、local-repair、writer-local-repair、setting-card-leak）。
- 后端全量 `/tmp/p279-be-gates.log`：`BE_EXIT=0`，**1545 tests / 1545 pass / 36 suites / 0 fail**（115 s）。

## 5. 残余（登记）

- **R-279-1**：保底稿填充池只是「去年代化」，仍是通用散文（不读题材）；真正的兜底文风对齐未做。
- **R-279-2**：续写轮数写死 2 轮；若模型连续两轮补不到位仍会落到保底稿（本轮真机未观测到）。
- **R-279-3**：批量回执仍会整块落空（真机 rep1 chunk1 filled 0）——现在靠逐句补齐兜住，代价是多 2 次修复调用；MAX_LOCAL_REPAIR_BATCH_TARGETS=2 的上限未再调。
- **R-279-4**：穷尽扫描后，同一个名字泄漏 ≥2 处就会触发 `setting-card-leak` P1（此前只算 1 条）——属期望中的收紧，但真机尚未观测到该路径的完整闭环。
- 沿用：**R-278-2**（pro 档位审计分低且慢，默认档位保持 flash @ low）、**R-278-3**（dev 下未注册 REST 路径返回 500；空风险确认会把 pass/ready 改写成 unknown/accepted-risk）、**R-278-4**（泄漏/指令回声 ≥2 命中才升 P1，单条交确定性 strip）。

## 6. 证据与复现

- 补丁脚本：`/tmp/p279-patchA2.py`（填充池提升+中性化）、`/tmp/p279-patchB.py`（续写两轮 + 采用判据）、`/tmp/p279-patchC.py` / `/tmp/p279-patchD.py`（stripAdopted）、`/tmp/p279-patchE.py`（穷尽扫描）、`/tmp/p279-patchF.py`（夹具）、`/tmp/p279-patchG.py`（穷尽剥离测试）。
- 门禁/套件：`/tmp/p279-gates2.sh`、`/tmp/p279-be.sh`；日志 `/tmp/p279-gates2.log` / `/tmp/p279-tests2.log` / `/tmp/p279-be.log`。
- 真机：`/tmp/p279-flash.py`（cell flash-p279 / REPS 3）、结果 `/tmp/p279-flash.json`、日志 `/tmp/p279-flash.log`、服务日志 `/tmp/p278-server-flash-p279.log`。
- 调试开关：`DEBUG_GATE_IN=1 DEBUG_GATE_IN_TAG=<tag>` → 过门稿写 `/tmp/gate-in-<tag>.txt`、失败逐次写 `/tmp/gate-fail-<tag>.jsonl`。
