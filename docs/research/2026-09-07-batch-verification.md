# 批次独立验证审计：8eaf51b..HEAD（2026-09-07 执行批次）

> 日期：2026-09-07
> 方法：对 `docs/plans/README.md` 状态表、各计划"执行状态"节、`docs/research/2026-09-07-incomplete-task-audit.md` 中的完成声明做独立验证——所有声明视为被审对象而非证据，逐条回到一手证据（代码精读/grep、命令实跑、git 历史）核对。判定三档：✅ 证实 / ❌ 信息错误 / ⚠️ 部分属实或需附注。
> 区间：`8eaf51b..HEAD`，实际 **16 个提交**（批次前 README/会话口径"约 18 个"，记为轻微偏差）。
> 测试安全：`npm test` 经 `tests/helpers/test-db-preload.ts` 重定向临时库；前端 vitest 为 jsdom 不触库；本轮全程未触碰 `data.db` 生产库。

---

## 1. 实测命令结果（fresh，不引用任何历史输出）

| 命令 | 实测结果 | 判定 |
|---|---|---|
| `npx tsc --noEmit` | exit 0，无输出，**0 错误** | ✅ 与基线声明一致 |
| `npx eslint <11 个批次触及文件>` | exit 0，无输出，**0 问题** | ✅ 与基线声明一致 |
| `npx vitest -c vitest.config.frontend.ts run` | Test Files **121 passed (121)**；Tests **839 passed (839)**，0 失败，192s | 见 §4-B（README 写 838/838+） |
| `npm test`（后端全量） | `# tests 1153  # pass 1153  # fail 0`（29 suites，51.6s） | 见 §4-A（README 写 1151/1151） |
| `NODE_ENV=test node --test --import tsx --import ./tests/helpers/test-db-preload.ts tests/skills-sanitize-api.test.ts` | **2 passed / 2**（sanitize endpoint persists…），0.9s | ✅ |

---

## 2. 逐计划核对表

### 001 能力卡单动词收敛（README:14 声明"✅ 完成"）

| 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|
| 旧文案 `加入本次配置候选\|应用所选配置` grep = 0 | 实测 0 命中 | ✅ | `src/components/SkillsStudioView.tsx` 全文件 grep |
| PlazaAssetCard 徽章 ≤2 | 徽章 1-2 枚：来源徽章（:364，恒有）+ 授权增强（:355-359，仅 licensed）；"冷启动证据"为纯文本非徽章 | ✅ | SkillsStudioView.tsx:355-364 |
| 能力卡徽章 ≤2 | 恰 2 枚：作用范围 + 只读/改正文（:382-393 注释明确"001 目标 4"） | ✅ | SkillsStudioView.tsx:382-393 |
| "需解锁" details 折叠分组 | 存在：`<details>` 折叠"需解锁（N）· 消毒或授权后可用" | ✅ | SkillsStudioView.tsx:2447-2449 |
| 撤销 toast 5000ms | 实测两处 equip 撤销均为 `5000`（此前审计指出的 6500ms 已改；现存 6500ms 仅"卡组已满"错误提示，非撤销） | ✅ | SkillsStudioView.tsx:1603、:2720 |
| 草稿机缓行"有绿测试锁定" | `configurationDraft` 仍在源码（24 处），锁定测试 `capability-configuration-session.test.ts`、`skills-studio-plan158.test.tsx` 均在 839 全绿内 | ✅ | 同左 |

**001 判定：✅ 全部证实。**

### 002 审稿三合一（README:15 声明"✅ 完成"）

| 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|
| QualityTab 以 reviewState（freshReviewState）为渲染源 | 主体成立：freshReviewState 带内容哈希校验（:98-104）；semanticReview 仅来自它（:105）；问题列表入参来自 `workflowMeta.reviewState.issues`（EditorView.tsx:2111）。附注：渲染门仍为 `hasCritique \|\| Boolean(freshReviewState)` 双轨（:158），结构化手术精修分类仍从 critique 文本提取（:93-95） | ⚠️ 主体属实 | QualityTab.tsx:96-104,157-158 |
| /api/audit 降级注释 | 存在（"002 口径说明……不再是独立的'第二份审稿结论'……保留此 API 仅作兼容"）；位置在 `registerAuditRoutes` 函数体内，**非文件顶部** | ✅（位置与转述有出入） | server/routes/audit.ts:514-518 |
| ProductionRunReview"生产期审稿（迭代用）"标注 | 存在（含"权威审稿结论以接受正文后的完成审查为准"） | ✅ | ProductionRunReview.tsx:241-243 |
| quality-review-journey 零配置精修测试 | 存在："shows completion-review conclusions and polish entry with zero capability configuration"，在本轮 839 全绿内 | ✅ | src/tests/quality-review-journey.test.tsx:107 |
| 口径表落档 research §6 | 存在："## 6. 审稿评分口径表（002 落地后追加，2026-09-07）" | ✅ | docs/research/2026-09-06-capability-system-essence.md:85 |

**002 判定：✅（渲染门双轨附注）。**

### 003 护栏面板化（README:16 声明"✅ 完成"）

| 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|
| GuardrailPolicyPanel 存在且被渲染 | 文件在 `src/components/skills/`（非 `src/components/` 根）；SkillsStudioView :2734 渲染、:2018 打开按钮、:734 开关 state | ✅ | SkillsStudioView.tsx:734,2018,2734 |
| 商店页签"系统护栏"删除 = 0 | 组件层 0 命中（命中均为测试断言里的知识面板摘要"系统护栏 12"，属另一功能，非页签） | ✅ | grep src（排除 tests）= 0 |
| 流程切换 appConfirm 含新旧流程名与"流程步骤进度" | 两处 appConfirm 均含「切换到「新」将替换当前流程「旧」…重置：流程步骤进度」 | ✅ | SkillsStudioView.tsx:829、:1892 |

**003 判定：✅ 全部证实。**

### 004 启用即落位 + 消毒管线（README:17 声明"✅ 完成"）

| 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|
| POST /api/skills/sanitize/:assetId（幂等/限频/落库脱敏副本） | 存在：`sanitized-${asset.id}` 幂等命名、rateLimit 限频、sanitizeWhiteLabelText 脱敏落库 | ✅ | server/routes/skills.ts:228-272 |
| registerSkillsRoutes 在 server 挂载 | 挂载于 `server/routes/index.ts:40`；`server.ts:9` 经 `registerRoutes` 间接引入（非 server.ts 直接调用，语义成立） | ✅ | server/routes/index.ts:10,40；server.ts:9 |
| "文风与正文"页签存在 | 存在（`['optional-style', '文风与正文']`） | ✅ | SkillsStudioView.tsx:2220 |
| 73 张可见 / 45 张待消毒 | tsx 实跑：`getOptionalStyleAssets().length = 73`、`getSanitizeRequiredAssets().length = 45` | ✅ | 实测输出 |
| "消毒并启用"绑定 isSanitizeRequiredAsset | `{onSanitize && isSanitizeRequiredAsset(asset.id) && (…消毒并启用…)` | ✅ | SkillsStudioView.tsx:431-437 |
| 编辑器推荐位 ≤2 张 | `getOptionalStyleAssets()…slice(0, 2)` | ✅ | QualityTab.tsx:220-229 |

**004 判定：✅（另记代码注释漂移一条，见 §4-H）。**

### 005 production-store（README:18、005:58-66 声明"◐ 步骤 1-3、5 完成"）

| 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|
| src/stores/production-store.ts 存在 | 存在（zustand；被 EditorView、AgentWorkspaceProductionPanel、ProductionTab、GenerationStatusBar、useChapterProductionFlow 及 1 个测试真实引用） | ✅ | grep 6 文件命中 |
| 验收门：`productionError={` / `activeProductionRun={` 跨 EditorView↔AgentWorkspace 透传 = 0 | 三文件 grep 均 0 命中 | ✅ | grep 实测 |
| `setCompletionInFlight` 唯一同步点、无散落直写 | :151 定义；`completionRequestInFlightRef.current = ` 全文件仅 :152 一处（即定义体内）；三组调用点 :858/:936/:1018 均走 setter | ✅ | EditorView.tsx:150-152,858,936,1018 |
| AgentWorkspace props 87 | EditorView 渲染 `<AgentWorkspace>` 属性行 :2033-2119 **恰好 87 个**，逐行清点 | ✅ | EditorView.tsx:2032-2120 |
| "props 109→87"的起点 109 | **批次基线 8eaf51b 实测 97 个**（属性行 2107-2203）；109 出自 005 计划编写时的历史审计（005:5,12），git 历史中从未出现该数（8eaf51b~1 = 94） | ❌ 起点数字不实（终点 87 准确） | git show 8eaf51b / 8eaf51b~1 实测 |
| S4 writingStyle、profiler 缓行 | 如实标 ⏸；writingStyle 引用量级（EditorView 90 / AgentWorkspace 18 / Panel 18 处）与"12-15 处中转引用"口径相容 | ✅（诚实标注） | 005:65-66 |

**005 判定：⚠️ 主体属实，"109→87"起点数字不实（批次内可验证事实为 97→87）。**

### 006 统一状态条 + 术语收敛（README:19 声明"◐ 进行中"）

| 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|
| GenerationStatusBar 落地并挂载 ProductionTab（full） | 挂载于 ProductionTab.tsx:86，组件完整（四段、订阅 production-store） | ✅ | ProductionTab.tsx:8,86 |
| "quick 模式组件已支持待接线" | 该行状态已过时：008 批次已把 quick 接线（EditorView:1930）；README 自身 :13 的 008 行也写"quick 状态条接线 ✅"，两行口径不同步 | ⚠️ 行内状态过时 | EditorView.tsx:1928-1939 |
| glossary.ts 词汇表建立 | 文件存在、内容完整，但**全仓（src/tests/server/shared）零 import、零消费**——纯死文件 | ⚠️ 字面属实但为死代码 | src/lib/glossary.ts；grep 引用 = 0 |

**006 判定：⚠️。**

### 007 双 AI 入口收敛（007:70-79 执行状态表）

| 任务 | 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|---|
| T1 命名区分 | ✅ 完成 | 组件层"智能管家"命中 14 处，逐条判定**全部属工作台语境或代码注释**：AgentWorkspace :549,559,565（工作台侧栏 aria/标题）、EditorHeader :176,185,189（设计保留）、EditorView :2028、WritingSurface :284,298（编辑器工作台）、AppShell :1175（工作台聚合描述）、AppShell :636 与 AiCandidateReview :10,25（注释）、AiCandidateReview :45,151（workbench variant aria）。上一轮审计指出的 4 处残留（ProjectCockpitView / WorldBibleView / ContinuationPackView / WorldBibleAssistant）**现已 0 命中** | ✅ | grep 全量清点 |
| T2 写入质量门 | ✅ 完成 | 正文路径有门（AppShell:637-642）属实；**替换选区现已补门**（:698-706，"与正文写入同语义…过质量门才能落库"）；**但分镜写入 `handleApplyAssistantToSceneBeats` 仍无任何校验直写（:652-670 区域），且 007 原计划 :33 明确要求"分镜候选同理"，执行状态对此第三条路径只字未提，也无豁免决策记录** | ⚠️ 部分属实 | AppShell.tsx:652-670,698-706 |
| T3 两个深流测试 | ✅ 完成（37/37） | plan158 测试在本轮 839 全绿内，前端恢复全绿 | ✅ | vitest 实测 |
| T4 动作词表 | ⏸ "workflow-copy.ts 待做" | **文件已存在**（src/lib/workflow-copy.ts）——007 行与同批次的 008 文档及代码自相矛盾，未回写 | ❌ 行声明过时 | src/lib/workflow-copy.ts 存在 |
| T5 候选确认去重 | ✅ 完成 | ① AiCandidateReview 被两个表面真实渲染（AgentWorkspace:694 variant="workbench"、EditorView:1941 variant="editor"）；② AgentWorkspace 旧候选确认 JSX 清理干净：`{(() => {` IIFE **0 命中**、"正文候选待确认"旧文案 **0 命中**、:692-708 为干净的新组件调用，无孤儿代码；③ `getCandidateQualityState` 全仓**唯一定义**于 src/lib/candidate-quality.ts:7（三份重复确已收敛），由 AiCandidateReview:4 引用 | ✅ | 同左 |
| T6 技法改名 | ✅（licensed 未做如实标注） | 与声明一致 | ✅（诚实） | — |

**007 判定：T1 ✅、T3 ✅、T5 ✅、T6 ✅；T2 ⚠️（分镜路径未收敛且未标注）；T4 行 ❌（与代码矛盾）。**

### 008 接受断点引导（README:13、008:42-54 执行状态）

| 声明 | 实际 | 判定 | 证据 |
|---|---|---|---|
| quick 状态条接线（9a4af0d） | EditorView :1928-1939 挂 `GenerationStatusBar mode="quick" quickDraftReady`，条件与候选横幅一致 | ✅ | EditorView.tsx:1928-1939 |
| ④ 待写入可点击滚动接受区 | ProductionTab :64 `runReviewAnchorRef`、:88 `onWriteClick={scrollIntoView}`、:285 锚点包裹；EditorView :1934 同样 scrollIntoView 到 candidateBannerRef | ✅ | ProductionTab.tsx:63-64,88,285 |
| 横幅一跳工作台质量页签 | EditorView `onWorkbenchJump={() => { setAgentTab('quality'); setIsAgentSidebarOpen(true); }}`；AiCandidateReview :138"到工作台处理"按钮存在 | ✅ | EditorView.tsx:1952 |
| ④ 可点击测试 | generation-status-bar.test.tsx:64-76"write segment becomes clickable … fires the seek callback"，在 839 全绿内 | ✅ | 同左 |
| "workflow-copy.ts 已建并**首个接入**" | 文件已建属实；但 `WORKFLOW_ACTION_LABELS`/`WorkflowActionKey` **全仓零 import**（src/tests/server/shared 均无）；AiCandidateReview:138 的"到工作台处理"是硬编码字符串副本，并非从词表导入；ProductionTab 内亦无词表引用或被替换的动作文案——**"首个接入"不成立** | ❌ 接入声明不实 | grep 全仓 = 0 |
| 页签收敛取消 | 文档如实记录"审查修正：6 常驻 + 更多" | ✅（诚实取消） | 008:4 |

**008 判定：⚠️ 功能四项全部证实；T4"首个接入"为虚假表述。**

---

## 3. 批次遗留物扫描

| 项 | 结果 |
|---|---|
| `git status` | 干净，无未跟踪文件（所有成果已提交） |
| DEBUG / console 残留 | SkillsStudioView、AgentWorkspace、AiCandidateReview、GenerationStatusBar、GuardrailPolicyPanel、production-store、workflow-copy、glossary、candidate-quality、server/routes/skills.ts 全部 0 命中；EditorView 仅 2 处 `console.error`（:1116、:1591），系 2026-08-29 salvage 快照既有错误处理日志，非本批次遗留 |
| 新文件真实引用 | AiCandidateReview.tsx ✅（两表面）、candidate-quality.ts ✅、GuardrailPolicyPanel.tsx ✅、production-store.ts ✅（6 处）；**workflow-copy.ts ❌ 零引用（死文件）**、**glossary.ts ❌ 零引用（死文件）** |
| 批次测试文件真实存在且在跑 | tests/skills-sanitize-api.test.ts ✅（专项 2/2）、src/tests/generation-status-bar.test.tsx ✅（在 121 文件 839 用例内） |
| 用户提示"约 18 个提交" | 实际 `git rev-list --count` = **16**（轻微口径偏差，非信息错误） |

---

## 4. 信息错误清单（❌ / ⚠️ 项详述与修正建议）

- **A. README.md:6 后端基线 "npm test（1151/1151）"** —— 实测 **1153/1153**。基线行写于 004 消毒管线测试（skills-sanitize-api 2 例）入库之前，之后未回写。建议改为"1153/1153"或恢复"随用例增长"的相对表述。
- **B. README.md:6 前端基线 "838/838+"** —— 实测 **839/839**。"838/838+"的"+"可容纳 839，不算错误，但快照数字已漂移；建议与 A 一并更新为当前实测或改为纯相对表述。
- **C. README.md:18 与 docs/plans/005:63 "AgentWorkspace props 109→87"** —— 终点 87 准确（逐行清点 ：2033-2119）；但**批次基线 8eaf51b 实测起点是 97**，109 只是 005 计划编写时的历史审计数，git 历史中不存在（8eaf51b~1 = 94）。批次内可验证事实为 **97→87**（与 005:63 自述"删 10+1 透传"吻合）。建议把执行状态行改为"97→87（批次内），109 为计划编写时口径"。
- **D. docs/plans/007:76 T4 行"workflow-copy.ts 待做"** —— 该文件在本批次 008 中已创建，007 执行状态表未回写，与 008:47"已建"及代码现状**直接矛盾**。建议 007 T4 行改为"已建（008 批），接入为零，见 E"。
- **E. docs/plans/008:47 "src/lib/workflow-copy.ts 已建并首个接入"** —— "已建"属实，"首个接入"**不实**：`WORKFLOW_ACTION_LABELS`/`WorkflowActionKey` 全仓零 import；AiCandidateReview.tsx:138 的"到工作台处理"是硬编码副本而非词表引用；ProductionTab 无任何词表消费。文件当前是**死代码**。建议：要么真的让 AiCandidateReview/GenerationStatusBar 从词表导入并补一条锁定测试，要么把 008 该行改为"已建表，接入渐进（当前 0 处）"。
- **F. docs/research/2026-09-07-incomplete-task-audit.md 未随批次更新** —— 该文档仅有一个提交（8eaf51b 本身），此后 16 个提交解决其大半结论（001 徽章/折叠/5s、007 T1 四处残留、T2 替换选区旁路、T3 两红测试、T5 未合并、828/830 基线），文档无任何"已被本批次解决"标注，旧口径持续误导。建议在文首加"2026-09-07 批次后多数 ❌/⚠️ 项已解决，见 batch-verification"或逐条补"已解决"批注。
- **G. README.md:19（006 行）"quick 模式组件已支持待接线"** —— 已被本批次 008 完成接线（EditorView:1930），006 行未同步，README 状态表内部 006 行与 008 行口径不一致。建议 006 行补"quick 接线已由 008 完成"。
- **H. SkillsStudioView.tsx:914 注释"74 张 optional-style 治理资产从目录投影上货架"** —— 实测 `getOptionalStyleAssets().length = 73`（README:17 的"73 可见 / 74 研究口径含 1 张 test-fixture"解释成立，但代码注释停在 74）；同源问题：docs/plans/004 标题与 :57 完成标准"≥74 张可见"按字面永不可达（第 74 张是 test-fixture 不上架），且 004 计划文档无执行状态节、checkbox 未勾而 README 已标"✅ 完成"。建议：注释改 73；004 标准改"≥73（研究口径 74 含 1 张 test-fixture）"。
- **I. 007 T2 执行状态"✅ 已完成"覆盖不全** —— 007:33 原计划列三条写入路径（正文/替换选区/分镜），本批补齐了前两条的门（AppShell:637-642、:698-706），**分镜 `handleApplyAssistantToSceneBeats`（:652-670）仍无校验直写**，执行状态与代码注释均未记录该路径的门禁或豁免决策。建议：给分镜路径补门或写入显式豁免理由，并回写 007 执行状态。
- **J.（附注，非错误）002 渲染门双轨** —— README"QualityTab 以 reviewState 为渲染源"主体成立（结论与 issues 均出自 reviewState），但 `hasQualityReport = hasCritique || Boolean(freshReviewState)`（QualityTab:158）保留旧 critique 兼容轨、手术精修分类仍从 critique 提取。属设计余量而非虚假声明，建议在 002 文档边界节补一句说明。
- **K.（轻微）批次规模口径** —— 任务简报"约 18 个提交"与实测 16 不符；README:3"001~007 全批次执行完毕"与状态表中 007 行"进行中"并存，建议统一措辞。

---

## 5. 总体结论

本批次 16 个提交的**功能声明与代码事实高度吻合**：001/003/004 全部证实，002/008 主体证实，007 T1/T3/T5 证实（含曾出过接线事故的 T5——旧 JSX、IIFE、重复实现清理干净，全仓仅剩一份 `getCandidateQualityState`），四条验证命令实测全绿（tsc 0 / eslint 0 / 前端 839 / 后端 1153 / 专项 2），工作区干净无调试残留。信息错误集中在**文档数字与状态行的陈旧化**：基线 1151 vs 实测 1153、props 起点 109 vs 批次实测 97、007 T4 与 008 关于 workflow-copy.ts 的互相矛盾（该文件实为零引用死代码，连同 glossary.ts 共两处死文件）、以及 incomplete-task-audit 研究文档未随批次回写——无一是"声称完成但功能不存在"级别的虚假声明，属可在半小时内清完的文档回写债。
