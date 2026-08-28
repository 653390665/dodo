# 自适应工作流路由动作闭环规范

> 触发分支：改动项目驾驶舱（ProjectCockpitView）行动推荐、跨视图路由（`launchState`）或 EditorView 就绪后自动执行逻辑之前先读本文。

## 为什么
用户在驾驶舱点击带明确意图的行动推荐（如"对本章进行审稿""一键精修局部润色"）后，若 EditorView 只做静态面板切换、要求用户再点一次同义按钮，体验链路被无谓拉长。

## 规范
1. **启动源完整追踪**：通过扩展 `launchState.source` 记录跳转意图，如 `'cockpit-audit'`（审稿）与 `'cockpit-polish'`（润色）。
2. **静默首发执行**：EditorView 组件与数据加载就绪后，直接静默触发对应核心动作（如自动调用深度审计 `handleRunAudit()`，或自动跑起润色 `handlePolishChapterFromAudit()`），而非停留静态面板切换。

## 现有实现参照
- 启动源类型：`shared/types/continuation.ts`；路由与消费：`src/components/AppShell.tsx`、`src/components/EditorView.tsx`。
