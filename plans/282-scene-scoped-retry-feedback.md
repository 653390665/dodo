# Plan 282：场景级重试反馈 —— 「重写整章」不再灌进单场景（R-281-1）

**Status**：代码 / 测试 / 门禁 ✅；真机验证 ✅（2026-10-05，flash-high 3 跑无回归 + flash-lite 3 跑逼出重试路径，膨胀消失）
**前置**：[`plans/281-fallback-grounding-and-scene-bridging.md`](281-fallback-grounding-and-scene-bridging.md)
**触发**：Plan 281 真机次臂 `flash-p281b` 的失败例 run `ac754320`

## 1 问题：章级重试反馈被送进「按场景」的 writer 调用

同代码、同模型（gemini-3.8-flash-high @ low）连跑 3 次：6 跑 5 过（90 / 88 / 88 / 88 / 84）+ 1 失（46 fail，281.6 s）。失败例逐 attempt 的单场景字数：

| attempt | 场景 1 | 场景 2 | 场景 3 | 场景 4 | 合计 |
| --- | --- | --- | --- | --- | --- |
| 0（首稿） | 2 092 | 788 | 2 359 | 1 513 | 6 752 |
| 1（第一次重试） | 6 357 | 1 024 | 1 553 | 4 917 | 13 851 |
| 2（第二次重试） | 5 054 | 5 631 | 4 818 | 2 642 | 18 145 |

attempt 2 的第 2、3 场景有约 480 字逐字重复（40 字 shingle 命中 440）；门禁判 `duplicate-paragraph` + `repeated-opening`（另有 `literary-polish` 2 处未达整章阻断阈值 3 处）；critic 三轮 62 → 46 → 12，交付 13 857 字 model 稿、审计 46 fail。

机制：门禁软失败后的重试反馈由 `buildLiteraryRetryFeedback(draftQuality)`（`server/helpers/ai-production-pipeline.ts:505`）生成，正文写着「请重写整章」；split 分支却把这份反馈原样塞进**逐个场景**的 writer 调用（`server/helpers/ai-production-pipeline.ts:1386` 的 `criticFeedback` 槽）⇒ 每个场景都被要求重写「整章」，模型按章级篇幅作答 → 跨场景复述 → 结构类硬命中（`duplicate-paragraph` / `repeated-opening`）。

## 2 方案：把反馈裁剪到「本场景」

`server/helpers/ai-production-pipeline.ts`（92 167 → 95 202 B）新增三件东西：

```ts
const SCENE_SCOPE_NOTE = '【本场景范围】上面的意见只针对本场景：只重写本场景这一段，按本场景分镜把内容写足，不要复述其它场景已经写过的内容，也不要把其它场景的情节搬进来；篇幅以本场景为单位，不要扩写成一章的长度。';
const RETRY_SNIPPET_LABEL = '需要改写的具体语句：';
const MAX_SCENE_RETRY_SNIPPETS = 3;

export function scopeRetryFeedbackToScene(feedback: string, previousSceneText: string): string
```

`scopeRetryFeedbackToScene`（`:561`）做四件事：

1. 定位 `需要改写的具体语句：` 到 `重写要求：` 之间那一段（`lastIndexOf('。')` 收尾），把片段列表 `split(' / ')`；
2. 只保留 `previousSceneText.includes(snippet)` 的片段，最多 3 条（`MAX_SCENE_RETRY_SNIPPETS`）——即「这条意见确实指着我这一场」；
3. 全被过滤掉就整段删除（宁可不给片段，也不给别场的片段）；
4. `请重写整章` → `请重写本场景`，末尾追加 `SCENE_SCOPE_NOTE`（明确篇幅以本场景为单位）。

调用点（`:1386-1389`）：

```ts
criticFeedback: criticFeedback
  ? scopeRetryFeedbackToScene(
      writerRetryFeedback || criticFeedback,
      previousSceneDraft === currentDraft ? previousSceneParts[i] || '' : ''
    )
  : i === 0 ? '初稿阶段，请全力输出。' : '继续本章的下一场景，保持人物与节奏连贯。',
```

片段归属靠上一轮 split pass 的留底：`let previousSceneParts: string[] = [];` / `let previousSceneDraft = '';`（`:1235-1236`），在 `currentDraft = parts.join('\n\n')` 之后写入（`:1522-1523`）。若上一轮不是 split pass、或稿子在两轮之间被确定性剥离改写过（`previousSceneDraft !== currentDraft`），第三个参数传空串 ⇒ 片段全丢，只保留问题描述与范围说明——保守但不会张冠李戴。

## 3 门禁与测试

- 新增两例（`tests/writer-quality-gate-retry.test.ts`，→ 29 077 B）：单元 `scene-scoped retry feedback keeps only the snippets found in that scene`（三条片段只留本场那条、`请重写整章` 消失、`【本场景范围】` 出现）；集成 `split-scene rewrite prompts carry scene-scoped feedback instead of chapter-level feedback`（门禁软失败后 3 条重试请求每条都带 `【本场景范围】`，无一条含 `请重写整章`，`result.source === 'model'`）。
- 定向：`tests/writer-quality-gate-retry.test.ts` 14/14；`/tmp/p282-gates.sh` → `/tmp/p282-gates.log` = `TSC_EXIT=0` / `LINT_EXIT=0` / `TEST_EXIT=0`，`/tmp/p282-tests.log` = **97 tests / 97 pass**（8 文件）。
- 后端全量：`/tmp/p282-be.log` = **1553 tests / 1553 pass / 0 fail**（36 suites，40.5 s）。

## 4 真机验证（隔离 3301，gemini 系 @ low，各 3 reps）

### 4.1 回归臂：`gemini-3.8-flash-high`（tag `flash-p282`，本轮未触发重试）

| rep | run | 耗时 | 审计 | 交付稿 | 首 token | resets |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `11260144` | 54.0 s | 90 pass（attempts 1） | model 4 984（fallback 4 119） | 18.4 s | 0 |
| 2 | `d2eb9833` | 59.0 s | 86 pass（1） | model 5 618 | 15.6 s | 1 |
| 3 | `eeab81b2` | 68.9 s | 82 pass（1） | model 6 833 | 12.8 s | 1 |

三跑均一次过门、无重试；rep3 走了一轮定点修复并通过（`targets 3 / applied 3 / batchCalls 2 / singleCalls 2`）⇒ 对既有链路无回归（对照 Plan 281 `flash-p281c`：73.4 / 71.0 / 76.6 s，88 / 88 / 84）。

### 4.2 重试臂：`gemini-3.1-flash-lite`（tag `lite-p282`，逼出两轮重试）

flash-high 三跑都没触发重试（写作门与审稿都一次过），故换弱模型把重试路径逼出来：

| rep | run | 耗时 | 审计 | 交付稿 | resets |
| --- | --- | --- | --- | --- | --- |
| 1 | `defaafb6` | 198.8 s | 68 fail（attempts 3） | model 5 974 | 1 |
| 2 | `63f6018e` | 158.2 s | 80 pass（2） | model 4 681 | 2 |
| 3 | `71188cef` | **1 991.2 s**（审稿超时挂死） | 58 fail（2，audit unknown） | model 4 545 | 1 |

逐场景实际送修字数（rep2，dump `writer-prompts-lite-p282-rep2.jsonl`）：

| attempt | 场景 1 | 场景 2 | 场景 3 | 场景 4 | 合计 |
| --- | --- | --- | --- | --- | --- |
| 0（首稿） | 1 530 | 1 432 | 1 576 | 1 330 | 5 868 |
| 1（第一次重试） | 1 578 | 851 | 1 540 | 1 245 | 5 214 |
| 2（第二次重试） | 1 671 | 1 671 | 1 992 | 634 | 5 968 |

提示词级对照（逐条解析 dump）：

| 指标 | 修前（`writer-prompts-flash-p281b-rep3.jsonl`） | 修后（`writer-prompts-lite-p282-rep2.jsonl`） |
| --- | --- | --- |
| 场景调用条数 | 12 | 12 |
| 含 `请重写整章` 的场景调用 | 8（attempt 1 / 2 各 4 条） | **0** |
| 含 `【本场景范围】` 的场景调用 | 0 | **8** |
| 逐场景字数区间 | 788 – 6 357 | 634 – 1 992 |
| 场景字数合计 | **38 748** | **17 050** |

（同一次重试里 `whole-chapter-prompt` 记录仍带 `请重写整章`——那是章级模板，场景调用由它派生；模板记录 `respChars: null`，不直接发往模型。）

结论：重试轮不再让每个场景重写整章，单场景字数稳定在首稿量级（634–1 992，修前重试轮 4 800–6 400），跨场景复述造成的 `duplicate-paragraph` / `repeated-opening` 不再出现 ⇒ **R-281-1 闭环**。

## 5 残余（登记）

- R-282-1：片段归属依赖 `previousSceneDraft === currentDraft` 字符串相等；上一轮稿被确定性剥离改写过时片段全丢（保守取舍）。
- R-282-2：`SCENE_SCOPE_NOTE` 是提示词级约束，没有硬校验（未给单场景篇幅加上限门禁）。
- R-282-3：弱模型 + 审稿超时会把单次 run 拖到 33 分钟（`lite-p282` rep3 = 1 991.2 s）；上游恢复期的重试/超时上限未见兜住。
- 沿用：R-279-2（续写写死 2 轮）、R-279-3（批量回执整块落空）、R-272-1（场景衔接，已由 281 大幅缓解）、R-269-3（点修失败回落整章重写）。

## 6 证据与复现

- 真机（修前）：`/tmp/p281-flashb.json`、`/tmp/p278-server-flash-p281b.log`、`/tmp/writer-prompts-flash-p281b*.jsonl`（归档 off-by-one：`-rep2.jsonl` = rep1、`-rep3.jsonl` = rep2、无后缀 = rep3）；场景字数/shingle 脚本 `/tmp/p281-dup2.py`。
- 真机（修后）：`/tmp/p282-flash.py`（tag `flash-p282`）、`/tmp/p282-lite.py`（tag `lite-p282`）；结果 `/tmp/p282-flash.json`、`/tmp/p282-lite.json`；日志 `/tmp/p278-server-flash-p282.log`、`/tmp/p278-server-lite-p282.log`；dump `/tmp/writer-prompts-flash-p282*.jsonl`、`/tmp/writer-prompts-lite-p282*.jsonl`；解析脚本 `/tmp/p282-sum2.py`、`/tmp/p282-kinds.py`、`/tmp/p282-scenes.py`、`/tmp/p282-dumpcheck.py`。
- 上游：8317 需本机代理客户端 7897 在线（本轮 01:51:46 antigravity token 刷新成功后恢复；此前 503 `auth_unavailable` 导致三跑 17 s 作废）。
- 门禁：`/tmp/p282-gates.sh`、`/tmp/p282-gates.log`、`/tmp/p282-tests.log`、`/tmp/p282-be.log`。
- 补丁脚本：`/tmp/p282-patchA.py`、`/tmp/p282-patchB.py`、`/tmp/p282-patchC.py`。
