# Plan 008: Build AI production pipeline (Planner → Writer → Critic)
> Commit: ca53899 | Status: TODO | Depends on: 007

## Finding
`/api/chapter-production-runs/start-stream` (server.ts:1758-1892) does NOT call any LLM — it generates a synchronous fallback draft via `buildFallbackSceneBeats` + `buildFallbackDraft` (both deterministic, no AI). The Planner (`/api/editor-agent`), Writer (`/api/orchestrate`), and Critic (`/api/audit`) endpoints exist as standalone routes but are never chained in production.

This means the core value proposition ("AI writes your chapter") is currently served by a placeholder.

## Goal
Wire the Planner → Writer → Critic pipeline into the production stream. When Critic scores below 80, loop back to Writer with feedback (max 2 retries). The fallback draft still fires immediately for instant UX.

## Files
| Op | File | Why |
|----|------|-----|
| Create | `server/helpers/ai-production-pipeline.ts` | Orchestration logic: Planner → Writer → Critic loop |
| Modify | `server/routes/production.ts` | Replace fallback-only `/start-stream` with async AI pipeline |
| Modify | `src/config/prompt-templates.ts` | Confirm or add CRITIC_SYSTEM template |

## Steps

### Step 1: Audit existing AI endpoints for I/O contracts
- Action: Read the handler bodies for these endpoints (all in `server/routes/` after plan 007):
  - `/api/editor-agent` — confirm it accepts `{ userIntent, contextStr, surface? }` and returns `{ text }` (scene beats)
  - `/api/orchestrate` — confirm it accepts `{ beats, contextStr }` and returns `{ draft }`
  - `/api/audit` — confirm it accepts `{ chapterContent, contextStr }` and returns an object that includes a quality assessment
- If `/api/audit` does NOT return a numeric score, note this as a prerequisite sub-task: add a `score` field (0-100) to the audit response.
- Verify: Open each route file and document the exact request/response shape in a comment at the top of `ai-production-pipeline.ts`.

### Step 2: Create `server/helpers/ai-production-pipeline.ts`
- Action: Implement `runProductionPipeline()` with this signature:
  ```typescript
  export async function runProductionPipeline(params: {
    userIntent: string;
    contextStr: string;
    onPhaseUpdate: (phase: string) => void;
    signal?: AbortSignal;
  }): Promise<{
    sceneBeats: string;
    draft: string;
    audit: string;
    score: number;
    attempts: number;
  }>
  ```
- Pipeline logic:
  1. **Planner**: POST to `/api/editor-agent` logic (call the underlying function, not HTTP) → `sceneBeats`
  2. **Writer**: Call orchestrate logic → `draft`
  3. **Critic**: Call audit logic → `{ score, suggestions, report }`
  4. If `score < 80` and `attempt < 3`: feed `suggestions` as feedback to Writer, goto step 2
  5. Return final result
- Call `onPhaseUpdate('planner' | 'writer' | 'critic' | 'retry')` for SSE progress.
- Verify: `npx tsc --noEmit` passes.

### Step 3: Wire pipeline into production stream
- Action: In `server/routes/production.ts`, modify `/start-stream`:
  - Keep the immediate fallback phase (Phase 1) — sends `fallback_beats`, `fallback_draft_token`, `fallback_audit` immediately
  - After fallback done, DO NOT end the SSE stream — instead call `runProductionPipeline()` asynchronously
  - On pipeline completion, send via SSE:
    - `{ type: 'ai_beats', content: sceneBeats }`
    - `{ type: 'ai_draft_token', content: chunk }` (tokenized streaming)
    - `{ type: 'ai_audit', content: audit }`
    - `{ type: 'ai_score', score, attempts }`
    - `{ type: 'done', run: updatedRun }`
  - On pipeline error, send `{ type: 'ai_error', message }` — do NOT break the stream
  - Update `chapter_production_runs` record with AI-generated data
- Verify: `npx tsc --noEmit` passes.

### Step 4: Confirm CRITIC_SYSTEM prompt template
- Action: Check `src/config/prompt-templates.ts` for a CRITIC_SYSTEM or similar key. If absent, add a template that instructs the model to return structured JSON with `{ score: number, suggestions: string, report: string }`.
- Verify: `grep -i "critic\|audit" src/config/prompt-templates.ts` returns results.

### Step 5: Frontend integration (if needed)
- Action: Check `src/components/AgentWorkspaceProductionPanel.tsx` for SSE event handling. If it only listens for `fallback_*` events, add handlers for `ai_draft_token`, `ai_audit`, `ai_score`.
- When AI draft arrives, replace the fallback display.
- When score arrives, show the quality score badge.
- Verify: `npx tsc --noEmit` passes; no frontend runtime errors.

## Done Criteria
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] `runProductionPipeline()` calls Planner → Writer → Critic in sequence
- [ ] Critic score < 80 triggers retry (max 2, configurable constant)
- [ ] `/start-stream` sends both fallback and AI events via SSE
- [ ] Frontend handles new AI SSE events without breaking
- [ ] Pipeline respects `AbortSignal` — cancels when client disconnects

## STOP Conditions
- If `/api/audit` does not return a structured score, stop and implement scoring before continuing.
- If the LLM call for any phase times out within the 120s global server timeout, stop and consider moving pipeline to background job pattern (like story-cards uses).
- If the pipeline produces worse output than the fallback (edge case), still present it — the user decides.

## Maintenance notes
- `MAX_RETRIES` and `SCORE_THRESHOLD` should be named constants at the top of `ai-production-pipeline.ts`, not magic numbers.
- Future: consider making retry count and threshold configurable per-novel via `project_preference_profile`.
