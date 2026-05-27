# InkFlow 资料续写主线收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the continuation writing mainline so that importing source material flows seamlessly into storyboard-ready state, with a single shared pack selection rule, editable continuation task, and consistent empty states across all modules.

**Architecture:** No new tables or endpoints. Reuse existing `continuation_packs` table and `updateContinuationPack` API. Add one shared selector module (`continuation-pack-selection.ts` rewrite), add `continuationTask` editing to `ContinuationPackView`, fix priority bug in `continuation-overview.ts`, wire post-import navigation to auto-open the production panel with pre-filled creation intent, and unify empty-state copy across production/knowledge/overview panels.

**Tech Stack:** React 19, TypeScript 5.8, existing local DB transport, node:test, Vite.

---

## File Inventory

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/lib/continuation-pack-selection.ts` | Rewrite selector to respect status priority (explicit > approved > draft) |
| Modify | `src/lib/continuation-overview.ts` | Fix priority bug: prefer approved over draft |
| Modify | `src/components/ContinuationPackView.tsx` | Add inline `continuationTask` editor |
| Modify | `src/components/ContinuationImportView.tsx` | Post-approve: navigate to editor with production panel open and pre-filled intent |
| Modify | `src/components/EditorView.tsx` | On continuation launch: auto-create chapter if none exists, pre-fill `userIntent` from pack's `continuationTask` |
| Modify | `src/components/AgentWorkspaceProductionPanel.tsx` | Show "创建下一章" button when no chapter exists; improve empty state copy |
| Modify | `src/components/ContinuationOverviewPanel.tsx` | Update overview CTA copy and link to storyboard |
| Modify | `src/components/WorldBibleView.tsx` | Add "进入分镜准备" CTA in continuation section |
| Modify | `src/types.ts` | Extend `ContinuationEditorLaunchState` with optional `prefillIntent` |
| Create | `tests/continuation-pack-selection.test.ts` | Tests for the new shared selector |
| Modify | `tests/continuation-overview.test.ts` | Update tests for priority fix |
| Modify | `tests/continuation-import-flow.test.ts` | Add test for intent prefill |

---

## Task 1: Fix Shared Pack Selection Logic

**Files:**
- Modify: `src/lib/continuation-pack-selection.ts`
- Modify: `src/lib/continuation-overview.ts`
- Create: `tests/continuation-pack-selection.test.ts`
- Modify: `tests/continuation-overview.test.ts`

**Goal:** Establish one canonical rule for "which pack is active" used everywhere.

### Step 1: Rewrite `continuation-pack-selection.ts`

Replace the current implementation which ignores status. The new rule:
1. If `currentPackId` is set and that pack exists in the list → keep it (explicit user choice).
2. Otherwise pick the most recent `approved` pack.
3. If no `approved`, pick the most recent `draft` pack.
4. Return `''` if no packs.

```ts
// src/lib/continuation-pack-selection.ts
import type { ContinuationPack } from '../types';

function compareByRecency(a: ContinuationPack, b: ContinuationPack): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  return b.createdAt - a.createdAt;
}

export function sortContinuationPacksByRecency(packs: ContinuationPack[]): ContinuationPack[] {
  return [...packs].sort(compareByRecency);
}

/**
 * Canonical pack selection rule used by EditorView, KnowledgePanel, ProductionPanel, and Overview.
 *
 * Priority:
 *  1. Explicit `currentPackId` if it exists in the list
 *  2. Most recent `approved` pack
 *  3. Most recent `draft` pack
 *  4. `''` (no packs)
 */
export function getPreferredContinuationPackId(
  packs: ContinuationPack[],
  currentPackId?: string,
): string {
  if (currentPackId && packs.some((pack) => pack.id === currentPackId)) {
    return currentPackId;
  }

  const sorted = sortContinuationPacksByRecency(packs);
  const approved = sorted.find((p) => p.status === 'approved');
  if (approved) return approved.id;

  return sorted[0]?.id || '';
}

/**
 * Returns the active pack object using the same priority rule.
 */
export function getPreferredContinuationPack(
  packs: ContinuationPack[],
  currentPackId?: string,
): ContinuationPack | null {
  const id = getPreferredContinuationPackId(packs, currentPackId);
  return packs.find((p) => p.id === id) || null;
}
```

### Step 2: Fix `continuation-overview.ts` priority bug

Current code returns `draftPack` as `primaryPack` even when `approvedPack` exists. Fix: check `approvedPack` first.

```ts
// In buildContinuationOverviewState, replace the body:

export function buildContinuationOverviewState(packs: ContinuationPack[]): ContinuationOverviewState {
  const draftPack = sortByRecency(packs.filter((pack) => pack.status === 'draft'))[0] || null;
  const approvedPack = sortByRecency(packs.filter((pack) => pack.status === 'approved'))[0] || null;

  // Priority: approved > draft (was reversed before)
  const primaryPack = approvedPack || draftPack;

  if (!primaryPack) {
    return {
      kind: 'empty',
      primaryPack: null,
      draftPack: null,
      approvedPack: null,
      contradictionCount: 0,
      readingQuestionCount: 0,
      continuationGapCount: 0,
      highlightWarnings: [],
    };
  }

  const isDraft = primaryPack === draftPack && !approvedPack;

  return {
    kind: isDraft ? 'draft' : hasHighRisk(primaryPack) ? 'risk' : 'ready',
    primaryPack,
    draftPack,
    approvedPack,
    contradictionCount: primaryPack.contradictions.length,
    readingQuestionCount: primaryPack.readingQuestions?.length || 0,
    continuationGapCount: primaryPack.continuationGaps?.length || 0,
    highlightWarnings: buildWarnings(primaryPack),
  };
}
```

### Step 3: Write tests for pack selection

```ts
// tests/continuation-pack-selection.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getPreferredContinuationPackId, getPreferredContinuationPack } from '../src/lib/continuation-pack-selection';
import type { ContinuationPack } from '../src/types';

function makePack(overrides: Partial<ContinuationPack>): ContinuationPack {
  return {
    id: 'pack-1',
    novelId: 'novel-1',
    title: 'Test Pack',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: { currentTimeline: '', latestScene: '', immediateConflict: '', nextLikelyMove: '', unresolvedHooks: [] },
    styleProfile: { pov: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [] },
    contradictions: [],
    continuationTask: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('getPreferredContinuationPackId', () => {
  it('returns empty string for empty list', () => {
    assert.equal(getPreferredContinuationPackId([]), '');
  });

  it('keeps explicit currentPackId if it exists in list', () => {
    const packs = [
      makePack({ id: 'a', status: 'approved', updatedAt: 200 }),
      makePack({ id: 'b', status: 'draft', updatedAt: 300 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs, 'b'), 'b');
  });

  it('ignores explicit currentPackId if not in list, picks approved', () => {
    const packs = [
      makePack({ id: 'a', status: 'approved', updatedAt: 200 }),
      makePack({ id: 'b', status: 'draft', updatedAt: 300 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs, 'nonexistent'), 'a');
  });

  it('prefers approved over draft even if draft is newer', () => {
    const packs = [
      makePack({ id: 'draft-new', status: 'draft', updatedAt: 500 }),
      makePack({ id: 'approved-old', status: 'approved', updatedAt: 100 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs), 'approved-old');
  });

  it('falls back to draft when no approved exists', () => {
    const packs = [
      makePack({ id: 'd1', status: 'draft', updatedAt: 100 }),
      makePack({ id: 'd2', status: 'draft', updatedAt: 200 }),
    ];
    assert.equal(getPreferredContinuationPackId(packs), 'd2');
  });
});

describe('getPreferredContinuationPack', () => {
  it('returns null for empty list', () => {
    assert.equal(getPreferredContinuationPack([]), null);
  });

  it('returns the pack object matching the selected id', () => {
    const packs = [
      makePack({ id: 'a', status: 'approved', title: 'Approved Pack' }),
    ];
    const result = getPreferredContinuationPack(packs);
    assert.equal(result?.title, 'Approved Pack');
  });
});
```

### Step 4: Update `continuation-overview.test.ts`

Read existing test, update assertions to reflect new priority (approved > draft).

---

## Task 2: Add Editable `continuationTask` to ContinuationPackView

**Files:**
- Modify: `src/components/ContinuationPackView.tsx`

**Goal:** Users can edit the continuation task directly in the pack detail card instead of it being read-only.

### Step 1: Add `continuationTask` editing state and save handler

In `ContinuationPackView`, add a local state for editing the task and a save handler.

After the existing `handleDeletePack` function (line ~73), add:

```ts
const [editingTask, setEditingTask] = useState(false);
const [taskDraft, setTaskDraft] = useState('');

const handleStartEditTask = () => {
  if (!activePack) return;
  setTaskDraft(activePack.continuationTask || '');
  setEditingTask(true);
};

const handleSaveTask = async () => {
  if (!activePack) return;
  await updateContinuationPack(activePack.id, { continuationTask: taskDraft });
  const updated = { ...activePack, continuationTask: taskDraft, updatedAt: Date.now() };
  setActivePack(updated);
  setPacks(prev => prev.map(p => p.id === activePack.id ? updated : p));
  setEditingTask(false);
};
```

### Step 2: Replace the read-only `continuationTask` display

Replace the existing details section (line ~201-209) that shows `continuationTask` in a collapsed `<details>` block. Instead, add a prominent editable field above the details:

```tsx
{/* Continuation Task - always visible and editable */}
<div className="rounded-xl border border-theme-border bg-white p-4 space-y-2">
  <div className="flex items-center justify-between">
    <div className="text-xs font-bold text-theme-text">续写主任务</div>
    {!editingTask && (
      <button
        onClick={handleStartEditTask}
        className="text-[10px] text-theme-accent hover:underline"
      >
        编辑
      </button>
    )}
  </div>
  <p className="text-[10px] text-theme-muted">
    这批资料导入后，你希望系统续写的主任务方向。将用于分镜预填和自动生产摘要。
  </p>
  {editingTask ? (
    <div className="space-y-2">
      <textarea
        value={taskDraft}
        onChange={(e) => setTaskDraft(e.target.value)}
        placeholder="例如：从第三卷高潮处续写，主角团进入秘境后遭遇反派伏击..."
        className="w-full h-20 bg-white border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/50 resize-none shadow-sm focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
      />
      <div className="flex gap-2">
        <button onClick={handleSaveTask} className="px-3 py-1.5 rounded-lg bg-theme-accent text-white text-[10px] font-bold">
          保存
        </button>
        <button onClick={() => setEditingTask(false)} className="px-3 py-1.5 rounded-lg bg-theme-sidebar text-theme-text text-[10px] font-bold border border-theme-border">
          取消
        </button>
      </div>
    </div>
  ) : (
    <div className="text-xs text-theme-text">
      {activePack?.continuationTask || <span className="text-theme-muted italic">未指定 — 点击编辑添加续写方向</span>}
    </div>
  )}
</div>
```

This replaces the collapsed `<details>` section. Keep the other read-only fields (硬设定、人物状态、剧情位置) in a simpler summary below.

---

## Task 3: Wire Post-Import Navigation to Storyboard Preparation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/ContinuationImportView.tsx`
- Modify: `src/components/EditorView.tsx`

**Goal:** After importing and approving a pack, land in the editor with production panel open and `userIntent` pre-filled from `continuationTask`.

### Step 1: Extend `ContinuationEditorLaunchState`

Add optional `prefillIntent` field in `src/types.ts` (line ~555):

```ts
export interface ContinuationEditorLaunchState {
  approvedPackId: string;
  launchToken: number;
  shouldOpenProductionPanel: true;
  prefillIntent?: string;
  source: 'continuation-import' | 'world-overview';
}
```

### Step 2: Update `ContinuationImportView` to pass intent

In the submit handler where `onEnterEditor(novel, approvedPackId)` is called, also pass the pack's `continuationTask` as prefill intent. This requires changing the `onEnterEditor` callback signature:

Update `ContinuationImportViewProps`:
```ts
interface ContinuationImportViewProps {
  onBack: () => void;
  onEnterEditor: (novel: Novel, approvedPackId: string, prefillIntent?: string) => void;
}
```

In the submit handler (where `onEnterEditor` is called), pass:
```ts
onEnterEditor(novel, approvedPackId, parsedState?.pack.continuationTask || undefined);
```

### Step 3: Update `App.tsx` to propagate `prefillIntent`

Update `navigateToEditorWithContinuation` to accept and pass `prefillIntent`:

```ts
const navigateToEditorWithContinuation = (
  novel: Novel,
  approvedPackId: string,
  source: ContinuationEditorLaunchState['source'],
  prefillIntent?: string,
) => {
  setContinuationLaunchState({
    approvedPackId,
    launchToken: Date.now(),
    shouldOpenProductionPanel: true,
    prefillIntent,
    source,
  });
  setSelectedNovel(novel);
  setWorkspaceFocus('editor');
  setCurrentView('editor');
};
```

Update the call sites in `ContinuationImportView` rendering to pass through `prefillIntent`.

### Step 4: EditorView consumes `prefillIntent` and auto-creates chapter

In `EditorView.tsx`, in the existing `useEffect` that handles `launchState` (around line 281-316), add logic to:

1. Pre-fill `userIntent` from `launchState.prefillIntent`
2. If no `currentChapter` exists, auto-create a chapter

```ts
// Inside the useEffect that watches launchState?.launchToken:
useEffect(() => {
  if (!launchState?.approvedPackId || hasConsumedContinuationLaunchUiRef.current) return;
  hasConsumedContinuationLaunchUiRef.current = true;
  setIsAgentSidebarOpen(true);
  setAgentTab('production');

  // Pre-fill creation intent from continuation task
  if (launchState.prefillIntent) {
    setUserIntent(launchState.prefillIntent);
  }

  // Auto-create first chapter if none exists
  if (chapters.length === 0) {
    createChapter({
      novelId: novel.id,
      title: '第一章',
      content: '',
      order: 0,
    }).then((newChapter) => {
      setCurrentChapter(newChapter);
      refreshChapters();
    });
  }
}, [launchState?.approvedPackId, launchState?.launchToken]);
```

---

## Task 4: Improve Production Panel Empty States and Chapter Bootstrap

**Files:**
- Modify: `src/components/AgentWorkspaceProductionPanel.tsx`

**Goal:** When no chapter exists, show a clear "创建下一章" button instead of just disabling the storyboard button.

### Step 1: Add chapter creation callback

Add a new prop `onCreateChapter` to `AgentWorkspaceProductionPanelProps`:

```ts
interface AgentWorkspaceProductionPanelProps {
  // ... existing props
  onCreateChapter?: () => Promise<void>;
}
```

### Step 2: Update the `planning` tab rendering

When `!currentChapter`, instead of just showing a disabled button, show a clear CTA:

```tsx
{agentTab === 'planning' && (
  <div className="space-y-6">
    {/* Creation intent textarea - always shown */}
    <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
      <h3 className="text-xs font-bold text-theme-text mb-2 flex items-center gap-2">
        <ListOrdered size={14} className="text-theme-accent" />
        创作意图
      </h3>
      <textarea
        data-prompt-surface={PLANNING_PROMPT_SURFACE}
        value={userIntent}
        onChange={(e) => setUserIntent(e.target.value)}
        placeholder="描述这一章你想写什么，比如：主角在酒馆偶遇了女二..."
        className="w-full h-24 bg-white border border-theme-border rounded-xl p-3 text-sm text-theme-text placeholder:text-theme-muted/60 resize-none shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
      />

      {!currentChapter ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-theme-muted">
            当前还没有章节上下文。创建第一章后即可开始生成分镜。
          </p>
          <button
            onClick={onCreateChapter}
            className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2"
          >
            <Plus size={16} /> 创建第一章并开始分镜
          </button>
        </div>
      ) : (
        <button
          onClick={onGenerateBeats}
          disabled={isGeneratingBeats}
          className="w-full mt-3 py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {isGeneratingBeats ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {isGeneratingBeats ? '规划中...' : '生成场景分镜'}
        </button>
      )}
    </div>
    {/* ... rest of planning panel */}
  </div>
)}
```

Import `Plus` icon at the top of the file.

### Step 3: Wire `onCreateChapter` in `EditorView.tsx`

Pass `onCreateChapter` from `EditorView` to `AgentWorkspaceProductionPanel`. The handler:

```ts
const handleCreateChapter = async () => {
  const newChapter = await createChapter({
    novelId: novel.id,
    title: `第 ${chapters.length + 1} 章`,
    content: '',
    order: chapters.length,
  });
  setCurrentChapter(newChapter);
  refreshChapters();
};
```

---

## Task 5: Update Overview Panel and WorldBibleView CTAs

**Files:**
- Modify: `src/components/ContinuationOverviewPanel.tsx`
- Modify: `src/components/WorldBibleView.tsx`

**Goal:** Give clear CTAs: "编辑续写任务", "进入分镜准备", "查看设定沉淀".

### Step 1: Add CTA buttons in `ContinuationOverviewPanel`

Read the current file to understand its structure, then add action buttons when a pack exists:

```tsx
{primaryPack && (
  <div className="flex gap-2 mt-3">
    <button
      onClick={() => onOpenPackManagement?.()}
      className="px-3 py-1.5 rounded-lg bg-theme-sidebar text-theme-text text-[10px] font-bold border border-theme-border hover:bg-theme-border/50"
    >
      编辑续写任务
    </button>
    <button
      onClick={() => onStartStoryboard?.(primaryPack.id)}
      className="px-3 py-1.5 rounded-lg bg-theme-accent text-white text-[10px] font-bold"
    >
      进入分镜准备
    </button>
  </div>
)}
```

### Step 2: Update WorldBibleView continuation section

Ensure the continuation section in WorldBibleView includes:
- "进入分镜准备" button that calls `onStartContinuationWriting`
- Brief explanation of what the pack does vs what storyboard does

---

## Task 6: Update Production Panel Summary to Show Active Pack

**Files:**
- Modify: `src/components/AgentWorkspaceProductionPanel.tsx`

**Goal:** In the `production` (自动生产) tab, show which pack is being used, its status, and continuation task.

### Step 1: Find the active pack from props

The production panel already receives `continuationPacks`, `approvedContinuationPacks`, and `selectedContinuationPackId`. Add a derived active pack:

```ts
const activeContinuationPack = continuationPacks.find(p => p.id === selectedContinuationPackId) || null;
```

### Step 2: Add pack context summary to the production tab

Before the production intent textarea, show:

```tsx
{activeContinuationPack && (
  <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 p-3 text-xs space-y-1">
    <div className="flex items-center gap-2">
      <span className="font-bold text-theme-text">当前资料包：</span>
      <span className="text-theme-muted">{activeContinuationPack.title}</span>
      <span className={cn(
        'px-1.5 py-0.5 rounded text-[9px] font-bold',
        activeContinuationPack.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
      )}>
        {activeContinuationPack.status === 'approved' ? '已确认' : '待审核'}
      </span>
    </div>
    {activeContinuationPack.continuationTask && (
      <div className="text-theme-muted">
        <span className="font-bold text-theme-text">续写任务：</span>
        {activeContinuationPack.continuationTask}
      </div>
    )}
    {activeContinuationPack.plotState.immediateConflict && (
      <div className="text-theme-muted">
        <span className="font-bold text-theme-text">即时冲突：</span>
        {activeContinuationPack.plotState.immediateConflict}
      </div>
    )}
  </div>
)}
```

For the empty state when no pack exists, ensure only two states:
- No pack at all: "尚未导入资料包，请先导入资料。"
- Has pack but no chapter: "已有资料包，但需要先创建章节上下文。"

---

## Task 7: Add Knowledge Panel Source Badge

**Files:**
- Modify: `src/components/AgentWorkspaceKnowledgePanel.tsx`
- Modify: `src/lib/agent-workspace-knowledge.ts`

**Goal:** Knowledge items derived from continuation packs show a source badge.

### Step 1: Read `agent-workspace-knowledge.ts`

Understand how `buildKnowledgeSearchEntries` works, then add source attribution to entries that come from continuation packs.

### Step 2: Add badge component

Use existing `SourceBadge.tsx` component (or inline a simple badge) to mark entries with their pack origin.

---

## Task 8: Regression Tests

**Files:**
- Modify: `tests/continuation-overview.test.ts`
- Create: `tests/continuation-pack-selection.test.ts` (already covered in Task 1 Step 3)
- Modify: `tests/continuation-import-flow.test.ts`

### Step 1: Run existing tests

```bash
node --test tests/continuation-pack-selection.test.ts
node --test tests/continuation-overview.test.ts
node --test tests/continuation-import-flow.test.ts
```

### Step 2: Verify no regressions in other continuation tests

```bash
node --test tests/continuation-pack.test.ts
node --test tests/continuation-pack-parse.test.ts
node --test tests/continuation-pack-prompt-contract.test.ts
node --test tests/db-continuation-pack.test.ts
```

---

## Execution Order

1. **Task 1** — Fix shared selector + overview priority (foundation)
2. **Task 2** — Add `continuationTask` editing (depends on Task 1 for correct pack display)
3. **Task 3** — Wire post-import navigation with prefill (depends on Task 2 for task content)
4. **Task 4** — Production panel chapter bootstrap + empty states (depends on Task 3)
5. **Task 5** — Overview/WorldBible CTAs (depends on Tasks 1-3)
6. **Task 6** — Production panel pack summary (depends on Task 1)
7. **Task 7** — Knowledge panel source badge (independent, can run in parallel with 4-6)

## Verification Checklist

- [ ] `getPreferredContinuationPackId` prefers approved over draft
- [ ] `buildContinuationOverviewState` returns `ready` when approved pack exists
- [ ] `continuationTask` is editable in pack detail and persists to DB
- [ ] Import → approve → lands in editor with production panel open
- [ ] `userIntent` is pre-filled from `continuationTask` after import
- [ ] If no chapters exist after import, "创建第一章并开始分镜" button appears
- [ ] Clicking "创建第一章" creates chapter and enables storyboard generation
- [ ] Production panel shows which pack is active and its continuation task
- [ ] Empty states are consistent: "无资料包" vs "有包无章节" are distinct
- [ ] Knowledge panel shows source attribution for pack-derived items
- [ ] All existing continuation tests pass
