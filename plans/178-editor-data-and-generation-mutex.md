# Plan 178: 编辑器数据流与生成互斥收口——旗标互斥、packs 竞态、isLoading 兜底、换书清空、监听器异常

> **Executor instructions**: 按步骤顺序执行，每步跑验证命令并确认预期结果后再进入下一步。触发 STOP conditions 时停止并报告。完成后更新 `plans/README.md` 中本计划的状态行。
>
> **Drift check (run first)**: `git diff --stat 0dfbbcf..HEAD -- src/lib/hooks/generation/useDraftGeneration.ts src/lib/hooks/useEditorContinuationPacks.ts src/lib/hooks/useEditorData.ts src/stores/editor-data-store.ts src/lib/db-transport.ts src/components/AIAssistant.tsx src/components/EditorView.tsx`
> 若有变更，先对照「Current state」摘录核对；不一致视为 STOP condition。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED（互斥收紧可能改变「边生成边审」的组合行为，需回归 cockpit 自动审计/润色链路）
- **Depends on**: Plan 177（同文件 useDraftGeneration.ts，先后执行减少冲突）
- **Category**: bug
- **Planned at**: commit `0dfbbcf`, 2026-09-10

## Why this matters

五个数据流缺陷：

1. **生成旗标互斥不完整**：beats 生成中可点快速生成 → seq 被顶掉 → beats 的 finally 跳过复位 → `isGeneratingBeats` 永久卡 true（UI 假死）；正文流式中点分镜 → `isGeneratingContent` 被提前置 false，用户可在流式写入窗口期编辑正文。
2. **换书竞态**：`useEditorContinuationPacks` 无过期守卫，慢响应可把 A 书资料包写进 B 书编辑器并把选中包置为 A 书的包。
3. **isLoading 无兜底**：`fetchAll` 代际不一致时提前 return 在 `setIsLoading(false)` 之前，首次挂载遇抖动即无限角落 spinner。
4. **换书 store 不清空**：旧书的章节/实体短暂泄漏进新书编辑器，窗口期内点旧章节可把旧书章节装进新书。
5. **监听器异常接不住**：db-transport 的 try/catch 只捕同步异常，`AIAssistant` 的 `refreshNovels` 无 catch → SSE 广播时反复 unhandled rejection。

## Current state

相关文件与角色：

- `src/lib/hooks/generation/useDraftGeneration.ts` — beats/正文生成 handler
- `src/components/EditorView.tsx:1075-1079` — `isGeneratingContentRef` 唯一同步点与 `isAnyGenerating`
- `src/lib/hooks/useEditorContinuationPacks.ts` — 资料包加载（全文 60 行）
- `src/lib/hooks/useEditorData.ts` — `fetchAll` 与挂载 reset effect
- `src/stores/editor-data-store.ts` — 模块级、跨挂载存续
- `src/lib/db-transport.ts:137-143` — SSE 监听器分发
- `src/components/AIAssistant.tsx:84-88` — 无 catch 的 listener

现状摘录：

```ts
// useDraftGeneration.ts:88-105 — handleGenerateBeats：无在途检查，还主动解锁正文旗标
const handleGenerateBeats = async () => {
  const startingChapterId = currentChapter?.id;
  if (!currentChapter) return;
  const currentSeq = ++requestSeqRef.current;
  ...
  setIsGeneratingBeats(true);
  setIsGeneratingContent(false);        // ← 正文流式中点分镜会解锁正文编辑
```

```ts
// useDraftGeneration.ts:181-188 — finally 仅在 seq 未被顶掉时复位自己的旗标
} finally {
  if (requestSeqRef.current === currentSeq) {
    setIsGeneratingBeats(false);
    ...
  }
}
```

```ts
// useDraftGeneration.ts:194 — 正文生成只检查单一旗标
if (!currentChapter || !currentChapter.sceneBeats || useEditorGenerationStore.getState().isGeneratingContent) return;
```

```tsx
// EditorView.tsx:1075-1079 — ref 是跨异步守卫的唯一同步点
// 005-S5 双写收敛：state=UI 投影，ref=跨异步守卫。
isGeneratingContentRef.current = isGeneratingContent;
const isAnyGenerating = isGeneratingContent || isGeneratingBeats || isGeneratingCritique || isSniffing || isGeneratingOutline;
```

```ts
// useEditorContinuationPacks.ts:35-52 — 无 cancelled 守卫、无 catch
const refreshContinuationPacks = async () => {
  const packs = sortContinuationPacksByRecency(await listContinuationPacks(novelId));
  setContinuationPacks(packs);
  ...
};
void refreshContinuationPacks();
return subscribeToChanges(() => { void refreshContinuationPacks(); });
```

```ts
// useEditorData.ts:186-191 — 代际不一致提前 return，位于 setIsLoading(false)（:246）之前
if (
  requestSeq !== dataRequestSeqRef.current
  || !hasConsistentGeneration(generationBefore, generationResult)
) return;
```

```ts
// useEditorData.ts:256-270 — 挂载 reset：清 selectedChapter/currentChapter/outline/generation/loading，不清 chapters/characters 等
dataRequestSeqRef.current += 1;
...
setCurrentChapter(null);
useOutlineContentStore.getState().resetOutlineContent();
setDatabaseGeneration(null);
setIsLoading(true);
setChapterLoading(false);
```

```ts
// db-transport.ts:137-143 — 仅捕同步异常
globalListeners.forEach((fn) => {
  try { fn(); } catch (e) { console.warn('SSE listener error:', e); }
});

// AIAssistant.tsx:84-88 — listener 返回未接住的 promise
const refreshNovels = () => listNovels().then(setUserNovels);
refreshNovels();
return subscribeToChanges(refreshNovels);
```

仓库既有守卫先例：`useEditorData.ts` 的 `dataRequestSeqRef` 递增比对模式（fetchAll 内部已用）。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npm run typecheck`（或 `node node_modules/typescript/bin/tsc --noEmit`） | exit 0 |
| 前端全量 | `npm run test:frontend` | 全绿 |
| 定向 | `node node_modules/vitest/vitest.mjs -c vitest.config.frontend.ts run src/tests/editor-generation-flow-lifecycle.test.ts src/tests/draft-generation-safety.test.ts`（文件名以 `ls src/tests | grep -E "draft|editor"` 为准） | 全过 |

## Scope

**In scope**：

- `src/lib/hooks/generation/useDraftGeneration.ts`
- `src/lib/hooks/useEditorContinuationPacks.ts`
- `src/lib/hooks/useEditorData.ts`
- `src/stores/editor-data-store.ts`（如需新增批量 reset action）
- `src/lib/db-transport.ts`（仅 listener 分发段）
- `src/components/AIAssistant.tsx`（仅 refreshNovels 一行）
- 新增/扩展测试

**Out of scope**：

- `EditorView.tsx` 的按钮 disabled 矩阵（Step 1 的入口收口已足够；若 Step 1 后仍有入口漏网，见 STOP）
- `useAuditPolishActions.ts`（Plan 177 范围）
- `WritingSurface.tsx` 防抖机制
- 服务端

## Git workflow

每个缺陷一次提交；消息如 `fix(editor): reset generation flags unconditionally in finally`；完成即提交，不 push。

## Steps

### Step 1: 生成旗标互斥

1. `useEditorGenerationStore`（`grep -rn "isGeneratingBeats" src/stores/` 定位 store 文件）确认四个旗标齐全后，在 `handleGenerateBeats` 与 `handleGenerateContent` 入口统一加守卫：任一 `isGenerating*` 为 true 时直接 return（beats 原本无检查；content 原本只查自己）。不要用「先 stop 再生成」的隐式顶替语义——入口直接拒绝。
2. `handleGenerateBeats` 删除 `setIsGeneratingContent(false);`（约 :105 行）——生成 beats 不得解锁正文。
3. finally 复位改为**无条件复位自己持有的旗标**：`finally { setIsGeneratingBeats(false); ... }` 去掉 `requestSeqRef.current === currentSeq` 外层条件（status 类 UI 更新保留 seq 条件）。对 `handleGenerateContent` 的 finally 同样处理（仅旗标部分；`setGenerationStatus` 的 8 秒延迟清理逻辑保持 seq 条件不变）。

**Verify**: typecheck 0 错误；`grep -n "setIsGeneratingContent(false)" src/lib/hooks/generation/useDraftGeneration.ts` → 仅剩入口拒绝路径与 finally 各一处（人工核对）

### Step 2: packs 竞态守卫

`useEditorContinuationPacks.ts` 的 effect 改为带 cancelled 标志 + catch：

```ts
useEffect(() => {
  let cancelled = false;
  const refreshContinuationPacks = async () => {
    try {
      const packs = sortContinuationPacksByRecency(await listContinuationPacks(novelId));
      if (cancelled) return;
      setContinuationPacks(packs);
      setSelectedContinuationPackIdUpdatable((current) => { /* 原逻辑不变，内部 reslove 前不再判 cancelled（updater 同步执行） */ });
    } catch { /* 列表刷新失败保留现值 */ }
  };
  void refreshContinuationPacks();
  return subscribeToChanges(() => { void refreshContinuationPacks(); });
  // cleanup 由外层 effect return 提供：
}, [/* 原依赖不变 */]);
```

注意 effect 必须返回组合 cleanup：`return () => { cancelled = true; unsubscribe(); };`（把 `subscribeToChanges` 的返回值接住）。

**Verify**: typecheck 0 错误；`grep -n "cancelled" src/lib/hooks/useEditorContinuationPacks.ts` ≥2 命中

### Step 3: fetchAll isLoading 兜底

`useEditorData.ts:186-191` 的提前 return 前补 `if (requestSeq === dataRequestSeqRef.current) setIsLoading(false);`（与 catch 分支口径一致：仅最新请求有权解除 loading）。`readGeneration` 失败路径（返回 null）已被同一守卫覆盖，无需单改。

**Verify**: typecheck 0 错误

### Step 4: 换书清空 store

1. `editor-data-store.ts` 新增批量 reset：`resetForNovelSwitch: () => set({ chapters: [], characters: [], locations: [], items: [], factions: [], librarySkills: [], skillUsageRecords: [], relationships: [] })`（以 store 实际字段为准，`sed -n '1,50p' src/stores/editor-data-store.ts` 核对全集；只清列表类，不清 preferenceProfile——它随 fetchAll 覆盖）。
2. `useEditorData.ts` 挂载 reset effect（:256-270）中，在 `setIsLoading(true)` 旁调用 `useEditorDataStore.getState().resetForNovelSwitch()`。
3. `selectChapter` 返回后加属主校验：`if (fullChapter.novelId !== novelId) return;`（定位 `selectChapter` 定义，在 setCurrentChapter 之前比对；`grep -n "const selectChapter" src/lib/hooks/useEditorData.ts`）。

**Verify**: typecheck 0 错误

### Step 5: SSE 监听器异常兜底

1. `db-transport.ts:137-143` 分发改为 `Promise.resolve(fn()).catch((e) => console.warn('SSE listener error:', e));`
2. `AIAssistant.tsx:84` 改为 `const refreshNovels = () => listNovels().then(setUserNovels).catch(() => {/* 刷新失败保留旧列表 */});`

**Verify**: typecheck 0 错误

### Step 6: 回归测试

在 `src/tests/` 新建 `editor-data-race-guards.test.ts`（结构仿 `src/tests/editor-persistence.test.ts`）：

1. **beats 不解锁正文**：触发 `handleGenerateBeats` → 断言 `isGeneratingContent` 仍为 false（修复前会被置 false）。
2. **顶掉后 finally 仍复位**：启动 beats 后立刻启动 content（入口拒绝后无此场景；改为直接单测 finally 语义：mock seq 递增，断言 beats 旗标仍被复位为 false）。
3. **packs 过期响应不落库**：novelId 从 A 切到 B，让 A 的响应后到 → 断言 store 中 packs 不含 A 的包。
4. **AIAssistant listener 失败不炸**：mock `listNovels` reject → 手动触发 subscribeToChanges 回调 → 断言无 unhandled rejection（`process.on('unhandledRejection')` 探针或 vitest 默认严格模式不报错即过）。

既有 `src/tests/editor-generation-flow-lifecycle.test.ts`、`draft-generation-safety.test.ts`、`editor-persistence.test.ts` 必须全绿（它们锁定互斥/保存语义，若因 Step 1 有意变更而失败，核对后更新断言并在执行报告说明）。

**Verify**: `npm run test:frontend` → 全绿

## Test plan

见 Step 6。回归重点文件：`editor-generation-flow-lifecycle` / `draft-generation-safety` / `editor-persistence` / `components`。

## Done criteria

- [ ] typecheck 0 错误；`npm run test:frontend` 全绿（含 ≥4 个新用例）
- [ ] `grep -n "setIsGeneratingContent(false)" src/lib/hooks/generation/useDraftGeneration.ts` 中不再存在 beats handler 路径的调用
- [ ] `grep -n "cancelled" src/lib/hooks/useEditorContinuationPacks.ts` ≥2 命中
- [ ] `grep -n "resetForNovelSwitch" src/stores/editor-data-store.ts src/lib/hooks/useEditorData.ts` 各 ≥1 命中
- [ ] `git status` 无 in-scope 之外的改动
- [ ] `plans/README.md` 状态行已更新

## STOP conditions

- Step 1 后发现存在合法的「边生成边审」产品路径被入口拒绝破坏（如 cockpit 静默审计依赖 content 生成中再跑 audit）——恢复该路径并报告，改为仅修 finally 复位。
- `useEditorGenerationStore` 缺少任一旗标 getter（说明旗标分布在多个 store）——报告 store 清单。
- Step 4 的属主校验发现 `Chapter` 类型无 `novelId` 字段（不可能，但以类型为准）。

## Maintenance notes

- 评审关注点：finally 无条件复位后，「被顶掉的请求」不再残留卡死旗标；但入口拒绝也让「顶替」语义消失——产品上生成入口从此必须先手动停止，文案如需「正在生成中」提示属 Plan 181 范畴。
- `resetForNovelSwitch` 未来加新实体列表字段时必须同步（store 字段与 reset 集合保持同一文件内相邻）。
- Plan 183（SSE 刷新风暴）会改 `subscribeToChanges` 的分发频率，与 Step 5 的兜底正交。
