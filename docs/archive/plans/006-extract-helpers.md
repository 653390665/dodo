# Plan 006: Extract helper functions from server.ts
> Commit: ca53899 | Status: TODO | Blocks: 007

## Finding
`server.ts` defines ~25 helper functions inside `startServer()` that block route extraction. `server/routes/index.ts:10-27` explicitly documents that these helpers prevent splitting the remaining 20+ routes.

## Goal
Extract these helpers into `server/helpers/` so route files can import them independently.

## Files
- Create: `server/helpers/prompt-helpers.ts`
- Create: `server/helpers/fallback-draft.ts`
- Create: `server/helpers/story-cards.ts`
- Create: `server/helpers/skill-extraction.ts`
- Create: `server/helpers/async-utils.ts`
- Create: `server/helpers/production-helpers.ts`
- Modify: `server.ts` — replace inline definitions with imports

## Steps

### Step 1: Create `server/helpers/prompt-helpers.ts`
- Action: Move these functions from server.ts into the new file, exported:
  - `buildSkillsPrompt` (line 136)
  - `getPromptTemplate` (line 188)
  - `renderPromptTemplate` (line 192)
  - `truncateForAudit` (line 200)
  - `buildPromptTemplateTest` (line 207)
- Import `PromptTemplateKey` type and `{ PROMPT_TEMPLATES }` from `../src/config/prompt-templates` and `{ SYSTEM_INSTRUCTIONS }` from `../src/config/souls` (match existing imports at server.ts:26-27).
- Verify: `npx tsc --noEmit` passes with no errors related to prompt helpers.

### Step 2: Create `server/helpers/fallback-draft.ts`
- Action: Move these functions into the new file:
  - `countDraftChars` (line 286)
  - `expandDraftToMinimum` (line 290)
  - `ensureMinimumDraftLength` (line 327)
  - `buildFallbackDraft` (line 334)
  - `buildFallbackSceneBeats` (line 389)
- Verify: `npx tsc --noEmit` passes.

### Step 3: Create `server/helpers/story-cards.ts`
- Action: Move these functions into the new file:
  - `createStoryCardJob` (line 73)
  - `extractSeedKeywords` (line 403)
  - `hookIsGeneric` (line 436)
  - `hookMatchesSeed` (line 442)
  - `hookIsTrivial` (line 449)
  - `parseStoryCardsFromModel` (line 458)
  - `extractKeywords` (line 556)
  - `buildFallbackStoryCards` (line 580)
  - `cleanCardField` (line 751)
- Import `StoryIdeaCard` type from `../src/types`.
- Verify: `npx tsc --noEmit` passes.

### Step 4: Create `server/helpers/skill-extraction.ts`
- Action: Move these functions into the new file:
  - `createSkillExtractionJob` (line 110)
  - `buildFallbackSkillForSegment` (line 762)
  - `buildFullFallbackSkillResult` (line 2005)
- Dependencies: `buildBookEvidenceSegments` is already importable from `../src/lib/book-skill-segmentation`.
- Verify: `npx tsc --noEmit` passes.

### Step 5: Create `server/helpers/async-utils.ts`
- Action: Move `withTimeout` (line 264) and `emitTextAsTokens` (line 278) into this file.
- Verify: `npx tsc --noEmit` passes.

### Step 6: Create `server/helpers/production-helpers.ts`
- Action: Move `buildEmptyContinuityReport` (line 1479, currently nested inside `/api/orchestrate` handler) into this file. Export it.
- Verify: `npx tsc --noEmit` passes.

### Step 7: Update server.ts imports
- Action: Replace all moved function definitions in server.ts with imports from the new helper files. Add the import statements alongside the existing imports (lines 1-65).
- Verify: `npx tsc --noEmit` passes with zero errors.

## Done Criteria
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All 25 helper functions are defined in files under `server/helpers/`, not in `server.ts`
- [ ] `server.ts` imports all moved functions from their new modules
- [ ] No files outside `server/helpers/*.ts` and `server.ts` are modified

## STOP Conditions
- If any extracted function depends on a closure variable from `startServer()` (e.g., `app`, `db`, `PORT`), stop and report — the function needs refactoring before extraction.
- If `npx tsc --noEmit` produces errors that cannot be fixed by adjusting import paths, stop and report.
- If a function is called from multiple routes with different expectations, stop before extracting and report the ambiguity.

## Maintenance notes
- New helper functions added to server.ts should go directly into the appropriate `server/helpers/` file.
- These helpers are the gateway to route extraction (plan 007) — keep them pure and avoid adding `startServer()` closure dependencies.
