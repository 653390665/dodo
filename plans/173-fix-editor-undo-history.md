# Plan 173: 修复编辑器撤销栈——只在切换章节时 reset，恢复 Cmd+Z

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告，不要自行发挥。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/components/EditorView.tsx src/lib/hooks/useChapterUndo.ts src/lib/hooks/useEditorPersistence.ts src/lib/undo-history.ts`
> 若上述文件有变更，先对照「Current state」摘录核对现行代码；不一致视为 STOP condition。

## Status

- **Priority**: P0
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

编辑器的 Cmd/Ctrl+Z 撤销在当前实现下完全失效：每次内容更新都会把撤销栈清空。这是核心写作功能的静默失效，且 README.md:238 正在向用户宣传该快捷键。修复后，用户在正文中打字、接受 AI 候选后都能用 Cmd+Z 回退。

## Current state

相关文件与角色：

- `src/components/EditorView.tsx` — 编辑器主视图；1194-1199 行的 effect 是 bug 触发点
- `src/lib/hooks/useChapterUndo.ts` — 撤销 hook；`resetUndoHistory` 会清空历史
- `src/lib/hooks/useEditorPersistence.ts` — `handleUpdateContent` 每次 300ms 防抖提交都产生新 `currentChapter` 对象
- `src/components/WritingSurface.tsx` — 300ms 防抖调用 `onUpdateContent`
- `src/lib/undo-history.ts` — 纯 reducer；`pushToHistory` 对等于 present 的内容去重

现状摘录：

```tsx
// src/components/EditorView.tsx:1194-1199
// Reset undo history when chapter changes
useEffect(() => {
  if (currentChapter) {
    resetUndoHistory(currentChapter.content);
  }
}, [currentChapter, currentChapter?.id, resetUndoHistory]);
```

```ts
// src/lib/hooks/useEditorPersistence.ts:229-232（handleUpdateContent 内）
const updatedChapter = { ...currentChapter, content: newContent, wordCount: newContent.replace(/\s/g, '').length };
setCurrentChapter(updatedChapter);
pushToUndoHistory(newContent);
```

```ts
// src/lib/hooks/useChapterUndo.ts:36-51
const undoPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const isInternalChangeRef = useRef(false);

// Debounced push to history
const pushToUndoHistory = useCallback((content: string) => {
  if (undoPushTimerRef.current) clearTimeout(undoPushTimerRef.current);
  undoPushTimerRef.current = setTimeout(() => {
    dispatchUndo({ type: 'push', content });
  }, 2000);
}, []);
```

```ts
// src/lib/hooks/useChapterUndo.ts:99-103
const resetUndoHistory = useCallback((content: string) => {
  isInternalChangeRef.current = false;
  dispatchUndo({ type: 'reset', content });
}, []);
```

```ts
// src/lib/undo-history.ts:11-14 — push 对等于 present 的内容去重
export function pushToHistory(state: UndoState, newContent: string): UndoState {
  if (newContent === state.present) return state;
```

失效链条：打字 → WritingSurface 300ms 防抖 → `handleUpdateContent` 产生新 `currentChapter` 对象 → EditorView 的 effect 因依赖整个对象而重跑 → `resetUndoHistory` 把 `past` 清空、`present` 设为最新内容 → 2 秒后 `pushToUndoHistory` 的定时器触发时内容已等于 present 被去重。结果 `past` 恒为空，Cmd+Z 无事发生（AI 候选接受后的 push 同样被后续 reset 抵消）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（本机 npm 损坏时用 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0，0 错误 |
| 前端全量测试 | `npm run test:frontend`（损坏时 `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run`） | 全绿 |
| 前端单文件测试 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/editor-undo-history.test.ts` | 全部通过 |
| Lint 改动文件 | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**（仅可修改这些文件）：

- `src/components/EditorView.tsx`（仅 1194-1199 行附近的 undo reset effect）
- `src/tests/editor-undo-history.test.ts`（新建）

**Out of scope**（不要动，即使看起来相关）：

- `src/lib/undo-history.ts` — reducer 语义正确，不需要改
- `src/lib/hooks/useChapterUndo.ts` — hook 内部逻辑正确，问题只在调用方的 reset 时机
- `src/components/WritingSurface.tsx` — 防抖行为是 0096 计划的有意设计，不得改动
- `src/lib/hooks/useEditorPersistence.ts` — 不得为绕过本 bug 改动持久化逻辑

## Git workflow

- 在当前开发分支小步提交；消息风格照仓库惯例（conventional commits），如 `fix(editor): reset undo history only on chapter switch`
- 完成即提交，不要 push，不要让改动滞留工作区

## Steps

### Step 1: 用章节 id 哨兵替换依赖整个对象的 reset effect

把 `src/components/EditorView.tsx:1194-1199` 的 effect 改为「只在章节 id 变化时 reset」：

```tsx
// Reset undo history when the chapter identity changes (not on every content update)
const lastUndoChapterIdRef = React.useRef<string | null>(null);
useEffect(() => {
  const chapterId = currentChapter?.id ?? null;
  if (!chapterId) {
    lastUndoChapterIdRef.current = null;
    return;
  }
  if (lastUndoChapterIdRef.current === chapterId) return;
  lastUndoChapterIdRef.current = chapterId;
  resetUndoHistory(currentChapter.content);
}, [currentChapter, resetUndoHistory]);
```

要点：保留 `[currentChapter, resetUndoHistory]` 依赖（内容更新仍会触发 effect，但被 id 哨兵短路）；去掉原依赖数组里的 `currentChapter?.id`（冗余）。不要在本文件其他位置新增 `useRef` 声明的重复命名。

**Verify**: `node node_modules/typescript/bin/tsc --noEmit` → 0 错误

### Step 2: 新增回归测试

新建 `src/tests/editor-undo-history.test.ts`，用 `@testing-library/react` 的 `renderHook` 挂载一个最小 wrapper：同时调用 `useChapterUndo` + 模拟 EditorView 的 reset effect（复制 Step 1 的 effect 逻辑到 wrapper 内），并用 `vi.useFakeTimers()` 控制 2 秒防抖。结构仿照 `src/tests/editor-persistence.test.ts` 的 hook 测试写法。用例：

1. **打字后可撤销**：依次以内容 `"v1"`、`"v2"`、`"v3"` 调用 `pushToUndoHistory`（每格 advance 2100ms 让 push 落地）→ `handleUndo()` 后 content 回到 `"v2"`，再 `handleUndo()` 回到 `"v1"`。
2. **切换章节重置**：换新章节（新 id + 新内容）触发 reset → `handleUndo()` 不改变内容（past 为空）。
3. **回归本 bug**：同章节内连续内容更新（不换 id）不得清空已 push 的历史——这是本计划修复的缺陷断言。

**Verify**: `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/editor-undo-history.test.ts` → 3 个用例全过

## Test plan

见 Step 2。既有 `src/tests/components.test.tsx` 涉及 EditorView 挂载，作为全量回归的一部分跑：

**Verify**: `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run` → 全绿（基线 841+）

## Done criteria

- [ ] `npm run typecheck` exit 0
- [ ] `npm run test:frontend` 全绿，含新增 `editor-undo-history.test.ts` 3 用例
- [ ] `grep -n "currentChapter?.id, resetUndoHistory" src/components/EditorView.tsx` 无命中（旧依赖数组已移除）
- [ ] `git status` 无 in-scope 之外的文件改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- EditorView.tsx 1194-1199 处代码与摘录不符（已漂移）。
- Step 2 用例 1 在修复后仍失败（说明 reset 之外还有别的清空路径——报告你观察到的路径，不要继续改 useChapterUndo）。
- 验证命令连续两次失败后无法定位原因。

## Maintenance notes

- 评审关注点：effect 的 id 哨兵在「章节删除后 currentChapter 变 null 再选中回同一章」时是否会漏 reset（当前实现：null 时清哨兵，重新选中会 reset，行为正确）。
- 若未来把 undo 迁入 zustand store（类似 011 计划的做法），此 effect 应一并迁移，哨兵逻辑保留。
- README.md:238 对 Cmd+Z 的宣传在修复后重新为真；Plan 191 会复核该行。
