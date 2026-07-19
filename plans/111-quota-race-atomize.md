# Plan 111: 原子化配额 check-then-consume 防止免费用户超额

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- server/helpers/quota-guard.ts server/routes/production.ts server/routes/agents.ts server/routes/audit.ts server/routes/skills.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

The quota system separates `checkQuota` (read novel, verify count < max) from `consumeQuota` (read novel again, increment count, write back). Between these two calls there is no transaction or lock. Two concurrent requests for the same novel can both pass `checkQuota` before either calls `consumeQuota`, allowing free-tier users to exceed their quota limits. The race window is large because LLM calls happen between check and consume.

## Current state

- `server/helpers/quota-guard.ts` — quota guard service; contains `checkQuota` (lines 49-108) and `consumeQuota` (lines 114-160) as separate functions, each independently reading the novel from DB.
- `server/routes/production.ts` — calls `checkQuota(novelId, 'generateProse')` at line 53, then `consumeQuota(novelId, 'generateProse')` at line 126 (after LLM work).
- `server/routes/agents.ts` — calls `checkQuota` at line 264, `consumeQuota` at line 386.
- `server/routes/audit.ts` — calls `checkQuota` at line 34, `consumeQuota` at line 138.
- `server/routes/skills.ts` — calls `checkQuota` at line ~44 area, `consumeQuota` at line 223.

Key excerpt from `server/helpers/quota-guard.ts`:

```typescript
// line 49-62: checkQuota reads novel independently
export function checkQuota(
  novelId: string | undefined,
  limitType: 'extractSkill' | 'generateProse' | 'advancedAudit'
): QuotaCheckResult {
  if (!novelId) return { allowed: true };
  const novel = getNovel(novelId);
  if (!novel) return { allowed: true };
  // ... reads count from novel.projectPreferenceProfile.quotaLimits ...
  // ... returns allowed: true/false but does NOT modify state ...
}

// line 114-160: consumeQuota reads novel AGAIN, then writes
export function consumeQuota(
  novelId: string | undefined,
  limitType: 'extractSkill' | 'generateProse' | 'advancedAudit'
): void {
  if (!novelId) return;
  const novel = getNovel(novelId);  // <-- second read, not transactionally linked
  if (!novel) return;
  // ... increments count ...
  updateNovel(novelId, { projectPreferenceProfile: profile });  // <-- write
}
```

### Repo conventions to follow

- Transaction pattern: use `runInSerializedWrite` from `server/lib/db-instance.ts` — see its usage in `server/lib/db/transaction.ts` and `server/routes/production.ts:437`.
- Logger: `import { logger } from '../logger'` — see any route file.
- Test pattern: `import test from 'node:test'; import assert from 'node:assert/strict';` — see `tests/api-compat.test.ts`.
- Error handling: return `{ error: '...' }` JSON with appropriate HTTP status — see `server/routes/production.ts:48-62`.

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Tests     | `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/quota-guard.test.ts` | all pass |
| Lint      | `npx eslint server/helpers/quota-guard.ts --max-warnings=0` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server/helpers/quota-guard.ts` — merge check+consume into atomic operation
- `tests/quota-guard.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `server/routes/production.ts` — route handlers keep calling checkQuota/consumeQuota as before; the fix is internal to quota-guard
- `server/routes/agents.ts` — same
- `server/routes/audit.ts` — same
- `server/routes/skills.ts` — same
- `server/lib/db-instance.ts` — the `runInSerializedWrite` function already exists, do not modify it

## Steps

### Step 1: Add atomic checkAndConsumeQuota function

In `server/helpers/quota-guard.ts`, add a new exported function `checkAndConsumeQuota` that performs the check and consume in a single `runInSerializedWrite` transaction. This function should:

1. Read the novel inside the transaction
2. Check if quota is exceeded (same logic as `checkQuota`)
3. If allowed, increment the count and write back (same logic as `consumeQuota`)
4. Return the `QuotaCheckResult` (with `allowed: true` if consumed, `allowed: false` if exceeded)

The function signature:

```typescript
export function checkAndConsumeQuota(
  novelId: string | undefined,
  limitType: 'extractSkill' | 'generateProse' | 'advancedAudit'
): QuotaCheckResult
```

Implementation: wrap the existing check + consume logic in `runInSerializedWrite(() => { ... })`. If the novel is paid/strict, return `{ allowed: true }` without consuming. If quota is exceeded, return `{ allowed: false, ... }` without consuming. Otherwise, increment and persist, then return `{ allowed: true, ... }`.

Import `runInSerializedWrite` at the top of the file:
```typescript
import { runInSerializedWrite } from '../lib/db-instance.js';
```

Keep the existing `checkQuota` and `consumeQuota` functions unchanged — they are still used for read-only checks (e.g., UI status display) and the existing route call sites that check first, do LLM work, then consume.

**Verify**: `npx tsc --noEmit` → exit 0, no errors

### Step 2: Write test for atomic quota enforcement

Create `tests/quota-guard.test.ts`:

- Test 1: `checkAndConsumeQuota` with a paid novel returns `{ allowed: true }` and does NOT increment the count.
- Test 2: `checkAndConsumeQuota` with a free novel that has count < max returns `{ allowed: true }` and increments count by 1.
- Test 3: `checkAndConsumeQuota` with a free novel that has count >= max returns `{ allowed: false }` and does NOT increment count.
- Test 4: `checkAndConsumeQuota` with undefined novelId returns `{ allowed: true }`.

Use `node:test` and `node:assert/strict` following the pattern in `tests/api-compat.test.ts`. Mock `getNovel` and `updateNovel` using a simple module-level override or by testing through the real in-memory SQLite database if one is available in the test setup. If mocking is complex, at minimum test the logic paths by importing `checkAndConsumeQuota` and setting up a test DB via `initDb` with `:memory:` path if the test infrastructure supports it. If not, write a lightweight unit test that stubs the DB functions.

**Verify**: `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/quota-guard.test.ts` → all tests pass

## Test plan

- New tests in `tests/quota-guard.test.ts` covering: paid novel bypass, free novel consume, free novel quota exceeded, undefined novelId.
- Structural pattern: `tests/api-compat.test.ts` (node:test + node:assert/strict).
- Verification: `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/quota-guard.test.ts` → all pass.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `ELECTRON_RUN_AS_NODE=1 npx electron --test --import tsx tests/quota-guard.test.ts` exits 0; 4 tests pass
- [ ] `npx eslint server/helpers/quota-guard.ts --max-warnings=0` exits 0
- [ ] `checkAndConsumeQuota` function exists and is exported from `server/helpers/quota-guard.ts`
- [ ] Existing `checkQuota` and `consumeQuota` functions are unchanged
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts (the codebase has drifted since this plan was written).
- A step's verification fails twice after a reasonable fix attempt.
- `runInSerializedWrite` is not exported from `server/lib/db-instance.ts` (verify its existence before proceeding).
- The test infrastructure cannot run unit tests for `quota-guard.ts` without a full database setup.

## Maintenance notes

- Future route handlers that need quota enforcement should prefer `checkAndConsumeQuota` over the split check+consume pattern. The existing check-then-consume call sites remain valid for the "check before LLM, consume after success" flow, but the atomic version is available for cases where the race window matters.
- A reviewer should scrutinize that the `runInSerializedWrite` wrapper does not deadlock when called from within another transaction (better-sqlite3 supports nested transactions via SAVEPOINT).
- Deferred: migrating all route call sites from check+consume to checkAndConsumeQuota is intentionally deferred — it changes the semantics (consume before LLM work completes) and requires careful handling of refund-on-failure.