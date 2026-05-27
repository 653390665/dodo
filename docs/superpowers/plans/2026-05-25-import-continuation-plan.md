# Import Continuation Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a homepage-level `导入资料续写` entry that guides users through upload, AI parsing, confirmation, and direct handoff into the editor's production panel using the approved continuation pack.

**Architecture:** Keep the existing continuation-pack parser, approval API, and editor production flow. Add one new top-level view for the import task, keep the old world-bible continuation screen as the management entry, and drive the new flow through a dedicated task-oriented component plus a small pure helper module for target-novel resolution and approval gating.

**Tech Stack:** React 19, TypeScript 5.8, existing local DB transport clients, node:test, Vite app shell, existing editor/production UI.

---

## File Structure

- Create: `src/lib/continuation-import-flow.ts`
  - Pure helpers for target novel mode, default novel title, and approval gating.
- Create: `src/components/ContinuationImportView.tsx`
  - New homepage-level task flow with `upload -> confirm` stages.
- Create: `tests/continuation-import-flow.test.ts`
  - Small regression tests for the new pure helpers.
- Modify: `src/types.ts`
  - Add the new top-level view and import-flow types.
- Modify: `src/App.tsx`
  - Add the new view, launch/exit handlers, and editor handoff state.
- Modify: `src/components/WelcomeView.tsx`
  - Add the new homepage CTA and callback prop.
- Modify: `src/components/EditorView.tsx`
  - Accept a continuation import launch hint and auto-open the production panel with the approved pack selected.

## Assumptions

- Reusing `parseContinuationPack`, `updateContinuationPack`, `listNovels`, and `createNovel` is sufficient; no new server endpoint is needed.
- The new entry only needs to exist on the welcome/homepage in this phase; `Library` can stay unchanged.
- “确认并进入续写” should approve the pack, then navigate to the editor for the selected or newly created novel.
- The existing editor pack-selection logic remains authoritative; the new flow only seeds the preferred pack and opens the right panel.

### Task 1: Add Typed Flow State And Pure Helpers

**Files:**
- Create: `src/lib/continuation-import-flow.ts`
- Modify: `src/types.ts`
- Test: `tests/continuation-import-flow.test.ts`

- [ ] **Step 1: Extend shared types for the new homepage task flow**

Add the new `ViewType` member and import-flow types in `src/types.ts` near the existing view definitions:

```ts
export type ViewType =
  | 'welcome'
  | 'library'
  | 'editor'
  | 'world'
  | 'workspace'
  | 'ai'
  | 'skills'
  | 'factory'
  | 'continuation-import';

export type ContinuationImportTargetMode = 'existing' | 'new';

export interface ContinuationImportLaunchState {
  approvedPackId: string;
  shouldOpenProductionPanel: true;
  source: 'continuation-import';
}
```

- [ ] **Step 2: Write the failing test for target-mode defaults and approval gating**

Create `tests/continuation-import-flow.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImportedNovelDraft,
  canApproveContinuationImportPack,
  resolveContinuationImportTargetMode,
} from '../src/lib/continuation-import-flow';
import type { ContinuationPack, Novel } from '../src/types';

function buildPack(overrides: Partial<ContinuationPack> = {}): ContinuationPack {
  return {
    id: 'pack-1',
    novelId: 'novel-1',
    title: '城隍庙续写资料包',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [{ id: 'f1', priority: 'hard', category: 'world', text: '供桌下有机关', evidence: 'doc' }],
    characterStates: [],
    plotState: {
      currentTimeline: '第一卷中段',
      latestScene: '林砚被追兵逼入城隍庙',
      unresolvedHooks: [],
      immediateConflict: '追兵逼近',
      nextLikelyMove: '寻找机关',
    },
    styleProfile: {
      pov: '第三人称',
      tense: '过去时',
      pacing: '紧推进',
      dialogueDensity: '中等',
      proseTraits: [],
      avoidTraits: [],
      sampleEvidence: '',
    },
    contradictions: [],
    continuationTask: '继续写机关与暗道',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test('resolveContinuationImportTargetMode prefers existing novels when available', () => {
  const novels = [{ id: 'n1', title: '旧书' }] as Novel[];
  assert.equal(resolveContinuationImportTargetMode(novels), 'existing');
  assert.equal(resolveContinuationImportTargetMode([]), 'new');
});

test('buildImportedNovelDraft derives a practical default title', () => {
  assert.equal(buildImportedNovelDraft('城隍庙续写资料包').title, '城隍庙续写');
  assert.equal(buildImportedNovelDraft('').title, '导入续写作品');
});

test('canApproveContinuationImportPack rejects contradiction-heavy packs', () => {
  assert.equal(canApproveContinuationImportPack(buildPack()), true);
  assert.equal(
    canApproveContinuationImportPack(
      buildPack({
        contradictions: [{ id: 'c1', severity: 'high', summary: '时间线冲突', conflictingEvidence: ['a', 'b'], suggestedResolution: '修正' }],
      }),
    ),
    false,
  );
});
```

- [ ] **Step 3: Run the new test to verify it fails**

Run:

```bash
node --import tsx --test tests/continuation-import-flow.test.ts
```

Expected: FAIL because `src/lib/continuation-import-flow.ts` and the new exported types do not exist yet.

- [ ] **Step 4: Add the pure helper module**

Create `src/lib/continuation-import-flow.ts`:

```ts
import type { ContinuationImportTargetMode, ContinuationPack, Novel } from '../types';

export function resolveContinuationImportTargetMode(novels: Novel[]): ContinuationImportTargetMode {
  return novels.length > 0 ? 'existing' : 'new';
}

export function buildImportedNovelDraft(packTitle: string): Pick<Novel, 'title' | 'summary'> {
  const normalized = packTitle.replace(/资料包$/u, '').trim();
  return {
    title: normalized || '导入续写作品',
    summary: normalized
      ? `由资料包「${normalized}」导入创建，用于资料驱动续写。`
      : '由资料包导入创建，用于资料驱动续写。',
  };
}

export function canApproveContinuationImportPack(pack: ContinuationPack | null): boolean {
  if (!pack) return false;
  if (pack.canonFacts.length === 0) return false;
  return !pack.contradictions.some((item) => item.severity === 'high');
}
```

- [ ] **Step 5: Run the helper test to verify it passes**

Run:

```bash
node --import tsx --test tests/continuation-import-flow.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the helper slice**

```bash
git add src/types.ts src/lib/continuation-import-flow.ts tests/continuation-import-flow.test.ts
git commit -m "feat: add continuation import flow helpers"
```

### Task 2: Add Homepage Entry And Top-Level View Routing

**Files:**
- Modify: `src/components/WelcomeView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a failing render expectation for the new homepage CTA**

This repository does not have a React test harness yet, so use a manual failing check instead:

Run:

```bash
npm run dev
```

Expected before implementation: the homepage only shows `开始一部新作品`; there is no `导入资料续写` CTA.

- [ ] **Step 2: Add the new callback prop and CTA in `WelcomeView`**

Update the props and add a second primary card below the main intro copy:

```tsx
interface WelcomeViewProps {
  onSelectStoryCard: (card: StoryIdeaCard, planning: StoryPlanningInput) => void;
  onJumpToLibrary: () => void;
  onSelectNovel: (novel: Novel) => void;
  onStartContinuationImport: () => void;
}

export function WelcomeView({
  onSelectStoryCard,
  onJumpToLibrary,
  onSelectNovel,
  onStartContinuationImport,
}: WelcomeViewProps) {
  // ...
  <div className="mt-8 grid gap-4 md:grid-cols-2">
    <button
      onClick={onStartContinuationImport}
      className="rounded-2xl border border-theme-border bg-white p-5 text-left hover:border-theme-accent/40 hover:shadow-sm transition-all"
    >
      <div className="text-sm font-bold text-theme-text">导入资料续写</div>
      <div className="mt-2 text-xs text-theme-muted">
        上传世界观、大纲、任务或已有正文，整理后直接进入续写。
      </div>
    </button>
    <button
      onClick={onJumpToLibrary}
      className="rounded-2xl border border-theme-border bg-theme-sidebar/20 p-5 text-left hover:border-theme-accent/20 transition-all"
    >
      <div className="text-sm font-bold text-theme-text">查看作品库</div>
      <div className="mt-2 text-xs text-theme-muted">继续已有作品，或管理已创建项目。</div>
    </button>
  </div>
```

- [ ] **Step 3: Add top-level routing and launch state in `App.tsx`**

Add import-flow state and a launch handler:

```tsx
const [currentView, setCurrentView] = useState<ViewType>('welcome');
const [continuationImportLaunch, setContinuationImportLaunch] =
  useState<ContinuationImportLaunchState | null>(null);

const handleStartContinuationImport = () => {
  setContinuationImportLaunch(null);
  setCurrentView('continuation-import');
};

const navigateToEditorWithImport = (novel: Novel, approvedPackId: string) => {
  setContinuationImportLaunch({
    approvedPackId,
    shouldOpenProductionPanel: true,
    source: 'continuation-import',
  });
  setSelectedNovel(novel);
  setWorkspaceFocus('editor');
  setCurrentView('editor');
};
```

Wire the new prop into `WelcomeView` and render the new view:

```tsx
{currentView === 'welcome' && (
  <WelcomeView
    onSelectStoryCard={handleSelectStoryCard}
    onJumpToLibrary={() => setCurrentView('library')}
    onSelectNovel={navigateToEditor}
    onStartContinuationImport={handleStartContinuationImport}
  />
)}

{currentView === 'continuation-import' && (
  <ContinuationImportView
    onBack={() => setCurrentView('welcome')}
    onEnterEditor={navigateToEditorWithImport}
  />
)}
```

- [ ] **Step 4: Run typecheck to catch prop and route breakage**

Run:

```bash
npm run lint
```

Expected: FAIL because `ContinuationImportView` is not created yet.

- [ ] **Step 5: Commit the routing slice after the new view exists in Task 3**

```bash
git add src/App.tsx src/components/WelcomeView.tsx
git commit -m "feat: add homepage entry for continuation import"
```

### Task 3: Build The Import And Confirmation View

**Files:**
- Create: `src/components/ContinuationImportView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the view skeleton with upload-first workflow framing**

Create `src/components/ContinuationImportView.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import type { ContinuationPack, Novel } from '../types';
import { listNovels, createNovel } from '../lib/novel-client';
import { parseContinuationPack } from '../lib/prompt-client';
import { updateContinuationPack } from '../lib/continuation-client';
import {
  buildImportedNovelDraft,
  canApproveContinuationImportPack,
  resolveContinuationImportTargetMode,
} from '../lib/continuation-import-flow';

interface ContinuationImportViewProps {
  onBack: () => void;
  onEnterEditor: (novel: Novel, approvedPackId: string) => void;
}

type Stage = 'upload' | 'confirm';

export function ContinuationImportView({ onBack, onEnterEditor }: ContinuationImportViewProps) {
  const [stage, setStage] = useState<Stage>('upload');
  const [novels, setNovels] = useState<Novel[]>([]);
  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('new');
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [newNovelTitle, setNewNovelTitle] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pack, setPack] = useState<ContinuationPack | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listNovels().then((items) => {
      setNovels(items);
      const defaultMode = resolveContinuationImportTargetMode(items);
      setTargetMode(defaultMode);
      if (defaultMode === 'existing' && items[0]) setSelectedNovelId(items[0].id);
    });
  }, []);

  async function fileToBase64(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  // upload and approve handlers filled in next steps
  return <div className="h-full overflow-y-auto px-8 py-10" />;
}
```

- [ ] **Step 2: Implement the upload stage**

Add the upload-stage body:

```tsx
const handleParse = async () => {
  if (files.length === 0) return;
  setIsParsing(true);
  setError('');
  try {
    const targetNovelId =
      targetMode === 'existing' && selectedNovelId
        ? selectedNovelId
        : `continuation-import-${Date.now()}`;
    const documents = await Promise.all(
      files.map(async (file) => ({
        filename: file.name,
        filedata: await fileToBase64(file),
      })),
    );
    const parsed = await parseContinuationPack({
      novelId: targetNovelId,
      title: newNovelTitle.trim() || '导入续写资料包',
      documents,
    });
    if (!newNovelTitle.trim()) {
      setNewNovelTitle(buildImportedNovelDraft(parsed.title).title);
    }
    setPack(parsed);
    setStage('confirm');
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setIsParsing(false);
  }
};
```

Render the upload stage:

```tsx
if (stage === 'upload') {
  return (
    <div className="h-full overflow-y-auto px-8 py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-theme-muted hover:text-theme-text">
          <ArrowLeft size={14} /> 返回首页
        </button>
        <div className="space-y-3">
          <h1 className="text-3xl font-serif font-bold text-theme-text">导入资料续写</h1>
          <p className="text-sm text-theme-muted">
            把世界观、大纲、任务说明、已有正文交给系统，先整理成资料包，再开始续写。
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-4 text-xs">
          {['上传资料', 'AI解析', '人工确认', '进入续写'].map((item, index) => (
            <div key={item} className="rounded-2xl border border-theme-border bg-white px-4 py-3">
              <div className="text-theme-accent font-bold">{index + 1}</div>
              <div className="mt-1 text-theme-text">{item}</div>
            </div>
          ))}
        </div>
        <div className="rounded-3xl border border-theme-border bg-white p-6 space-y-5">
          {/* target mode radios, novel select, new title input, file input, parse button */}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement the confirmation stage**

Add the approval handler:

```tsx
const handleApproveAndEnter = async () => {
  if (!pack) return;
  setIsApproving(true);
  setError('');
  try {
    let targetNovel = novels.find((item) => item.id === selectedNovelId) || null;
    if (targetMode === 'new' || !targetNovel) {
      const now = Date.now();
      const draft = buildImportedNovelDraft(newNovelTitle || pack.title);
      targetNovel = {
        id: `novel-${now}`,
        title: newNovelTitle.trim() || draft.title,
        authorId: 'local-user',
        summary: draft.summary,
        status: 'ongoing',
        createdAt: now,
        updatedAt: now,
      } as Novel;
      await createNovel(targetNovel);
    }
    await updateContinuationPack(pack.id, { status: 'approved', novelId: targetNovel.id, updatedAt: Date.now() });
    onEnterEditor(targetNovel, pack.id);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setIsApproving(false);
  }
};
```

Render the confirmation stage:

```tsx
return (
  <div className="h-full overflow-y-auto px-8 py-10">
    <div className="mx-auto max-w-4xl space-y-6">
      <button onClick={() => setStage('upload')} className="inline-flex items-center gap-2 text-sm text-theme-muted hover:text-theme-text">
        <ArrowLeft size={14} /> 返回调整资料
      </button>
      <div className="rounded-3xl border border-theme-border bg-white p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-theme-text">{pack?.title}</div>
            <div className="mt-1 text-xs text-theme-muted">先确认系统理解结果，再进入续写。</div>
          </div>
          <button
            onClick={handleApproveAndEnter}
            disabled={!canApproveContinuationImportPack(pack) || isApproving}
            className="inline-flex items-center gap-2 rounded-xl bg-theme-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {isApproving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            确认并进入续写
          </button>
        </div>
        {/* render task, plot anchor, canon facts, character states, gaps/risks */}
      </div>
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
    </div>
  </div>
);
```

- [ ] **Step 4: Run typecheck to verify the new view compiles**

Run:

```bash
npm run lint
```

Expected: PASS or reveal missing imports/property mismatches that must be fixed before moving on.

- [ ] **Step 5: Commit the import-flow UI**

```bash
git add src/components/ContinuationImportView.tsx src/App.tsx
git commit -m "feat: add continuation import flow view"
```

### Task 4: Connect Editor Handoff And Visible Production Mode

**Files:**
- Modify: `src/components/EditorView.tsx`
- Test: `tests/continuation-pack-selection.test.ts`

- [ ] **Step 1: Add a failing regression test for preferred pack handoff**

Extend `tests/continuation-pack-selection.test.ts` with:

```ts
test('getPreferredContinuationPackId honors an explicitly passed approved pack id', () => {
  const packs = [buildPack('pack-old', 100), buildPack('pack-new', 200)];
  assert.equal(getPreferredContinuationPackId(packs, 'pack-old'), 'pack-old');
});
```

Run:

```bash
node --import tsx --test tests/continuation-pack-selection.test.ts
```

Expected: PASS already. This locks the selection behavior before wiring the new launch state.

- [ ] **Step 2: Update `EditorView` props and launch-state effect**

Add the launch hint prop:

```tsx
interface EditorViewProps {
  novel: Novel;
  onBack: () => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
  launchState?: ContinuationImportLaunchState | null;
}

export function EditorView({ novel, onBack, onOpenAssistant, launchState }: EditorViewProps) {
  // ...
}
```

Add an effect after approved packs are loaded:

```tsx
useEffect(() => {
  if (!launchState || launchState.source !== 'continuation-import') return;
  setSelectedContinuationPackId((current) =>
    current === launchState.approvedPackId ? current : launchState.approvedPackId,
  );
  setAgentTab('production');
  setIsAgentSidebarOpen(true);
}, [launchState?.approvedPackId, launchState?.source]);
```

Pass the prop from `App.tsx`:

```tsx
<EditorView
  novel={selectedNovel}
  onBack={...}
  onOpenAssistant={handleOpenAssistant}
  launchState={continuationImportLaunch}
/>
```

- [ ] **Step 3: Add lightweight mode copy in the production panel entry point**

Without restructuring the whole production panel, add one visible status strip in `EditorView` above `AgentWorkspace` when launched from the import flow:

```tsx
{continuationImportLaunch?.source === 'continuation-import' && (
  <div className="rounded-2xl border border-theme-accent/20 bg-theme-accent/5 px-4 py-3 text-xs text-theme-text">
    当前模式：资料包续写 · 已接入资料包将在自动生产中默认选中
  </div>
)}
```

Keep this copy small; the stronger summary card already exists in `AgentWorkspaceProductionPanel.tsx`.

- [ ] **Step 4: Run targeted regression tests and typecheck**

Run:

```bash
node --import tsx --test tests/continuation-import-flow.test.ts tests/continuation-pack-selection.test.ts
npm run lint
```

Expected: PASS

- [ ] **Step 5: Manual smoke in the in-app browser**

Run the app and verify:

```bash
npm run dev
```

Manual checklist:

1. Homepage shows `导入资料续写`.
2. Click the CTA and confirm the first screen shows the four-step explanation before upload.
3. Upload sample docs and parse into a pack.
4. Confirmation page shows task-oriented sections, not the old management list.
5. Click `确认并进入续写`.
6. Editor opens with the agent sidebar visible, tab on `自动生产`, and the approved pack selected.

- [ ] **Step 6: Commit the editor handoff slice**

```bash
git add src/App.tsx src/components/EditorView.tsx tests/continuation-pack-selection.test.ts
git commit -m "feat: hand off continuation import into editor production"
```

## Self-Review

### Spec Coverage

- Homepage first-class entry: covered by Task 2.
- Flow explanation before upload: covered by Task 3 upload stage.
- Lightweight confirmation page: covered by Task 3 confirm stage.
- Reuse existing parse/approve/editor pipeline: covered by Tasks 1, 3, and 4.
- Direct handoff into editor production with approved pack selected: covered by Task 4.
- Old world-bible continuation page remains the management entry: preserved by omission; no task deletes or rewires it.

### Placeholder Scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Manual verification is spelled out where automated coverage does not exist yet.

### Type Consistency

- `ContinuationImportLaunchState`, `ContinuationImportTargetMode`, and `ViewType` additions are defined in Task 1 before later tasks consume them.
- `ContinuationImportView` uses `parseContinuationPack`, `updateContinuationPack`, `createNovel`, and `listNovels` that already exist in the current codebase.

