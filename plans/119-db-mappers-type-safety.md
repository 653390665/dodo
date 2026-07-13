# Plan 119: Replace `any` DbRow type with typed row interfaces

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

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

`server/lib/db-mappers.ts` defines `type DbRow = any` (via `SafeAny`), which erases all TypeScript type safety across every mapper function. This means typos in column names, wrong property accesses, and type mismatches are silently accepted by the compiler. Introducing typed row interfaces for each table restores compile-time guarantees without changing runtime behavior.

## Current state

- `server/lib/db-mappers.ts:24-25`:
  ```typescript
  type SafeAny = any;
  export type DbRow = SafeAny;
  ```
- Every mapper function accepts `DbRow` (i.e., `any`) as input
- The mappers access snake_case DB columns and map to camelCase TS properties

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`       | exit 0, no errors   |
| Tests     | `npx vitest run tests/db-mappers.test.ts` | all pass |
| Lint      | `npx eslint server/lib/db-mappers.ts` | exit 0 |

## Scope

**In scope**:
- `server/lib/db-mappers.ts`

**Out of scope**:
- Other files that import `DbRow` — they can continue using it as a type alias
- Actual DB query code in `server/lib/db/*.ts`

## Steps

### Step 1: Define typed row interfaces

At the top of `server/lib/db-mappers.ts`, after the imports (around line 8), add typed interfaces for the most frequently used tables. These mirror the SQLite column types:

```typescript
interface NovelRow {
  id: string; title: string; author_id: string; summary: string;
  cover_image: string | null; status: string; world_rules: string | null;
  global_outline: string | null; mounted_skill_ids: string;
  mounted_skill_loadout: string | null; project_preference_profile: string | null;
  created_at: number; updated_at: number;
}

interface CharacterRow {
  id: string; novel_id: string; name: string; role: string;
  summary: string; traits: string; bio: string; current_state: string;
  created_at: number; updated_at: number;
}

interface ChapterRow {
  id: string; novel_id: string; volume_name: string | null; title: string;
  content: string; order: number; word_count: number;
  scene_beats: string | null; critique: string | null;
  created_at: number; updated_at: number;
}

interface SkillRow {
  id: string; name: string; description: string; style: string;
  pacing: string; vocabulary: string; sentence_structure: string | null;
  imagery: string; banned_words: string; few_shots: string;
  character_traits: string | null; world_building: string | null;
  foreshadowing: string | null; plot_pattern: string | null;
  core_patterns: string; banned_elements: string;
  stability_score: number; evaluation_feedback: string;
  version: number; parent_skill_id: string | null;
  lineage_root_id: string | null; primary_dimension: string | null;
  dimension_tags: string; composition_profile: string;
  usage_stats: string; feedback_score: number;
  fusion_meta: string | null; method_chain: string | null;
  why_this_skill_works: string | null; source_badge: string | null;
  created_at: number; updated_at: number | null;
}
```

### Step 2: Update mapper function signatures

Change the mapper functions to accept typed rows instead of `DbRow`. For example:

```typescript
export function rowToNovel(row: NovelRow): Novel {
```

```typescript
export function rowToCharacter(row: CharacterRow): Character {
```

```typescript
export function rowToChapter(row: ChapterRow): Chapter {
```

```typescript
export function rowToSkill(row: SkillRow): Skill {
```

For other mapper functions that have simpler rows (Location, Item, etc.), either define a minimal interface or keep `DbRow` if the mapping is trivial (just `...row` spread).

### Step 3: Keep DbRow for backward compatibility

Keep `export type DbRow = SafeAny;` but add a deprecation comment:

```typescript
/** @deprecated Use typed row interfaces (NovelRow, ChapterRow, etc.) for new code */
export type DbRow = SafeAny;
```

### Step 4: Fix any type errors

After changing the signatures, `npx tsc --noEmit` may report errors where callers pass untyped objects. These callers use `database.prepare(...).all()` which returns `unknown[]`. The fix is to add `as NovelRow` (etc.) casts at the call sites in `server/lib/db/*.ts` files.

Check each db file (novels.ts, chapters.ts, etc.) and add type assertions where needed.

**Verify**: `npx tsc --noEmit` → exit 0

### Step 5: Run tests

```bash
npx vitest run tests/db-mappers.test.ts
```

Expected: All pass.

## Test plan

- `tests/db-mappers.test.ts` already exists and tests mapper functions
- After type changes, these tests should still pass (no runtime behavior change)
- Verify: `npx vitest run tests/db-mappers.test.ts` → all pass

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest run tests/db-mappers.test.ts` exits 0
- [ ] `grep -n "type DbRow = SafeAny" server/lib/db-mappers.ts` still exists (backward compat)
- [ ] `grep -n "interface NovelRow" server/lib/db-mappers.ts` returns a match
- [ ] `grep -n "rowToNovel(row: NovelRow)" server/lib/db-mappers.ts` returns a match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- The type changes cause cascading errors in more than 5 files (indicates scope is too large — stop and report).
- The SQLite return types don't match the defined interfaces (column names differ).

## Maintenance notes

- New mapper functions should use typed interfaces from the start.
- The `SafeAny` escape hatch remains for edge cases but should not be used in new code.
- If more tables need typed rows, follow the same pattern: define interface, update mapper signature.
