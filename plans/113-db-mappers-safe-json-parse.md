# Plan 113: db-mappers JSON.parse 安全防护防止脏数据崩溃整条读取链

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- server/lib/db-mappers.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

`server/lib/db-mappers.ts` contains ~27 bare `JSON.parse(row.xxx || 'fallback')` calls across 11 mapper functions. If any JSON column in SQLite contains corrupted data (partial write from crash, manual DB edit, encoding issue), the entire `rowToEntity` call throws, which propagates up and crashes the API endpoint with a 500. No individual field is protected. A single corrupt column in one row takes down the entire entity read, even if all other fields are valid.

## Current state

- `server/lib/db-mappers.ts` — 386 lines; contains all `rowTo*` and `*ToRow` functions. 27 bare `JSON.parse` calls in the `rowTo*` functions (deserialization direction).

Key excerpts showing the pattern:

```typescript
// line 11-24: rowToNovel — 3 JSON.parse calls
export function rowToNovel(row: DbRow): Novel {
  return {
    ...row,
    mountedSkillIds: JSON.parse(row.mounted_skill_ids || '[]'),        // line 18
    mountedSkillLoadout: JSON.parse(row.mounted_skill_loadout || '[]'), // line 19
    projectPreferenceProfile: JSON.parse(row.project_preference_profile || '{}'), // line 20
    // ...
  };
}

// line 26-35: rowToCharacter — 1 JSON.parse call
export function rowToCharacter(row: DbRow): Character {
  return {
    ...row,
    traits: JSON.parse(row.traits || '[]'), // line 30
    // ...
  };
}

// line 65-99: rowToSkill — 11 JSON.parse calls (most affected)
export function rowToSkill(row: DbRow): Skill {
  const fusionMeta = row.fusion_meta ? JSON.parse(row.fusion_meta) : undefined; // line 66
  return {
    ...row,
    bannedWords: JSON.parse(row.banned_words || '[]'),     // line 70
    fewShots: JSON.parse(row.few_shots || '[]'),             // line 71
    vocabulary: JSON.parse(row.vocabulary || '[]'),         // line 72
    imagery: JSON.parse(row.imagery || '[]'),                // line 73
    corePatterns: JSON.parse(row.core_patterns || '[]'),    // line 78
    bannedElements: JSON.parse(row.banned_elements || '[]'), // line 79
    dimensionTags: JSON.parse(row.dimension_tags || '[]'),  // line 85
    compositionProfile: JSON.parse(row.composition_profile || '{}'), // line 86
    usageStats: JSON.parse(row.usage_stats || '{}'),        // line 87
    methodChain: row.method_chain ? JSON.parse(row.method_chain) : undefined, // line 93
    // ...
  };
}

// line 329-364: mapContinuationPackRow — 9 JSON.parse calls
export function mapContinuationPackRow(row: DbRow): ContinuationPack {
  const styleProfile = JSON.parse(row.style_profile || '{}');   // line 330
  const characterStates = JSON.parse(row.character_states || '[]'); // line 337
  const plotState = JSON.parse(row.plot_state || '{}');         // line 342
  return {
    ...row,
    sourceDocuments: JSON.parse(row.source_documents || '[]'),   // line 350
    canonFacts: JSON.parse(row.canon_facts || '[]'),             // line 351
    contradictions: JSON.parse(row.contradictions || '[]'),     // line 355
    sourceMap: JSON.parse(row.source_map || '{}'),              // line 357
    readingQuestions: JSON.parse(row.reading_questions || '[]'), // line 358
    continuationGaps: JSON.parse(row.continuation_gaps || '[]'), // line 359
    // ...
  };
}
```

Also affected: `rowToSkillUsageRecord:106`, `rowToForeshadowing:132`, `rowToChapterProductionRun:148`.

### Repo conventions to follow

- Logger: `import { logger } from '../logger'` — see `server/lib/db-instance.ts:8`.
- File uses `eslint-disable @typescript-eslint/no-explicit-any` at line 1 — the `DbRow = any` type is intentional (plan 105 BACKLOG addresses this, do not fix it here).
- Test pattern: `import test from 'node:test'; import assert from 'node:assert/strict';` — see `tests/api-compat.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Tests | `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/db-mappers.test.ts` | all pass |
| Lint | `npx eslint server/lib/db-mappers.ts --max-warnings=0` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server/lib/db-mappers.ts` — replace all bare `JSON.parse` with `safeJsonParse`
- `tests/db-mappers.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `server/lib/db-crud.ts` — CRUD helpers that call mappers, do not modify
- `server/lib/db-init.ts` — schema definitions, do not modify
- `shared/types/` — type definitions, do not modify
- The `DbRow = any` type alias — plan 105 addresses this

## Steps

### Step 1: Add safeJsonParse helper

At the top of `server/lib/db-mappers.ts` (after the imports, before the type definitions), add a helper function:

```typescript
/**
 * Safely parse a JSON string from a DB column, returning a fallback value
 * if the string is null, undefined, empty, or contains malformed JSON.
 * Logs a warning when malformed JSON is encountered so corruption is detectable.
 */
function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    logger.warn(`[db-mappers] Malformed JSON in column, using fallback. Value starts with: ${raw.slice(0, 80)}`);
    return fallback;
  }
}
```

This requires importing the logger. Add at the top of the file (after the existing type import, before the eslint-disable comment — actually the eslint-disable is at line 1, so add the import after it):

```typescript
import { logger } from '../logger';
```

**Verify**: `npx tsc --noEmit` → exit 0, no errors (the function is unused at this point, but should compile)

### Step 2: Replace all bare JSON.parse calls in rowTo* functions

Systematically replace every `JSON.parse(row.xxx || 'fallback')` in the deserialization functions with `safeJsonParse(row.xxx, fallback)`. Also replace `row.xxx ? JSON.parse(row.xxx) : undefined` with `safeJsonParse(row.xxx, undefined)`.

The functions to update (in order):
1. `rowToNovel` — lines 18, 19, 20 → 3 replacements
2. `rowToCharacter` — line 30 → 1 replacement
3. `rowToSkill` — lines 66, 70, 71, 72, 73, 78, 79, 85, 86, 87, 93 → 11 replacements
4. `rowToSkillUsageRecord` — line 106 → 1 replacement
5. `rowToForeshadowing` — line 132 → 1 replacement
6. `rowToChapterProductionRun` — line 148 → 1 replacement
7. `mapContinuationPackRow` — lines 330, 337, 342, 350, 351, 355, 357, 358, 359 → 9 replacements

For `mapContinuationPackRow` (lines 330-343), note that `styleProfile` and `characterStates` and `plotState` are intermediate variables with post-parse mutations (e.g., `styleProfile.proseTraits = styleProfile.proseTraits || [];`). Keep these mutations after the `safeJsonParse` call. The pattern becomes:

```typescript
const styleProfile = safeJsonParse(row.style_profile, {});
styleProfile.proseTraits = styleProfile.proseTraits || [];
// ...
```

**Verify**: `npx tsc --noEmit` → exit 0, no errors

### Step 3: Verify no bare JSON.parse remains in rowTo* functions

Run a grep to confirm all `JSON.parse` calls in the `rowTo*` and `mapContinuation*Row` functions have been replaced. `JSON.parse` in the `*ToRow` serialization functions do NOT need replacement (those use `JSON.stringify` to serialize, not parse).

**Verify**: `grep -n 'JSON.parse' server/lib/db-mappers.ts` should return 0 matches in `rowTo*` functions. Any remaining `JSON.parse` should only be in helper code, not in mappers.

### Step 4: Write test for safeJsonParse with malformed data

Create `tests/db-mappers.test.ts`:

- Test 1: `safeJsonParse` with valid JSON returns parsed value.
- Test 2: `safeJsonParse` with null returns fallback.
- Test 3: `safeJsonParse` with undefined returns fallback.
- Test 4: `safeJsonParse` with malformed JSON (e.g., `'{{invalid}}'`) returns fallback and does NOT throw.
- Test 5: `rowToSkill` with a row containing malformed `banned_words` still returns a valid Skill object with `bannedWords: []` (does not throw).

For test 5, construct a fake `DbRow` object with all expected fields and set `banned_words: '{{invalid json}}'`, then call `rowToSkill(fakeRow)` and assert `result.bannedWords` equals `[]`.

Use `node:test` and `node:assert/strict` following `tests/api-compat.test.ts`.

**Verify**: `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/db-mappers.test.ts` → all 5 tests pass

### Step 5: Verify lint passes

**Verify**: `npx eslint server/lib/db-mappers.ts --max-warnings=0` → exit 0

## Test plan

- New tests in `tests/db-mappers.test.ts` covering: valid JSON parse, null input, undefined input, malformed JSON fallback, `rowToSkill` with corrupted column.
- Structural pattern: `tests/api-compat.test.ts` (node:test + node:assert/strict).
- Verification: `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/db-mappers.test.ts` → all 5 tests pass.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/db-mappers.test.ts` exits 0; 5 tests pass
- [ ] `npx eslint server/lib/db-mappers.ts --max-warnings=0` exits 0
- [ ] `grep -c 'safeJsonParse' server/lib/db-mappers.ts` returns >= 27
- [ ] `grep -n 'JSON\.parse' server/lib/db-mappers.ts` returns 0 matches in `rowTo*` or `mapContinuation*Row` functions (only allowed in serialization `*ToRow` functions which use `JSON.stringify`, not `JSON.parse`)
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts (the codebase has drifted since this plan was written).
- A step's verification fails twice after a reasonable fix attempt.
- `mapContinuationPackRow` has post-parse mutations that break when `safeJsonParse` returns a fallback (e.g., if `styleProfile` falls back to `{}` but code expects `.proseTraits` to exist as an array — the existing `|| []` normalization at lines 332-335 should handle this, but verify).

## Maintenance notes

- Future mapper additions should use `safeJsonParse` instead of bare `JSON.parse`. Consider adding an ESLint custom rule or a code review checklist item.
- The `logger.warn` call in `safeJsonParse` makes corruption detectable in logs. If the warn is too noisy (e.g., a column frequently has null), adjust to only warn on non-null malformed input.
- The `DbRow = any` type at line 8 is intentionally left as-is. Plan 105 (BACKLOG) addresses adding proper SQLite row types. This plan only adds the parse safety net.