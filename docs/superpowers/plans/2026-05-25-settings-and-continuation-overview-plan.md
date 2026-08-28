# Settings And Continuation Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current `世界设定集` area into a task-oriented `设定与续写` surface with a default overview tab, pack-state-driven actions, and one-click handoff into the editor production panel.

**Architecture:** Keep the existing continuation-pack parsing, approval, and editor production APIs. Add one small pure helper for overview state derivation, one focused overview component for the new first screen, then rewire `WorldBibleView` tab order and launch callbacks so the page becomes state-first instead of form-first.

**Tech Stack:** React 19, TypeScript 5.8, existing local DB clients, node:test, Vite app shell, current editor/production flow.

---

## File Structure

- Create: `src/lib/continuation-overview.ts`
  - Pure logic for deciding whether the overview is in `empty`, `draft`, `ready`, or `risk` state.
- Create: `src/components/ContinuationOverviewPanel.tsx`
  - The new first-screen overview UI with status, task summary, risk summary, and action buttons.
- Create: `tests/continuation-overview.test.ts`
  - Regression coverage for state-priority logic.
- Modify: `src/types.ts`
  - Add overview-state types and an editor launch hint for starting production from the world side.
- Modify: `src/components/ContinuationPackView.tsx`
  - Rename surface copy from `资料续写` to `资料包管理` and expose the active-pack selection more clearly.
- Modify: `src/components/WorldBibleView.tsx`
  - Rename header copy to `设定与续写`, change tab order, default to `overview`, and mount the new overview panel plus the moved pack-management tab.
- Modify: `src/components/SplitWorkspace.tsx`
  - Pass a world-side “start continuation writing” callback into `WorldBibleView` and forward editor launch state into the embedded editor.
- Modify: `src/components/EditorView.tsx`
  - Accept a new launch hint when production should open from the world side while already inside split workspace.
- Modify: `src/App.tsx`
  - Hold a reusable continuation launch hint and pass it to both standalone editor and split workspace.
- Test/verify manually: `http://localhost:3000/` or local dev URL after `npm run dev`

## Assumptions

- The existing `ContinuationPack` model is sufficient; the overview state is derived at runtime rather than persisted.
- “左侧导航页” refers to the internal left tab rail in `WorldBibleView`, not the global app sidebar.
- The new overview page should prefer the newest `draft` pack over older `approved` packs, matching the approved spec.
- When the user is already inside split workspace, “开始按资料续写” should move focus to the editor and open the production panel without forcing a full route change.

### Task 1: Add Pure Overview-State Logic

**Files:**
- Create: `src/lib/continuation-overview.ts`
- Modify: `src/types.ts`
- Test: `tests/continuation-overview.test.ts`

- [ ] **Step 1: Extend shared types for overview state and launch hints**

Update `src/types.ts` near the existing continuation-pack types:

```ts
export type ContinuationOverviewStateKind = 'empty' | 'draft' | 'ready' | 'risk';

export interface ContinuationOverviewState {
  kind: ContinuationOverviewStateKind;
  primaryPack: ContinuationPack | null;
  draftPack: ContinuationPack | null;
  approvedPack: ContinuationPack | null;
  contradictionCount: number;
  readingQuestionCount: number;
  continuationGapCount: number;
  highlightWarnings: string[];
}

export interface ContinuationEditorLaunchState {
  approvedPackId: string;
  shouldOpenProductionPanel: true;
  source: 'continuation-import' | 'world-overview';
}
```

- [ ] **Step 2: Write failing tests for state priority**

Create `tests/continuation-overview.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildContinuationOverviewState } from '../src/lib/continuation-overview';
import type { ContinuationPack } from '../src/types';

function buildPack(overrides: Partial<ContinuationPack> = {}): ContinuationPack {
  return {
    id: 'pack-1',
    novelId: 'novel-1',
    title: '城隍庙资料包',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [{ id: 'fact-1', priority: 'hard', category: 'world', text: '供桌下有机关', evidence: 'doc' }],
    characterStates: [],
    plotState: {
      currentTimeline: '第一卷中段',
      latestScene: '林砚被追兵逼入城隍庙',
      unresolvedHooks: [],
      immediateConflict: '追兵逼近',
      nextLikelyMove: '掀开供桌寻找机关',
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
    continuationTask: '继续写城隍庙机关与暗道',
    sourceMap: { sections: [], keyConflicts: [] },
    readingQuestions: [],
    continuationGaps: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

test('overview prefers draft pack over approved packs', () => {
  const draftPack = buildPack({ id: 'draft-1', status: 'draft', updatedAt: 30 });
  const approvedPack = buildPack({ id: 'approved-1', status: 'approved', updatedAt: 20 });
  const state = buildContinuationOverviewState([approvedPack, draftPack]);

  assert.equal(state.kind, 'draft');
  assert.equal(state.primaryPack?.id, 'draft-1');
  assert.equal(state.draftPack?.id, 'draft-1');
  assert.equal(state.approvedPack?.id, 'approved-1');
});

test('overview falls back to ready when newest approved pack has no high risk', () => {
  const pack = buildPack({ id: 'approved-1', status: 'approved', updatedAt: 50 });
  const state = buildContinuationOverviewState([pack]);

  assert.equal(state.kind, 'ready');
  assert.equal(state.primaryPack?.id, 'approved-1');
});

test('overview enters risk state for approved pack with severe contradictions', () => {
  const pack = buildPack({
    id: 'approved-risk',
    status: 'approved',
    contradictions: [
      { id: 'c-1', severity: 'high', summary: '时间线冲突', conflictingEvidence: ['A', 'B'], suggestedResolution: '先人工确认' },
    ],
    continuationGaps: [{ id: 'g-1', description: '暗道终点未定', severity: 'high', suggestedDirection: '先定废井或旧仓库', relatedFacts: [] }],
  });
  const state = buildContinuationOverviewState([pack]);

  assert.equal(state.kind, 'risk');
  assert.equal(state.highlightWarnings[0], '时间线冲突');
});

test('overview is empty when there are no packs', () => {
  const state = buildContinuationOverviewState([]);
  assert.equal(state.kind, 'empty');
  assert.equal(state.primaryPack, null);
});
```

- [ ] **Step 3: Run the new test and verify it fails**

Run:

```bash
node --import tsx --test tests/continuation-overview.test.ts
```

Expected: FAIL because the helper and new exported types do not exist yet.

- [ ] **Step 4: Add the pure helper implementation**

Create `src/lib/continuation-overview.ts`:

```ts
import type { ContinuationOverviewState, ContinuationPack } from '../types';

function sortByRecency(packs: ContinuationPack[]): ContinuationPack[] {
  return [...packs].sort((a, b) => b.updatedAt - a.updatedAt);
}

function hasHighRisk(pack: ContinuationPack | null): boolean {
  if (!pack) return false;
  return pack.contradictions.some((item) => item.severity === 'high');
}

function buildWarnings(pack: ContinuationPack | null): string[] {
  if (!pack) return [];
  const contradictionWarnings = pack.contradictions.slice(0, 1).map((item) => item.summary);
  const gapWarnings = (pack.continuationGaps || []).slice(0, 1).map((item) => item.description);
  return [...contradictionWarnings, ...gapWarnings].filter(Boolean).slice(0, 2);
}

export function buildContinuationOverviewState(packs: ContinuationPack[]): ContinuationOverviewState {
  const draftPack = sortByRecency(packs.filter((pack) => pack.status === 'draft'))[0] || null;
  const approvedPack = sortByRecency(packs.filter((pack) => pack.status === 'approved'))[0] || null;

  if (draftPack) {
    return {
      kind: 'draft',
      primaryPack: draftPack,
      draftPack,
      approvedPack,
      contradictionCount: draftPack.contradictions.length,
      readingQuestionCount: draftPack.readingQuestions?.length || 0,
      continuationGapCount: draftPack.continuationGaps?.length || 0,
      highlightWarnings: buildWarnings(draftPack),
    };
  }

  if (approvedPack) {
    const kind = hasHighRisk(approvedPack) ? 'risk' : 'ready';
    return {
      kind,
      primaryPack: approvedPack,
      draftPack: null,
      approvedPack,
      contradictionCount: approvedPack.contradictions.length,
      readingQuestionCount: approvedPack.readingQuestions?.length || 0,
      continuationGapCount: approvedPack.continuationGaps?.length || 0,
      highlightWarnings: buildWarnings(approvedPack),
    };
  }

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
```

- [ ] **Step 5: Run the helper test again**

Run:

```bash
node --import tsx --test tests/continuation-overview.test.ts
```

Expected: PASS

### Task 2: Build The Overview UI Surface

**Files:**
- Create: `src/components/ContinuationOverviewPanel.tsx`
- Modify: `src/components/ContinuationPackView.tsx`

- [ ] **Step 1: Add a manual failing check for the missing overview screen**

Run:

```bash
npm run dev
```

Expected before implementation: opening `设定` side still lands on `全局设定` or `资料续写`; there is no dedicated `总览` screen with state-driven primary actions.

- [ ] **Step 2: Create the overview component**

Create `src/components/ContinuationOverviewPanel.tsx`:

```tsx
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import FileWarning from 'lucide-react/dist/esm/icons/file-warning.js';
import Upload from 'lucide-react/dist/esm/icons/upload.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import type { ContinuationOverviewState } from '../types';

interface ContinuationOverviewPanelProps {
  state: ContinuationOverviewState;
  onImport: () => void;
  onReviewDraft: (packId: string) => void;
  onOpenPackManagement: () => void;
  onStartWriting: (packId: string) => void;
  onOpenWorldSetup: () => void;
}

export function ContinuationOverviewPanel({
  state,
  onImport,
  onReviewDraft,
  onOpenPackManagement,
  onStartWriting,
  onOpenWorldSetup,
}: ContinuationOverviewPanelProps) {
  const primaryPack = state.primaryPack;
  const statusLabel =
    state.kind === 'empty'
      ? '未接入资料包'
      : state.kind === 'draft'
        ? '已解析，待审核'
        : state.kind === 'risk'
          ? '可续写，但有风险'
          : '已接入资料包';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <section className="rounded-3xl border border-theme-border bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold text-theme-muted">资料续写总览</div>
            <h2 className="mt-2 text-2xl font-serif font-bold text-theme-text">{statusLabel}</h2>
            <p className="mt-2 text-sm text-theme-muted">
              {state.kind === 'empty'
                ? '还没有可用于续写的资料，请先导入世界观、大纲、任务或已有正文。'
                : `当前资料包：${primaryPack?.title || '未接入'}。本次自动生产将默认使用该资料包。`}
            </p>
          </div>
          {primaryPack && (
            <div className="rounded-full border border-theme-border bg-theme-sidebar/20 px-3 py-1 text-xs text-theme-muted">
              更新于 {new Date(primaryPack.updatedAt).toLocaleString('zh-CN')}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-theme-muted">本次续写任务</div>
          <div className="mt-3 text-sm font-bold text-theme-text">
            {primaryPack?.continuationTask || '还没有续写任务摘要'}
          </div>
          <div className="mt-4 space-y-3 text-xs text-theme-muted">
            <div>
              <div className="font-bold text-theme-text">当前剧情锚点</div>
              <div className="mt-1">{primaryPack?.plotState.latestScene || '暂无'}</div>
            </div>
            <div>
              <div className="font-bold text-theme-text">即时冲突</div>
              <div className="mt-1">{primaryPack?.plotState.immediateConflict || '暂无'}</div>
            </div>
            <div>
              <div className="font-bold text-theme-text">下一步建议</div>
              <div className="mt-1">{primaryPack?.plotState.nextLikelyMove || '暂无'}</div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
          <div className="text-xs font-bold text-theme-muted">风险与缺口</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-theme-border px-2.5 py-1">冲突 {state.contradictionCount}</span>
            <span className="rounded-full border border-theme-border px-2.5 py-1">审读问题 {state.readingQuestionCount}</span>
            <span className="rounded-full border border-theme-border px-2.5 py-1">续写缺口 {state.continuationGapCount}</span>
          </div>
          <div className="mt-4 space-y-2">
            {state.highlightWarnings.length > 0 ? (
              state.highlightWarnings.map((warning) => (
                <div key={warning} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {warning}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-theme-border bg-theme-sidebar/15 px-3 py-2 text-xs text-theme-muted">
                当前没有需要优先处理的风险提示。
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-theme-border bg-white p-5 shadow-sm">
        <div className="text-xs font-bold text-theme-muted">下一步动作</div>
        <div className="mt-4 flex flex-wrap gap-3">
          {state.kind === 'empty' && (
            <>
              <button onClick={onImport} className="rounded-xl bg-theme-text px-4 py-2 text-sm font-bold text-white flex items-center gap-2">
                <Upload size={14} /> 导入资料
              </button>
              <button onClick={onOpenWorldSetup} className="rounded-xl border border-theme-border px-4 py-2 text-sm font-bold text-theme-text">
                查看世界设定
              </button>
            </>
          )}

          {state.kind === 'draft' && state.draftPack && (
            <>
              <button onClick={() => onReviewDraft(state.draftPack!.id)} className="rounded-xl bg-theme-text px-4 py-2 text-sm font-bold text-white flex items-center gap-2">
                <CheckCircle2 size={14} /> 审核资料包
              </button>
              <button onClick={onImport} className="rounded-xl border border-theme-border px-4 py-2 text-sm font-bold text-theme-text">
                重新导入资料
              </button>
            </>
          )}

          {state.kind === 'ready' && state.approvedPack && (
            <>
              <button onClick={() => onStartWriting(state.approvedPack!.id)} className="rounded-xl bg-theme-text px-4 py-2 text-sm font-bold text-white flex items-center gap-2">
                <ArrowRight size={14} /> 开始按资料续写
              </button>
              <button onClick={onOpenPackManagement} className="rounded-xl border border-theme-border px-4 py-2 text-sm font-bold text-theme-text">
                更换资料包
              </button>
            </>
          )}

          {state.kind === 'risk' && state.approvedPack && (
            <>
              <button onClick={onOpenPackManagement} className="rounded-xl bg-theme-text px-4 py-2 text-sm font-bold text-white flex items-center gap-2">
                <FileWarning size={14} /> 先处理风险
              </button>
              <button onClick={() => onStartWriting(state.approvedPack!.id)} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 flex items-center gap-2">
                <AlertTriangle size={14} /> 仍然开始续写
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Rename the pack-management surface copy**

Update the header copy in `src/components/ContinuationPackView.tsx`:

```tsx
<h1 className="text-2xl font-serif font-bold text-theme-text">资料包管理</h1>
<p className="text-sm text-theme-muted mt-1">
  上传世界观、大纲、人物设定、已有正文等资料，整理、审核并切换用于续写的资料包。
</p>
```

Also update the empty-state copy at the bottom:

```tsx
{packs.length === 0 && <div className="text-xs text-theme-muted">暂无资料包，先上传文件并解析，再回来审核或启用。</div>}
```

- [ ] **Step 4: Verify the new component type-checks**

Run:

```bash
npm run lint -- --pretty false
```

Expected: PASS or unrelated pre-existing errors only. If new errors mention `ContinuationOverviewPanel`, fix them before continuing.

### Task 3: Rewire WorldBible Tabs Into “设定与续写”

**Files:**
- Modify: `src/components/WorldBibleView.tsx`

- [ ] **Step 1: Add a manual failing check for the current default tab**

Run the app and open a novel’s world side.

Expected before implementation: the left tab rail starts from `全局设定`, the page title still says `世界设定集 (World Bible)`, and there is no `总览` tab.

- [ ] **Step 2: Extend the component props and tab state**

Change the component signature and default tab in `src/components/WorldBibleView.tsx`:

```tsx
import { buildContinuationOverviewState } from '../lib/continuation-overview';
import { listContinuationPacks } from '../lib/continuation-client';
import { ContinuationOverviewPanel } from './ContinuationOverviewPanel';

export function WorldBibleView({
  novel,
  onboarding,
  onStartContinuationWriting,
}: {
  novel: Novel;
  onboarding?: { /* keep existing shape */ };
  onStartContinuationWriting?: (approvedPackId: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'pack-management' | 'characters' | 'locations' | 'items' | 'factions' | 'powerLevels' | 'global' | 'timeline'
  >('overview');
  const [continuationPacks, setContinuationPacks] = useState<ContinuationPack[]>([]);
```

- [ ] **Step 3: Fetch continuation packs beside existing world data**

Inside the existing `fetchAll` effect, add `listContinuationPacks(novel.id)` and store the result:

```tsx
const [characters, locations, items, timelineEvents, factions, powerLevels, packs] = await Promise.all([
  listCharacters(novel.id),
  listLocations(novel.id),
  listItems(novel.id),
  listTimelineEvents(novel.id),
  listFactions(novel.id),
  listPowerLevels(novel.id),
  listContinuationPacks(novel.id),
]);

setContinuationPacks(packs);
```

- [ ] **Step 4: Change header and tab ordering**

Update the header copy and internal tabs:

```tsx
<h1 className="text-2xl font-serif font-bold text-theme-text flex items-center gap-3">
  <Globe className="text-theme-accent" />
  设定与续写
</h1>
<p className="text-sm text-theme-muted mt-1">先看当前续写状态，再进入资料包管理或设定资产维护。</p>
```

Replace the existing `tabs` array with:

```ts
const tabs = [
  { id: 'overview', icon: FileText, label: '总览' },
  { id: 'pack-management', icon: Upload, label: '资料包管理' },
  { id: 'global', icon: BookOpen, label: '世界设定' },
  { id: 'characters', icon: Users, label: '人物档案' },
  { id: 'locations', icon: MapPin, label: '地点副本' },
  { id: 'items', icon: Package, label: '道具设定' },
  { id: 'factions', icon: Shield, label: '势力 / 力量体系' },
  { id: 'timeline', icon: Clock, label: '纪元与时间线' },
] as const;
```

- [ ] **Step 5: Render the overview as the new default first screen**

Add the overview block before the old `global` tab render:

```tsx
const overviewState = buildContinuationOverviewState(continuationPacks);

{activeTab === 'overview' && (
  <motion.div key="overview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <ContinuationOverviewPanel
      state={overviewState}
      onImport={() => setActiveTab('pack-management')}
      onReviewDraft={() => setActiveTab('pack-management')}
      onOpenPackManagement={() => setActiveTab('pack-management')}
      onOpenWorldSetup={() => setActiveTab('global')}
      onStartWriting={(packId) => {
        if (!onStartContinuationWriting) return;
        onStartContinuationWriting(packId);
      }}
    />
  </motion.div>
)}
```

- [ ] **Step 6: Move the old continuation content under `资料包管理`**

Replace the old `continuation` branch with:

```tsx
{activeTab === 'pack-management' && (
  <motion.div key="pack-management" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <ContinuationPackView novel={novel} />
  </motion.div>
)}
```

- [ ] **Step 7: Run a focused type-check**

Run:

```bash
npm run lint -- --pretty false
```

Expected: PASS

### Task 4: Wire One-Click Handoff Into The Editor Production Panel

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/SplitWorkspace.tsx`
- Modify: `src/components/EditorView.tsx`

- [ ] **Step 1: Add a manual failing check for the missing handoff**

Run `npm run dev`, open a novel, and verify current behavior.

Expected before implementation: from the world side there is no `开始按资料续写` button, and there is no way to switch directly into the editor with a selected approved pack.

- [ ] **Step 2: Reuse a single launch-state shape in `App.tsx`**

Replace the current import-only launch state with the shared type:

```tsx
import { AssistantLaunchContext, ContinuationEditorLaunchState, OnboardingDraftState, SetupTaskKey, StoryIdeaCard, StoryPlanningInput, ViewType, Novel, WorkspaceFocus, WorkspaceNavKey } from './types';

const [continuationLaunchState, setContinuationLaunchState] = useState<ContinuationEditorLaunchState | null>(null);

const navigateToEditorWithContinuation = (novel: Novel, approvedPackId: string, source: ContinuationEditorLaunchState['source']) => {
  setContinuationLaunchState({
    approvedPackId,
    shouldOpenProductionPanel: true,
    source,
  });
  setSelectedNovel(novel);
  setWorkspaceFocus('editor');
  setCurrentView('editor');
};
```

Update the continuation-import flow to call:

```tsx
onEnterEditor={(novel, approvedPackId) => navigateToEditorWithContinuation(novel, approvedPackId, 'continuation-import')}
```

Pass the same launch state into both editor placements:

```tsx
<SplitWorkspace
  novel={selectedNovel}
  focus={workspaceFocus}
  onFocusChange={setWorkspaceFocus}
  continuationLaunchState={continuationLaunchState}
  onStartContinuationWriting={(packId) => {
    setContinuationLaunchState({
      approvedPackId: packId,
      shouldOpenProductionPanel: true,
      source: 'world-overview',
    });
    setWorkspaceFocus('editor');
  }}
  // existing props...
/>

<EditorView
  key={`${selectedNovel.id}:${continuationLaunchState?.approvedPackId || 'default'}`}
  novel={selectedNovel}
  launchState={continuationLaunchState}
  // existing props...
/>
```

- [ ] **Step 3: Thread the callback and launch state through `SplitWorkspace.tsx`**

Update props and forward them:

```tsx
interface SplitWorkspaceProps {
  novel: Novel;
  onboarding?: any;
  onBack: () => void;
  focus: WorkspaceFocus;
  onFocusChange: (focus: WorkspaceFocus) => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
  continuationLaunchState?: ContinuationEditorLaunchState | null;
  onStartContinuationWriting?: (approvedPackId: string) => void;
}

<EditorView
  novel={novel}
  launchState={continuationLaunchState || null}
  onBack={onBack}
  onOpenAssistant={onOpenAssistant}
/>

<WorldBibleView
  novel={novel}
  onboarding={onboarding}
  onStartContinuationWriting={onStartContinuationWriting}
/>
```

- [ ] **Step 4: Let `EditorView` consume the world-overview launch state inside split workspace**

Keep the existing approved-pack selection logic, but ensure the incoming launch state is consumed once whenever `approvedPackId` changes:

```tsx
useEffect(() => {
  if (!launchState?.approvedPackId) return;
  setAgentTab('production');
  hasConsumedContinuationPackSelectionRef.current = false;
  setSelectedContinuationPackId(launchState.approvedPackId);
}, [launchState?.approvedPackId]);
```

Retain the current fallback logic that keeps the user’s manual selection once the launch state has been consumed.

- [ ] **Step 5: Run the targeted tests and type-check**

Run:

```bash
node --import tsx --test tests/continuation-overview.test.ts tests/continuation-pack-selection.test.ts
npm run lint -- --pretty false
```

Expected: PASS

- [ ] **Step 6: Do the manual browser smoke**

Run:

```bash
npm run dev
```

Then verify all of the following in the browser:

1. Enter a novel’s world side and confirm the title reads `设定与续写`.
2. Confirm the default selected tab is `总览`.
3. In the no-pack state, the main button is `导入资料`.
4. After creating a `draft` pack, `总览` changes to `已解析，待审核`, and the main button is `审核资料包`.
5. After approving a pack, `总览` changes to `已接入资料包`, and the main button becomes `开始按资料续写`.
6. Clicking `开始按资料续写` moves focus to the editor and opens the production panel with that approved pack selected.

## Self-Review Notes

- Spec coverage:
  - Left internal navigation rename and default `总览`: Task 3
  - State-driven overview layout and actions: Tasks 1-3
  - `资料包管理` responsibility split: Tasks 2-3
  - One-click production handoff: Task 4
- Placeholder scan:
  - No `TBD`, `TODO`, or “similar to previous task” references remain.
- Type consistency:
  - Shared launch-state type is `ContinuationEditorLaunchState`.
  - Overview derivation helper is always `buildContinuationOverviewState`.
