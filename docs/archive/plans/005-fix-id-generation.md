# Plan 005: Fix ID Generation
> Commit: fcb3b9b | Status: TODO | Blocks: None

## Finding
Date.now() used as entity IDs — collision risk in high-concurrency scenarios.

## Goal
Replace Date.now() ID generation with cryptographically secure UUIDs.

## Files
- Create: `server/id.ts` — ID generation utility
- Modify: `server.ts` — replace Date.now() ID generation (lines 1334, 1702, 1969, 2215, 2232, 2243)
- Modify: `src/App.tsx` — replace Date.now() ID generation (line 260)

## Steps
### Step 1: Create ID generation utility
- Action: Create `server/id.ts` that exports a `generateId()` function returning `crypto.randomUUID()`. Also export a `generateIdClient()` function for client-side use that returns `crypto.randomUUID()` (available in modern browsers).
- Verify: `npx tsc --noEmit server/id.ts` compiles without errors

### Step 2: Replace server.ts ID generation
- Action: In `server.ts`, import `generateId` from `./id` and replace all `Date.now().toString()` ID generation at lines:
  1. Line 1334
  2. Line 1702
  3. Line 1969
  4. Line 2215
  5. Line 2232
  6. Line 2243
  With `generateId()`.
- Verify: `grep -n "Date.now().toString()" server.ts` shows no matches at the specified lines

### Step 3: Replace App.tsx ID generation
- Action: In `src/App.tsx`, at line 260, replace `Date.now().toString()` with `crypto.randomUUID()`.
- Verify: `grep -n "Date.now().toString()" src/App.tsx` shows no matches at line 260

### Step 4: Verify no remaining Date.now() ID generation
- Action: Run `grep -r "Date.now().*" server.ts src/App.tsx` to ensure no ID generation patterns remain.
- Verify: The grep command returns no matches (or only matches that are not ID generation).

### Step 5: Test compilation and build
- Action: Run `npx tsc --noEmit` and `npm run build` to ensure no TypeScript errors.
- Verify: Both commands complete without errors.

### Step 6: Run existing tests
- Action: Run `npm test` (or equivalent test command) to ensure existing tests pass.
- Verify: All tests pass without failures.

## Done Criteria
- [ ] `server/id.ts` exists with `generateId()` function
- [ ] All `Date.now().toString()` ID generation in `server.ts` replaced with `generateId()`
- [ ] `Date.now().toString()` ID generation in `src/App.tsx` replaced with `crypto.randomUUID()`
- [ ] `grep -r "Date.now().*" server.ts src/App.tsx` shows no ID generation patterns
- [ ] `npx tsc --noEmit` passes without errors
- [ ] `npm run build` passes without errors
- [ ] `npm test` passes without failures

## STOP Conditions
- If the line numbers don't match the current code (e.g., due to previous modifications), stop and report actual line numbers.
- If `crypto.randomUUID()` is not available in the target environment (e.g., older Node.js version), stop and report the required version.
- If existing tests rely on Date.now() ID format (e.g., for ordering), stop and report.
- If the ID generation is used in database schemas or external systems that expect specific format, stop and report.