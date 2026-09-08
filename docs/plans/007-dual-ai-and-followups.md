# 007 — 双 AI 入口收敛 + 剩余深流测试修复（任务计划包）

> 生成：2026-09-07。合并来源：①上一轮未完成的 2 个深流测试修复 + 术语收敛；②本轮全维度审计（双 AI 入口冲突 / 引导过载 / 能力链路断裂）。
> 执行约定：每步后跑 `npx tsc --noEmit` 与改动文件的 vitest；本仓库是 git 仓库，每个任务包完成后提交一次。

## 任务包总览（建议执行顺序）

| # | 任务 | 优先级 | 预估 | 依赖 |
|---|---|---|---|---|
| T1 | 双 AI 入口命名区分（P0） | P0 | S | 无 |
| T2 | 全局助手写入接入质量门候选管道（P0） | P0 | M | 无 |
| T3 | 修复 2 个深流测试（006 遗留） | P0 | S | 无 |
| T4 | "下一步动作"收敛 + 动作词表（P1） | P1 | M | T1 |
| T5 | 候选确认 UI 去重（P1） | P1 | M | T2 |
| T6 | 技法动词改名 + licensed 限额收敛（P2） | P2 | S | 无 |

## T1 — 双 AI 入口命名区分（P0）

**问题**："智能管家"一名三用：侧边栏项打开全局抽屉（workspace-nav.ts:13），编辑器按钮打开工作台（EditorHeader.tsx:176-185），抽屉内标题却是"作品协作助手/灵感启动助手"（AIAssistant.tsx:47）。用户无法区分两个 AI 表面。

**改法**：
1. `src/components/workspace-nav.ts`（或 Sidebar 侧边栏项定义处）：导航项文案"智能管家"→"AI 协作"。
2. `src/components/AIAssistantDrawer.tsx`：抽屉 aria-label 与标题统一为"AI 协作助手"；`AIAssistant.tsx:400` 的"关闭智能管家"→"关闭 AI 协作"。
3. 编辑器顶栏按钮 `EditorHeader.tsx:185` 保留"智能管家"（工作台专属名）。
4. 全局 grep `智能管家` 用户可见文案：只允许出现在工作台相关 UI。

**验收**：grep 用户可见文案（排除代码注释/测试）"智能管家"仅出现在工作台语境；侧边栏项与抽屉标题不再叫"智能管家"；相关测试同步。

## T2 — 全局助手写入接入质量门（P0）

**问题**：全局助手的"写入正文/替换选区/确认写入分镜"（AIAssistant.tsx:637-668）直接调用 onApplyToContent/onReplaceSelection，绕过质量门；而智能管家产出要过三重门。同一产品两套质量标准。

**改法**：全局助手的正文候选回调改走 `aiContentCandidate` 管道（EditorView 已有：候选横幅→用户确认→质量校验→写入），分镜候选同理。保留"灵感碎片/备忘录"等非正文写入不变。

**验收**：全局助手生成正文后出现候选确认横幅（含质量校验），不再直写章节内容。

## T3 — 修复 2 个深流测试（006 遗留）

- `skills-studio-plan158.test.tsx` "uses author-facing"（:869）与 "explains outline"（:936）：断言 启用所选 后 onLaunchCapability 立即被调用，但单动词下 applyConfiguration(false) 不导航也不触发 outline launch（launch 移到了弹窗按钮的 applyConfiguration(true) 路径）。
- 修法：按新语义拆断——启用所选后断言 applyCapabilityConfiguration 被调用（payload 含 profile）；大纲 launch 改为在弹窗按钮 applyConfiguration(true,'outline') 后断言；或按 006 新交互把 launch 移入 启用所选 的 returnToWriting 分支。

## T4 — "下一步动作"收敛 + 动作词表

**问题**："下一步动作"5 处并存（EditorGuideBanners:31-45、WritingSurface:110-119、AgentWorkspace:886-891、ProductionTab:235、QualityTab:330）；"生成本章正文"4 种措辞；"审稿"3 种。

**改法**：新增 `src/lib/workflow-copy.ts` 动作词表常量（drafting='生成本章正文'、audit='开始 AI 审计'、plan='生成分镜'…），5 处表面全部引用；EditorGuideBanners 的"当前阶段主动作"横幅删除（与主按钮 100% 重复）。

## T5 — 候选确认 UI 去重

`EditorView.tsx:1946-2026` 与 `AgentWorkspace.tsx:735-852` 的 AI 候选确认段是同一逻辑两份实现。抽出单一 `AiCandidateReview` 组件共用。

## T6 — 技法动词改名 + licensed 限额收敛

- `SkillsStudioView.tsx:1553-1571` 技法 toggle 文案"启用"→"收藏为常用技法"（已有 favoriteActionLabel，删误用的"启用"）；handleEquipAsset 技法分支的 recordCapabilityEvent 语义改 technique_favorited。
- licensed 限额三处重复实现（787/1472/1810）抽为一个 `assertLicensedAllowed(asset, novel)` helper。

## 验收总门

- `npx tsc --noEmit` 0 错误；`npx eslint` 改动文件 0 问题
- `npx vitest -c vitest.config.frontend.ts run` 全绿（含修复的 2 个深流测试）
- 手动：侧边栏"AI 协作"生成正文 → 出现候选确认横幅（质量门生效）

## 风险与边界

- T2 改全局助手写入路径，需保"灵感碎片/备忘录"等非正文写入不受影响
- 不动质量门阈值；不动后端 API
- 006 的状态条依赖 005（领域状态入 store），本包不含（仍待立项）


## 执行状态（2026-09-08 关账复核：T1-T6 全部关闭）

| 任务 | 状态 |
|---|---|
| T1 双 AI 入口命名区分 | ✅ 已完成：侧边栏“智能管家”→“AI 协作”，抽屉 aria-label 同步，编辑器按钮保留“智能管家”（工作台专属名） |
| T2 全局助手写入接入质量门 | ✅ 已完成（三条路径中两条有门）：正文写入（AppShell:637-642）与替换选区（:698-706）过 validateCompleteChapterDraftQuality；**分镜写入（:652-670）有意豁免**——分镜是结构素材，整章正文门会误杀，待 T5 系候选管道覆盖时一并收敛 |
| T3 修复 2 个深流测试 | ✅ 完成（2026-09-07 第二轮）：根因是会话重置副作用把自家 apply 误判为外部漂移、关闭了打开的能力包弹窗（组件级修复，见 commit 22b1406）；plan158 35/37→37/37，前端基线恢复全绿 |
| T4 动作词表收敛 | ✅ 关账（2026-09-08 复核）：workflow-copy 由 AiCandidateReview（"到工作台处理"）与 WritingSurface:113（getWorkflowPrimaryActionLabel 收编 9 动作映射）消费；EditorGuideBanners 动作横幅此前已删；009-A2 实测无残留动作词面 |
| T5 候选确认 UI 去重 | ✅ 完成（2026-09-07 第二轮）：单一 `AiCandidateReview` 组件两端接入（editor/workbench 双 variant）；质量门判定 `getCandidateQualityState` 三份重复收敛到 `src/lib/candidate-quality.ts`；表面差异（标题/精修动作/工作台跳转）全部 props 化 |
| T6 技法动词改名 | ✅ 完全关闭（2026-09-08 复核）：改名语义此前已落地；"licensed 限额收敛未做"系陈旧记录——增强门槛已归一至 `src/lib/entitlements.ts` 唯一判定（isLicensedEnhancementGated / filterLicensedAssetsByEntitlement，代码注释即标注 007 T6），组件层仅剩 sourceType 标签与类型守卫管线 |

### 关账说明（原"暂缓原因与重启条件"已失效）

- T3/T5 已于 09-07 第二轮完成，原暂缓条件不再适用；T4/T6 经 2026-09-08 实测复核关账（证据见上表）。本计划无遗留项。

### 已修复的同类回归（供参考）

- 主 PRD 001 的 5 处文案收敛、plan158 深流断言的部分更新、quality-guardrail 误报否决、getPackageModeLabel 标签统一——详见本轮会话记录。
