# Plan 116: Replace consumeQuota with atomic checkAndConsumeQuota in audit/rewrite routes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- server/routes/audit.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

The audit and rewrite routes call `consumeQuota()` to increment the free-tier counter AFTER the LLM work succeeds. But `consumeQuota()` performs a non-atomic read-modify-write of `novel.projectPreferenceProfile.quotaLimits`. Two concurrent requests can both increment from the same baseline count, and one increment overwrites the other, so the persisted counter ends up at `count+1` instead of `count+2`. The atomic `checkAndConsumeQuota()` already exists in `server/helpers/quota-guard.ts:177` and performs the increment inside `runInSerializedWrite`. This plan swaps the non-atomic `consumeQuota` calls for atomic `checkAndConsumeQuota` calls.

The existing前置 `checkQuota(novelId, 'advancedAudit')` calls (audit.ts:34, audit.ts:206) ARE KEPT UNCHANGED. They serve as a fast pre-filter so free users who are already over quota get a 403 BEFORE the expensive LLM call. Only the post-LLM `consumeQuota` is replaced with the atomic version.

## Current state

- `server/routes/audit.ts:20` — import: `import { checkQuota, consumeQuota } from '../helpers/quota-guard.js';`
- `server/routes/audit.ts:34` — `const quotaCheck = checkQuota(novelId, 'advancedAudit');` (前置 fast gate, KEEP)
- `server/routes/audit.ts:138` — `consumeQuota(novelId, 'advancedAudit');` (POST-LLM, REPLACE)
- `server/routes/audit.ts:206` — `const quotaCheck = checkQuota(novelId, 'advancedAudit');` (rewrite 前置 gate, KEEP)
- `server/routes/audit.ts:246` — `consumeQuota(novelId, 'advancedAudit');` (rewrite POST-LLM, REPLACE)
- `server/helpers/quota-guard.ts:177-260` — `checkAndConsumeQuota()` is the atomic version (returns Promise)

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `/usr/local/bin/node node_modules/typescript/bin/tsc --noEmit` | exit 0, no errors   |
| Lint      | `/usr/local/bin/node node_modules/eslint/bin/eslint.js --max-warnings=0 server/routes/audit.ts` | exit 0 |

Note: `npm`/`npx` symlinks in this environment are broken. Use the direct paths above.

## Scope

**In scope** (the only files you should modify):
- `server/routes/audit.ts`

**Out of scope** (do NOT touch):
- `server/helpers/quota-guard.ts` — atomic function already exists, no changes
- `server/routes/production.ts` — different route, not in this plan
- `server/routes/agents.ts` — separate plan for agents quota
- `server/routes/skills.ts` — separate plan for skills quota

## Steps

### Step 1: Add checkAndConsumeQuota to the import

In `server/routes/audit.ts` line 20, replace:

```typescript
import { checkQuota, consumeQuota } from '../helpers/quota-guard.js';
```

with:

```typescript
import { checkQuota, checkAndConsumeQuota } from '../helpers/quota-guard.js';
```

`checkQuota` is kept (still used as the fast pre-filter at lines 34 and 206). `consumeQuota` is removed (replaced by `checkAndConsumeQuota` at lines 138 and 246).

**Verify**: `/usr/local/bin/node node_modules/typescript/bin/tsc --noEmit` → exit 0 (the removed import may produce an unused warning until steps 2 & 3 complete, but it shouldn't be an error)

### Step 2: Replace consumeQuota at audit.ts:138 with await checkAndConsumeQuota

At line 138 of `server/routes/audit.ts`, the audit handler calls `consumeQuota(novelId, 'advancedAudit');` synchronously after the LLM response is obtained. Replace this with the async atomic version.

Replace:
```typescript
      consumeQuota(novelId, 'advancedAudit');
```

with:
```typescript
      await checkAndConsumeQuota(novelId, 'advancedAudit');
```

The enclosing route handler is already `async (req, res) => { ... }`, so `await` is valid. If `checkAndConsumeQuota` returns `{ allowed: false }` (a concurrent request consumed the last slot between the pre-check and here), the audit result has already been generated — we return the audit result to the user anyway. Quota drift is minor and self-correcting on the next check.

**Verify**: `/usr/local/bin/node node_modules/typescript/bin/tsc --noEmit` → exit 0

### Step 3: Replace consumeQuota at audit.ts:246 with await checkAndConsumeQuota

At line 246 of `server/routes/audit.ts`, the rewrite handler does the same `consumeQuota` call. Replace it the same way.

Replace:
```typescript
      consumeQuota(novelId, 'advancedAudit');
```

with:
```typescript
      await checkAndConsumeQuota(novelId, 'advancedAudit');
```

**Verify**: `/usr/local/bin/node node_modules/typescript/bin/tsc --noEmit` → exit 0

### Step 4: Verify lint passes

**Verify**: `/usr/local/bin/node node_modules/eslint/bin/eslint.js --max-warnings=0 server/routes/audit.ts` → exit 0

### Step 5: Confirm no consumeQuota references remain

**Verify**: `grep -n "consumeQuota" server/routes/audit.ts` → no matches. Only `checkQuota` and `checkAndConsumeQuota` should remain.

## Test plan

- No new tests. `tests/quota-guard.test.ts` already covers `checkAndConsumeQuota` behavior.
- Verification: typecheck + lint pass.
- Manual regression: trigger an audit and rewrite in the running app, confirm quota counter increments correctly.

## Done criteria

- [ ] `/usr/local/bin/node node_modules/typescript/bin/tsc --noEmit` exits 0
- [ ] `/usr/local/bin/node node_modules/eslint/bin/eslint.js --max-warnings=0 server/routes/audit.ts` exits 0
- [ ] `grep -n "consumeQuota" server/routes/audit.ts` returns no matches
- [ ] `grep -n "checkQuota" server/routes/audit.ts` returns 2 matches (lines 34 and 206, the pre-filter gates)
- [ ] `grep -n "checkAndConsumeQuota" server/routes/audit.ts` returns 3 matches (import + 2 await calls)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts (the codebase has drifted since this plan was written).
- A step's verification fails twice after a reasonable fix attempt.
- `checkAndConsumeQuota` is not exported from `server/helpers/quota-guard.ts`.
- The enclosing route handler at line 138 or 246 is NOT `async` (would require making it async, which is out of scope).

## Maintenance notes

- The pre-filter `checkQuota` at lines 34 and 206 is intentionally kept. It prevents wasted LLM API calls when the user is clearly over quota. The post-LLM `checkAndConsumeQuota` is the authoritative atomic counter update that closes the race window.
- If concurrent requests cause the post-LLM `checkAndConsumeQuota` to return `allowed: false`, the audit/rewrite result is still returned to the user (the LLM work is already done). The quota counter is correctly NOT incremented. This is a minor "free" audit for the user in the race case, which is acceptable.
- `consumeQuota` and `checkQuota` remain exported from `quota-guard.ts` for use by routes that haven't been migrated yet. Future route migrations should follow this same pattern: keep pre-filter `checkQuota`, replace post-LLM `consumeQuota` with `await checkAndConsumeQuota`.