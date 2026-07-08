# 实施计划: 收紧 ESLint 门禁与警告清理 (079)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development

**Goal:** 拓宽静态代码规范的覆盖面，将后端 Express 路由与 Electron 宿主脚本纳入统一的 ESLint 门禁，并将关键性警告规则提升为硬性错误（Error），同时彻底清除目前累积的 145 个代码警告。
**Architecture:**1. **多环境配置隔离**：在 `eslint.config.mjs` 中，通过配置对象数组，为前端 React、后端 Node.js 以及 Electron 进程脚本分别指定各自的 `languageOptions`（如 Node 全局变量环境与 CommonJS 规则），防止产生虚假的未定义报错。
2. **规则评级提升**：将高实用价值的 `react-hooks/exhaustive-deps` 与 `@typescript-eslint/no-unused-vars` 规则从 `warn` 升级为 `error`，在 CI 门禁处进行强拦截。
3. **存量警告清零**：全面重构清除项目中因未使用的变量、未挂载的 Hook 依赖、不安全 any 类型而产生的 145 个警告。
**Tech Stack:** ESLint, TypeScript, Node.js

---

## 任务分解 (Tasks)

### Task 1: 升级 ESLint 多环境扫描规则与评级
**Files:**
- [MODIFY] [eslint.config.mjs](file:///Users/Zhuanz/Documents/dodo-inkflow/eslint.config.mjs)

**步骤：**
- [ ] 1. 从 `eslint.config.mjs` 忽略清单中移除 `'server'`，使其纳入扫描。
- [ ] 2. 在 `eslint.config.mjs` 中，新增针对 Node.js / Electron 环境的专用配置块，允许使用 CommonJS 模块并注入 Node 全局变量：
  ```javascript
  {
    files: ['server/**/*.ts', 'electron.cjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      }
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    }
  }
  ```
- [ ] 3. 在前端规则配置块中，将以下规则提升为 `error`：
  ```javascript
  'react-hooks/exhaustive-deps': 'error',
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  ```

---

### Task 2: 清理前端与公用库中的未定义和未使用警告
**Files:**
- [MODIFY] [Sidebar.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/Sidebar.tsx)
- [MODIFY] [SkillsStudioView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/SkillsStudioView.tsx)
- [MODIFY] [WelcomeView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WelcomeView.tsx)
- [MODIFY] [WorldBibleView.tsx](file:///Users/Zhuanz/Documents/dodo-inkflow/src/components/WorldBibleView.tsx)

**步骤：**
- [ ] 1. 在 `Sidebar.tsx` 中，清理或为未使用参数 `user` 加上下划线前缀（`_user`）。
- [ ] 2. 在 `SkillsStudioView.tsx` 中，删除未使用的导入 `useAppStore`。
- [ ] 3. 在 `WelcomeView.tsx` 中，删除未使用的赋值 `setChatContext`。
- [ ] 4. 在 `WorldBibleView.tsx` 中，清理未使用的函数 `extractWorldSetupPhase`，并为未使用的 map 索引参数加上下划线。

---

### Task 3: 补全并修复 React Hook 缺失的副作用依赖项
**Files:**
- [MODIFY] [useEditorData.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorData.ts)
- [MODIFY] [useEditorIntelligenceContext.ts](file:///Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorIntelligenceContext.ts)

**步骤：**
- [ ] 1. 在 `useEditorData.ts` 中，将获取数据的核心方法 `fetchAll` 包装在 `useCallback` 内，或将其安全地追加到 `useEffect` 的依赖数组中。
- [ ] 2. 在 `useEditorIntelligenceContext.ts` 中，对 `useMemo` 的缺失依赖项 `getCurrentFitScore` 进行补齐。

---

## 验证计划 (Verification)

### Drift Check
- 运行：
  ```bash
  git diff --stat ca53899..HEAD -- eslint.config.mjs src/components/ src/lib/hooks/
  ```

### 静态扫描验证
- 运行：
  ```bash
  npm run lint
  ```
  预期：ESLint 没有任何 Errors 且 Warnings 数量下降 90% 以上（控制在 15 个以内），命令以 exit 0 成功退出。
- 运行：
  ```bash
  npx tsc --noEmit && npm run test
  ```
  确保在此次清理过程中未对类型和已有功能造成任何破坏性改动。
