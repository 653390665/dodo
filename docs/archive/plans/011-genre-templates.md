# Plan 011: Genre template transplant — 37 webnovel genres
> Commit: ca53899 | Status: TODO

## Why this matters
webnovel-writer defines 37 webnovel genre writing templates (xuanhuan, period-drama, rules-mystery, zhihu-short, dog-blood-romance, realistic), each with 5-7 dimensions of writing guidance. InkFlow currently only has skill/soul-level style definitions, lacking genre-level creative constraints. After transplant, users can select a genre during onboarding and get auto-injected genre writing rules.

## Source material
From webnovel-writer `genres/` directory:
- `xuanhuan/` — cultivation levels, cool points, plot patterns, power systems
- `period-drama/` — ancient dialogue, character design, palace intrigue, historical setting, plot patterns
- `rules-mystery/` — core elements, clue design, trick design, suspect management, revelation design, structure/pacing
- `zhihu-short/` — hook techniques, plot compression, emotional peaks, ending patterns, pacing rhythm, character quick-build, genre templates
- `dog-blood-romance/` — torture points, sweet moments, emotional tension, character archetypes, plot templates, romance pacing
- `realistic/` — character depth, reality anchoring, plot logic, social issues, dialogue authenticity

## Scope
**In scope:**
- `src/config/genre-profiles.ts` (new) — genre profile definitions
- `src/types.ts` — add `GenreProfile` type
- `src/components/WelcomeView.tsx` — add genre picker step to onboarding

**Out of scope:**
- Do NOT copy raw markdown files from webnovel-writer
- Do NOT modify existing skill/soul system

## GenreProfile data shape
```typescript
interface GenreProfile {
  id: string;
  label: string;
  icon: string;
  description: string;
  constraints: {
    powerSystem?: string;
    characterArchetypes?: string[];
    plotPatterns?: string[];
    pacingRules?: string;
    tabooElements?: string[];
    dialogueStyle?: string;
    hookTechniques?: string[];
  };
  promptAugmentation: string;
}
```

## Steps

### Step 1: Extract genre data from webnovel-writer
- Read genre markdown files from `/tmp/inkflow-review/webnovel-writer-master/webnovel-writer/genres/`
- Extract core constraints and writing guidance per genre
- Condense into 200-400 character `promptAugmentation` field
- Verify: manually review each genre extraction, confirm key constraints are preserved

### Step 2: Create `src/config/genre-profiles.ts`
- Create file exporting `GENRE_PROFILES: GenreProfile[]` array
- Include 6 genre categories (1-2 subtypes each, ~10 profiles total)
- Follow `src/config/souls.ts` style: `export const` constants, Chinese comments
- Verify: `npx tsc --noEmit` passes

### Step 3: Add `GenreProfile` type
- Add interface to `src/types.ts`
- Export type
- Verify: `npx tsc --noEmit` passes

### Step 4: Genre picker UI in onboarding
- In `WelcomeView.tsx`, add genre selection step before story card generation
- Display genre card grid (icon + name + description), click to select
- Append genre `promptAugmentation` to story card generation prompt
- Reference: `src/components/onboarding/SetupTaskCard.tsx` card layout pattern
- Verify: `pnpm dev` — onboarding shows genre picker, story cards reflect genre constraints

## Done Criteria
- [ ] `npx tsc --noEmit` zero errors
- [ ] 10+ genre profiles defined in `src/config/genre-profiles.ts`
- [ ] Onboarding flow includes genre selection step
- [ ] `pnpm dev` can complete: pick genre → generate story cards → create novel

## STOP Conditions
- If webnovel-writer genre files contain GPL code (not pure knowledge), stop and mark as unusable
- If genre picker makes onboarding UX worse (too many steps), stop and simplify to optional step

## Maintenance notes
- Genre `promptAugmentation` should be tuned based on model performance
- Future: connect genre to skill system — different genres recommend different skill loadouts
