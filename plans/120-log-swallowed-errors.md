# Plan 120: Log or rethrow silently swallowed errors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- server/lib/server-llm.ts server/lib/config.ts server/lib/db-mappers.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: correctness
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

Several empty `catch {}` blocks silently swallow errors, making debugging difficult. When LLM streaming fails to parse a token, or config file reading fails, or DB mapper JSON parsing fails, the error is silently dropped. Adding `logger.warn()` calls makes these failures observable without changing control flow.

## Current state

Known empty catch blocks:
- `server/lib/server-llm.ts:432` — SSE JSON parse failure during streaming
- `server/lib/config.ts:223` — config file read failure during API key migration
- `server/lib/db-mappers.ts:18` — JSON.parse failure (already has logger.warn, OK)

The `server/lib/db-mappers.ts:18` catch block already logs properly. Focus on the other two.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`       | exit 0, no errors   |
| Lint      | `npx eslint server/lib/server-llm.ts server/lib/config.ts` | exit 0 |

## Scope

**In scope**:
- `server/lib/server-llm.ts`
- `server/lib/config.ts`

**Out of scope**:
- `server/lib/db-mappers.ts` — already logs properly
- `server/lib/db-init.ts` — catch is for `import.meta.url` evaluation, intentional fallback
- Frontend `console.warn/error` calls — different concern, covered by BACKLOG plan 108

## Steps

### Step 1: Add logger import to server-llm.ts (if missing)

Check if `server/lib/server-llm.ts` already imports `logger`. If not, add:
```typescript
import { logger } from '../logger';
```

### Step 2: Log SSE parse failures in server-llm.ts

At line 432 in `server/lib/server-llm.ts`, change:
```typescript
} catch {}
```
to:
```typescript
} catch (parseErr) {
  logger.warn('SSE token JSON parse skipped:', parseErr);
}
```

**Verify**: `npx tsc --noEmit` → exit 0

### Step 3: Log config read failure in config.ts

At line 223 in `server/lib/config.ts`, change:
```typescript
} catch {}
```
to:
```typescript
} catch (readErr) {
  logger.warn('Failed to read existing config for API key migration:', readErr);
}
```

**Verify**: `npx tsc --noEmit` → exit 0

### Step 4: Run lint

```bash
npx eslint server/lib/server-llm.ts server/lib/config.ts
```

Expected: exit 0

## Test plan

- No new tests needed — these are logging additions with no behavior change
- Manual verification: check server logs for warnings during SSE streaming and config loading

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx eslint server/lib/server-llm.ts server/lib/config.ts` exits 0
- [ ] `grep -n "catch {}" server/lib/server-llm.ts` returns no matches (for the targeted line)
- [ ] `grep -n "catch {}" server/lib/config.ts` returns no matches (for the targeted line)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.
- The `logger` import is not available in the target file.

## Maintenance notes

- Future code should avoid empty `catch {}` blocks. Use `logger.warn()` at minimum for observability.
- Some catch blocks are intentionally empty (e.g., `db-init.ts` for `import.meta.url` fallback) — don't change those.
