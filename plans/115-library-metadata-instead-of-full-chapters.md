# Plan 115: Library 页面用 Metadata 替代全量章节加载消除 N+1 性能瓶颈

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- src/components/Library.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

The Library page loads chapter and continuation pack metadata for every novel on mount and on every DB change event. For each novel, it calls `listChapters(novelId)` which fetches FULL chapter objects including `content`, `sceneBeats`, and `critique` (potentially hundreds of KB per novel). The Library only uses chapter count and latest chapter's `updatedAt` timestamp. With 20 novels, this downloads megabytes of unnecessary chapter content. Switching to `listChaptersMetadata` (which already exists and returns only id, title, order, wordCount, timestamps) eliminates the content payload entirely.

## Current state

- `src/components/Library.tsx` — Library page component; loads metadata at lines 31-53.

Key excerpt (lines 7-11, imports):

```typescript
import { createChapter, listChapters } from '../lib/chapter-client';
import { listContinuationPacks } from '../lib/continuation-client';
import { Novel, ViewType, Chapter, ContinuationPack } from '../../shared/types';
```

Key excerpt (lines 28-29, state):

```typescript
const [chaptersMap, setChaptersMap] = useState<Record<string, Chapter[]>>({});
const [packsMap, setPacksMap] = useState<Record<string, ContinuationPack[]>>({});
```

Key excerpt (lines 31-53, loadMetadata):

```typescript
const loadMetadata = async (novelList: Novel[]) => {
    const chaps: Record<string, Chapter[]> = {};
    const pks: Record<string, ContinuationPack[]> = {};

    await Promise.all(
      novelList.map(async (novel) => {
        try {
          const [c, p] = await Promise.all([
            listChapters(novel.id),           // <-- FULL chapters with content
            listContinuationPacks(novel.id),
          ]);
          chaps[novel.id] = c;
          pks[novel.id] = p;
        } catch {
          chaps[novel.id] = [];
          pks[novel.id] = [];
        }
      })
    );

    setChaptersMap(chaps);
    setPacksMap(pks);
  };
```

Key excerpt (lines 334-339, usage — only needs count + latest updatedAt):

```typescript
const novelChapters = chaptersMap[novel.id] || [];
const latestCh = [...novelChapters].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
const chaptersCount = novelChapters.length;
const novelPacks = packsMap[novel.id] || [];
const firstPack = novelPacks[0] || null;
```

The component also uses `listChapters(novel.id)` at line 149 for export (`handleExportNovel`), but that is a user-initiated on-demand call and is NOT part of the N+1 metadata load. Do not change the export call.

### Available lighter alternatives

- `listChaptersMetadata(novelId)` — already exists in `src/lib/chapter-client.ts:5`, returns `ChapterMetadata[]` with only: `id, novelId, volumeName, title, order, wordCount, createdAt, updatedAt`. No `content`, `sceneBeats`, or `critique`. The corresponding server function `listChaptersMetadata` is in `server/lib/db/chapters.ts:20-35`.
- `ChapterMetadata` type is already imported at line 8 of `chapter-client.ts` and defined in `shared/types`.
- `listContinuationPacks` has no lighter alternative — the pack list is needed for `firstPack` display. But the packs response is typically small (1-3 packs per novel).

### Repo conventions to follow

- Client API pattern: `call('methodName', ...args)` via `db-transport.ts` — see `src/lib/chapter-client.ts`.
- State typing: use the appropriate type from `shared/types`.
- The existing `loadMetadata` uses `Promise.all` per novel — this parallelizes HTTP calls but each is still a separate request. The fix is to switch from `listChapters` to `listChaptersMetadata`, not to add batching (which would require server-side changes).

## Commands you will need

| Purpose | Command | Expected on success |
|-----------|---------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Tests (frontend) | `npx vitest -c vitest.config.frontend.ts run` | all pass |
| Lint | `npx eslint src/components/Library.tsx --max-warnings=0` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `src/components/Library.tsx` — switch from `listChapters` to `listChaptersMetadata`

**Out of scope** (do NOT touch, even though they look related):
- `src/lib/chapter-client.ts` — already exports `listChaptersMetadata`, no changes needed
- `server/lib/db/chapters.ts` — already implements `listChaptersMetadata`, no changes needed
- `src/components/Library.tsx` line 149 `handleExportNovel` — keep using `listChapters` for export (needs full content)
- `src/lib/continuation-client.ts` — no lighter pack API exists, keep as-is
- `shared/types/` — `ChapterMetadata` type already exists

## Steps

### Step 1: Switch import and state types

In `src/components/Library.tsx`:

1. At line 8, add `listChaptersMetadata` to the import and add the `ChapterMetadata` type:

Replace line 8:
```typescript
import { createChapter, listChapters } from '../lib/chapter-client';
```
With:
```typescript
import { createChapter, listChapters, listChaptersMetadata } from '../lib/chapter-client';
```

2. At line 11, add `ChapterMetadata` to the type import:

Replace:
```typescript
import { Novel, ViewType, Chapter, ContinuationPack } from '../../shared/types';
```
With:
```typescript
import { Novel, ViewType, Chapter, ChapterMetadata, ContinuationPack } from '../../shared/types';
```

3. At line 28, change the state type from `Chapter[]` to `ChapterMetadata[]`:

Replace:
```typescript
const [chaptersMap, setChaptersMap] = useState<Record<string, Chapter[]>>({});
```
With:
```typescript
const [chaptersMap, setChaptersMap] = useState<Record<string, ChapterMetadata[]>>({});
```

4. At line 32, change the local variable type:

Replace:
```typescript
const chaps: Record<string, Chapter[]> = {};
```
With:
```typescript
const chaps: Record<string, ChapterMetadata[]> = {};
```

**Verify**: `npx tsc --noEmit` → exit 0, no errors (there may be a type error at line 334 if the sort comparison uses Chapter-specific fields — verify and fix)

### Step 2: Switch listChapters to listChaptersMetadata in loadMetadata

In `src/components/Library.tsx` line 39, replace the API call:

Replace:
```typescript
listChapters(novel.id),
```
With:
```typescript
listChaptersMetadata(novel.id),
```

**Verify**: `npx tsc --noEmit` → exit 0, no errors

### Step 3: Verify the usage at line 334-339 works with ChapterMetadata

The usage at lines 334-339:

```typescript
const novelChapters = chaptersMap[novel.id] || [];
const latestCh = [...novelChapters].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
const chaptersCount = novelChapters.length;
```

`ChapterMetadata` has `updatedAt` (number timestamp) and `id`, so the sort comparison `b.updatedAt - a.updatedAt` works. `chaptersCount` is just `.length`. Both are valid on `ChapterMetadata[]`.

Check if `latestCh` is used for any field that `ChapterMetadata` does not have (e.g., `content`, `sceneBeats`, `critique`). Search for `latestCh.` usage in the render code below line 337. If `latestCh` is only used for `updatedAt` or `title` or `wordCount`, it is compatible. If it accesses `content` or `sceneBeats`, STOP and report.

**Verify**: `npx tsc --noEmit` → exit 0, no errors. If type errors appear at the `latestCh` usage site, check which field is accessed and verify it exists on `ChapterMetadata`.

### Step 4: Verify lint passes

**Verify**: `npx eslint src/components/Library.tsx --max-warnings=0` → exit 0

### Step 5: Run existing frontend tests

**Verify**: `npx vitest -c vitest.config.frontend.ts run` → all pass

## Test plan

- No new test file is required. The change is a type swap from `Chapter[]` to `ChapterMetadata[]` in the metadata loading path. The existing tests should continue to pass.
- Verification: `npx vitest -c vitest.config.frontend.ts run` → all existing tests pass.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx eslint src/components/Library.tsx --max-warnings=0` exits 0
- [ ] `npx vitest -c vitest.config.frontend.ts run` exits 0
- [ ] `grep -n 'listChapters(' src/components/Library.tsx` returns only 1 match at line 149 (`handleExportNovel`), NOT in `loadMetadata`
- [ ] `grep -n 'listChaptersMetadata(' src/components/Library.tsx` returns 1 match in `loadMetadata`
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts (the codebase has drifted since this plan was written).
- `latestCh` at line 335 is used to access a field not present on `ChapterMetadata` (e.g., `latestCh.content`). This would indicate the Library needs more than metadata and the plan needs revision.
- `listChaptersMetadata` is not exported from `src/lib/chapter-client.ts` (verify its existence before proceeding — it should be at line 5).
- `ChapterMetadata` is not exported from `shared/types` (verify its existence before proceeding).

## Maintenance notes

- The Library still calls `listChapters(novel.id)` for export (line 149) — this is correct because export needs full content. Do not change this.
- The `packsMap` still uses full `ContinuationPack[]` objects. If pack lists grow large in the future, consider adding a `listContinuationPacksMetadata` or a count-only endpoint. For now, packs are typically 1-3 per novel, so the payload is small.
- The N+1 HTTP request pattern remains (one request per novel for metadata). A future improvement could add a batch metadata endpoint (`listAllChaptersMetadata(novelIds[])`) to reduce HTTP round-trips. This plan focuses on the payload size win (metadata vs full content), which is the higher-impact change.