# 未完结任务审计：日志声称完成 vs 一手证据

> 日期：2026-09-07
> 方法：以工作日志/计划文档的"已完成"声明为被审对象，逐条对照一手证据（代码现状 grep/精读 + 三条基线验证命令实测 + git 历史），区分三档结论：❌ 虚假完成（声称完成但证据相反）/ ⚠️ 部分完成（主体完成但有明确遗留）/ ✅ 证实完成（证据支持）。
> 数据源：`docs/plans/README.md`、`docs/plans/001~007`、`.zcode/plans/plan-sess_602f8bc2-*.md`、`.zcode/plans/plan-sess_95b278a5-*.md`、`docs/research/2026-09-05-full-stack-audit.md`、`docs/research/2026-09-06-capability-system-essence.md`、`docs/prd/2026-09-05-generation-entry-consolidation.md`、`docs/prd/2026-09-05-generation-follow-ups.md`、根目录《InkFlow_产品体验审计报告.md》《InkFlow_横纵分析报告.md》、git log/status、代码与测试实况。
> 测试安全：`tests/helpers/test-db-preload.ts` 将 `INKFLOW_DB_PATH` 重定向到 `mkdtempSync` 临时目录并随进程退出清理，前端 vitest 为 jsdom 不触库——三条命令均未触碰运行中的 `data.db` 生产库。

---

## 1. 结论速览

| 任务 | 日志声称 | 实际状态 | 档位 | 证据 |
|---|---|---|---|---|
| 仓库属性声明 | "本仓库**非 git 仓库**"（README.md:4、007:4） | 是 git 仓库（13 个提交，末次 2026-09-03）；且 09-05~09-07 全部"已完成"代码仅存在于暂存区/工作区，未提交 | ❌ | `git log -1` → de696c5 2026-09-03；`git status --short` → src/server 大量 `M `（已暂存未提交）；`git diff --stat HEAD` → SkillsStudioView +159 行等 |
| 007 T1 双 AI 入口命名区分 | "✅ 已完成"（007:74） | 侧边栏/抽屉改名属实；但验收"智能管家仅出现在工作台语境"未达成——驾驶舱/世界观/续写页 4 处"智能管家"按钮打开的是全局抽屉（已改名"AI 协作助手"），名实错位依旧 | ⚠️ | 改名：`src/lib/workspace-nav.ts:13`、`AIAssistantDrawer.tsx:118,144`；残留：`ProjectCockpitView.tsx:245-250`、`WorldBibleView.tsx:972-973`、`ContinuationPackView.tsx:698-727`、`WorldBibleAssistant.tsx:44,570-571`，经 `AppShell.tsx:518-521` → 全局抽屉 |
| 007 T2 全局助手写入接入质量门 | "✅ 已完成"（007:75） | 三条写入路径只有一条有门：正文写入过 `validateCompleteChapterDraftQuality`；**"替换选区"与"写入分镜"仍无校验直写**；原验收"候选确认横幅"未实现 | ⚠️ | 有门：`AppShell.tsx:637-642`；无门直写：`AppShell.tsx:672-709`（替换选区）、`AppShell.tsx:652-670`（分镜）；007:33 明确列出三处都要收敛 |
| 001 单动词收敛（"大部分完成"，含"徽章瘦身"） | README.md:12、41：弹窗单动词+撤销、徽章瘦身、文案收敛已上线 | 单动词+撤销属实；但"徽章 ≤2"未达（能力卡仍 5-6 枚、包卡 3+ 枚）、旧文案"应用所选配置"残留 1 处、撤销条 6.5s 而非 5s、草稿机未退役、不可用卡未折叠；计划 4 项完成标准 checkbox 全部未勾 | ⚠️ | 已做：`SkillsStudioView.tsx:74-76`（启用所选）、`:1525-1537`（即时应用+撤销 toast）；未达：`:349-362`（徽章 5-6 枚）、`:2169-2176`（包卡 3+ 枚）、`:65`（"应用所选配置并返回写作"）、`:1005,:801`（configurationDraft/stageConfiguration 仍在）；撤销时长 `:1531`（6500ms）；`grep 需解锁` = 0 |
| 001/007 T3 两个深流测试 | "遗留 2 个待修"（README.md:12、007:76 ⏸） | 与实测完全一致：恰为该两用例失败 | ✅（诚实） | `skills-studio-plan158.test.tsx:792`（uses author-facing…）、`:905`（explains outline…）失败；全量 828/830 |
| 写法确认留存化 | "根治 171:6 摩擦，confirmed 稳定保持"（README.md:38） | 回退资料包解析落地，confirmed 指纹比对存在，后端测试过 | ✅ | `server/helpers/writing-style-service.ts:815`（resolveWritingStyleRequest）、`:833-835`（fallbackContinuationPackId 回退资料包）、`:924`（confirmed 指纹）；npm test `ok 972` writing-style 相关 |
| 被拒稿进预览 + 知情覆写 | "三次重试全拒→保留待改进草稿，两步知情确认"（README.md:39） | 证据完整支持（3 次模型稿尝试→review_required 预览→两步确认） | ✅ | `server/helpers/ai-production-pipeline.ts:268,17`（attempt≤2 即 3 次尝试）、`:409`（DraftQualityRejectionError 带最后模型稿）；`server/routes/production.ts:946-975`（review_required + qualityRejected）；`ProductionRunReview.tsx:321-325`（保留文案）、`:259-267`（两步确认面板） |
| 批次 5 各项 | 主题对比度 97 处、0600、temp 清扫、SSE 脱敏、race abort、validation 日志、PRAGMA optimize（README.md:40） | 全部有代码落点；唯"97 处"与审计报告"94 处"数字漂移 | ✅ | `src/index.css:21,35`（变量定义）+ 全仓 137 处 `text-theme-bg/accent-contrast`；`db-init.ts:101,129`（chmod 0600）、`:82-99,158-180`（temp 清扫）、`:220`（PRAGMA optimize）；`server/logger.ts:16,25`（redact）；`server-llm.ts:644-655,252`（abort 联动）；`server/validation.ts:14-27`（门控调试日志） |
| 007 T6 技法改名 + licensed 收敛 | "✅ 已完成…licensed 限额收敛未做"（007:79） | 与声明一致：改名落地、licensed 仍重复（如实标注） | ✅（诚实） | `SkillsStudioView.tsx:307,420,464,530,1573`（收藏为常用技法/technique_favorited）；licensed 重复实测 ≥5 处（`:283,779,1470,1810,2229`） |
| 007 T4 动作词表 | "⏸ 部分完成：横幅已删，workflow-copy.ts 待做"（007:77） | 与声明一致 | ✅（诚实） | `src/lib/workflow-copy.ts` 不存在；"下一步动作" 5→1 处（仅 `ContinuationOverviewPanel.tsx:212`） |
| 产品体验审计报告勘误 1/3/4/6 号修复 | "已修复"（报告 §勘误表） | 四项均有代码落点，声称的新增测试实测通过 | ✅ | `onboarding.ts:115-119`（disableThinking+4096+audit-json）；`useEditorPersistence.ts:228-230`（wordCount 同步）；`SettingsModal.tsx:34-38`（details 中文映射）；`Library.tsx:346-352`（文案对齐）；server-llm.test.ts 22 用例、editor-persistence.test.ts 14 用例实测全过 |
| PRD §12 六 Story 落地 | "✅ 已落地（830/830）"（PRD:186-197） | 主体证实；3 项遗留已诚实转 follow-ups；所附"21 处 alert 残留"现已清零（文档未回写，见 §4） | ✅ | 快速模式 `ProductionTab.tsx:148`；stepEvidence `AgentWorkspace.tsx:239`；violations 证据行 `ProductionRunReview.tsx:326-331`；`grep window.confirm src/components` 实际调用 0（仅注释）；`grep alert(` 组件 0 命中 |

---

## 2. 逐项详述（按严重度排序）

### 2.1 ❌ "本仓库非 git 仓库"——虚假声明，且使全部"已上线"表述失真

**声称**：`docs/plans/README.md:4`："执行者须知：本仓库**非 git 仓库**，漂移检测用各计划中的'现状摘录'对照实际文件"；`docs/plans/007-dual-ai-and-followups.md:4` 同句重复。

**事实**：
- 环境与 `git log` 证实这是标准 git 仓库：13 个提交，末次 `de696c5`（2026-09-03 "fix(polish): audit batch 4"）。
- 关键后果：README.md:34"已完成里程碑（本轮会话）"表与 007:70-79 执行状态表描述的全部代码改动（SkillsStudioView 单动词 +159 行、AppShell 质量门、production.ts 被拒稿留存、writing-style-service 留存化、onboarding 推理模型兼容、db-init 0600 等）**全部处于已暂存未提交状态**。`git status --short` 显示 src/server 数十文件为 `M `（staged），`docs/plans/001-007`、两份会话日志、两份审计报告本身也都是未提交的新增文件。
- 对一个历史上真实发生过"444 个本地提交随 git 对象损坏而丢失"事故的仓库（见《InkFlow_横纵分析报告.md》§2.4），"已上线/已根治"的实际含义只是"已写入工作区，一次 `git checkout` 即可全灭"。声明的错误直接导致执行者不会去做提交保护。

**差距清单**：
1. 更正 README.md:4 与 007:4 的仓库属性声明；
2. 将当前暂存区内容提交（或至少快照），使"已完成"具备持久性；
3. 之后所有里程碑表加"commit hash"列，杜绝"工作区即上线"。

### 2.2 ⚠️ 007 T1 双 AI 入口命名区分——主改名完成，"仅工作台语境"验收未达成

**声称**：007:74 "✅ 已完成：侧边栏'智能管家'→'AI 协作'，抽屉 aria-label 同步，编辑器按钮保留'智能管家'（工作台专属名）"。007:27 验收原文："grep 用户可见文案（排除代码注释/测试）'智能管家'仅出现在工作台语境"。

**证实部分**：
- `src/lib/workspace-nav.ts:13` → `{ id: 'ai', label: 'AI 协作' }`（007:19 引用的路径 `src/components/workspace-nav.ts` 不存在，实际在 `src/lib/`，文件路径记录有误但改动属实）；
- `AIAssistantDrawer.tsx:118` aria-label "AI 协作助手"、`:144` "关闭 AI 协作助手"；`AIAssistant.tsx:400` 已改 "关闭 AI 协作助手"；`EditorHeader.tsx:185` 保留"智能管家"（符合设计）。

**未达成部分**（"智能管家"仍指向全局抽屉，即已被改名"AI 协作助手"的那个表面）：
- `ProjectCockpitView.tsx:245-250`："智能管家"按钮 → `onOpenAssistant('general', {surface:'workspace'})` → `AppShell.tsx:518-521 handleOpenAssistant` → `openAssistant` → 全局 `AIAssistantDrawer`（AppShell.tsx:1188 挂载）；
- `WorldBibleView.tsx:972-973`："打开智能管家" → 同上全局抽屉；
- `ContinuationPackView.tsx:698-727`："批量交给智能管家处理" 等三处 → 同上；
- `WorldBibleAssistant.tsx:44,570-571`："智能管家的设定模式"（独立设定面板，非工作台）。
- 另 `WritingSurface.tsx:298`"唤起 AI 智能管家"→ `setIsAgentSidebarOpen(true)`，此为编辑器工作台，属验收允许语境。

**结论**：任务标记 ✅ 但自家验收条件未满足，两个 AI 表面的命名区分在 4 个入口上仍然名实错位。

### 2.3 ⚠️ 007 T2 全局助手写入接入质量门——三条直写路径只堵了一条

**声称**：007:75 "✅ 已完成：AppShell.handleApplyAssistantToContent 写入前跑 validateCompleteChapterDraftQuality"。007:31 问题定义明确列三处："写入正文/替换选区/确认写入分镜（AIAssistant.tsx:637-668）……绕过质量门"；007:33 改法"分镜候选同理"。

**证实部分**：
- 正文路径有门：`AppShell.tsx:637-642`，`validateCompleteChapterDraftQuality` 不过则 toast 违规详情并拒绝写入（:638-641）；
- 接线完整：`AppShell.tsx:1200` → `AIAssistantDrawer.tsx:185,233` → `AIAssistant.tsx:564,658,663`（插到末尾/确认写入正文）。

**未达成部分**：
- **替换选区绕过质量门**：`AppShell.tsx:672-709 handleReplaceAssistantSelection`——拼接新内容后（:692-700）直接 `updateChapter` 落库（:702-706），全程无任何质量校验；
- **分镜写入无门禁**：`AppShell.tsx:652-670 handleApplyAssistantToSceneBeats` 直接追加 `sceneBeats` 落库（分镜语义上整章门禁或不适用的确存疑，但计划原文要求"同理"收敛，至少应有显式决策记录）；
- **原验收"候选确认横幅"未实现**：007:35 验收"全局助手生成正文后出现候选确认横幅（含质量校验）"——实际实现为"写入前校验+拒绝 toast"，成功时仍直写。007:75 的措辞如实描述了实现方式，但任务整体标 ✅ 与计划验收不符。

**结论**：主路径（整章写入）已堵，"替换选区"是仍然敞开的旁路——质量门禁是产品核心卖点（PRD §4 护栏声明），该旁路与"同一产品两套质量标准"的原始问题定义直接冲突。

### 2.4 ⚠️ 001 单动词收敛——核心交互已上线，但里程碑表的"徽章瘦身、文案收敛"与证据不符

**声称**：README.md:12 "大部分完成（2026-09-07）：弹窗单动词+撤销已上线"；README.md:41 里程碑表 "弹窗单动词+撤销、徽章瘦身、文案收敛、确认框全覆盖（appConfirm/appPrompt）"。

**证实部分**：
- 单动词：包提交按钮统一"启用所选"（`SkillsStudioView.tsx:74-76`），硬编码四套提示语函数（001:17-19 引用的 :174-176）已删除，grep `加入本次配置候选` = 0 命中；
- 撤销：`SkillsStudioView.tsx:1525-1537` 深拷贝 preProfile → applyConfiguration → toast 带"撤销"按钮回写（另 `:2578`）；
- 确认框：`appConfirm/appPrompt` 存在（`src/components/ui/app-confirm.tsx:32,50`），组件层 `window.confirm` 实际调用 0（grep 3 命中均为注释），hooks/lib 无原生 confirm。

**与证据相反/未达成部分**（001 完成标准 4 项 checkbox 全部未勾——checkbox 是诚实的，问题是 README 里程碑表的措辞越过证据）：
- **"徽章瘦身"未达标准**：能力卡徽章区 `SkillsStudioView.tsx:349-362` 仍渲染 类别 + runtime + scope + 逐个 inputs（正文/大纲/设定各一枚，最多 3 枚）+ `:329` 来源徽章 = 单卡最多 5-6 枚；包卡 `:2169-2171` 仍 3 枚 + `:2176` 付费徽章。001 完成标准"每卡徽章 ≤2"远未达成，`CapabilityBadges` 子组件（001 步骤 4）不存在；
- **"文案收敛"有残留**：完成标准"grep `加入本次配置候选|应用所选配置` = 0 命中"实际 **1 命中**——`SkillsStudioView.tsx:65` `'应用所选配置并返回写作'`（弹窗按钮，现行设计的保留字符串，但按字面标准即未达成，checkbox 未勾是对的，里程碑表不应笼统写"文案收敛"）；
- **撤销条时长漂移**：完成标准"5 秒后消失"，实现为 `:1531` toast 6500ms（注释自称 5s）；
- **草稿机未退役**：001 目标 3"stageConfiguration/configurationDraft 流程退役"未做——`configurationDraft` state（:1005）、`stageConfiguration` 调用（:801）、草稿恢复逻辑（:1159,1179）全部在用；
- **不可用卡折叠未做**：001 目标 5"需解锁 `<details>` 分组"，grep `需解锁|<details` = 0 命中。

**结论**：001 自我定位"大部分完成"+checkbox 未勾基本诚实；但 README 里程碑表把"徽章瘦身、文案收敛"列入完成项，超出了代码证据支持的范围。

### 2.5 ✅ 证实完成的条目（证据摘要）

- **写法确认留存化**：`writing-style-service.ts:815,833-835,924`——resolveWritingStyleRequest + 旧确认回退最新已批准资料包 + confirmed 指纹比对；npm test `ok 972` 相关用例通过。README.md:38 的"根治"表述有代码与测试双重支撑。
- **被拒稿进预览+知情覆写**：管线 3 次模型稿尝试（`ai-production-pipeline.ts:268`，`MAX_RETRIES=2` 即 attempt 0..2）→ 全拒时带最后模型稿抛 `DraftQualityRejectionError`（`:409`）→ `production.ts:946-975` 持久化 `review_required` + `qualityRejected: true` + SSE 告知 → `ProductionRunReview.tsx:321-325` 保留文案 + `:259-267` 两步知情确认（先点"接受并写入"→ 出现风险告知面板 → "确认写入"）。README.md:39 完全成立（"三次重试"与实现的 3 次尝试措辞基本相符）。
- **批次 5**：见速览表证据列，7 项全部有落点。唯一瑕疵：对比度修复数量 README 写"97 处"（README.md:40）、审计报告写"94 处"（2026-09-05-full-stack-audit.md:33），两份文档数字漂移，未复核原始计数。
- **007 T6/T4、T3**：与 007:76-79 执行状态的自述完全一致（含如实标注的未做项）。
- **产品体验审计报告勘误表**：1/3/4/6 号修复全部有代码落点且声称的测试（server-llm 22 用例、editor-persistence 14 用例）实测通过；5/8 号诚实标"待复验"。
- **PRD §12**：六 Story 的落地证据均在（详见速览表），3 项遗留子项如实转入 follow-ups PRD。

---

## 3. 测试实况（2026-09-07 实测）

| 命令 | README 声明 | 实测结果 | 判定 |
|---|---|---|---|
| `npx tsc --noEmit` | 0 错误 | exit 0，无输出（0 错误） | ✅ 一致 |
| `npx vitest -c vitest.config.frontend.ts run` | 全绿基线 830/830，当前 828/830 | Test Files: 1 failed \| 119 passed (120)；Tests: **2 failed \| 828 passed (830)**；失败文件 `src/tests/skills-studio-plan158.test.tsx`，失败用例：① `uses author-facing action and scope labels inside package components`（:792 起，waitFor 超时）② `explains outline package results as outline setup instead of deck setup`（:905 起，:924 断言期望"下一步：应用配置后前往大纲面板"，实际渲染"下一步：应用配置后写入作品"） | ✅ 与 README/007 T3 描述一致（828/830 正是这 2 个） |
| `npm test` | 1151/1151 | `# tests 1151  # pass 1151  # fail 0`（50391ms） | ✅ 一致 |

补充：失败用例②的期望文案在源码中存在（`SkillsStudioView.tsx:122`），失败表现为大纲目的地状态未在断言窗口内生效——与 007:76 "fireEvent 与异步状态更新的竞态"的自述相容，但也可能是弹窗 destination 传参真实缺陷，修复 T3 时需用浏览器逐帧确认（007:84 已给出同样的重启条件）。

硬性规则核验：`npm test` 经 `tests/helpers/test-db-preload.ts:8-18` 强制使用 `mkdtemp` 临时库并随进程清理；前端 vitest 配置（`vitest.config.frontend.ts`）为 jsdom 无数据库；本机 `INKFLOW_DB_PATH` 未设置。**未触碰生产 data.db。**

---

## 4. 对照附录：诚实标记为未完成/暂缓的条目（不计入问题）

| 条目 | 出处 | 现状核验 |
|---|---|---|
| 002 审稿三合一 / 003 护栏面板化 / 004 启用即落位 / 005 store / 006 状态条 | README.md:13-17 "TODO" | 确未实施，标注诚实 |
| 007 T3 两个深流测试 | 007:76 "⏸ 用户决定暂缓" | 与实测 2 个失败用例吻合 |
| 007 T5 候选确认 UI 去重 | 007:78 "⏸ 用户决定暂缓" | `EditorView` 与 `AgentWorkspace` 两份实现仍在（未合并） |
| 007 T4 workflow-copy.ts | 007:77 "待做" | 文件确实不存在 |
| 007 T6 licensed 限额收敛 | 007:79 "未做" | 重复实现确实仍在（≥5 处） |
| 虚拟化大列表（react-window） | README.md:46 "需批准" | package.json 确无 react-window |
| Google/OpenAI 超时重试统一、A1 状态条交互、writerModel UI | README.md:47-50 | 属未立项事项，标注一致 |
| PRD follow-ups A1/A2/A3 | follow-ups:16-21 | A1 状态条、A2 历史降级标记、A3 章节角标均未实现（与"未做"标注一致） |
| 审计报告 5/8 号（Key 占位符、弹窗失焦） | 体验审计报告:108,111 "待复验" | 保持待复验，标注诚实 |

**反向漂移（文档落后于代码，顺带记录）**：
- follow-ups PRD（:2"草稿（待排期）"）的 B 项"21 处原生 alert() 清理"**实际已完成**（组件层 `alert(` 0 命中），文档未回写；
- `docs/README.md` 维护规则"根目录不再散落 md"，但本轮新增的 4 份审计报告（md/html）仍落在仓库根目录。

---

## 5. 建议的处理顺序

1. **立即（保护成果）**：更正"非 git 仓库"声明并将暂存区/工作区改动提交——当前所有"已完成"结论都以未提交状态存在，是本仓库历史上真实发生过的事故模式（横纵分析报告 §2.4）。
2. **T2 旁路封堵（真实功能缺口）**：给 `AppShell.tsx:672 handleReplaceAssistantSelection` 补质量校验（或与正文路径共用同一段门禁代码）；对分镜写入做显式决策（门禁或豁免理由）并回写 007。
3. **T1 收尾（半天内可清）**：改 `ProjectCockpitView` / `WorldBibleView` / `ContinuationPackView` / `WorldBibleAssistant` 的 4 处"智能管家"文案或改其指向，使 grep 验收真正达标。
4. **T3 两个红测试**：恢复 830/830 回归基线（README:5 已声明以全绿为基线，常红会污染后续每一轮判断）；修复时先确认是竞态还是弹窗 destination 传参缺陷。
5. **001 收尾或降级表述**：徽章 ≤2、草稿机退役、需解锁折叠三项要么做完，要么把 README 里程碑行的"徽章瘦身、文案收敛"改为与 checkbox 一致的精确表述。
6. **文档回写**：follow-ups B 项标已完成、README 与审计报告的对比度数字对齐（94 vs 97）、根目录审计报告按 docs/README 规则归位。
