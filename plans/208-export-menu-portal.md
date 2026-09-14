# Plan 208: 导出菜单 portal 化——脱离编辑器堆叠命中区（P2）

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 95aefc3..HEAD -- src/components/EditorStatusBar.tsx src/components/WritingSurface.tsx tests/e2e/core-flow.spec.ts`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none（与 207 独立；建议 207 先行以减少同文件并发——207 不改 EditorStatusBar，实际无文件冲突）
- **Category**: bug-fix（既有产品脆弱性/E2E 稳定性）
- **Planned at**: commit `95aefc3`, 2026-09-14

## Why this matters

core-flow E2E 的导出步骤间歇性失败（昨绿今挂），plan199 执行期归因为**既有导出菜单命中区脆弱性**（在未改动该路径的 `f44adb2` 上同样复现，非 Round 31 回归）：菜单弹层位于编辑器 textarea 命中区之下，Playwright hit-target 检查（等价 `elementFromPoint` 语义）命中 textarea 而非菜单项，`z-50` 无效——因为菜单的 `absolute` 弹层与 textarea 同处一个层叠上下文，textarea 在 DOM 上后绘/更高。这是产品级命中缺陷，不只影响测试：真实用户在特定布局下同样可能点不中菜单项。

## Current state（2026-09-14 勘察，锚点基于 `95aefc3`）

- 菜单实现：`src/components/EditorStatusBar.tsx:166-188`，`role="menu"`，定位 `absolute bottom-full right-0 z-50 mb-1`，挂在 ：157 的 `relative` 容器内，向上弹入 `WritingSurface` 滚动区。触发按钮 ：158-165（`aria-haspopup="menu"` + `aria-expanded`）。关闭逻辑 ：57-73（document 级 mousedown + Escape，ref 外点击关闭——portal 化后依然有效）。
- 命中区对手：`src/components/WritingSurface.tsx:307-321` textarea（:313 `min-h-[70vh]`，空章 `min-h-[55vh]`）；外层滚动容器 :173 `flex-1 overflow-y-auto relative`。层级：`EditorView.tsx:2242` 根容器（全屏时 ：2211 变 `fixed inset-0 z-[100]`）→ WritingSurface（:2639）→ EditorStatusBar（:2700）——同父层兄弟，堆叠竞争发生在这里。
- git 证据：plan199 的「1 类名修复」（`f44adb2`）实为**从状态栏根节点移除** `overflow-hidden`（:101 有注释说明），是裁剪修复而非命中区修复；`29c1af1` 将 core-flow 归因为既有脆弱性（原 ：131，现 ：355-362，行号已漂移）。
- E2E 依赖面：`tests/e2e/core-flow.spec.ts:359-362`——`getByRole('button', { name: '导出', exact: true })` → `getByRole('menuitem', { name: '导出 EPUB' }).click()`。全 tests/ 目录仅此一处依赖该菜单。
- 单测现状：`src/tests/editor-guidance-layout.test.tsx` 渲染了 EditorStatusBar 但只测高级工具菜单（:544-550），导出菜单**无单测**。
- portal 先例：仓库唯一 portal 是 Radix AlertDialog（`src/components/ui/alert-dialog.tsx:7`，portal 到 body + `fixed inset-0 z-50`），使用方含 `SkillsStudioView.tsx` 自身。src 中零 `createPortal`；无 floating-ui/headlessui（package.json:42-45 仅 radix alert-dialog/scroll-area/tabs/tooltip）。**不新增依赖**（加依赖需审批，本计划不需要）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 新增菜单单测 | `npx vitest run src/tests/editor-status-bar-export-menu.test.tsx`（命名按实际） | 全绿 |
| 既有状态栏套件 | `npx vitest run src/tests/editor-guidance-layout.test.tsx` | 全绿 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 定向 E2E | `npx playwright test tests/e2e/core-flow.spec.ts` | 全绿 |
| typecheck | `npm run typecheck` | 0 错误 |

## Scope

**In scope**：

- `src/components/EditorStatusBar.tsx`：导出菜单改 `createPortal(document.body)` + `fixed` 定位（打开时按触发按钮 rect 锚定）；保留 `role="menu"`/`menuitem`、`aria-haspopup`/`aria-expanded`、既有外点/Escape 关闭
- 新增导出菜单单测（getByRole 可穿透 portal，断言只测外部行为）
- `plans/README.md` 本行更新

**Out of scope**：

- 其他菜单/弹层的 portal 化（如高级工具菜单未表现脆弱性，不动）
- floating-ui 等新依赖
- core-flow.spec.ts 断言改写（role 点击应自然转绿；可选的 elementFromPoint 显式回归断言见 Step 3，仓库无先例不强求）

## Steps

### Step 1: 菜单 portal + fixed 定位

菜单 JSX 移入 `createPortal(document.body)`；打开时读触发按钮 `getBoundingClientRect()` 计算 `fixed` 坐标（向上弹出：`bottom = viewportHeight - rect.top + gap`，右对齐 `right = viewportWidth - rect.right`）。菜单生命周期短，定位只在打开时计算一次 + `window` scroll/resize 时直接关闭（状态栏菜单一击即走的先例语义）。role/aria 与关闭逻辑不动；z-index 沿用 `z-50`（portal 到 body 后已脱离编辑器堆叠上下文）。

**Verify**: typecheck + 既有状态栏套件绿；手工冒烟（或单测断言 menu 出现在 document.body 下）确认弹层挂载点为 body。

### Step 2: 新增导出菜单单测

仿 `editor-guidance-layout.test.tsx` 的渲染方式单独挂载 EditorStatusBar（mock 导出 fetch）：点「导出」→ `role=menu` 可见（RTL getByRole 穿透 portal）；点「导出 EPUB」→ fetch 被调且菜单关闭；Escape 与外点关闭。全部为外部行为断言。

**Verify**: 新测试绿，且 `editor-guidance-layout.test.tsx` 回归绿。

### Step 3: E2E 定向验证 + 台账

`core-flow.spec.ts` role 点击不变，定向跑全绿；连跑 3 次确认不再间歇失败（该缺陷的历史形态是昨绿今挂）。可选加固：spec 内加一段 `page.evaluate` 用 `elementFromPoint` 断言菜单项中心命中自身（仓库无此先例，仅当 Step 1 后仍想显式锁定命中区时加）。完成后更新 `plans/README.md` 本行。

**Verify**: 定向 E2E 3 连跑全绿；台账落账

## Test plan

新增单测 + 既有状态栏套件 + 前端全量 + core-flow 定向 E2E（3 连跑）+ typecheck。纯前端改动，不触后端。

## Done criteria

- [ ] 导出菜单 portal 到 body、fixed 定位，命中区不再被 textarea 覆盖
- [ ] 导出菜单有单测覆盖（开/关/选中/Escape/外点）
- [ ] core-flow E2E 3 连跑全绿；台账已更新

## STOP conditions

- portal 化后 `document` 级 mousedown 关闭逻辑失效（portal 不改变事件冒泡目标，理论上不受影响；若实测关闭异常且根因涉及既有 ref 结构）→ 停止报告。
- fixed 定位在全屏模式（`EditorView.tsx:2211` `fixed inset-0 z-[100]`）下出现遮挡/坐标错位 → 停止报告全屏分支的实测结果。

## Maintenance notes

若后续有第二个菜单需要 portal 化，可将本计划的 rect 锚定 + scroll 关闭逻辑沉淀为共享 hook；当前单点不预先抽象。
