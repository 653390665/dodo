# 实施计划: 开启 TypeScript 严格模式并解决编译错误 (076)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development

**Goal:** 在 `tsconfig.json` 中开启 `"strict": true`，并修复由此引入的所有类型安全编译报错（包含 `null` 检查、隐式 `any` 以及第三方库声明缺失）。
**Architecture:** 通过安全的非空断言（`!`）、可选链（`?.`）、空值合并（`??`）以及添加必要的显式类型声明，消除编译期隐患，确保运行时类型安全。
**Tech Stack:** TypeScript, React

---

## 任务分解 (Tasks)

### Task 1: 开启严格模式配置
**Files:**
- [MODIFY] [tsconfig.json](file:///Users/Zhuanz/Documents/dodo-inkflow/tsconfig.json)

**步骤：**
- [ ] 1. 在 `tsconfig.json` 的 `compilerOptions` 中添加 `"strict": true`。

---

### Task 2: 修复主应用与面板的 Null/Undefined 报错
**Files:**
- [MODIFY] [App.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/App.tsx)
- [MODIFY] [AgentWorkspace.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/AgentWorkspace.tsx)
- [MODIFY] [WritingSurface.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx)

**步骤：**
- [ ] 1. 在 `App.tsx` 的行 384-385 中，对 `onboardingDraft` 添加非空断言或可选链（如 `onboardingDraft?.cards`）。
- [ ] 2. 在 `AgentWorkspace.tsx` 的行 246 中，确保 `CopilotSuggestion | null` 到 `CopilotSuggestion` 的赋值安全，或者在没有建议时传 `undefined` / 允许 `null`。
- [ ] 3. 在 `WritingSurface.tsx` 的行 185 中，做类似的 `CopilotSuggestion | null` 兼容处理。

---

### Task 3: 修复辅助面板与组件的类型不匹配报错
**Files:**
- [MODIFY] [AIAssistant.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/AIAssistant.tsx)
- [MODIFY] [BookFactoryView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/BookFactoryView.tsx)
- [MODIFY] [EditorView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/EditorView.tsx)
- [MODIFY] [RelationshipGraph.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/RelationshipGraph.tsx)
- [MODIFY] [StoryContractPanel.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/StoryContractPanel.tsx)
- [MODIFY] [WorldBibleView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WorldBibleView.tsx)

**步骤：**
- [ ] 1. 在 `AIAssistant.tsx` 中，确保分配给 `string` 类型的变量不会被赋予 `string | undefined`（使用 `?? ''`）。
- [ ] 2. 在 `BookFactoryView.tsx` 中，安全读取 `selectedSkill.vocabulary?.length` 和 `selectedSkill.corePatterns?.length`。
- [ ] 3. 在 `EditorView.tsx` 中，对 `ProjectPreferenceProfile | undefined` 赋默认空对象或进行可选链处理。
- [ ] 4. 在 `RelationshipGraph.tsx` 中，确保 `description` 字段始终为 `string`（使用 `?? ''`）。
- [ ] 5. 在 `StoryContractPanel.tsx` 中，使用 `?? []` 安全迭代 `customConstraints`，并使用可选链读取 `foreshadowingDebt`。
- [ ] 6. 在 `WorldBibleView.tsx` 中，补齐 `ProjectPreferenceProfile` 缺少的字段或使用可选链。

---

### Task 4: 修复抽屉及工具类的类型缺失与隐式 Any
**Files:**
- [MODIFY] [SkillDetailDrawer.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/skills/SkillDetailDrawer.tsx)
- [MODIFY] [audit-structured.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/src/lib/audit-structured.ts)
- [MODIFY] [main.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/main.tsx)

**步骤：**
- [ ] 1. 在 `SkillDetailDrawer.tsx` 中，添加对 `skill` 和 `draft` 的非空判断，并补齐 `name` 和 `id` 的必填校验。
- [ ] 2. 在 `audit-structured.ts` 中，为 `issue` 和 `check` 参数显式声明类型。
- [ ] 3. 在 `main.tsx` 中，解决 `react-dom/client` 模块声明问题（若需要，补齐 `@types/react-dom` 或添加本地 `declare module`）。

---

### Task 5: 修复测试用例中的重复 Key 与隐式 Any
**Files:**
- [MODIFY] [continuation-overview.test.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-overview.test.ts)
- [MODIFY] [onboarding-model.test.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/tests/onboarding-model.test.ts)
- [MODIFY] [skill-fusion.test.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/tests/skill-fusion.test.ts)

**步骤：**
- [ ] 1. 在 `continuation-overview.test.ts` 中，为参数 `child` 声明显式类型或 `any`。
- [ ] 2. 清理 `onboarding-model.test.ts` 和 `skill-fusion.test.ts` 中重复声明的 `id` 和 `name` 属性。

---

## 验证计划 (Verification)

### 自动化测试
- 运行：
  ```bash
  npx tsc --noEmit
  ```
- 运行：
  ```bash
  npm run test
  ```
