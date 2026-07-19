# Plan 040: Scene-level entity — chapters × scenes hierarchy
> Priority: P3 | Effort: L | Risk: MEDIUM | Category: direction

## Why
Professional authors plan at scene granularity. InkFlow only supports chapter-level. Adding scenes enables word-count targets, POV assignment, and status tracking.

## Steps

### Step 1: Add Scene type + DB table
- `src/types.ts`: `Scene { id, chapterId, novelId, title, content, order, wordCount, pov, status, createdAt, updatedAt }`
- `src/lib/db.ts`: `CREATE TABLE scenes (...)` + CRUD functions
- Verify: `npx tsc --noEmit` + `db.listScenes(chapterId)` works

### Step 2: Scene CRUD to DB whitelist
- `server/routes/db.ts`: add scene methods to whitelist
- Verify: create/list/delete scene via proxy

### Step 3: ChapterSidebar scene list
- Collapsible scene list under each chapter
- WritingSurface scene selector dropdown
- Verify: `pnpm dev` — scenes visible and switchable

### Step 4: Production pipeline scene-level planning
- Per-scene beats generation
- Verify: generate chapter with 3 scenes, each has beats

## Done: tsc passes, scene CRUD works, UI integrated
