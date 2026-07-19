# Navigation And Information Architecture Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** 收拢 `开始创作 / 灵感助手 / 创作舞台 / 设定记忆` 的职责边界，让侧边栏导航、页面语义和实际行为一致。
**Architecture:** 保持现有 React 单页结构，不引入新依赖。先用类型和纯函数锁定新的导航模型，再把 `Sidebar`、`App` 和相关页面改成“新建入口 + 创作工作台 + AI 辅助台”的清晰分工，最后补最小回归测试和运行验证。
**Tech Stack:** React 19, TypeScript, Express-backed local API, node:test, tsx, Vite, lucide-react, motion/react

## Scope Guard

本计划只覆盖 `信息架构与导航收口`。

包含：

- `开始创作` 只保留“新建作品入口”职责
- `灵感助手` 只保留“创作中 AI 辅助台”职责
- 侧边栏把 `创作舞台 / 设定记忆` 收成一个 `创作工作台`
- 工作台内部增加“写作优先 / 设定优先”焦点模式
- 为上述改动补类型、纯函数测试和 UI 回归检查

不包含：

- 章节生产流水线、连续性审校、状态账本
- Skill 仓库、拆书工厂、桌面打包
- 对 `WorldBibleView` 数据结构做重构
- 新增复杂路由库或状态管理库

## Existing Anchors

实现前先基于当前代码锚点工作：

- [src/App.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/App.tsx:1)
  - 负责 `currentView` 切换
  - 当前把 `view3` / `view4` 都映射到 `workspace`
  - `welcome` 已经承担“输入灵感 -> 生成故事方案卡 -> 创建作品”的流程
- [src/components/Sidebar.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/Sidebar.tsx:1)
  - 当前有两个不同 label 的 `workspace` 导航项
- [src/components/WelcomeView.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/WelcomeView.tsx:1)
  - 当前已经是“新建作品入口”的半成品
- [src/components/AIAssistant.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/AIAssistant.tsx:1)
  - 当前同时承担灵感聊天、故事卡生成、保存作品、提取设定
- [src/components/SplitWorkspace.tsx](/Users/Zhuanz/Documents/dodo-inkflow/src/components/SplitWorkspace.tsx:1)
  - 当前固定渲染 `EditorView + WorldBibleView`
- [src/types.ts](/Users/Zhuanz/Documents/dodo-inkflow/src/types.ts:1)
  - 当前 `ViewType` 只有页面级视图，没有“工作台焦点模式”

## Target Product Structure

目标导航结构：

- `开始创作`
- `我的书库`
- `创作工作台`
- `灵感助手`
- `拆书工厂`
- `技能仓库`

目标职责边界：

- `开始创作`
  - 一句话灵感输入
  - 生成故事方案卡
  - 选择方案后创建作品并进入工作台
  - 展示最近作品快捷入口
- `灵感助手`
  - 围绕已有作品做脑暴、改写、润色、补设定
  - 允许“保存到作品”“提取到设定记忆”
  - 不再承担“生成故事方案卡并开新坑”的主入口职责
- `创作工作台`
  - 仍然复用双栏布局
  - 但由一个侧边栏入口进入
  - 内部有两种焦点：`editor` 和 `world`

## Success Criteria

满足以下条件才算完成：

1. 侧边栏不再出现两个都指向 `workspace` 的按钮。
2. `开始创作` 页面文案和动作只围绕“新建作品”。
3. `灵感助手` 页面不再出现“生成故事方案卡”入口。
4. 用户从 `创作工作台` 可以切换“写作优先 / 设定优先”。
5. 相关纯函数测试通过，`npm run lint` 和 `npm run build` 通过。

## Task 1: 锁定新的导航模型和失败测试

**Files:**
- Modify: `src/types.ts`
- Create: `src/lib/workspace-nav.ts`
- Test: `tests/workspace-nav.test.ts`

- [ ] **Step 1: 先写失败测试，锁定导航项和工作台焦点行为**

Create `tests/workspace-nav.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSidebarItems,
  deriveWorkspaceFocus,
  getWorkspaceLabels,
} from '../src/lib/workspace-nav';

test('buildSidebarItems removes duplicate workspace entries', () => {
  const items = buildSidebarItems();
  const workspaceItems = items.filter((item) => item.id === 'workspace');
  assert.equal(workspaceItems.length, 1);
  assert.equal(workspaceItems[0]?.label, '创作工作台');
});

test('deriveWorkspaceFocus returns editor focus for workspace-editor key', () => {
  assert.equal(deriveWorkspaceFocus('workspace-editor'), 'editor');
});

test('deriveWorkspaceFocus returns world focus for workspace-world key', () => {
  assert.equal(deriveWorkspaceFocus('workspace-world'), 'world');
});

test('deriveWorkspaceFocus falls back to editor for unknown key', () => {
  assert.equal(deriveWorkspaceFocus('unknown'), 'editor');
});

test('getWorkspaceLabels returns explicit mode labels', () => {
  const labels = getWorkspaceLabels();
  assert.equal(labels.editor, '写作优先');
  assert.equal(labels.world, '设定优先');
});
```

- [ ] **Step 2: 运行测试，确认模块尚不存在**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/workspace-nav.test.ts
```

Expected:

```text
not ok ... ERR_MODULE_NOT_FOUND
```

- [ ] **Step 3: 在 `src/types.ts` 中增加工作台焦点类型**

Append near `ViewType`:

```ts
export type WorkspaceFocus = 'editor' | 'world';

export interface SidebarViewItem {
  id: ViewType;
  label: string;
  navKey?: string;
}
```

- [ ] **Step 4: 实现 `src/lib/workspace-nav.ts`**

Create `src/lib/workspace-nav.ts`:

```ts
import type { SidebarViewItem, WorkspaceFocus } from '../types';

export function buildSidebarItems(): SidebarViewItem[] {
  return [
    { id: 'welcome', label: '开始创作' },
    { id: 'library', label: '我的书库' },
    { id: 'workspace', label: '创作工作台', navKey: 'workspace-editor' },
    { id: 'ai', label: '灵感助手' },
    { id: 'factory', label: '拆书工厂' },
    { id: 'skills', label: '技能仓库' },
  ];
}

export function deriveWorkspaceFocus(navKey?: string): WorkspaceFocus {
  if (navKey === 'workspace-world') return 'world';
  return 'editor';
}

export function getWorkspaceLabels(): Record<WorkspaceFocus, string> {
  return {
    editor: '写作优先',
    world: '设定优先',
  };
}
```

- [ ] **Step 5: 重新运行测试，确认通过**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/workspace-nav.test.ts
```

Expected:

```text
# tests 5
# pass 5
```

## Task 2: 收拢 `Sidebar` 和 `App` 的导航语义

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: 让 `Sidebar` 使用统一导航模型**

In `src/components/Sidebar.tsx`, replace duplicated workspace items:

```ts
import { buildSidebarItems } from '../lib/workspace-nav';
```

Define local icon mapping:

```ts
const NAV_ICONS: Record<ViewType, React.ComponentType<{ size?: number; className?: string }>> = {
  welcome: Sparkles,
  library: BookOpen,
  workspace: PenTool,
  editor: PenTool,
  world: Users,
  ai: Lightbulb,
  skills: Wand2,
  factory: BookTemplate,
};
```

Build main items from pure config:

```ts
const mainItems: NavItem[] = buildSidebarItems()
  .filter((item) => ['welcome', 'library', 'workspace', 'ai'].includes(item.id))
  .map((item) => ({
    ...item,
    icon: NAV_ICONS[item.id],
  }));

const exploreItems: NavItem[] = buildSidebarItems()
  .filter((item) => ['factory', 'skills'].includes(item.id))
  .map((item) => ({
    ...item,
    icon: NAV_ICONS[item.id],
  }));
```

- [ ] **Step 2: 让 `App` 显式持有 `workspaceFocus` 状态**

In `src/App.tsx`, add state:

```ts
import { deriveWorkspaceFocus } from './lib/workspace-nav';
import type { WorkspaceFocus } from './types';
```

```ts
const [workspaceFocus, setWorkspaceFocus] = useState<WorkspaceFocus>('editor');
```

- [ ] **Step 3: 替换含糊的快捷键映射**

Replace current `viewMap`:

```ts
const viewMap: Record<string, { view: ViewType; focus?: WorkspaceFocus }> = {
  view1: { view: 'welcome' },
  view2: { view: 'library' },
  view3: { view: 'workspace', focus: 'editor' },
  view4: { view: 'workspace', focus: 'world' },
  view5: { view: 'ai' },
};
```

Use it in the handler:

```ts
const target = viewMap[id];
if (target) {
  e.preventDefault();
  setCurrentView(target.view);
  if (target.focus) setWorkspaceFocus(target.focus);
  return;
}
```

- [ ] **Step 4: 调整侧边栏点击时的工作台默认焦点**

Replace direct setter passed into `Sidebar` with explicit handler:

```ts
const handleNavigate = (view: ViewType) => {
  setCurrentView(view);
  if (view === 'workspace') {
    setWorkspaceFocus('editor');
  }
};
```

Render:

```tsx
<Sidebar currentView={currentView} onNavigate={handleNavigate} user={user} />
```

- [ ] **Step 5: 保留现有独立页作为兼容入口，但不再侧边栏暴露**

Keep these branches:

```tsx
if (currentView === 'editor' && selectedNovel) {
  return <EditorView novel={selectedNovel} onBack={() => setCurrentView('library')} />;
}

if (currentView === 'world' && selectedNovel) {
  return <WorldBibleView novel={selectedNovel} onboarding={onboardingDraft} />;
}
```

Do not remove them in this task. This keeps diff small and reversible.

## Task 3: 给 `SplitWorkspace` 增加内部焦点模式

**Files:**
- Modify: `src/components/SplitWorkspace.tsx`
- Optional Test: `tests/workspace-nav.test.ts`

- [ ] **Step 1: 为 `SplitWorkspace` 增加 `focus` 参数**

Update props:

```ts
import type { Novel, WorkspaceFocus } from '../types';

interface SplitWorkspaceProps {
  novel: Novel;
  onboarding?: any;
  onBack: () => void;
  focus: WorkspaceFocus;
  onFocusChange: (focus: WorkspaceFocus) => void;
}
```

- [ ] **Step 2: 根据焦点给出不同默认分栏比例**

Add effect:

```ts
import { useEffect, useRef, useState } from 'react';
```

```ts
useEffect(() => {
  setSplitRatio(focus === 'editor' ? 0.68 : 0.42);
}, [focus]);
```

- [ ] **Step 3: 在顶部增加焦点切换控件**

Render a minimal header above the split panes:

```tsx
<div className="border-b border-theme-border/60 px-4 py-3 flex items-center justify-between bg-white/70">
  <div>
    <div className="text-sm font-bold text-theme-text">创作工作台</div>
    <div className="text-[11px] text-theme-muted">在写作与设定之间切换当前工作重心</div>
  </div>
  <div className="inline-flex rounded-xl border border-theme-border bg-theme-sidebar/30 p-1">
    <button
      onClick={() => onFocusChange('editor')}
      className={focus === 'editor' ? 'px-3 py-1.5 rounded-lg bg-white text-theme-text text-xs font-bold shadow-sm' : 'px-3 py-1.5 rounded-lg text-theme-muted text-xs font-bold'}
    >
      写作优先
    </button>
    <button
      onClick={() => onFocusChange('world')}
      className={focus === 'world' ? 'px-3 py-1.5 rounded-lg bg-white text-theme-text text-xs font-bold shadow-sm' : 'px-3 py-1.5 rounded-lg text-theme-muted text-xs font-bold'}
    >
      设定优先
    </button>
  </div>
</div>
```

- [ ] **Step 4: 把双栏主体包进纵向容器**

Replace root layout:

```tsx
return (
  <div className="h-full flex flex-col">
    {/* header */}
    <div ref={containerRef} className="min-h-0 flex-1 flex">
      {/* left/right panes unchanged */}
    </div>
  </div>
);
```

- [ ] **Step 5: 在 `App` 里把焦点状态传进去**

Update render call:

```tsx
<SplitWorkspace
  novel={selectedNovel}
  onboarding={onboardingDraft}
  onBack={() => setCurrentView('library')}
  focus={workspaceFocus}
  onFocusChange={setWorkspaceFocus}
/>
```

## Task 4: 把 `开始创作` 收成单一入口

**Files:**
- Modify: `src/components/WelcomeView.tsx`

- [ ] **Step 1: 调整页头文案，明确这是新建入口**

Replace header copy:

```tsx
<h1 className="text-3xl font-serif font-bold text-theme-text mb-3">
  开始一部新作品
</h1>
<p className="text-theme-muted text-sm max-w-md mx-auto">
  输入一个场景、角色、情绪或设定缺口，系统会先给你 3 个开坑方向，再把选定方向落成新项目。
</p>
```

- [ ] **Step 2: 调整结果区标题，强调“创建作品”而不是泛灵感**

Replace:

```tsx
<h2 className="text-lg font-serif font-bold text-theme-text text-center">
  选一个方向，开始你的故事
</h2>
```

With:

```tsx
<h2 className="text-lg font-serif font-bold text-theme-text text-center">
  选一个方向，创建新作品
</h2>
```

- [ ] **Step 3: 保留最近作品入口，但弱化其与灵感助手的功能混淆**

Keep current recent novels section and do not add any AI assistant action here.

- [ ] **Step 4: 手动检查页面里不再出现“灵感助手式”的泛入口文案**

Search:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
rg -n "灵感助手|随便说说你的想法|故事方案卡供你选择" src/components/WelcomeView.tsx
```

Expected:

```text
only new-project-oriented copy remains
```

## Task 5: 把 `灵感助手` 收成创作中的 AI 辅助台

**Files:**
- Modify: `src/components/AIAssistant.tsx`

- [ ] **Step 1: 修改欢迎消息，明确这是创作中辅助**

Replace initial assistant message:

```ts
content: '这里是灵感助手。它服务于你正在写的作品：补桥段、扩场景、润台词、提设定，而不是替代新建作品入口。'
```

- [ ] **Step 2: 去掉“生成故事方案卡”动作按钮**

Remove this block entirely:

```tsx
{onCreateDraft && (
  <button
    onClick={() =>
      onCreateDraft({
        ideaSeed: msg.content,
        chatContext: messages.map((entry) => `${entry.role}: ${entry.content}`).join('\n\n'),
      })
    }
    className="inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-sidebar/20 px-3 py-2 text-xs font-bold text-theme-muted transition-colors hover:border-theme-accent hover:text-theme-accent"
    title="基于这段灵感生成故事方案卡"
  >
    <BookPlus size={14} />
    生成故事方案卡
  </button>
)}
```

- [ ] **Step 3: 删除不再使用的 props 与 import**

Remove:

```ts
import { BookPlus } from 'lucide-react';
```

Update props:

```ts
export function AIAssistant() {
```

Remove:

```ts
interface AIAssistantProps {
  onCreateDraft?: (payload: { ideaSeed: string; chatContext: string }) => void;
}
```

- [ ] **Step 4: 在页头副标题里声明使用场景**

Below the title, replace uppercase subtitle with:

```tsx
<p className="text-theme-muted text-sm max-w-xl mx-auto">
  用于已有作品的脑暴、扩写、改写与设定提取。
</p>
```

- [ ] **Step 5: 搜索并确认页面中不再存在“新建作品入口”动作**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
rg -n "生成故事方案卡|onCreateDraft|BookPlus" src/components/AIAssistant.tsx
```

Expected:

```text
no matches
```

## Task 6: 衔接 `App` 中的页面调用和最小回归

**Files:**
- Modify: `src/App.tsx`
- Optional Test: `tests/workspace-nav.test.ts`

- [ ] **Step 1: 调整 `AIAssistant` 渲染调用**

Replace:

```tsx
<AIAssistant onCreateDraft={handleCreateDraftFromIdea} />
```

With:

```tsx
<AIAssistant />
```

- [ ] **Step 2: 删除 `App` 中不再被使用的草稿入口函数**

Remove:

```ts
const handleCreateDraftFromIdea = async ({
  ideaSeed,
  chatContext,
}: {
  ideaSeed: string;
  chatContext: string;
}) => {
  setLoading(true);
  try {
    const cards = await generateStoryCards({ ideaSeed, chatContext });
    setOnboardingDraft({
      ideaSeed,
      cards,
      setupTasks: [],
      acceptedSkillIds: [],
      recommendedSkills: [],
      acceptedRecommendedSkills: false,
    });
    setCurrentView('ai');
  } finally {
    setLoading(false);
  }
};
```

Also drop now-unused imports:

```ts
generateStoryCards
```

- [ ] **Step 3: 搜索编译期残留引用**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
rg -n "handleCreateDraftFromIdea|onCreateDraft|workspace-world|workspace-editor" src/App.tsx src/components
```

Expected:

```text
only the intended workspace focus keys remain
```

## Task 7: 验证

**Files:**
- None

- [ ] **Step 1: 跑导航纯函数测试**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/workspace-nav.test.ts
```

Expected:

```text
# pass 5
```

- [ ] **Step 2: 跑完整测试集**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/*.test.ts
```

Expected:

```text
# fail 0
```

- [ ] **Step 3: 跑类型检查**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected:

```text
Found 0 errors
```

- [ ] **Step 4: 跑生产构建**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run build
```

Expected:

```text
vite build completed successfully
```

- [ ] **Step 5: 手动验证导航行为**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
PORT=3001 DISABLE_VITE_DEV_MIDDLEWARE=1 npm run dev
```

Manual checks:

1. 打开 `http://127.0.0.1:3001/`
2. 侧边栏只出现一个 `创作工作台`
3. `开始创作` 页面只体现新建作品
4. `灵感助手` 页面没有“生成故事方案卡”
5. 进入 `创作工作台` 后可以在 `写作优先 / 设定优先` 间切换，分栏比例会变化

## Risks And Notes

- 这次改动故意不移除 `editor` 和 `world` 独立页，避免一次性牵动过多跳转逻辑。
- `WelcomeView` 和 `AIAssistant` 的真实边界主要靠文案和动作按钮收口，后续如果还想进一步强化，可以再拆出“灵感碎片库”或“项目内助手”上下文。
- `SplitWorkspace` 当前只通过分栏比例表达焦点模式，后续可以再补“默认聚焦 tab / 默认滚动位置 / 上次焦点记忆”，但不应放进本任务。

## Self-Review Checklist

- [ ] 计划只覆盖导航与信息架构，不混入其他子系统
- [ ] 每个任务都列出精确文件路径
- [ ] 每个任务都包含可执行步骤
- [ ] 测试、lint、build、手动验证都已写明
- [ ] 没有 `TODO`、`TBD`、`类似 Task N` 之类占位语
