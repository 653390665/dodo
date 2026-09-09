# Plan 175: 打通工作台家族导航——驾驶舱获得可见入口，快捷键与命名对齐

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- shared/types/core.ts src/lib/workspace-nav.ts src/components/AppShell.tsx src/components/Sidebar.tsx src/lib/keyboard-shortcuts.ts src/stores/app-store.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED（涉及导航语义与既有测试断言）
- **Depends on**: none
- **Category**: bug + ux
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

作品驾驶舱（ProjectCockpitView，PRODUCT.md 宣称的 8 大功能之一）目前对鼠标用户**不可达**：它只在 `currentView==='workspace' && workspaceFocus!=='editor'` 时渲染，而所有鼠标导航路径都把 focus 写死为 `'editor'`。唯一入口是 Cmd+4——其文案却写着「设定记忆」，按了会被带到驾驶舱而不是设定页，两个功能互相错位。同理「设定与续写」(World Bible) 无侧边栏入口，只能从编辑器三层深处进入。本计划为工作台家族（驾驶舱/写作/设定）建立可见、一致的切换机制，并修正快捷键文案与视图命名漂移。

注意：`docs/specs/cockpit-routing.md` 规定的「驾驶舱行动推荐点击后跨视图静默自动执行」是既定设计，本计划不得改变该行为；本计划只解决**入口与文案**。

## Current state

相关文件与角色：

- `shared/types/core.ts:136` — `export type WorkspaceFocus = 'editor' | 'world';`
- `src/lib/workspace-nav.ts` — 侧边栏导航项与 `deriveWorkspaceFocus`
- `src/components/AppShell.tsx` — 1030 行 cockpit 渲染条件；486/876 行 navigate 焦点派生；491-516 快捷键 viewMap；966-975 全屏 loading；1160-1170 空态标题
- `src/components/Sidebar.tsx` — 63-67 行 workspace 高亮逻辑；191 行「设置 (Settings)」
- `src/lib/keyboard-shortcuts.ts:9-17` — SHORTCUTS 注册表
- `src/stores/app-store.ts:53-60` — localStorage 恢复视图无白名单校验
- `src/components/WelcomeView.tsx:588` — 「支持 Enter 快捷保存」文案

现状摘录：

```ts
// shared/types/core.ts:136
export type WorkspaceFocus = 'editor' | 'world';
```

```ts
// src/lib/workspace-nav.ts
const SIDEBAR_MAIN_ITEMS: SidebarNavItem[] = [
  { id: 'welcome', label: '开始创作' },
  { id: 'library', label: '我的书库' },
  { id: 'workspace', label: '创作工作台', navKey: 'workspace-editor' },
  { id: 'ai', label: 'AI 协作' },
];
const SIDEBAR_SECONDARY_ITEMS: SidebarNavItem[] = [
  { id: 'continuation-import', label: '资料续写' },
];
export function deriveWorkspaceFocus(view: ViewType, navKey?: WorkspaceNavKey, previousFocus: WorkspaceFocus = 'editor'): WorkspaceFocus {
  if (navKey === 'workspace-editor' || view === 'editor') return 'editor';
  if (navKey === 'workspace-world' || view === 'world') return 'world';
  return previousFocus;
}
```

```tsx
// src/components/AppShell.tsx:1030-1031 — cockpit 唯一渲染条件
{currentView === 'workspace' && selectedNovel && workspaceFocus !== 'editor' && (
  <ErrorBoundary>
    <ProjectCockpitView
```

```ts
// src/components/AppShell.tsx:492-499 — 快捷键 viewMap（view4 顶着「设定记忆」的描述进驾驶舱）
const viewMap: Record<string, { view: ViewType; navKey?: WorkspaceNavKey }> = {
  view1: { view: 'welcome' },
  view2: { view: 'library' },
  view3: { view: 'workspace', navKey: 'workspace-editor' },
  view4: { view: 'workspace', navKey: 'workspace-world' },
  view5: { view: 'ai' },
};
```

```ts
// src/lib/keyboard-shortcuts.ts:14-15
view3: { key: '3', mod: true, label: 'Cmd+3', desc: '创作舞台' },
view4: { key: '4', mod: true, label: 'Cmd+4', desc: '设定记忆' },
```

```ts
// src/stores/app-store.ts:55-60 — localStorage 值未经校验直接断言
const savedView = localStorage.getItem('inkflow-last-view');
if (savedView) restoredView = savedView as ViewType;
```

`src/components/AppShell.tsx:1078`：`currentView === 'world'` 渲染 `WorldBibleView`（即「设定」有独立 view，不只是 focus）。`grep -rn "workspaceFocus" src/ --include='*.tsx'` 确认测试中仅使用 `'editor' | 'world'` 两值（`src/tests/app-shell-*.test.tsx`）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量测试 | `npm run test:frontend` | 全绿（允许更新受影响的既有断言，见 Step 6） |
| 单文件 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/app-shell-capability-launch.test.tsx` | 全过 |
| Lint | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**：

- `shared/types/core.ts`（WorkspaceFocus 联合类型 + WorkspaceNavKey 若为独立联合类型则同步扩展，见 Step 1）
- `src/lib/workspace-nav.ts`
- `src/components/AppShell.tsx`（cockpit 渲染条件、viewMap、工作台切换器、空态标题文案）
- `src/components/Sidebar.tsx`（主项 active 逻辑收窄、设置按钮文案）
- `src/lib/keyboard-shortcuts.ts`（view3/view4 描述）
- `src/stores/app-store.ts`（恢复视图白名单校验）
- `src/components/WelcomeView.tsx:588`（Enter 文案一处）
- `src/components/SettingsModal.tsx`（快速设置页脚追加快捷键列表）
- 相关测试文件更新

**Out of scope**：

- `src/components/ProjectCockpitView.tsx` 内部（其行动推荐与静默执行是 spec 行为）
- `src/components/EditorView.tsx`、`WorldBibleView.tsx` 内部
- `docs/specs/cockpit-routing.md` 的语义
- 信息架构大改（侧边栏信息分组重排）——本计划只加最小入口

## Git workflow

小步提交，消息如 `feat(nav): workspace family switcher + cockpit entry + shortcut label alignment`；完成即提交，不 push。

## Steps

### Step 1: 扩展 WorkspaceFocus 与 navKey

1. `shared/types/core.ts:136` 改为 `export type WorkspaceFocus = 'editor' | 'world' | 'cockpit';`
2. 找到 `WorkspaceNavKey` 的定义（`grep -rn "WorkspaceNavKey" shared/types/`），在其联合中加 `'workspace-cockpit'`。
3. `src/lib/workspace-nav.ts` 的 `deriveWorkspaceFocus` 在 `workspace-world` 分支前加：`if (navKey === 'workspace-cockpit') return 'cockpit';`

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误（若出现「not assignable」错误指向其他比较点，记录该位置——它是 Step 2 要改的渲染条件；若指向无法理解的深处，STOP）

### Step 2: AppShell 渲染条件与工作台切换器

1. `AppShell.tsx:1030` 的 cockpit 条件从 `workspaceFocus !== 'editor'` 改为 `workspaceFocus === 'cockpit'`。
2. 在 `currentView === 'workspace' && selectedNovel` 的渲染块之前（以及 `currentView === 'world' && selectedNovel` 块之前，AppShell.tsx:1078），插入共享的工作台切换器组件（内联在 AppShell 或新建 `src/components/WorkspaceFamilySwitcher.tsx`）：

```tsx
// 三段切换：总览 / 写作 / 设定
const tabs = [
  { key: 'cockpit', label: '总览' },
  { key: 'editor', label: '写作' },
  { key: 'world', label: '设定' },
];
// 总览/写作 → setCurrentView('workspace') + setWorkspaceFocus(key)
// 设定 → void handleNavigate('world')
// 当前高亮：currentView === 'world' ? 'world' : workspaceFocus
```

样式沿用现有 pill/badge 风格（参考 EditorHeader.tsx:107 的圆角胶囊类名），置于内容区顶部居中，`hidden sm:flex`。设置页签不进入历史 `inkflow-last-view` 之外的持久化。

3. `AppShell.tsx:966-975` 全屏 loading 文案 `'InkFlow Starting...'` 改为 `'正在启动 InkFlow…'`（顺带消除英文直出；此行属于 Plan 181 的范畴，但该行在本计划触碰的 render 分支内，一并处理避免二次冲突）。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误；`grep -n "workspaceFocus !== 'editor'" src/components/AppShell.tsx` → 无命中

### Step 3: 快捷键与 viewMap 对齐

1. `AppShell.tsx:496` view4 改为 `{ view: 'workspace', navKey: 'workspace-cockpit' }`。
2. `keyboard-shortcuts.ts`：view3 desc `'创作舞台'` → `'创作工作台'`；view4 desc `'设定记忆'` → `'作品驾驶舱'`。

**Verify**: `grep -n "workspace-cockpit" src/components/AppShell.tsx src/lib/workspace-nav.ts shared/types/*.ts` 各 ≥1 命中

### Step 4: 侧边栏入口与 active 逻辑

1. `workspace-nav.ts` 的 `SIDEBAR_SECONDARY_ITEMS` 增加 `{ id: 'world', label: '设定与续写' }`（放在资料续写之前）。
2. `Sidebar.tsx:63-67` 的 workspace 主项 active 判断从 `isWorkspaceFamilyView(currentView)` 收窄为 `currentView === 'workspace' || currentView === 'editor'`，避免「设定与续写」高亮时「创作工作台」同时高亮。`isWorkspaceFamilyView` 导出保留（其他消费方不动）。
3. `Sidebar.tsx:191` 按钮文案 `'设置 (Settings)'` → `'设置'`（aria-label 已是「系统设置」，保留）。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误

### Step 5: localStorage 恢复校验 + 文案修正

1. `app-store.ts:55-60`：改为白名单校验——`const VALID_VIEWS: ViewType[] = ['welcome','library','workspace','world','ai','factory','skills','continuation-import','editor'];`（以 `shared/types` 中 `ViewType` 实际联合为准，`grep -n "export type ViewType" shared/types/` 取全集），`if (savedView && VALID_VIEWS.includes(savedView as ViewType)) restoredView = savedView as ViewType;` 否则回落 `'welcome'`。为避免双源漂移，若 `ViewType` 已导出运行时数组则直接复用；没有就建 `shared/types` 常量并让类型从数组派生（`as const` + `typeof`）。
2. `AppShell.tsx:1165` 空态标题 `'创作舞台等待作品'` → `'创作工作台等待作品'`。
3. `WelcomeView.tsx:588` `'支持 Enter 快捷保存'` → `'按 Enter 进入下一步'`（该 Enter 只会进入下一步，WelcomeView.tsx:595-603 行为不改动）。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误

### Step 6: 测试更新与新增

1. 跑 `npm run test:frontend`，收集因本计划失败的既有断言（预期集中在 `src/tests/app-shell-*.test.tsx` 的 workspaceFocus 相关用例）；逐一核对失败原因确属本计划的有意行为变更后更新断言。
2. 在 `src/tests/app-shell-capability-launch.test.tsx` 追加用例（仿照该文件既有的 `useAppStore.setState` 模式）：
   - `currentView:'workspace', workspaceFocus:'cockpit'` 时渲染出驾驶舱（断言 ProjectCockpitView 特征内容出现）；
   - `workspaceFocus:'world' && currentView:'workspace'` 时**不再**渲染驾驶舱（回归断言，锁住 Step 2 的条件收窄）。
3. `src/tests/keyboard-shortcuts` 相关（若存在）更新 view4 描述断言；无则跳过。

**Verify**: `npm run test:frontend` → 全绿

### Step 7: 快捷键可发现性

`SettingsModal.tsx`「快速模型设置」页签底部追加「键盘快捷键」折叠区：`Object.entries(SHORTCUTS).map` 渲染 `label` + `desc` 两列小字（样式沿用该页签既有的 dl/行样式；import 路径 `../lib/keyboard-shortcuts`）。纯展示，不加交互。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误；`grep -n "SHORTCUTS" src/components/SettingsModal.tsx` ≥1 命中

## Test plan

见 Step 6。全量回归：

**Verify**: `npm run test:frontend` → 全绿；`npm run typecheck` → 0 错误

## Done criteria

- [ ] typecheck 0 错误；`npm run test:frontend` 全绿
- [ ] 鼠标路径可达驾驶舱：AppShell 存在渲染 cockpit 的切换器入口（grep `总览` 命中 AppShell 或 WorkspaceFamilySwitcher）
- [ ] `grep -n "设定记忆" src/lib/keyboard-shortcuts.ts` 无命中
- [ ] `grep -rn "savedView as ViewType" src/stores/app-store.ts` 命中行位于白名单校验之内
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- `WorkspaceNavKey` 的定义结构无法容纳新值（如是模板映射类型）。
- Step 2 后 `src/tests/` 出现与本计划无关的大面积失败（>10 个文件）——说明 focus 语义被更多地方隐式依赖，报告清单。
- 发现 `currentView === 'workspace' && workspaceFocus === 'world'` 的组合在别处被当作「World Bible 嵌在工作台」使用（即存在依赖旧行为的消费者）——报告位置。

## Maintenance notes

- `docs/specs/cockpit-routing.md` 不需要改：静默自动执行语义未动；但评审时应顺手在该 spec 末尾补一句「驾驶舱入口 = 工作台切换器『总览』页签 / Cmd+4」（文档更新属于 Plan 191 的 docs 批次，若 190 未执行可先在此计划内一并补一行）。
- 未来若给驾驶舱加独立路由/视图 id，WorkspaceFocus 的 'cockpit' 值应随之收敛。
- Plan 194（Cmd+K 搜索 spike）落地后，快捷键列表需追加该项。
