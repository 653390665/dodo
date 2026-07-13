# Plan 112: 修复 handleDeleteChapter 闭包过期导致选中错误章节

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- src/lib/hooks/useEditorPersistence.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

When the user deletes the current chapter, `handleDeleteChapter` uses `chapters` from the closure to find the fallback chapter. But `chapters` is the value at hook initialization time, not the latest state. After `setChapters(prev => prev.filter(...))` removes the deleted chapter, the closure's `chapters` still contains the old array. The `.find()` may select a chapter that was also deleted, or return `undefined` and cast it to `Chapter` via `as unknown as Chapter`, causing downstream undefined-access crashes.

## Current state

- `src/lib/hooks/useEditorPersistence.ts` — editor persistence hook; contains `handleDeleteChapter` at lines 311-317.

Key excerpt (lines 311-317):

```typescript
const handleDeleteChapter = async (id: string) => {
    await deleteChapter(id);
    setChapters((prev) => prev.filter((chapter) => chapter.id !== id));
    if (currentChapter?.id === id) {
      setCurrentChapter((chapters.find((chapter) => chapter.id !== id) as unknown as Chapter) || null);
    }
  };
```

The bug: `chapters` on line 315 is the closure-captured value from when the hook was last called, NOT the updated array after `setChapters` on line 313. React's `setChapters` updates state asynchronously, but even if it were synchronous, the `chapters` variable in this closure is a stale reference. The `as unknown as Chapter` cast hides the fact that `.find()` returns `undefined` when no match is found.

### Repo conventions to follow

- State updates: the hook uses functional updaters `setChapters((prev) => ...)` — match this pattern. See `src/lib/hooks/useEditorData.ts:81-89` for how `setCurrentChapter` is used with a functional updater that reads from fresh `prev` state.
- No `any` casts: the repo has `eslint --max-warnings=0`; avoid `as unknown as` casts. The existing `ChapterMetadata` to `Chapter` cast at `useEditorData.ts:82,88` is a known debt item (plan 105), but this plan only fixes the stale closure, not the type gap.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Tests (frontend) | `npx vitest -c vitest.config.frontend.ts run` | all pass |
| Lint | `npx eslint src/lib/hooks/useEditorPersistence.ts --max-warnings=0` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `src/lib/hooks/useEditorPersistence.ts` — fix `handleDeleteChapter` stale closure

**Out of scope** (do NOT touch, even though they look related):
- `src/components/EditorView.tsx` — consumer of the hook, do not modify
- `shared/types/` — the `ChapterMetadata` vs `Chapter` type gap is plan 105, not this plan
- Other hooks in `src/lib/hooks/` — only fix the one function

## Steps

### Step 1: Fix handleDeleteChapter to use functional state updater

In `src/lib/hooks/useEditorPersistence.ts`, replace the `handleDeleteChapter` function (lines 311-317) with a version that computes the fallback chapter from the updated chapters array via a functional updater.

The fix: use `setChapters` with a functional updater that also computes the fallback chapter, then call `setCurrentChapter` with that fallback. Since `setCurrentChapter` cannot read the result of `setChapters` directly (they are separate state pieces), compute the filtered array first, then use it for both `setChapters` and `setCurrentChapter`.

Replace lines 311-317 with:

```typescript
const handleDeleteChapter = async (id: string) => {
    await deleteChapter(id);
    const remaining = chapters.filter((chapter) => chapter.id !== id);
    setChapters(remaining);
    if (currentChapter?.id === id) {
      const fallback = remaining.find((chapter) => chapter.id !== id) || null;
      setCurrentChapter(fallback as unknown as Chapter | null);
    }
  };
```

Wait — this still uses `chapters` from the closure. The real fix must use the functional updater pattern to get the latest state. But `setCurrentChapter` needs the filtered list, which comes from `setChapters`. The correct approach: compute `remaining` from the functional updater of `setChapters`, but because we need it for `setCurrentChapter` too, extract the computation:

```typescript
const handleDeleteChapter = async (id: string) => {
    await deleteChapter(id);
    setChapters((prev) => {
      const remaining = prev.filter((chapter) => chapter.id !== id);
      if (currentChapter?.id === id) {
        const fallback = remaining.find((chapter) => chapter.id !== id) || null;
        setCurrentChapter(fallback as unknown as Chapter | null);
      }
      return remaining;
    });
  };
```

This reads from `prev` (the latest chapters at the time the updater runs), not from the stale closure `chapters`. The `as unknown as Chapter | null` cast is kept because `ChapterMetadata` is not a full `Chapter` (plan 105 addresses this type gap).

Note: calling `setCurrentChapter` inside a `setChapters` updater is a React state update from within another state updater. This is safe in React 18+ — the updater function is a pure function that React calls synchronously, and `setCurrentChapter` schedules its own update. It does not cause a re-render during the `setChapters` call.

**Verify**: `npx tsc --noEmit` → exit 0, no errors

### Step 2: Verify lint passes

**Verify**: `npx eslint src/lib/hooks/useEditorPersistence.ts --max-warnings=0` → exit 0

### Step 3: Run existing frontend tests to verify no regression

**Verify**: `npx vitest -c vitest.config.frontend.ts run` → all pass

## Test plan

- No new test file is required for this fix. The existing frontend tests in `src/tests/components.test.tsx` should continue to pass. If a test for `handleDeleteChapter` is desired as a follow-up, it would need to mock the `deleteChapter` API and verify that after deletion, `currentChapter` is set to the correct fallback. This is deferred because the hook's dependency surface (12+ props) makes meaningful isolated testing non-trivial without integration test infrastructure.
- Verification: `npx vitest -c vitest.config.frontend.ts run` → all existing tests pass.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx eslint src/lib/hooks/useEditorPersistence.ts --max-warnings=0` exits 0
- [ ] `npx vitest -c vitest.config.frontend.ts run` exits 0
- [ ] The `chapters.find(...)` closure reference is replaced with `prev` from the functional updater
- [ ] `currentChapter` is set to the fallback computed from the updated (filtered) array
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts (the codebase has drifted since this plan was written).
- `npx tsc --noEmit` fails with errors related to the `setChapters` updater calling `setCurrentChapter` (this would indicate a React version issue).
- The fix appears to require touching `EditorView.tsx` or `shared/types/`.

## Maintenance notes

- The `as unknown as Chapter | null` cast is still present because `ChapterMetadata` lacks `content`, `sceneBeats`, and `critique`. Plan 105 (BACKLOG) addresses this type gap. When plan 105 lands, this cast should be removed.
- Calling `setCurrentChapter` inside a `setChapters` updater is safe in React 18+/19 but unusual. A reviewer should verify the updater is called exactly once (React strict mode double-invokes updaters in dev, but the side-effect `setCurrentChapter` is idempotent — setting the same value twice is a no-op).
- A more idiomatic alternative is to compute `remaining` outside the updater using a `useRef` that tracks the latest chapters, but that adds complexity for minimal benefit. The functional updater approach is simpler and correct.