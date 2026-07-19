# 实施计划: 前端样式、暗色模式与无障碍规范清理 (075)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development

**Goal:** 清理前端剩余的 3 处亮色模式硬编码 (`bg-white`)、重构不稳定的 `space-x/y` 布局、推广 `size-*` 图标缩写，并完善 `SettingsModal` 的无障碍声明。
**Architecture:** 采用 CSS 变量与现代 Flex 布局替代旧的 Tailwind 类，完全兼容自定义的 OKLCH 暗色模式。
**Tech Stack:** React, TailwindCSS v4, Lucide React

---

## 任务分解 (Tasks)

### Task 1: 清扫 `bg-white` 暗色模式残留
**Files:**
- [MODIFY] [App.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/App.tsx)

**步骤：**
- [ ] 1. 将第 597 行的小说选择卡片背景从 `bg-white` 替换为 `bg-theme-sidebar`。
- [ ] 2. 将第 615 行的智能助手侧边栏容器背景从 `bg-white` 替换为 `bg-theme-sidebar`。
- [ ] 3. 将第 619 行的智能助手侧边栏头部背景从 `bg-white` 替换为 `bg-theme-sidebar`。

---

### Task 2: 重构不稳定的 `space-x/y` 布局
**Files:**
- [MODIFY] [Sidebar.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/Sidebar.tsx)
- [MODIFY] [AIAssistant.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/AIAssistant.tsx)

**步骤：**
- [ ] 1. 在 `Sidebar.tsx` 中，将 `<nav className="flex-1 px-3 space-y-1 overflow-y-auto">` 替换为 `<nav className="flex-1 px-3 flex flex-col gap-1 overflow-y-auto">`。
- [ ] 2. 在 `AIAssistant.tsx` 中，将聊天内容区域的 `space-y-6` 替换为 `flex flex-col gap-6`。

---

### Task 3: 推广 `size-*` 图标宽高缩写
**Files:**
- [MODIFY] [SourceBadge.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/SourceBadge.tsx)
- [MODIFY] [EditorHeader.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/EditorHeader.tsx)

**步骤：**
- [ ] 1. 在 `SourceBadge.tsx` 中，将 `w-3.5 h-3.5` 替换为 `size-3.5`。
- [ ] 2. 在 `EditorHeader.tsx` 中，将 `w-3 h-3` 替换为 `size-3`。

---

### Task 4: 补齐 `SettingsModal` 无障碍语义
**Files:**
- [MODIFY] [SettingsModal.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/SettingsModal.tsx)

**步骤：**
- [ ] 1. 为设置弹窗的主面板容器添加 `role="dialog"` 和 `aria-modal="true"` 属性。
- [ ] 2. 为弹窗的 Header 标题添加唯一的 `id="settings-dialog-title"`，并在主面板容器上添加 `aria-labelledby="settings-dialog-title"`。

---

## 验证计划 (Verification)

### 自动化测试
- 运行 `npx tsc --noEmit` 确保无编译错误。
- 运行 `npm run test` 确保未破坏现有组件测试。
