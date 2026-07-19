# Plan 012: Review dimensions — Reader Pull + Strand Weave
> Commit: ca53899 | Status: TODO

## Why this matters
InkFlow's `audit-structured.ts` has five review dimensions (prose, narrative, character, setting, pacing). webnovel-writer adds a sixth dimension — **Reader Pull** (hook strength, cool-point density, micro-payoff, expectation debt tracking) — plus a **Strand Weave** rhythm system (Quest 60% / Fire 20% / Constellation 20% with hard break thresholds). Adding these makes chapter reviews more actionable for webnovel writers.

## Source material
- `webnovel-writer/agents/reviewer.md` — six-dimension review system (High-point / Consistency / Pacing / OOC / Continuity / Reader-pull)
- `docs/architecture/overview.md` — Strand Weave definitions and red-line rules

## Scope
**In scope:**
- `src/lib/audit-structured.ts` — add ReaderPull dimension to five-dim audit
- `src/config/prompt-templates.ts` — extend audit prompt with reader-pull instructions
- `src/components/PacingDashboard.tsx` — add Strand Weave visualization

**Out of scope:**
- Do NOT modify existing five-dim scoring weights
- Do NOT change the audit API response shape (additive only)

## Current state
`src/lib/audit-structured.ts` parses five dimensions and computes `totalScore`. The `parseAuditFiveDim` function expects scores for: prose, narrative, character, setting, pacing.

`src/components/PacingDashboard.tsx` displays tension scores and emotion labels per chapter but has no Strand tracking.

## Steps

### Step 1: Add ReaderPull dimension to audit parser
- In `src/lib/audit-structured.ts`, extend `parseAuditFiveDim()` to also parse a `readerPull` dimension if present
- Add `ReaderPullScores` type: `{ hookStrength: number; coolPointDensity: number; microPayoff: number; debtCount: number }`
- ReaderPull total = weighted average of sub-scores
- Include readerPull in `totalScore` computation (weight: 15%, reduce others proportionally)
- Verify: `npx tsc --noEmit` passes

### Step 2: Extend audit prompt template
- In `src/config/prompt-templates.ts`, locate `manualAudit` template
- Add reader-pull instructions: check hook at chapter start/end, count cool-point moments, check if previous chapter promises were fulfilled, track unresolved debt
- Reference webnovel-writer's reviewer.md for prompt language (paraphrase, don't copy)
- Verify: `grep -i "reader.*pull\|追读力" src/config/prompt-templates.ts` returns matches

### Step 3: Add Strand Weave to pacing endpoint
- In `server/routes/world.ts`, modify `/api/analyze-pacing` to also return Strand Weave data
- Add fields: `{ questRatio: number; fireRatio: number; constellationRatio: number; breakWarnings: string[] }`
- Break warnings: quest连续>5章, fire断档>10章, constellation断档>15章
- Verify: `npx tsc --noEmit` passes

### Step 4: Add Strand Weave visualization
- In `src/components/PacingDashboard.tsx`, add a Strand Weave section below the tension chart
- Display a stacked bar or pie showing Quest/Fire/Constellation ratios
- Show break warnings as red badge alerts
- Reference `src/components/copilot/CopilotStatusBar.tsx` for compact status display pattern
- Verify: `pnpm dev` — pacing dashboard shows Strand ratios and break warnings

## Done Criteria
- [ ] `npx tsc --noEmit` zero errors
- [ ] `/api/analyze-pacing` returns Strand Weave data
- [ ] Audit reports include reader-pull score when model returns it
- [ ] PacingDashboard shows Quest/Fire/Constellation ratio bar + break warnings

## STOP Conditions
- If model doesn't reliably return reader-pull scores (low signal), stop — make it optional, don't force
- If Strand Weave analysis requires model call and adds latency, stop — use heuristic calculation from chapter metadata instead

## Maintenance notes
- ReaderPull is additive — old audit results without it still parse correctly
- Strand Weave ratios can be computed heuristically from chapter content length/type without model calls — future optimization
