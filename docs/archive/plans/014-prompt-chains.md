# Plan 014: Prompt modular routing — 3-chain pipeline
> Commit: ca53899 | Status: TODO | Source: Chinese-WebNovel-Skill

## Why this matters
InkFlow's prompts are monolithic templates passed to `renderPromptTemplate()`. Chinese-WebNovel-Skill uses a modular 3-chain design: Pre-planning (concept→opening→volume outline) → Body execution (plot/character/transition/dialogue/ending/anti-AI-voice) → Final review (consistency). Each chain module retrieves examples before generating, producing higher-quality output. Currently, every generation call in InkFlow loads the same heavy prompt regardless of what phase it's in.

## Goal
Refactor prompt system into chain-based modules. Each chain step: (1) retrieve relevant examples from genre/corpus, (2) assemble minimal targeted prompt, (3) generate, (4) validate against the next module's checks.

## Scope
**In scope:**
- `src/config/prompt-chains.ts` (new) — define 3 chains with module routing
- `src/config/prompt-templates.ts` — split monolithic templates into chain modules
- `server/helpers/prompt-helpers.ts` — add `resolveChainPrompt()` router
- `server/routes/agents.ts` — use chain prompts in editor-agent

**Out of scope:**
- Corpus retrieval system (future plan)
- Full 10-module Chinese-WebNovel-Skill port

## Steps

### Step 1: Define chain structure
- Create `src/config/prompt-chains.ts` with:
```typescript
export const PROMPT_CHAINS = {
  prePlanning: ['concept', 'opening', 'volume_outline'],
  bodyExecution: ['plot_logic', 'character_consistency', 'transition', 'dialogue', 'chapter_ending', 'anti_ai_voice'],
  finalReview: ['consistency_review'],
} as const;
```
- Verify: `npx tsc --noEmit` passes.

### Step 2: Split monolithic templates into chain modules
- Extract focused sub-prompts from `manualAudit`, `editorAgent`, `orchestrateWriter` templates
- Add chain-specific template keys: `chainConcept`, `chainPlotLogic`, `chainCharacterConsistency`, `chainTransition`, `chainDialogue`, `chainChapterEnding`, `chainAntiAiVoice`, `chainConsistencyReview`
- Each module is ~200 chars focused on one aspect — not the full 1000+ char audit prompt
- Verify: `grep "chainConcept\|chainPlotLogic" src/config/prompt-templates.ts` returns matches.

### Step 3: Add `resolveChainPrompt()` to prompt-helpers.ts
- Router function: given a chain (prePlanning/bodyExecution/finalReview) and step index, return the appropriate template
- Each module gets context trimmed to relevant portion only (character module only sees character context, etc.)
- Verify: `npx tsc --noEmit` passes.

### Step 4: Use chain prompts in editor-agent
- Modify `/api/editor-agent` to accept optional `chain` parameter
- If `chain=bodyExecution`, run each module in sequence, composing their outputs
- Fall back to existing monolithic prompt if no chain specified
- Verify: `npx tsc --noEmit` passes.

## Done Criteria
- [ ] `npx tsc --noEmit` zero errors
- [ ] 3 chains defined with 10+ sub-modules
- [ ] Chain-based generation produces equivalent or better output than monolithic
- [ ] Backward compatible: existing calls without `chain` param still work

## STOP Conditions
- If chain-based prompts consistently produce worse output than monolithic, stop and investigate
- If splitting removes essential cross-cutting context (e.g., character needs world context), keep those cross-references
