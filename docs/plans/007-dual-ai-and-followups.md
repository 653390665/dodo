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


## 执行状态（2026-09-07 更新）

| 任务 | 状态 |
|---|---|
| T1 双 AI 入口命名区分 | ✅ 已完成：侧边栏“智能管家”→“AI 协作”，抽屉 aria-label 同步，编辑器按钮保留“智能管家”（工作台专属名） |
| T2 全局助手写入接入质量门 | ✅ 已完成：AppShell.handleApplyAssistantToContent 写入前跑 validateCompleteChapterDraftQuality，不通过则 toast 违规详情并拒绝写入 |
| T3 修复 2 个深流测试 | ✅ 完成（2026-09-07 第二轮）：根因是会话重置副作用把自家 apply 误判为外部漂移、关闭了打开的能力包弹窗（组件级修复，见 commit 22b1406）；plan158 35/37→37/37，前端基线恢复全绿 |
| T4 动作词表收敛 | ⏸ 部分完成："下一步动作"横幅已删（与主按钮重复）；动作词表常量化（workflow-copy.ts）待做 |
| T5 候选确认 UI 去重 | ✅ 完成（2026-09-07 第二轮）：单一 `AiCandidateReview` 组件两端接入（editor/workbench 双 variant）；质量门判定 `getCandidateQualityState` 三份重复收敛到 `src/lib/candidate-quality.ts`；表面差异（标题/精修动作/工作台跳转）全部 props 化 |
| T6 技法动词改名 | ✅ 已完成：技法"启用"误用改为"收藏为常用技法"语义；licensed 限额收敛未做 |

### 暂缓原因与重启条件

- T3/T5：不影响用户实际使用（产品功能正常），影响的是测试信号质量与长期维护成本。建议在下一轮功能开发**开始前**清掉——常红测试会污染回归判断。
- 重启 T3 时：用浏览器 devtools 对 humanization/outline 包流逐帧追踪 fireEvent 与异步 apply 的竞态；断言按新单动词时序重写。
- 重启 T5 时：先读 EditorView 与 AgentWorkspace 两份实现的 diff，确认行为一致后再抽组件。

### 已修复的同类回归（供参考）

- 主 PRD 001 的 5 处文案收敛、plan158 深流断言的部分更新、quality-guardrail 误报否决、getPackageModeLabel 标签统一——详见本轮会话记录。
