# Plan 278：设定卡泄漏门禁与长度合同（R-267-1 收口）

**Status**: ✅ 已完成（2026-10-03；代码/测试/门禁/真机均已验证；按 m23892 仍不提交）

**前置**: Plan 269（段落级定点修复）、Plan 273/275（strict 守门下的分段透传）、Plan 276/277（批量修复与残句第二轮）、Plan 270（模型档位矩阵）。用户 m24363「直接做」= 实施设定卡泄漏门禁。

## 1. 问题（真机取证）

1. **设定卡泄漏**：pro 系 5/6 跑的稿尾整段复述设定档案文本——`characters.summary`（左妄「觉醒但未自知的裂隙携带者，能感知事物同源性。」）与 `entity_relationships.description`（「顾铁峰第一次见面就判断左妄是觉醒但未自知的裂隙携带者。」），以及古风填充碎片（更鼓/檐角的铁马/梆子/二更天/灯芯茶凉/酒过三巡）。critic 逐字引用为失败理由（「直接抳贴『左妄，觉醒但未自知的裂隙携带者…』」「将提纲提示词硬塞在毫不相干的意象句里」），而**本地机械门禁当年全过**（pro-low/pro-high 两格 `failed the prose quality gate` 0）。
2. **R-267-1「年代戏」稿尾崩坏**（此前未定位）：稿尾出现 `马厩里那匹青骡子一直在刨蹄子。`、`门房打了个哈欠，火盆里的炭塌了一层。`、`渡船靠岸，缆绳还滴着水。`、`更漏一声接一声，把夜滴得越来越沉。`、`她把银票对折，塞进了靴筒夹层。`、`城墙根下摆着两个算命摊子…`。来源钉死：生产库全库泛搜这些词只命中 `chapter_production_runs.draft_content` / `chapter_production_run_versions.draft_content`（数据表零命中），仓库扫描命中 `server/helpers/fallback-draft.ts` 的填充池（`expandDraftToMinimum` :70）——真因是 `server/helpers/ai-production-pipeline.ts:1497` 对**模型稿**调用了 `ensureMinimumDraftLength(currentDraft, sceneBeats, augmentedContexts.writer, minDraftChars)`，把短稿用通用年代戏句补到篇幅下限。
3. **pro-low 篇幅不足（被填充掩盖）**：删除填充后门禁 dump 的模型稿长度 `[DEBUG-gatein] len=` 为 3246/3404/3028/2777/3851/3592 ⇒ **真实输出 2.8–3.9K 字 < 4000 合同**；此前 pro-low5 的 4190/4251/4267 全是填充池凑出来的。

## 2. 方案与落地

### 2.1 设定卡泄漏：检测 + 确定性剥离 + 门禁 + 重试反馈（`shared/lib/draft-quality.ts`）
- 导出：`SettingCardSource`、`SETTING_CARD_LEAK_MIN_MATCH_CHARS = 6`、`SettingCardLeakHit`、`SettingCardLeakStrip`、`extractSettingCardSources`、`normalizeSettingCardText`、`sentenceRangeAt`、`detectSettingCardLeaks`（名字后 80 字窗口内命中 sketch 的任一 6-gram；hit 以名字所在整句为界；`seen` 按 range.start 去重）、`stripSettingCardLeaks`。
- 门禁新增 `setting-card-leak`（≥2 命中 → P1 / template）与`prompt-residue-echo`（`PROMPT_INSTRUCTION_RESIDUE = /(档案纪律|必须遵守|严禁|设定档案|字段名|不要扩写|不要新增|输出格式|【第\s*\d+\s*处】|@@FIX)/`，≥2 命中 → P1 / template）；私有 `stripHitRanges` 供三处 strip 共用。
- 管线（`server/helpers/ai-production-pipeline.ts`）：`WRITER_RETRIABLE_FINDING_CODES = ['literary-slop', 'setting-card-leak', 'prompt-residue-echo', 'chapter-below-contract']`；`buildLiteraryRetryFeedback` 新增 `leakFeedback`（「正文混入了设定档案/人物小传原文…」）与 `residueFeedback`（「正文混入了写作提示词指令（如「档案纪律」「必须遵守」等说明句）…」）；统一剥离块（先 `stripSettingCardLeaks` 再 `stripPromptInstructionResidue`，达标即采用并 `logger.info('[pipeline] stripped leaked archive/instruction text from the draft')`，否则 warn `archive/instruction residue detected; deterministic strip did not clear the gate`）。
- 测试：`tests/setting-card-leak.test.ts`（11 例：8 例卡片泄漏 + 3 例指令回声——detect / 门禁≥2 才报 / 剥离后清门）。

### 2.2 roster 裁剪与 guard 回退（`shared/lib/chapter-production.ts`）
- `buildProductionWriterContext` 的「关键人物」只给名字（`- ${entry.name}`，planner 侧保留摘要）；实测泄漏检测 **9 → 0**（pro-low4 三跑全 0）。
- 首版插入的「档案纪律」guard 行反而被模型照抄到稿尾（critic：「文章末尾出现了大段的元数据指令（如"档案纪律"…）」）→ **删除 guard 行**，保留 roster 裁剪 + 门禁/strip 作安全网。

### 2.3 删掉模型稿的模版填充（R-267-1 真因）
- 删除 `ai-production-pipeline.ts` 里对模型稿的 `ensureMinimumDraftLength(...)` 调用（Plan 278(3)），短稿改由门禁的 `chapter-below-contract`（已入 `WRITER_RETRIABLE_FINDING_CODES`）走带篇幅反馈的定向重写；移除不再使用的 import。
- `server/helpers/fallback-draft.ts` 的填充池**保留**（仅用于最后手段的保底稿）——已登记为残余（保底稿仍可能带时代错位的意象）。

### 2.4 长度续写（length continuation）+ 排序 + 逐 attempt 重置
- 触发（门禁失败块内）：`!localRepairPassed && !lengthContinuationAttempted && findings.some(f => f.code === 'chapter-below-contract') && currentDraft.trim().length >= 800`。
- 提示词**复用 writer 阶段模板**：`renderPromptTemplate(writerAsset.template, { WRITER_SOUL, contextStr: augmentedContexts.writer + 【已写出的正文末尾——从这里无缝续写，禁止复述】+ tail 1200, skillsInfo, sceneBeats: 未写完场景 + （本章剩余场景…）, criticFeedback: 全章目前约 N 字，还差约 M 字才到 K 字下限：请无缝续写补足篇幅，禁止重复已写内容，禁止重新开场。 }) + worldviewHintsSuffix + foreshadowingSuffix + WRITER_OUTPUT_DISCIPLINE`；调用 `maxTokens: Math.min(4096, Math.max(2048, shortfall))`、`disableThinking`、`streamHoldback: STREAM_HOLDBACK_CHARS`、operation `production-pipeline-writer-continue-length`。
- 合并：`merged = draft + 换行 + appended`，用同一 `validateCompleteChapterDraftQuality(merged, undefined, { minChars, context })` 复检；过门→`currentDraft = merged; draftQuality = mergedQuality; lengthContinuationPassed = true;` + `logger.info('[pipeline] length continuation passed the prose quality gate')`；不过门→仍采用合并稿（机械分不降则作营救候选）+ warn `length continuation did not clear the gate`。
- **排序**：续写块移到定点修复块**之前**（短稿先续写，长稿/续写未过门时再让定点修复修套话）。
- **逐 attempt 重置**（真机 pro-low8 rep3 暴露）：四个标志曾声明在 attempt 循环外，critic 低分回路重写产生的新短稿会沿上一轮的「已过门」状态被当作 model 稿交付（2846 字 < 4000 合同）→ 现在四个标志声明在 `for (let attempt = 0; attempt <= MAX_RETRIES; attempt++)` 循环体内，且交付条件收紧为 `if ((localRepairPassed || lengthContinuationPassed) && draftQuality.ok)`。回归测试：`tests/writer-quality-gate-retry.test.ts` 新增 `a below-contract rewrite cannot ride a stale repair pass`（mock 新增 `criticScript: 'low-score'` 模式 + `AUDIT_JSON_LOW`，断言「model 稿必达 4000」且短稿正文 `短。` 不得入稿）。

## 3. 真机读数（隔离 3301，作品 d23eef68 / 章节 99b28a6e，gemini-3.1-pro-low 与 gemini-3.8-flash-high）

| 轮次 | 代码状态 | 耗时（s） | 审计分 | 交付稿（字） | 说明 |
|---|---|---|---|---|---|
| pro-low4 | roster 只给名字 | 297.9 / 216.1 / 398.4 | — | 4200 / 4445 / 4170 | 泄漏检测 0（修前 9）；2/3 稿末尾照拄 guard 行 |
| pro-low5 | + guard 删除 + 指令回声门禁 | 314.5 / 367.2 / 435.0 | 38/30/34 | 4190 / 4251 / 4267 | 0 泄漏 / 0 门禁失败；critic 三连 fail（理由是稿尾崩坏）|
| pro-low6 | + 删除模型稿填充 | 531.9 / — / 390.1 | 10 / — / 2 | 均 fallback（无 model 行）| 真实稿 2.8–3.9K < 4000；保底稿仍带年代戏填充 |
| pro-low7 | + 长度续写 | 205 / 428.8 / — | 78 / 10 | model 5088 / fallback | rep1 首次续写达交；rep2 续写后 5061 字仅剩套话未修（修复名额已被浪费）|
| **pro-low8** | + 排序（续写先于定点修复）| 237.9 / 218.3 / 294.8 | 70 / 76 / **84 pass** | model 4250 / 4897 / **2846** | 前两跑续写达交；rep3 暴露陈旧标志 bug（2846 字交付）|
| **pro-low9** | + 逐 attempt 重置 + `draftQuality.ok` 门 | 618.9 / 205.8 / 199.5 | 54 / 76 / 72 | **model 5462 / 4623 / 5070** | 三跑均交付达篇幅合同模型稿；rep1 内定点修复 3/3 通过（续写未过门后的修复路径生效）；无陈旧标志违规 |
| flash-low1 | 泄漏新代码回归 | 60.7 / 57.4 / 58.2 | 88 / 90 / 86 | （字数未登记）| 无回归 |
| **flash-low2** | 排序+重置后回归 | 65.5 / 65.5 / 59.3 | **90 / 88 / 90** | model 6181 / 5892 / 5918 | 0 门禁失败、0 续写、0 修复 → 不回归（基线 88/90/86、~63 s）|

**结论**：① 设定卡泄漏已根治（9 → 0，0 strip / 0 门禁命中）；② R-267-1 真因（模版填充）已删除，短稿改由模型自己续写；③ 长度合同现在对 model 稿硬约束（陈旧标志 bug 已修 + 回归测试锁住）；④ **pro-low 不适合本链路**（审计 54/72/76 全部低于 80 阈值，耗时 206–619 s；同一故事 flash 版 88–90 分 / 59–66 s）——继续把工程手段投入 pro 没有产品价值，停在此处并登记。

## 4. 门禁读数
- `tsc --noEmit` = 0；`eslint server src shared tests scripts --max-warnings=0` = 0（首轮因四个标志的「无效初值」报 `no-useless-assignment` → 声明移入循环体）。
- 定向 8 文件（setting-card-leak / draft-quality / local-repair / chapter-production / narrative-promise / flow-step-gate / assistant-context / writer-quality-gate-retry）= **109 tests / 109 pass / 0 cancelled**（/tmp/p278-step12.log）；后端全量最新读数 = **1540 tests / 1540 pass / 0 fail / 0 cancelled**（/tmp/p278-be-gates2.log）。

## 5. 残余（登记）
- **R-278-1**：保底稿（`server/helpers/fallback-draft.ts` 的 `expandDraftToMinimum`）仍用通用年代戏填充池——仅作为最后手段，但一旦交付仍会带时代错位意象。
- **R-278-2**：pro-low 审计分 54–76（0/3 过 80）且耗时 199–619 s，不适合作为本链路模型；默认档位仍为 flash（`disableThinking` → `reasoning_effort=low`）。
- **R-278-3**：`dev` 下未注册 REST 路径返回 500（预期 404）；空风险确认会把 `pass/ready` 改写成 `unknown/accepted-risk`（两点观察，未修）。
- **R-278-4**：泄漏/指令回声仅在命中 ≥2 处时升 P1（单条交由确定性 strip 处理）——刻意选择，登记为已知边界。
- 沿用：R-269-3（点修失败回落整章重写）、R-272-1（场景衔接）、R-273-3（reset 触发面）、R-276-1..3、R-277-1..2。

## 6. 证据与复现
- 真机 harness：`/tmp/p278-pro-matrix.py`（同源变体：`/tmp/p278-rerun-pro6..pro9.py`、`/tmp/p278-rerun-flash1..flash2.py`；链 `/tmp/p278-chain8.sh`、`/tmp/p278-chain9.sh`），日志 `/tmp/p278-rerun-pro*.log`、服务日志 `/tmp/p278-server-pro-low*.log`；结果 JSON `/tmp/p278-rerun-pro9.json`。
- 门禁：`/tmp/p278-step9.sh`（tsc/eslint/8 文件）→ `/tmp/p278-step12.log`；后端全量 `/tmp/p278-be-full.sh`。
- 补丁：`/tmp/p278-step6.py`（删填充）、`/tmp/p278-step8.py`+`8b`（长度续写）、`/tmp/p278-step11.py`（逐 attempt 重置 + `draftQuality.ok`）、`/tmp/p278-step12.py`（标志声明入循环体）、`/tmp/p278-step11-test.py`+`step12-test.py`（回归测试）。
- 关键锚点：`server/helpers/ai-production-pipeline.ts` 的 attempt 循环头、标志声明、`length continuation passed` / `local gate repair passed` 日得、交付条件 `(localRepairPassed || lengthContinuationPassed) && draftQuality.ok`；`shared/lib/draft-quality.ts` 的 `setting-card-leak`/`prompt-residue-echo`；`server/helpers/fallback-draft.ts` 的填充池。
