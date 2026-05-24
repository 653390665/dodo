# AgentWorkspace Boundary Map

日期：2026-05-20

目标：把当前 `AgentWorkspace` 从“大一统管家组件”拆成可逐步重构的边界图，先明确 ownership，再决定代码拆分顺序。

## 1. Current Evidence

- `AgentWorkspaceProps` 从 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:24) 开始，props 面覆盖 chapter、production、outline、audit、bible、skills、versions、trace、sniffing 等多类职责
- tab bar 在 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:177) 同时编排 12 个 tab
- content area 从 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:237) 开始，按 `agentTab` 渲染 copilot、production、ideas、foreshadowing、pacing、outline、planning、quality、bible、skills、versions、trace
- `ProjectPreferencePanel` 与 `SkillLoadoutBoard` 在 skills 区出现，见 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:546)
- `sniffedEntities` 相关 trace UI 在后段单独存在，见 [src/components/AgentWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx:661)

## 2. Proposed Ownership Groups

### A. Copilot Group

包含：

- `copilot-home`
- `runCopilotAction`
- `copilotSuggestion`

职责：

- 展示当前建议
- 分发用户对建议的执行动作

### B. Production Group

包含：

- `production`
- `outline`
- `planning`
- `quality`

相关 props：

- `activeProductionRun`
- `productionIntent`
- `expectedWordCount`
- `userIntent`
- `globalOutline`
- `production*Source`
- `onStartProductionRun`
- `onApplyProductionRun`
- `onGenerateOutline`
- `onGenerateBeats`
- `onGenerateContent`
- `onRunAudit`
- `onPolishChapterFromAudit`

职责：

- 写前规划
- 章节生产
- 写后审计

### C. Knowledge Group

包含：

- `bible`
- `skills`

相关 props：

- `characters`
- `locations`
- `items`
- `librarySkills`
- `skillUsageRecords`
- `mountedSkillLoadout`
- `projectPreferenceProfile`
- `onAssignSkill`
- `onRemoveSkill`
- `onPreferenceProfileChange`
- `bibleSearch`

职责：

- 设定检索
- 技能装备
- 偏好配置

### D. Diagnostics Group

包含：

- `pacing`
- `foreshadowing`
- `trace`
- `versions`
- `ideas`

相关 props：

- `versions`
- `onSaveVersion`
- `onRestoreVersion`
- `isSniffing`
- `sniffedEntities`
- `onSniffEntities`
- `onAddSniffedEntity`
- `addingEntityNames`

职责：

- 节奏/伏笔诊断
- 版本回溯
- 实体嗅探与追踪
- 灵感碎片浏览

## 3. Shared Shell Responsibilities

以下职责不应立即下沉：

- 侧边栏开关
- tab 切换状态
- 顶部容器壳层与动画
- group 之间共享的 `novel` / `chapters` / `currentChapter`

建议保留在：

- `AgentWorkspaceShell`

## 4. First Split Recommendation

第一批最适合拆出的子容器：

1. `AgentWorkspaceProductionPanel`
2. `AgentWorkspaceKnowledgePanel`
3. `AgentWorkspaceDiagnosticsPanel`

原因：

- 这三组的 props 聚类最明显
- 不需要先改核心数据模型
- 可以先做 UI orchestration 拆分，不立即改业务语义

## 5. Non-Goals For First Refactor

- 不重做视觉样式
- 不改 tab 命名
- 不同时改状态管理方案
- 不在第一轮把所有 hooks 都抽离

## 6. Acceptance

第一轮实现完成后，应满足：

1. `AgentWorkspace` 主文件只负责 shell + tab routing
2. 至少 2 组 feature 被分离成独立 panel
3. props ownership 更清楚，后续继续拆分时不需要重新理解整块 JSX
