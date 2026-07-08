# Plan 004: Delete Dead Code
> Commit: fcb3b9b | Status: TODO | Blocks: None

## Finding
~500 lines of unreachable code after early returns in server.ts, increasing maintenance burden and confusion.

## Goal
Remove unreachable code blocks and unused helper functions to reduce codebase size and complexity.

## Files
- Modify: `server.ts` — remove dead code blocks and unused functions

## Steps
### Step 1: Remove unreachable model pipeline in /start endpoint
- Action: In `server.ts`, locate the `/start` endpoint handler. At line 1733 (after early return), delete lines 1735-1858 which contain unreachable model pipeline code.
- Verify: `sed -n '1730,1860p' server.ts` shows the dead code is removed and the function ends properly after the early return.

### Step 2: Remove unreachable Phase 2 in /start-stream endpoint
- Action: In `server.ts`, locate the `/start-stream` endpoint handler. At line 2019 (after early return), delete lines 2021-2169 which contain unreachable Phase 2 code.
- Verify: `sed -n '2015,2175p' server.ts` shows the dead code is removed and the function ends properly after the early return.

### Step 3: Identify and remove unused helper functions
- Action: Check if the following functions are used only by the dead code:
  1. `buildEmptyContinuityReport`
  2. `parseJsonOrEmptyReport`
  3. `sseWrite`
  4. `emitTextAsTokensWithType`
  If they are not used elsewhere in the codebase, delete them.
- Verify: `grep -r "buildEmptyContinuityReport\|parseJsonOrEmptyReport\|sseWrite\|emitTextAsTokensWithType" server.ts` shows no remaining usages (or only the function definitions if kept for other reasons).

### Step 4: Verify code compiles and builds
- Action: Run `npx tsc --noEmit` to check for TypeScript errors, then run `npm run build` to ensure the build passes.
- Verify: Both commands complete without errors.

### Step 5: Check line reduction
- Action: Run `git diff --stat server.ts` to see the number of lines removed.
- Verify: The diff shows approximately 500 lines removed (±10% tolerance).

## Done Criteria
- [ ] `npx tsc --noEmit` passes without errors
- [ ] `npm run build` passes without errors
- [ ] `git diff --stat server.ts` shows ~500 lines removed
- [ ] No remaining references to deleted functions (unless intentionally kept)

## STOP Conditions
- If the line numbers don't match the current code (e.g., due to previous modifications), stop and report actual line numbers.
- If the dead code is actually reachable (e.g., due to complex control flow), stop and report.
- If removing the code breaks TypeScript compilation or build, stop and report the specific errors.
- If the helper functions are used elsewhere, stop and report where they are used.