# Plan 015: Decision-backed preference learning
> Commit: ca53899 | Status: TODO | Source: Writer's Loop

## Why this matters
Writer's Loop learns only from *reviewed* user decisions — approved/rejected plans, accepted/rejected edits, manual rewrites — never from raw AI drafts. InkFlow's `preference-flywheel.ts` currently only tracks skill accept/reject, not chapter-level edit decisions. Adding decision-backed learning would let InkFlow progressively adapt to the writer's style across a novel.

## Goal
Extend the preference flywheel to capture chapter-level decisions (accept draft, reject + edit manually, rewrite instruction) and feed them back into future generation calls as learned constraints.

## Scope
**In scope:**
- `src/lib/preference-flywheel.ts` — add decision recording and retrieval
- `src/lib/db.ts` — add `preference_decisions` table (or use existing JSON field)
- `server/routes/production.ts` — record decisions on production run apply
- `server/helpers/ai-production-pipeline.ts` — inject learned preferences

**Out of scope:**
- Full style distillation pipeline (Writer's Loop references/style-distillation.md)
- Journal-based replay

## Current state
`preference-flywheel.ts` has `applyPreferenceFeedback()` that tracks skill-level accept/reject. `production.ts` `/apply` endpoint applies a production run but doesn't record the user's decision about the AI output.

## Steps

### Step 1: Add decision recording
- Extend `preference-flywheel.ts` with:
```typescript
export interface ChapterDecision {
  chapterId: string;
  timestamp: number;
  action: 'accept_draft' | 'reject_draft' | 'manual_rewrite' | 'edit_then_accept';
  instruction?: string; // rewrite instruction if provided
  acceptedPortions?: string[]; // which parts the user kept
  rejectedReason?: string;
}

export function recordChapterDecision(decision: ChapterDecision): void {
  // Append to novel.projectPreferenceProfile.decisions array
}
```
- Modify `/api/chapter-production-runs/:runId/apply` to call `recordChapterDecision` with the user's action.
- Verify: `npx tsc --noEmit` passes.

### Step 2: Build preference summary
- Add `summarizeChapterDecisions(novelId): LearnedPreference[]`:
  - Analyzes last N decisions for patterns
  - Example: if user consistently rewrites dialogue, add "prefers [style] dialogue" constraint
  - Example: if user always rejects overly long descriptions, add "keep descriptions under X chars" constraint
- Verify: `npx tsc --noEmit` passes.

### Step 3: Inject learned preferences into pipeline
- In `ai-production-pipeline.ts`, accept optional `learnedPreferences: LearnedPreference[]`
- Append them to the context as "【学习到的偏好 — 基于你之前的修改习惯】\n..."
- Position after contract constraints, before prompt
- Verify: `npx tsc --noEmit` passes.

### Step 4: Surface preferences in UI
- Add a "写作偏好" section to StoryContractPanel showing learned preferences
- Read-only display with reset option
- Shows: "你倾向于 XX 风格的对话" / "你常缩短描述段落" / "你偏好 XX 类型的章节结尾"
- Verify: `npx tsc --noEmit` passes.

## Done Criteria
- [ ] `npx tsc --noEmit` zero errors
- [ ] Chapter decisions recorded on production run apply
- [ ] Learned preferences extracted and injected into next generation
- [ ] Preferences visible in contract panel
- [ ] Backward compatible: novels without decisions still work

## STOP Conditions
- If decision recording adds latency to `/apply`, defer recording to async
- If learned preferences contradict genre constraints, genre wins (explicit > learned)
- If decisions are too sparse (<3 per novel) to extract patterns, show "not enough data to learn" instead of guessing

## Maintenance notes
- Start with last 10 decisions for pattern extraction (sliding window)
- Decision data lives in `project_preference_profile.decisions` — no schema migration
- Reset learned preferences when user explicitly clears in contract panel
