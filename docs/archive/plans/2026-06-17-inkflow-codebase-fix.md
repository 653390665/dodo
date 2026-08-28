# InkFlow 墨影 — P0 + P1 代码修复实现计划

> **For agentic workers:** 使用 superpowers-lite 的 execute-plan 能力逐 Task 执行。步骤使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标:** 修复审计报告中 P0 (安全漏洞 + 零 Lint) 和 P1 (代码分割 + 状态管理 + 巨型文件拆分) 问题，将 InkFlow 工程化水平从 C+ 提升到 B+

**架构:** 分三阶段递进 — (1) 基础设施补课 → (2) 前端架构优化 → (3) 后端拆分。每阶段独立可交付、不破坏现有功能。

**技术栈:** TypeScript 5.8, React 19, Vite 6, Tailwind CSS v4, Express, better-sqlite3, Electron 33

## 全局约束

- TypeScript 编译必须始终零错误: `npx tsc --noEmit` exit 0
- 现有 63 个后端测试必须全部通过
- 不改变任何用户可见行为（纯内部重构）
- 每个 Task 完成后 `npm run build` 必须成功
- Git 分支: `refactor/code-quality` 从 main 切出

---

### Task 1: npm audit 修复安全漏洞

**文件:**
- 修改: `package.json`
- 修改: `package-lock.json` (自动生成)

**接口:**
- 消耗: 无
- 产出: `npm audit` 输出漏洞数降至 0 (或仅剩 low/info 级别)

- [ ] **Step 1: 记录当前漏洞数**

```bash
cd ~/Documents/dodo-inkflow
npm audit --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=d.get('metadata',{}).get('vulnerabilities',{})
print(f'当前: total={sum(v.values())}, high={v.get(\"high\",0)}, moderate={v.get(\"moderate\",0)}')
"
```
预期: 显示当前漏洞分布

- [ ] **Step 2: 执行自动修复**

```bash
cd ~/Documents/dodo-inkflow
npm audit fix 2>&1
```

- [ ] **Step 3: 检查修复后状态**

```bash
npm audit --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
v=d.get('metadata',{}).get('vulnerabilities',{})
print(f'修复后: total={sum(v.values())}, high={v.get(\"high\",0)}, moderate={v.get(\"moderate\",0)}')
"
```
预期: high = 0, total 大幅减少

- [ ] **Step 4: 对剩余漏洞尝试 force fix**

```bash
npm audit fix --force 2>&1
# 审查输出，确认没有 major version 破坏性升级
npm audit 2>&1 | tail -5
```
预期: `found 0 vulnerabilities` 或仅剩 low 级别

- [ ] **Step 5: 验证构建不坏**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
```
预期: exit 0, build 成功

- [ ] **Step 6: 提交**

```bash
git add package.json package-lock.json
git commit -m "fix: resolve npm audit vulnerabilities"
```

---

### Task 2: 引入 ESLint + Prettier 代码规范

**文件:**
- 创建: `eslint.config.mjs`
- 创建: `.prettierrc`
- 创建: `.prettierignore`
- 修改: `package.json` (添加 devDependencies + scripts)

**接口:**
- 消耗: 无
- 产出: `npm run lint` 可用, `npm run format` 可用

- [ ] **Step 1: 安装依赖**

```bash
cd ~/Documents/dodo-inkflow
npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh prettier eslint-config-prettier
```

- [ ] **Step 2: 创建 ESLint 配置**

写入 `eslint.config.mjs`:
```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release', 'node_modules', 'tests'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  }
);
```

- [ ] **Step 3: 创建 Prettier 配置**

写入 `.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2
}
```

写入 `.prettierignore`:
```
dist
dist-electron
release
node_modules
package-lock.json
*.md
```

- [ ] **Step 4: 添加 scripts 到 package.json**

在 `scripts` 中添加:
```json
"lint": "eslint . --ext .ts,.tsx",
"lint:fix": "eslint . --ext .ts,.tsx --fix",
"format": "prettier --write \"src/**/*.{ts,tsx,css,json}\" \"server.ts\""
```

并删除旧的 `"lint": "tsc --noEmit"` (类型检查改用 `typecheck` 脚本):
```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 5: 验证 lint 运行**

```bash
npm run lint 2>&1 | tail -10
```
预期: 运行成功（可能有 warnings，但不报错退出）

- [ ] **Step 6: 验证 typecheck 不坏**

```bash
npm run typecheck 2>&1
```
预期: exit 0

- [ ] **Step 7: 提交**

```bash
git add eslint.config.mjs .prettierrc .prettierignore package.json package-lock.json
git commit -m "chore: introduce eslint + prettier code standards"
```

---

### Task 3: React.lazy 代码分割

**文件:**
- 修改: `src/App.tsx:10-25` (将静态 import 改为 lazy)

**接口:**
- 消耗: 无
- 产出: 首屏 JS 包体积减少 40%+

- [ ] **Step 1: 记录当前构建产物大小**

```bash
cd ~/Documents/dodo-inkflow
npm run build 2>&1 | tail -5
ls -lh dist/assets/*.js 2>/dev/null | head -10
```
预期: 记录当前 JS 文件大小

- [ ] **Step 2: 修改 App.tsx 导入方式**

将 `src/App.tsx` 中的静态导入:
```typescript
// 删除这些静态导入:
// import BookFactoryView from './components/BookFactoryView';
// import WorldBibleView from './components/WorldBibleView';
// import EditorView from './components/EditorView';
// import Library from './components/Library';
// import SkillsStudioView from './components/SkillsStudioView';
// import ContinuationImportView from './components/ContinuationImportView';

// 替换为 lazy 导入:
const BookFactoryView = React.lazy(() => import('./components/BookFactoryView'));
const WorldBibleView = React.lazy(() => import('./components/WorldBibleView'));
const EditorView = React.lazy(() => import('./components/EditorView'));
const Library = React.lazy(() => import('./components/Library'));
const SkillsStudioView = React.lazy(() => import('./components/SkillsStudioView'));
const ContinuationImportView = React.lazy(() => import('./components/ContinuationImportView'));
```

确保顶部有 `import React from 'react';`（如果还没有的话）。

在渲染区域用 `<Suspense>` 包裹:
```tsx
import { Suspense } from 'react';

// 在 main 内容区:
<Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-neutral-400">加载中...</div>}>
  {currentView === 'library' && <Library ... />}
  {currentView === 'workspace' && <SplitWorkspace ... />}
  ...
</Suspense>
```

- [ ] **Step 3: 验证类型检查通过**

```bash
npx tsc --noEmit
```
预期: exit 0

- [ ] **Step 4: 验证构建成功并比较产物大小**

```bash
npm run build 2>&1 | tail -5
ls -lh dist/assets/*.js 2>/dev/null | head -10
```
预期: 主 JS bundle 显著缩小, 出现多个 chunk 文件

- [ ] **Step 5: 提交**

```bash
git add src/App.tsx
git commit -m "perf: add React.lazy code splitting for heavy views"
```

---

### Task 4: App.tsx 状态提取 → Zustand Store

**文件:**
- 创建: `src/stores/app-store.ts`
- 创建: `src/stores/novel-store.ts`
- 创建: `src/stores/copilot-store.ts`
- 修改: `src/App.tsx` (替换 useState 为 store hooks)
- 修改: `package.json` (添加 zustand 依赖)

**接口:**
- 消耗: 无
- 产出: App.tsx useState 从 14 个降至 2-3 个 (UI-only 状态), 业务状态由 Zustand 管理

- [ ] **Step 1: 安装 zustand**

```bash
cd ~/Documents/dodo-inkflow
npm install zustand
```

- [ ] **Step 2: 创建 useAppStore**

创建 `src/stores/app-store.ts`:
```typescript
import { create } from 'zustand';
import type { ViewType, WorkspaceFocus, Theme } from '../types';

interface AppState {
  currentView: ViewType;
  workspaceFocus: WorkspaceFocus;
  theme: Theme;
  isSettingsOpen: boolean;
  isAIAssistantOpen: boolean;
  aiDrawerTab: 'cards' | 'chat';
  setCurrentView: (v: ViewType) => void;
  setWorkspaceFocus: (f: WorkspaceFocus) => void;
  setTheme: (t: Theme) => void;
  toggleSettings: () => void;
  toggleAIAssistant: () => void;
  setAIDrawerTab: (tab: 'cards' | 'chat') => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentView: 'welcome',
  workspaceFocus: 'editor',
  theme: 'system',
  isSettingsOpen: false,
  isAIAssistantOpen: false,
  aiDrawerTab: 'chat',
  setCurrentView: (currentView) => set({ currentView }),
  setWorkspaceFocus: (workspaceFocus) => set({ workspaceFocus }),
  setTheme: (theme) => set({ theme }),
  toggleSettings: () => set((s) => ({ isSettingsOpen: !s.isSettingsOpen })),
  toggleAIAssistant: () => set((s) => ({ isAIAssistantOpen: !s.isAIAssistantOpen })),
  setAIDrawerTab: (aiDrawerTab) => set({ aiDrawerTab }),
}));
```

- [ ] **Step 3: 创建 useNovelStore**

创建 `src/stores/novel-store.ts`:
```typescript
import { create } from 'zustand';
import type { Novel, OnboardingDraftState, SetupTaskKey, AssistantLaunchContext, ContinuationEditorLaunchState } from '../types';

interface NovelState {
  selectedNovel: Novel | null;
  onboardingDraft: OnboardingDraftState | null;
  activeSetupTaskKey: SetupTaskKey | null;
  batchCounter: number;
  assistantLaunchContext: AssistantLaunchContext | null;
  continuationLaunchState: ContinuationEditorLaunchState | null;
  setSelectedNovel: (novel: Novel | null) => void;
  setOnboardingDraft: (draft: OnboardingDraftState | null) => void;
  setActiveSetupTaskKey: (key: SetupTaskKey | null) => void;
  incrementBatchCounter: () => void;
  setAssistantLaunchContext: (ctx: AssistantLaunchContext | null) => void;
  setContinuationLaunchState: (state: ContinuationEditorLaunchState | null) => void;
}

export const useNovelStore = create<NovelState>((set) => ({
  selectedNovel: null,
  onboardingDraft: null,
  activeSetupTaskKey: null,
  batchCounter: 0,
  assistantLaunchContext: null,
  continuationLaunchState: null,
  setSelectedNovel: (selectedNovel) => set({ selectedNovel }),
  setOnboardingDraft: (onboardingDraft) => set({ onboardingDraft }),
  setActiveSetupTaskKey: (activeSetupTaskKey) => set({ activeSetupTaskKey }),
  incrementBatchCounter: () => set((s) => ({ batchCounter: s.batchCounter + 1 })),
  setAssistantLaunchContext: (assistantLaunchContext) => set({ assistantLaunchContext }),
  setContinuationLaunchState: (continuationLaunchState) => set({ continuationLaunchState }),
}));
```

- [ ] **Step 4: 逐步迁移 App.tsx**

将 `App.tsx` 中的 useState 替换为 store hooks:
```typescript
import { useAppStore } from './stores/app-store';
import { useNovelStore } from './stores/novel-store';

function App() {
  const { currentView, setCurrentView, theme, setTheme, ... } = useAppStore();
  const { selectedNovel, setSelectedNovel, ... } = useNovelStore();
  // 仅保留 UI-only 状态:
  const [loading, setLoading] = useState(false);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  ...
}
```

将所有 props 传递改为直接在子组件中使用 `useAppStore()` / `useNovelStore()`。

- [ ] **Step 5: 验证**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
```
预期: exit 0

- [ ] **Step 6: 提交**

```bash
git add src/stores/ src/App.tsx package.json package-lock.json
git commit -m "refactor: extract App.tsx state into Zustand stores"
```

---

### Task 5: server.ts 路由拆分

**文件:**
- 创建: `server/routes/db.ts`
- 创建: `server/routes/ai.ts`
- 创建: `server/routes/config.ts`
- 创建: `server/routes/sse.ts`
- 创建: `server/routes/continuation.ts`
- 创建: `server/routes/skills.ts`
- 创建: `server/routes/export.ts`
- 创建: `server/routes/index.ts` (路由聚合)
- 修改: `server.ts` (导入路由模块替代内联路由)

**接口:**
- 消耗: 无
- 产出: server.ts 从 2919 行降至 ~200 行 (启动 + 中间件 + 路由挂载)

- [ ] **Step 1: 创建路由目录**

```bash
mkdir -p ~/Documents/dodo-inkflow/server/routes
```

- [ ] **Step 2: 提取 DB 路由**

创建 `server/routes/db.ts`，将 `server.ts` 中 `/api/db` (行 841) 和 `/api/db/events` (行 859) 移入:
```typescript
import { Router } from 'express';
// 导入需要的 db 函数...

const router = Router();

router.post('/', async (req, res) => { /* 从 server.ts:841-857 复制 */ });
router.get('/events', (req, res) => { /* 从 server.ts:859-882 复制 */ });

export default router;
```

- [ ] **Step 3: 提取 Config 路由**

创建 `server/routes/config.ts`，移入 `/api/config` GET+POST (行 884-907)

- [ ] **Step 4: 提取 AI 路由**

创建 `server/routes/ai.ts`，移入:
- `/api/inspiration` (行 938)
- `/api/story-cards` (行 963)
- `/api/story-cards/jobs/:jobId` (行 1023)
- `/api/editor-agent` (行 1129)
- `/api/expand-fragment` (行 1178)
- `/api/rewrite` (行 1440)
- `/api/orchestrate` (行 1495)
- `/api/orchestrate-draft` (行 1606)

- [ ] **Step 5: 提取 Continuation 路由**

创建 `server/routes/continuation.ts`，移入:
- `/api/continuation-packs/parse` (行 1278)
- `/api/chapter-production-runs/start` (行 1653)
- `/api/chapter-production-runs/start-stream` (行 1885)
- `/api/chapter-production-runs/:runId/apply` (行 2189)

- [ ] **Step 6: 提取 Skills 路由**

创建 `server/routes/skills.ts`，移入:
- `/api/extract-skill` (行 2459)
- `/api/extract-skill/jobs/:jobId` (行 2514)

- [ ] **Step 7: 提取 Export 路由**

创建 `server/routes/export.ts`，移入 `/api/export` (行 2722)

- [ ] **Step 8: 创建路由聚合**

创建 `server/routes/index.ts`:
```typescript
import { Router } from 'express';
import dbRouter from './db';
import configRouter from './config';
import aiRouter from './ai';
import continuationRouter from './continuation';
import skillsRouter from './skills';
import exportRouter from './export';

const router = Router();
router.use('/db', dbRouter);
router.use('/config', configRouter);
router.use('/ai', aiRouter);
router.use('/continuation', continuationRouter);
router.use('/skills', skillsRouter);
router.use('/export', exportRouter);

export default router;
```

- [ ] **Step 9: 修改 server.ts 使用路由**

```typescript
import apiRoutes from './server/routes/index';
app.use('/api', apiRoutes);
```

- [ ] **Step 10: 验证**

```bash
npx tsc --noEmit
# 手动启动服务器测试 API 是否正常
npm run dev &
sleep 3
curl -s http://localhost:3000/api/config | head -c 100
kill %1
```
预期: API 返回正常 JSON

- [ ] **Step 11: 提交**

```bash
git add server/ server.ts
git commit -m "refactor: split server.ts into route modules"
```

---

### Task 6: 巨型组件拆分 — BookFactoryView (1025 行)

**文件:**
- 创建: `src/components/factory/FileUploader.tsx`
- 创建: `src/components/factory/ExtractionProgress.tsx`
- 创建: `src/components/factory/SkillPreview.tsx`
- 创建: `src/components/factory/BookFactoryLayout.tsx`
- 修改: `src/components/BookFactoryView.tsx` (改为组合上述子组件)

**接口:**
- 消耗: BookFactoryView 现有 props 接口不变
- 产出: BookFactoryView 降至 ~100 行, 4 个子组件各 150-300 行

- [ ] **Step 1: 分析 BookFactoryView 职责边界**

```bash
cd ~/Documents/dodo-inkflow
grep -n "function\|const.*=.*(" src/components/BookFactoryView.tsx | head -30
grep -n "return\|<div\|<section\|<button\|onClick" src/components/BookFactoryView.tsx | head -40
```
确认: 文件上传区、进度展示区、结果/技能卡预览区、整体布局

- [ ] **Step 2: 提取 FileUploader**

从 BookFactoryView 中提取文件上传相关 state + UI 到 `src/components/factory/FileUploader.tsx`

- [ ] **Step 3: 提取 ExtractionProgress**

提取进度条/步骤展示到 `src/components/factory/ExtractionProgress.tsx`

- [ ] **Step 4: 提取 SkillPreview**

提取技能卡预览/编辑到 `src/components/factory/SkillPreview.tsx`

- [ ] **Step 5: 重构 BookFactoryView 为组合器**

```tsx
import { FileUploader } from './factory/FileUploader';
import { ExtractionProgress } from './factory/ExtractionProgress';
import { SkillPreview } from './factory/SkillPreview';

export default function BookFactoryView(props) {
  return (
    <div className="...">
      <FileUploader ... />
      {isExtracting && <ExtractionProgress ... />}
      {skills.length > 0 && <SkillPreview ... />}
    </div>
  );
}
```

- [ ] **Step 6: 验证**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
```

- [ ] **Step 7: 提交**

```bash
git add src/components/BookFactoryView.tsx src/components/factory/
git commit -m "refactor: split BookFactoryView (1025 lines) into focused sub-components"
```

---

### Task 7: motion 代理清理

**文件:**
- 删除或修改: `src/lib/motion.tsx`
- 修改: 14 个引用 motion 的组件文件

**接口:**
- 消耗: 无
- 产出: 消除死代码，`<motion.div>` 替换为 `<div>`

- [ ] **Step 1: 找到所有 motion 引用**

```bash
cd ~/Documents/dodo-inkflow
grep -rl "from.*motion\|motion\." src/components/ src/lib/motion.tsx 2>/dev/null
```

- [ ] **Step 2: 批量替换**

对每个引用文件:
- `import { motion, AnimatePresence } from '../lib/motion'` → 删除
- `<motion.div ...>` → `<div ...>`
- `<AnimatePresence>...</AnimatePresence>` → 直接输出 children
- `motion.div` props (`initial`, `animate`, `exit`, `transition`) → 删除

- [ ] **Step 3: 删除 motion 代理**

```bash
rm src/lib/motion.tsx
```

- [ ] **Step 4: 验证**

```bash
npx tsc --noEmit && npm run build 2>&1 | tail -3
```

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "chore: remove unused motion proxy and animation props"
```

---

## 验证门 (所有 Task 完成后)

```bash
cd ~/Documents/dodo-inkflow

# 1. 类型检查
npx tsc --noEmit
# 预期: exit 0

# 2. Lint
npm run lint 2>&1 | tail -5
# 预期: 无 error (warnings 可接受)

# 3. 构建
npm run build 2>&1 | tail -5
# 预期: exit 0

# 4. 后端测试
npx vitest run --reporter=dot 2>&1 | tail -10
# 预期: all passing

# 5. 安全审计
npm audit 2>&1 | tail -3
# 预期: found 0 vulnerabilities (或仅 low)

# 6. 产物大小
ls -lh dist/assets/*.js 2>/dev/null | head -10
# 预期: 主 bundle 显著小于修复前
```

## 停止条件

- 任何 Task 导致 `npx tsc --noEmit` 报错 → 停止，修复类型错误后继续
- `npm run build` 失败 → 停止，回滚该 Task 变更
- 现有测试失败 → 停止，调查根因
- `npm audit fix --force` 引入破坏性升级 → 停止，手动选择性修复
