# Plan 007: Split server.ts routes into server/routes/
> Commit: ca53899 | Status: TODO | Depends on: 006

## Finding
`server.ts` has 30 route definitions (lines 847-2601). Only 4 groups are extracted (`db`, `config`, `simple-llm`, `export`). The remaining 20+ routes are stuck, documented in `server/routes/index.ts:10-27`.

## Goal
Extract all remaining routes into `server/routes/` by functional domain. After extraction, `server.ts` becomes a thin `initApp()` entry point (< 100 logic lines).

## Files
| Op | File | Routes |
|----|------|--------|
| Create | `server/routes/onboarding.ts` | `/api/story-cards`, `/api/story-cards/jobs/:jobId`, `/api/setup-task-refine`, `/api/extract-world-setup` |
| Create | `server/routes/agents.ts` | `/api/editor-agent`, `/api/inspiration`, `/api/orchestrate`, `/api/orchestrate-draft` |
| Create | `server/routes/production.ts` | `/api/chapter-production-runs/start`, `/start-stream`, `/:runId/apply` |
| Create | `server/routes/audit.ts` | `/api/audit`, `/api/rewrite` |
| Create | `server/routes/skills.ts` | `/api/extract-skill`, `/api/extract-skill/jobs/:jobId` |
| Create | `server/routes/continuation.ts` | `/api/continuation-packs/parse`, `/api/parse-doc` |
| Create | `server/routes/world.ts` | `/api/generate-bio`, `/api/generate-outline`, `/api/extract-entities`, `/api/detect-foreshadowing`, `/api/analyze-pacing`, `/api/generate-entity-details` |
| Create | `server/routes/prompt-test.ts` | `/api/prompt-template-test` |
| Modify | `server/routes/index.ts` | Register all new route modules |
| Modify | `server.ts` | Delete extracted route definitions; keep only `initApp()` + middleware + `registerRoutes()` call |

## Steps

### Step 1: Create route file template
- Use `server/routes/simple-llm.ts` as the structural template. Every route file:
  - Imports `type { Express }` from `express`
  - Imports `db` from `../src/lib/db`
  - Imports required helpers from `server/helpers/`
  - Exports a single `registerXxxRoutes(app: Express)` function
- Verify: `grep -A3 "import.*Express" server/routes/simple-llm.ts` confirms the pattern.

### Step 2: Extract onboarding routes
- Create `server/routes/onboarding.ts` with routes: `/api/story-cards` (server.ts:969), `/api/story-cards/jobs/:jobId` (server.ts:1029), `/api/setup-task-refine` (server.ts:1037), `/api/extract-world-setup` (server.ts:1067).
- Import `createStoryCardJob`, `buildFallbackStoryCards`, etc. from `server/helpers/story-cards`.
- Register in `server/routes/index.ts`, remove from `server.ts`.
- Verify: `npx tsc --noEmit` passes.

### Step 3: Extract agent routes
- Create `server/routes/agents.ts` with: `/api/editor-agent` (server.ts:1135), `/api/inspiration` (server.ts:944), `/api/orchestrate` (server.ts:1493), `/api/orchestrate-draft` (server.ts:1604).
- Verify: `npx tsc --noEmit` passes.

### Step 4: Extract production routes
- Create `server/routes/production.ts` with: `/api/chapter-production-runs/start` (server.ts:1651), `/start-stream` (server.ts:1758), `/:runId/apply` (server.ts:1912).
- Includes SSE helper `sseWrite` — import from `server/helpers/async-utils`.
- Verify: `npx tsc --noEmit` passes.

### Step 5: Extract audit routes
- Create `server/routes/audit.ts` with: `/api/audit` (server.ts:1383), `/api/rewrite` (server.ts:1446).
- Verify: `npx tsc --noEmit` passes.

### Step 6: Extract skills routes
- Create `server/routes/skills.ts` with: `/api/extract-skill` (server.ts:2182), `/api/extract-skill/jobs/:jobId` (server.ts:2237).
- Import `createSkillExtractionJob`, `buildFullFallbackSkillResult` from `server/helpers/skill-extraction`.
- Verify: `npx tsc --noEmit` passes.

### Step 7: Extract continuation routes
- Create `server/routes/continuation.ts` with: `/api/continuation-packs/parse` (server.ts:1284), `/api/parse-doc` (server.ts:1211).
- Import `buildContinuationContext`, `classifyContinuationSource` from `../src/lib/continuation-pack` (already external).
- Verify: `npx tsc --noEmit` passes.

### Step 8: Extract world routes
- Create `server/routes/world.ts` with: `/api/generate-bio` (server.ts:2252), `/api/generate-outline` (server.ts:2290), `/api/extract-entities` (server.ts:2326), `/api/detect-foreshadowing` (server.ts:2364), `/api/analyze-pacing` (server.ts:2397), `/api/generate-entity-details` (server.ts:2549).
- Verify: `npx tsc --noEmit` passes.

### Step 9: Extract prompt-test route
- Create `server/routes/prompt-test.ts` with: `/api/prompt-template-test` (server.ts:915).
- Import `buildPromptTemplateTest` from `server/helpers/prompt-helpers`.
- Verify: `npx tsc --noEmit` passes.

### Step 10: Register all routes in index.ts
- In `server/routes/index.ts`, add `registerXxxRoutes(app)` calls for all 8 new modules.
- Verify: `npx tsc --noEmit` passes.

### Step 11: Clean up server.ts
- Remove all extracted route definitions. Keep only:
  - Imports (lines 1-65)
  - `initApp()` function
  - Middleware setup (express.json, timeout, authMiddleware)
  - DB_WHITELIST
  - `/api/db` proxy (keep — it's tightly coupled to `app`)
  - `/api/db/events` SSE (keep — it's tightly coupled to `app`)
  - `/api/config` routes (keep — already extracted but simple enough)
  - `registerRoutes(app)` call
  - Production static file serving
- Target: `server.ts` < 100 logic lines (not counting imports/whitespace/comments).
- Verify: `wc -l server.ts` shows significant reduction; `npx tsc --noEmit` passes.

### Step 12: End-to-end smoke test
- Verify: `pnpm dev` starts successfully.
- Verify: `node scripts/runtime-smoke.mjs` exits successfully.

## Done Criteria
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All 30 routes are defined in `server/routes/` files
- [ ] `server.ts` contains only `initApp()` + middleware + DB proxy + config + static serving
- [ ] `pnpm dev` starts and responds to API requests
- [ ] `node scripts/runtime-smoke.mjs` passes
- [ ] No duplicate route registrations

## STOP Conditions
- If any route depends on a closure variable not available in the extracted module, stop and add it as a parameter.
- If two routes share significant logic that's hard to split, merge them into the same file rather than duplicating.
- If `pnpm dev` fails to start after extraction, revert the last module and investigate.
