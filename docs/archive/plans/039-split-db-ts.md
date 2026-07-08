# Plan 039: Split db.ts — extract row-mappers + schema init
> Priority: P3 | Effort: L | Risk: HIGH | Category: tech-debt

## Why
db.ts at 1341 lines is the largest file. Splitting into domain modules enables parallel work and reduces merge conflicts.

## Goal
Extract 3 modules without changing behavior:
1. `src/lib/db-schema.ts` — ~260 lines: `initDb()`, `ensureColumn()`, all DDL
2. `src/lib/db-mappers.ts` — ~250 lines: 14 `rowTo*()` functions
3. `src/lib/db-entity-crud.ts` — ~600 lines: entity CRUD (13×5 operations)

## Strategy: Worktree isolation
1. Create worktree: `git worktree add ../inkflow-db-split`
2. Install deps: `cd ../inkflow-db-split && pnpm install`
3. Execute refactoring in worktree
4. Verify: `npx tsc --noEmit` passes
5. Reviewer inspects diff, approves, cherry-picks to main

## Steps

### Step 1: Extract db-schema.ts
- Move `ensureColumn()` + `initDb()` + all `CREATE TABLE` statements
- db.ts imports `initDb` from `./db-schema`
- Verify: `npx tsc --noEmit` zero errors

### Step 2: Extract db-mappers.ts
- Move all `rowTo*()` functions + `safeParse()` helper
- db.ts imports row mappers from `./db-mappers`
- Verify: `npx tsc --noEmit` zero errors

### Step 3: Extract db-entity-crud.ts
- Move entity CRUD functions (list/get/create/update/delete × 13 types)
- These depend on `getDb()` and `notify()` — import both from db.ts
- Verify: `npx tsc --noEmit` zero errors

## Done Criteria
- [ ] `npx tsc --noEmit` zero errors
- [ ] db.ts < 200 lines (re-exports only)
- [ ] `pnpm dev` starts successfully

## STOP Conditions
- Circular dependency → restructure
- tsc failure > 3 attempts → stop
- pnpm dev failure → stop
