# Generate Beats Mainline Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the verified "生成分镜" crash and no-feedback fix into the main workspace, without importing unrelated P2/dark-mode worktree changes.

**Architecture:** Keep the fix surgical. Normalize legacy continuation-pack data at the DB boundary, make prompt/context builders tolerate missing optional fields, preserve fallback status long enough for users to see it, and open the existing planning panel after scene-beat generation.

**Tech Stack:** React, TypeScript, Vite, Node test runner via `tsx`, SQLite through the existing `src/lib/db.ts` helpers.

---

## Scope And Guardrails

The implementation source of truth is the verified fix in `/Users/Zhuanz/Documents/dodo-inkflow/.claude/worktrees/quizzical-shirley-fde5eb`, but do not copy the worktree wholesale. Only migrate the five files listed below.

Do not include unrelated P2/dark-mode edits from `WritingSurface.tsx`, especially `bg-white` to `bg-paper` and `text-white` to `text-theme-btn-text` changes. Those belong to a separate UI theme task.

Before starting, run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git status --short --branch
```

Expected: main workspace may already show these unrelated local changes:

```text
## main...origin/main
 M src/components/ContinuationOverviewPanel.tsx
 M src/components/WorldBibleView.tsx
 M tests/continuation-overview.test.ts
```

Do not revert, restage, or edit those three files while executing this plan.

## File Structure

- Modify `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`
  - Adds regression coverage for old continuation packs that lack `styleProfile.proseTraits`, `styleProfile.avoidTraits`, `characterStates[].relationshipNotes`, and `plotState.unresolvedHooks`.
- Modify `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/continuation-pack.ts`
  - Makes `buildCreationIntentDraft` and `buildContinuationContext` safe when old parsed packs miss optional nested fields.
- Modify `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/db.ts`
  - Normalizes old DB rows in `mapContinuationPackRow` so downstream code receives array fields even when the stored JSON omitted them.
- Modify `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorGenerationFlow.ts`
  - Keeps the fallback status visible for 8 seconds after LLM timeout/failure instead of clearing it immediately in `finally`.
- Modify `/Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx`
  - Opens the existing smart-agent planning panel after `onGenerateBeats` completes, so generated or fallback scene beats are visible.

---

### Task 1: Add Continuation Pack Regression Tests

**Files:**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`
- Test: `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`

- [ ] **Step 1: Write the failing regression tests**

Append these tests to the end of `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`:

```ts
test('buildContinuationContext handles pack with missing styleProfile and plotState fields', () => {
  const pack = {
    id: 'pack-old',
    novelId: 'novel-1',
    title: '旧资料包',
    status: 'approved',
    sourceDocuments: [],
    canonFacts: [{ id: 'f1', priority: 'hard', category: 'world', text: '旧设定', evidence: '' }],
    characterStates: [{
      name: '主角',
      role: '主角',
      currentGoal: '活下来',
      emotionalState: '紧张',
      secrets: [],
    }],
    plotState: {
      currentTimeline: '第一章后',
      latestScene: '城门',
      immediateConflict: '守卫盘查',
      nextLikelyMove: '',
    },
    styleProfile: {
      pov: '第三人称',
      pacing: '',
      dialogueDensity: '',
    },
    contradictions: [],
    continuationTask: '继续写。',
    createdAt: 1,
    updatedAt: 1,
  } as any;

  const context = buildContinuationContext(pack);
  assert.match(context, /旧设定/);
  assert.match(context, /第三人称/);
  assert.match(context, /城门/);
  assert.match(context, /未设定/);
});

test('buildCreationIntentDraft handles missing plotState fields gracefully', () => {
  const pack = {
    id: 'p1',
    novelId: 'n1',
    title: 'T',
    status: 'draft',
    sourceDocuments: [],
    canonFacts: [],
    characterStates: [],
    plotState: {},
    styleProfile: {},
    contradictions: [],
    continuationTask: '续写任务',
    createdAt: 1,
    updatedAt: 1,
  } as any;

  const draft = buildCreationIntentDraft(pack);
  assert.match(draft, /续写任务/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails before implementation**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npx tsx --test tests/continuation-pack.test.ts
```

Expected: FAIL with a message equivalent to one of these crashes:

```text
TypeError: Cannot read properties of undefined (reading 'join')
```

or:

```text
TypeError: Cannot read properties of undefined (reading 'slice')
```

- [ ] **Step 3: Commit the failing test**

Only commit if this plan is being executed on a dedicated branch/worktree and commits are part of the run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add tests/continuation-pack.test.ts
git commit -m "test: cover legacy continuation pack fields"
```

Expected: commit succeeds and contains only `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`.

---

### Task 2: Make Continuation Context Builders Legacy-Safe

**Files:**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/continuation-pack.ts`
- Test: `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`

- [ ] **Step 1: Update `buildCreationIntentDraft` optional field access**

In `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/continuation-pack.ts`, replace the three direct `plotState` checks inside `buildCreationIntentDraft` with optional chaining:

```ts
  if (pack.plotState?.latestScene) {
    parts.push(`当前场景：${pack.plotState.latestScene}`);
  }

  if (pack.plotState?.immediateConflict) {
    parts.push(`即时冲突：${pack.plotState.immediateConflict}`);
  }

  if (pack.plotState?.nextLikelyMove) {
    parts.push(`下一步：${pack.plotState.nextLikelyMove}`);
  }
```

- [ ] **Step 2: Update `buildContinuationContext` collection defaults**

In the same file, replace the beginning of `buildContinuationContext` through the `style` definition with this code:

```ts
export function buildContinuationContext(pack: ContinuationPack): string {
  const hardFacts = (pack.canonFacts || [])
    .filter((fact) => fact.priority === 'hard')
    .slice(0, 20)
    .map((fact) => `- [${fact.category}] ${fact.text}`)
    .join('\n');
  const characters = (pack.characterStates || [])
    .slice(0, 8)
    .map((item) => `- ${item.name}：目标=${item.currentGoal}；情绪=${item.emotionalState}；关系=${(item.relationshipNotes || []).join('、')}`)
    .join('\n');
  const hooks = (pack.plotState?.unresolvedHooks || []).slice(0, 10).map((hook) => `- ${hook}`).join('\n');
  const sp = pack.styleProfile;
  const style = [
    `视角：${sp?.pov || '未设定'}`,
    `节奏：${sp?.pacing || '未设定'}`,
    `对白密度：${sp?.dialogueDensity || '未设定'}`,
    `文风特征：${(sp?.proseTraits || []).join('、') || '未设定'}`,
    `避免：${(sp?.avoidTraits || []).join('、') || '未设定'}`,
  ].join('\n');
```

- [ ] **Step 3: Update plot-state output defaults**

In the return array of `buildContinuationContext`, replace the current plot-state line with:

```ts
    `【当前剧情状态】\n时间线：${pack.plotState?.currentTimeline || '未设定'}\n最近场景：${pack.plotState?.latestScene || '未设定'}\n即时冲突：${pack.plotState?.immediateConflict || '未设定'}\n下一步：${pack.plotState?.nextLikelyMove || '未设定'}`,
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npx tsx --test tests/continuation-pack.test.ts
```

Expected:

```text
# pass 9
# fail 0
```

- [ ] **Step 5: Commit the context-builder fix**

Only commit if this plan is being executed on a dedicated branch/worktree and commits are part of the run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/lib/continuation-pack.ts tests/continuation-pack.test.ts
git commit -m "fix: tolerate legacy continuation pack fields"
```

Expected: commit contains only `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/continuation-pack.ts` and `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`.

---

### Task 3: Normalize Continuation Packs At The DB Boundary

**Files:**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/db.ts`
- Test: `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`

- [ ] **Step 1: Update `mapContinuationPackRow`**

In `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/db.ts`, replace the current `mapContinuationPackRow` function with:

```ts
function mapContinuationPackRow(row: any): import('../types').ContinuationPack {
  const styleProfile = JSON.parse(row.style_profile || '{}');
  styleProfile.proseTraits = styleProfile.proseTraits || [];
  styleProfile.avoidTraits = styleProfile.avoidTraits || [];
  styleProfile.pov = styleProfile.pov || '';
  styleProfile.pacing = styleProfile.pacing || '';
  styleProfile.dialogueDensity = styleProfile.dialogueDensity || '';

  const characterStates = JSON.parse(row.character_states || '[]');
  for (const cs of characterStates) {
    cs.relationshipNotes = cs.relationshipNotes || [];
  }

  const plotState = JSON.parse(row.plot_state || '{}');
  plotState.unresolvedHooks = plotState.unresolvedHooks || [];

  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    status: row.status,
    sourceDocuments: JSON.parse(row.source_documents || '[]'),
    canonFacts: JSON.parse(row.canon_facts || '[]'),
    characterStates,
    plotState,
    styleProfile,
    contradictions: JSON.parse(row.contradictions || '[]'),
    continuationTask: row.continuation_task,
    sourceMap: JSON.parse(row.source_map || '{}'),
    readingQuestions: JSON.parse(row.reading_questions || '[]'),
    continuationGaps: JSON.parse(row.continuation_gaps || '[]'),
    sourceBadge: row.source_badge || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

- [ ] **Step 2: Run type/build validation for the DB change**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run build
```

Expected:

```text
✓ built in
```

The build may print a chunk-size warning. That warning is acceptable for this task.

- [ ] **Step 3: Run the focused continuation-pack tests again**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npx tsx --test tests/continuation-pack.test.ts
```

Expected:

```text
# pass 9
# fail 0
```

- [ ] **Step 4: Commit the DB normalization**

Only commit if this plan is being executed on a dedicated branch/worktree and commits are part of the run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/lib/db.ts
git commit -m "fix: normalize continuation pack rows"
```

Expected: commit contains only `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/db.ts`.

---

### Task 4: Preserve Fallback Status After Scene-Beat Generation Fails

**Files:**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorGenerationFlow.ts`
- Test: manual browser verification in Task 6

- [ ] **Step 1: Add the fallback marker**

In `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorGenerationFlow.ts`, inside `handleGenerateBeats`, add the marker immediately after assigning `abortControllerRef.current = controller;`:

```ts
    let usedFallback = false;
```

The surrounding block should look like:

```ts
    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;

    let usedFallback = false;
    setIsGeneratingBeats(true);
    setGenerationStatus('正在根据创作意图和世界观拆解本章分镜…');
```

- [ ] **Step 2: Mark fallback usage in the catch path**

After `await updateChapter(currentChapter.id, { sceneBeats: fallbackBeats });`, add:

```ts
      usedFallback = true;
```

The catch path should end like:

```ts
      setCurrentChapter((prev) => (prev ? { ...prev, sceneBeats: fallbackBeats } : null));
      await updateChapter(currentChapter.id, { sceneBeats: fallbackBeats });
      usedFallback = true;
      setGenerationStatus('模型响应不稳定，已生成保底分镜，可直接编辑后继续写。');
```

- [ ] **Step 3: Keep fallback status visible for 8 seconds**

Replace `setGenerationStatus(null);` in the `finally` block with:

```ts
        if (!usedFallback) {
          setGenerationStatus(null);
        } else {
          setTimeout(() => setGenerationStatus(null), 8000);
        }
```

The `finally` block should become:

```ts
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingBeats(false);
        if (!usedFallback) {
          setGenerationStatus(null);
        } else {
          setTimeout(() => setGenerationStatus(null), 8000);
        }
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
```

- [ ] **Step 4: Run lint for the hook change**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected: command exits with code 0 and no lint errors.

- [ ] **Step 5: Commit the fallback status fix**

Only commit if this plan is being executed on a dedicated branch/worktree and commits are part of the run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/lib/hooks/useEditorGenerationFlow.ts
git commit -m "fix: keep scene beat fallback status visible"
```

Expected: commit contains only `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorGenerationFlow.ts`.

---

### Task 5: Open Planning Panel After Generating Scene Beats

**Files:**
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx`
- Test: manual browser verification in Task 6

- [ ] **Step 1: Change only the `生成分镜` button handler**

In `/Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx`, replace:

```tsx
                    onClick={onGenerateBeats}
```

with:

```tsx
                    onClick={async () => {
                      await onGenerateBeats();
                      setAgentTab('planning');
                      setIsAgentSidebarOpen(true);
                    }}
```

Do not change the button classes in this task.

- [ ] **Step 2: Run lint for the component change**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected: command exits with code 0 and no lint errors.

- [ ] **Step 3: Commit the planning-panel behavior**

Only commit if this plan is being executed on a dedicated branch/worktree and commits are part of the run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/components/WritingSurface.tsx
git commit -m "fix: show planning panel after scene beat generation"
```

Expected: commit contains only `/Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx`.

---

### Task 6: Mainline Verification On `localhost:3001`

**Files:**
- Validate: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/continuation-pack.ts`
- Validate: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/db.ts`
- Validate: `/Users/Zhuanz/Documents/dodo-inkflow/src/lib/hooks/useEditorGenerationFlow.ts`
- Validate: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/WritingSurface.tsx`
- Validate: `/Users/Zhuanz/Documents/dodo-inkflow/tests/continuation-pack.test.ts`

- [ ] **Step 1: Run whitespace diff validation**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git diff --check
```

Expected:

```text
```

No output means no whitespace errors.

- [ ] **Step 2: Run focused continuation tests**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npx tsx --test tests/continuation-pack.test.ts
```

Expected:

```text
# pass 9
# fail 0
```

- [ ] **Step 3: Run lint**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run lint
```

Expected: command exits with code 0 and no lint errors.

- [ ] **Step 4: Run production build**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run build
```

Expected:

```text
✓ built in
```

The existing chunk-size warning is acceptable.

- [ ] **Step 5: Start or reuse the main dev server**

If no server is running on port 3001, run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run dev
```

Expected server output:

```text
Server running on http://localhost:3001
```

- [ ] **Step 6: Browser-check the original user flow**

Open `http://localhost:3001/`.

Click the existing imported continuation project, open the writing workspace, and click the `生成分镜` button.

Expected visible result:

```text
智能管家工作台
写前准备
分镜
当前场景分镜规划
```

Expected server log result: no error containing:

```text
Cannot read properties of undefined (reading 'join')
```

An LLM timeout followed by fallback is acceptable if the log contains:

```text
Editor agent fell back: Error: LLM request timed out after 8s
```

- [ ] **Step 7: Inspect final diff scope**

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git diff --stat
git diff -- src/lib/continuation-pack.ts src/lib/db.ts src/lib/hooks/useEditorGenerationFlow.ts src/components/WritingSurface.tsx tests/continuation-pack.test.ts
```

Expected: the scoped diff includes only the five files in this plan for the generate-beats fix. The pre-existing local changes in `src/components/ContinuationOverviewPanel.tsx`, `src/components/WorldBibleView.tsx`, and `tests/continuation-overview.test.ts` may still appear in `git status`, but this task must not alter them.

- [ ] **Step 8: Commit the final verified fix**

Only commit if previous task commits were skipped and this plan is being executed on a dedicated branch/worktree:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
git add src/lib/continuation-pack.ts src/lib/db.ts src/lib/hooks/useEditorGenerationFlow.ts src/components/WritingSurface.tsx tests/continuation-pack.test.ts
git commit -m "fix: repair generate beats fallback flow"
```

Expected: commit contains only the five files in this plan.

---

## Self-Review

**Spec coverage:** The plan covers the observed backend crash, legacy DB normalization, fallback status visibility, planning-panel visibility, and mainline browser verification on `localhost:3001`.

**Placeholder scan:** No step relies on unspecified work. Each code change includes the exact snippet to insert or replace, and every validation command includes the expected result.

**Type consistency:** All referenced functions and files already exist in the repository: `buildContinuationContext`, `buildCreationIntentDraft`, `mapContinuationPackRow`, `handleGenerateBeats`, `setAgentTab`, and `setIsAgentSidebarOpen`.

