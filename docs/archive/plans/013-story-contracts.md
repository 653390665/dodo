# Plan 013: Story contract system — writing constraint cards
> Commit: ca53899 | Status: TODO | Depends on: 011

## Why this matters
webnovel-writer's "contract-driven system" (MASTER_SETTING → runtime contracts → commits) provides a powerful writing constraint framework. InkFlow can simplify this into "writing constraint cards" — novel-level unbreakable rules that are enforced during writing and review. This prevents common webnovel problems: power creep, inconsistent character behavior, forgotten plot threads.

## Current state
InkFlow has `project_preference_profile` in `novels` table (a JSON blob storing skill preferences). No dedicated constraint/contract system exists. The Planner and Reviewer work independently without shared constraint enforcement.

## Scope
**In scope:**
- `src/types.ts` — add `StoryContract` type
- `src/components/StoryContractPanel.tsx` (new) — constraint card editor
- `server/routes/agents.ts` — inject contract constraints before Planner
- `server/routes/audit.ts` — check contract rules during review
- `server/routes/production.ts` — inject contract into production pipeline

**Out of scope:**
- Do NOT implement full webnovel-writer commit/event chain
- Do NOT change novel table schema (use existing JSON fields)

## StoryContract data shape
```typescript
interface StoryContract {
  powerCeiling: string;
  noResurrection: boolean;
  characterConsistency: 'strict' | 'loose';
  genreRules: string[];
  customConstraints: string[];
  foreshadowingDebt: {
    planted: number;
    resolved: number;
    overdue: string[];
  };
}
```

## Steps

### Step 1: Add `StoryContract` type
- In `src/types.ts`, add `StoryContract` interface with fields above
- Add `contract?: StoryContract` to `Novel` type's `project_preference_profile`
- Export type
- Verify: `npx tsc --noEmit` passes

### Step 2: Create `StoryContractPanel` component
- Create `src/components/StoryContractPanel.tsx`
- Display editable constraint cards: power ceiling input, resurrection toggle, character consistency radio, genre rules checklist, custom constraints textarea
- Show foreshadowing debt counter (planted/resolved/overdue)
- Style: follow `src/components/SettingsModal.tsx` layout pattern with card sections
- Save to novel's `project_preference_profile.contract` via `updateNovel()`
- Verify: `npx tsc --noEmit` passes

### Step 3: Add contract entry point in World Bible
- In `src/components/WorldBibleView.tsx` (or EditorHeader), add a "合同" (Contract) button
- Opens `StoryContractPanel` as a side panel or modal
- Verify: `pnpm dev` — contract button visible, panel opens

### Step 4: Inject contract into Planner (editor-agent)
- In `server/routes/agents.ts` `/api/editor-agent` handler:
  - Load novel's contract from `project_preference_profile`
  - If contract exists, append contract rules to the prompt as "【写作合同约束】"
  - Format: list each rule as a constraint line
- Verify: `npx tsc --noEmit` passes

### Step 5: Check contract during Review (audit)
- In `server/routes/audit.ts` `/api/audit` handler:
  - Accept optional `contract` field in request body
  - Add contract compliance section to audit prompt: "逐条检查以下合同规则是否被遵守"
  - Parse contract violations from audit response
- In `src/lib/audit-structured.ts`, add `contractViolations: string[]` to audit result
- Verify: `npx tsc --noEmit` passes

### Step 6: Inject contract into production pipeline
- In `server/routes/production.ts`, load contract and pass to `runProductionPipeline()`
- In `server/helpers/ai-production-pipeline.ts`, accept optional `contract: StoryContract` param
- Append contract rules to Planner and Critic prompts
- Verify: `npx tsc --noEmit` passes

## Done Criteria
- [ ] `npx tsc --noEmit` zero errors
- [ ] `StoryContractPanel` component renders and saves contract data
- [ ] Planner prompt includes contract constraints when contract exists
- [ ] Audit reports flag contract violations
- [ ] `pnpm dev` can: define contract → write chapter with constraints → audit checks compliance

## STOP Conditions
- If contract injection makes prompts too long (exceeding token limits), stop and add truncation
- If contract violation parsing from model output is unreliable, stop and make it a heuristic check instead

## Maintenance notes
- Start with simple contract rules (power ceiling, no resurrection) before adding complex ones
- Contract data lives in `project_preference_profile` JSON — no schema migration needed
- Foreshadowing debt is read-only in the panel (computed from `foreshadowings` table) until a debt resolution UI is built
