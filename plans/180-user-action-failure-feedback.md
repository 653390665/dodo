# Plan 180: 用户动作失败反馈补全——删章节、建书、刷一批三处静默失败

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/lib/hooks/useEditorPersistence.ts src/components/EditorModals.tsx src/components/Library.tsx src/components/AppShell.tsx src/components/StoryCardDeck.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: S-M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug + ux
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

三处用户动作失败后零反馈：

1. **删除章节**：`handleDeleteChapter` 的 await 无 try/catch，服务端错误直接 unhandled rejection；确认弹窗照常关闭，用户以为删了实际还在。
2. **书库新建作品**：`handleCreateNovel` 无 try/catch，失败时点击毫无反应，标题留在输入框，用户反复点击。
3. **方案卡「继续刷一批/混卡」**：失败被 `catch (e) { throw e }` 原样上抛且调用方不接；进行中整个应用被替换为全屏英文「InkFlow Starting...」（并没有在启动，是在等 LLM）。

## Current state

相关文件与角色：

- `src/lib/hooks/useEditorPersistence.ts:427-449` — `handleDeleteChapter`
- `src/components/EditorModals.tsx:42-50` — 删除确认的 AlertDialogAction
- `src/components/Library.tsx:100-132` — `handleCreateNovel`
- `src/components/AppShell.tsx:752-783` — `handleCreateDraftFromIdea`（setLoading + useless-catch）
- `src/components/AppShell.tsx:966-975` — `if (loading)` 全屏分支
- `src/components/StoryCardDeck.tsx:29` — `onRefreshBatch`/`onMixCard` 调用方

现状摘录：

```ts
// useEditorPersistence.ts:427-432 — await 无 try/catch；只有返回 false 的分支有 toast
const handleDeleteChapter = async (id: string) => {
  if (!await flushBeforeChangingEditorContext()) return;
  const deleted = await deleteChapterForEditor(id);
  if (!deleted) {
    toast('删除章节失败，章节可能已不存在', 'error');
    return;
  }
```

```tsx
// EditorModals.tsx:42-50 — 同步调用后立即关弹窗，promise 无人接
<AlertDialogAction
  onClick={() => {
    if (chapterToDeleteId) {
      onDeleteChapter(chapterToDeleteId);
      setChapterToDeleteId(null);
    }
  }}
```

```ts
// Library.tsx:100-132 — 创建失败即 unhandled rejection（中间省略构造逻辑）
await createNovelWithChapter(novel, firstChapter);
setNewNovelTitle('');
setIsAdding(false);
onSelectNovel(novel);
```

```ts
// AppShell.tsx:775-782 — 失败上抛 + finally 复位 loading
} // eslint-disable-next-line no-useless-catch
catch (e) {
  throw e;
} finally {
  setLoading(false);
}
```

```tsx
// AppShell.tsx:966-975 — loading 期间整窗替换为启动文案
if (loading) {
  return (
    <div className="h-screen w-full ..." data-testid="app-ready" data-ready-state="false">
      <div className="text-xl font-serif italic text-gray-400">
        InkFlow Starting...
      </div>
    </div>
  );
}
```

仓库既有正例：`AppShell.tsx:878-881` AI 立项失败 `toast('创建作品失败，请稍后重试', 'error')`；toast API（`src/lib/toast.ts:33`）：`toast(message, type?: 'info'|'success'|'error', durationMs?, action?)`，error 默认 6.5s。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| Lint | `node node_modules/eslint/bin/eslint.js <改动文件> --max-warnings=0` | exit 0 |

## Scope

**In scope**：

- `src/lib/hooks/useEditorPersistence.ts`（仅 handleDeleteChapter）
- `src/components/EditorModals.tsx`（仅 AlertDialogAction onClick）
- `src/components/Library.tsx`（仅 handleCreateNovel）
- `src/components/AppShell.tsx`（仅 handleCreateDraftFromIdea 的 catch 与全屏 loading 分支）
- `src/components/StoryCardDeck.tsx`（仅 onRefreshBatch/onMixCard 的错误接住与按钮级 loading）
- 相关测试

**Out of scope**：

- `flushBeforeChangingEditorContext` 的语义（false 时静默返回是有意设计）
- 全局 loading 状态机重构——只把「刷一批」从全局 loading 解耦为局部 loading
- Plan 174 范围内的其他删除确认

## Git workflow

三个修复各一次提交；消息如 `fix(editor): toast on chapter deletion failure`；完成即提交，不 push。

## Steps

### Step 1: 删除章节失败反馈

1. `handleDeleteChapter` 的 `await deleteChapterForEditor(id);` 包 try/catch：

```ts
let deleted: boolean;
try {
  deleted = await deleteChapterForEditor(id);
} catch (error) {
  console.error('[useEditorPersistence] Failed to delete chapter:', error);
  toast('删除章节失败，请重试', 'error');
  return;
}
```

2. `EditorModals.tsx:42-50` 的 onClick 改为 `onClick={() => { if (chapterToDeleteId) { void onDeleteChapter(chapterToDeleteId); setChapterToDeleteId(null); } }}`——`void` 显式化（hook 内已兜底 toast，弹窗照常关闭可接受：章节列表会保持原状，用户能看到章节仍在 + 有错误提示）。

**Verify**: typecheck 0 错误

### Step 2: 新建作品失败反馈

`Library.tsx` 的 `handleCreateNovel` 把 `await createNovelWithChapter(novel, firstChapter);` 起的三行包入 try/catch：

```ts
try {
  await createNovelWithChapter(novel, firstChapter);
} catch (error) {
  console.error('[Library] Failed to create novel:', error);
  toast('创建作品失败，请稍后重试', 'error');
  return;   // 保留输入与展开状态，用户可重试
}
```

文件头 import `toast`（`../lib/toast`，以相对路径为准）。

**Verify**: typecheck 0 错误

### Step 3: 刷一批局部化 loading + 失败 toast

1. `AppShell.tsx` `handleCreateDraftFromIdea`（:752-783）：
   - `setLoading(true)` 改为 `setStoryCardsLoading(true);`（新增局部 state `const [storyCardsLoading, setStoryCardsLoading] = useState(false);`，与全局 `loading` 分离）。
   - 删除 `// eslint-disable-next-line no-useless-catch` 与 `catch (e) { throw e; }`，改为 `catch (error) { console.error('[AppShell] Failed to generate story cards:', error); toast('生成方案卡失败，请稍后重试', 'error'); }`（finally 的 `setLoading(false)` 同步改为 `setStoryCardsLoading(false)`）。
   - 全局 `loading` 若不再有其他写入点（`grep -n "setLoading(" src/components/AppShell.tsx` 核对），删除 state 与 `AppShell.tsx:966-975` 全屏分支；仍有其他写入点则仅保留分支但改文案为 `'正在启动 InkFlow…'`（Plan 175 已改则跳过）。
2. `StoryCardDeck.tsx`：给刷新/混卡按钮接入 `storyCardsLoading`（经 props 从 AppShell 传入，prop 名 `isRefreshingBatch`）——按钮 `disabled={isRefreshingBatch}` + 文案切「生成中…」；onRefreshBatch/onMixCard 保持纯调用（错误已在 AppShell 接住）。

**Verify**: typecheck 0 错误；`grep -n "useless-catch" src/components/AppShell.tsx` 无命中

### Step 4: 回归测试

扩展 `src/tests/components.test.tsx` 或新建 `src/tests/user-action-failure-feedback.test.tsx`（仿既有组件测试的 client mock 模式）：

1. mock `createNovelWithChapter` reject → 渲染 Library 提交新建表单 → 断言 toast error 出现（`document.querySelector('[data-inkflow-toasts]')` 内含「创建作品失败」）且输入未清空。
2. mock `deleteChapterForEditor` reject → 挂载使用 useEditorPersistence 的最小组件触发删除 → 断言 toast「删除章节失败」且无 unhandled rejection。
3. mock `generateStoryCards` reject → 触发 AppShell 的 onRefreshBatch → 断言 toast「生成方案卡失败」且**不**出现 `app-ready` 全屏分支。

**Verify**: `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/user-action-failure-feedback.test.tsx` → 全过

## Test plan

见 Step 4；全量 `npm run test:frontend`（AppShell 相关用例较多，注意 Step 3 删除全屏分支后既有断言 `data-ready-state` 的用例需核对更新）。

## Done criteria

- [ ] typecheck 0 错误；`npm run test:frontend` 全绿（含 3 个新用例）
- [ ] `grep -n "useless-catch" src/components/AppShell.tsx` 无命中
- [ ] `grep -n "InkFlow Starting" src/components/AppShell.tsx` 无命中（分支删除或文案已中文化）
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- 全局 `loading` 存在本计划之外的写入点且依赖全屏分支（如启动恢复流程）——保留分支并只改文案，报告写入点清单。
- StoryCardDeck 的 props 结构不支持单向传入 loading（如它在 onboarding 向导内自成状态机）——报告组件树。
- 既有测试对 `data-ready-state="false"` 有强断言且不属于本计划行为变更。

## Maintenance notes

- 评审关注点：Step 3 后「刷一批」不再阻塞整窗——确认 AI 抽屉/侧边栏在生成期间可交互属预期产品行为。
- Plan 181（UX 反馈一致性）会统一 toast 语义分级，本计划的 error 级文案保持原样即可。
- `handleCreateDraftFromIdea` 与 Plan 175 的空态文案无交集，冲突时可先 174 后 179。
