# Legacy Artifact Structuring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit, non-destructive maintenance flow that previews and confirms structured versions for legacy world, character, outline, scene-beat, and narrative-promise sources.

**Architecture:** A shared descriptor and preview contract crosses client/server boundaries. Source discovery and preview are read-only; preview tokens remain in bounded process memory. Confirmation reloads the source, validates generation and fingerprint, then delegates to the owning persistence lifecycle.

**Tech Stack:** React, TypeScript, Express, Zod, SQLite/better-sqlite3, node:test, Vitest.

## Current Status (2026-08-17)

**DONE.** Five legacy source families support read-only discovery, strict preview, guarded confirmation, and an explicit maintenance UI. Verification: isolated Node regression `65/65`, focused frontend regression `49/49`, and `npm run typecheck` exit `0`. The original RED/GREEN/commit checkboxes are retained as historical execution steps.

## Global Constraints

- No new dependencies and no background scan, model call, or write while opening a project.
- Preview must preserve original readable text and persist nothing.
- Confirmation must revalidate novel ownership, database generation, preview expiry, and current source fingerprint.
- Parser/model failure must leave source rows and active structured versions unchanged.
- Tests use only `:memory:` or an isolated test database.
- Stop after focused tests, typecheck, target lint, diff-check, and task review pass; defer non-blocking visual polish.

---

### Task 1: Shared Contract, Source Discovery, and Strict Parsing

**Files:**
- Create: `shared/types/legacy-artifact-structuring.ts`
- Create: `server/helpers/legacy-artifact-structuring.ts`
- Test: `tests/legacy-artifact-structuring.test.ts`

**Interfaces:**
- Produces: `LegacyArtifactSource`, `LegacyArtifactPreview`, `listLegacyArtifactSources(novelId)`, `buildLegacyStructuringPrompt(source)`, `parseLegacyStructuringOutput(source, raw)`, `confirmLegacyStructuringPreview(input)`.
- Consumes: existing novel, character, outline, chapter, foreshadowing, creative-artifact-version, and Canon Patch repositories.

- [ ] **Step 1: Write failing source-discovery and prompt-contract tests**

Add table-driven fixtures for all five source families. Assert discovery omits already structured sources, does not mutate row counts, and the prompt contains `只输出 JSON`, `不得编造`, the artifact kind, and the exact source text.

- [ ] **Step 2: Run RED**

Run:

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/legacy-artifact-structuring.test.ts
```

Expected: fail because `server/helpers/legacy-artifact-structuring.ts` does not exist.

- [ ] **Step 3: Implement strict descriptors and parsers**

Use this public contract:

```ts
export type LegacyStructurableKind = CreativeArtifactKind;
export interface LegacyArtifactSource {
  novelId: string;
  artifactKind: LegacyStructurableKind;
  artifactId: string;
  label: string;
  originalContent: string;
  artifactVersion: number;
  sourceFingerprint: string;
}
export interface LegacyArtifactPreview {
  previewId: string;
  source: LegacyArtifactSource;
  proposedCore: Record<string, unknown>;
  proposedContent?: string;
  expiresAt: number;
}
```

Normalize world and character through existing helpers, validate outline cores with `isStructuredOutlineCore`, narrative promises with `normalizeNarrativePromiseCore`, and scene beats as `{ schemaVersion: 1, beats: [{ order, summary, intent }] }`. Reject empty normalized cores.

- [ ] **Step 4: Add confirmation adapter tests and implementation**

Assert stale fingerprints and stale generation write nothing. For accepted confirmation, assert outlines create/accept a Canon Patch while other kinds create the next `creative_artifact_cores` version with `readableContent === originalContent` and provenance source `legacy-artifact-structuring`.

- [ ] **Step 5: Run GREEN and commit**

Run the Task 1 test command, `npm run typecheck`, target ESLint, and `git diff --check`, then commit the three files.

---

### Task 2: Explicit HTTP Preview and Confirmation

**Files:**
- Create: `server/routes/legacy-artifact-structuring.ts`
- Modify: `server/routes/index.ts`
- Test: `tests/legacy-artifact-structuring.test.ts`

**Interfaces:**
- Produces: `GET /api/novels/:novelId/legacy-artifacts`, `POST /api/novels/:novelId/legacy-artifacts/preview`, and `POST /api/novels/:novelId/legacy-artifacts/confirm`.
- Consumes: Task 1 descriptors/parsers/confirmation and the governed LLM execution gate.

- [ ] **Step 1: Write failing route tests**

Assert route registration is reachable; GET is read-only; no provider request occurs before POST preview; preview returns the unchanged source plus a preview ID; malformed model JSON returns 422 and creates no version; confirm returns the accepted domain result.

- [ ] **Step 2: Run RED**

Run the focused Node command and expect 404 for the unregistered routes.

- [ ] **Step 3: Implement guarded routes**

Validate IDs and generation with Zod. Preview loads the server-owned source, creates an LLM execution session named `legacy-artifact-structuring`, parses strict JSON, and stores the preview in a module-local Map capped at 100 entries with a 15-minute expiry. Confirm accepts only `{ previewId, databaseGeneration }` and deletes the preview after successful confirmation.

- [ ] **Step 4: Run GREEN and commit**

Run the focused Node test, typecheck, target ESLint, and diff-check, then commit route, registration, and tests.

---

### Task 3: Advanced Maintenance UI

**Files:**
- Create: `src/lib/legacy-artifact-client.ts`
- Create: `src/components/LegacyArtifactStructuringPrompt.tsx`
- Modify: `src/components/SkillsStudioView.tsx`
- Test: `src/tests/legacy-artifact-structuring.test.tsx`

**Interfaces:**
- Produces: a collapsed advanced-maintenance control for the selected novel.
- Consumes: Task 2 HTTP contract and localStorage key `inkflow-legacy-structuring-dismissals:<novelId>`.

- [ ] **Step 1: Write failing component tests**

Assert mount performs no request; clicking `检查旧产物` lists sources; clicking `生成结构化预览` is the first preview request; preview renders original and proposed data; failed preview leaves confirm unavailable; confirm calls the API; dismissal hides only the current fingerprint and a changed fingerprint reappears.

- [ ] **Step 2: Run RED**

Run:

```bash
npx vitest -c vitest.config.frontend.ts run src/tests/legacy-artifact-structuring.test.tsx
```

Expected: fail because the component and client do not exist.

- [ ] **Step 3: Implement the minimal UI**

Render one unframed advanced-maintenance section in `SkillsStudioView` when `selectedNovel` exists. Use explicit text commands, loading/error states, source selector, side-by-side original/proposed preview, confirm, cancel, and dismiss. Never call discovery or preview from an effect.

- [ ] **Step 4: Run GREEN and final gates**

Run the focused frontend and Node tests, `npm run typecheck`, target ESLint, and `git diff --check`.

- [ ] **Step 5: Commit**

Commit client, component, SkillsStudio integration, and tests. Update the SDD report with RED/GREEN evidence and remaining risks.
