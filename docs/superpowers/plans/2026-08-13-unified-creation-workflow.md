# Unified Creation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable, versioned creation workflow from project creation or import through chapter completion and creation of the next chapter, with structured artifacts, story memory, and capability-driven candidates.

**Architecture:** Extend the existing SQLite domain records and candidate/preview patterns instead of introducing a new orchestration framework or graph database. Preserve readable legacy text, add structured cores and versioned candidates, project story memory from authoritative records, then converge the Editor on one state-derived chapter action.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Express 4, SQLite via better-sqlite3, Node test runner, Vitest, Playwright.

## Global Constraints

- Do not add dependencies.
- Preserve the React + TypeScript + Vite + Express + SQLite architecture.
- Schema changes must be additive; existing text and manuscript content must remain readable and unchanged until an author accepts a candidate.
- No AI result modifies manuscript text or Canon without confirmation.
- Every write must validate novel ownership and database generation.
- Candidate application must reject stale base fingerprints and run transactionally.
- Manual writing, saving, and chapter creation remain available when AI is not configured or its state is unknown.
- Use `:memory:` or a unique temporary database for every backend test; never write the running `data.db`.
- Do not modify the current unrelated worktree changes in `src/lib/capability-stage-cards.ts` or the existing modified frontend tests.
- Mobile and whole-book publishing are out of scope.

## Source Design

- `docs/superpowers/specs/2026-08-13-unified-creation-workflow-design.md`

## Delivery Strategy

This plan is intentionally split into five reviewable stacks. A stack is complete only after its focused tests, typecheck, target lint, and `git diff --check` pass. Do not start a dependent stack until the preceding contract is accepted.

```text
Stack 1: domain and persistence
    -> Stack 2: candidate and capability runtime
        -> Stack 3: planning, character, and story memory
            -> Stack 4: chapter completion and Editor workflow
                -> Stack 5: migration and end-to-end journey gate
```

This is the integration master plan. Before executing each stack, the Coordinator must copy that stack's accepted interfaces and owned files into a narrow execution plan. Do not dispatch the entire master plan as one implementation task.

### Existing Authority Map

The implementation must preserve these current sources of truth:

```text
Master/volume/chapter outline -> active outline_artifacts row
Novel.globalOutline          -> compatibility mirror of active master
Manuscript                    -> chapters + chapter_versions
Manuscript candidate          -> chapter_production_runs + versions
Foreshadowing lifecycle       -> foreshadowings
Entity Canon                  -> existing character/item/location/faction/timeline tables
Relationships                 -> entity_relationships
```

The common candidate lifecycle is implemented through adapters over these stores. New generic persistence is used only where no governed candidate/version store exists. It must not duplicate an existing authoritative artifact.

---

### Task 1: Add Structured Artifact and Story-Memory Types

**Files:**
- Create: `shared/types/creative-artifacts.ts`
- Create: `shared/types/story-memory.ts`
- Modify: `shared/types/index.ts`
- Modify: `shared/types/world.ts`
- Modify: `shared/types/novel.ts`
- Test: `tests/creative-artifact-contracts.test.ts`

**Interfaces:**
- Produces: `CreativeArtifactKind`, `CreativeArtifactRef`, `StructuredOutlineCore`, `StructuredWorldCore`, `CharacterCore`, `ArtifactCandidate`, `ArtifactDiff`, `ArtifactImpactReport`, `NarrativePromiseCore`, `ChapterCompletionGate`.
- Consumes: existing `Foreshadowing`, `ChapterWorkflowMeta`, and outline governance types.

- [ ] **Step 1: Write contract tests for exact unions and safe legacy absence**

Create `tests/creative-artifact-contracts.test.ts` with compile-time fixtures plus runtime assertions that:

```ts
const legacyCharacter: Character = {
  id: 'c1', novelId: 'n1', name: '叶半夏', role: 'protagonist',
  summary: '药师', traits: [], bio: '',
};
assert.equal(legacyCharacter.core, undefined);

const promise: NarrativePromiseCore = {
  schemaVersion: 1,
  plan: {
    intent: '戒指身份悬念',
    plannedHintRanges: [{ from: 3, to: 5 }],
    sourceOutlineNodeIds: ['master-hook-1'],
  },
  evidence: [],
};
assert.equal(promise.evidence.length, 0);
```

Also assert that `Foreshadowing.status` remains the compatibility union `planted | hinted | payoff` and is not inferred from a plan fixture.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
NODE_ENV=test node --test --test-concurrency=1 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-contracts.test.ts
```

Expected: FAIL because the new shared modules and fields do not exist.

- [ ] **Step 3: Define the minimal shared contracts**

Implement the design types verbatim. Add optional compatibility fields only:

```ts
interface Character {
  // existing fields unchanged
  core?: CharacterCore;
  coreVersion?: number;
}

interface Foreshadowing {
  // existing fields unchanged
  narrativeCore?: NarrativePromiseCore;
  coreVersion?: number;
}
```

Extend `ChapterWorkflowMeta` additively with `completionGate?`, `completionDecisionAt?`, and `factCandidateId?`. Do not make new fields required for legacy rows.

- [ ] **Step 4: Run contract checks**

Run the focused Node test and `npm run typecheck`. Expected: both PASS.

- [ ] **Step 5: Commit Stack 1 types**

```bash
git add shared/types/creative-artifacts.ts shared/types/story-memory.ts shared/types/index.ts shared/types/world.ts shared/types/novel.ts tests/creative-artifact-contracts.test.ts
git commit -m "feat: define governed creative artifact contracts"
```

---

### Task 2: Add Additive Persistence for Structured Cores and Missing Candidate Domains

**Files:**
- Modify: `server/lib/db-init.ts`
- Create: `server/lib/db/creative-artifacts.ts`
- Modify: `server/lib/db.ts`
- Modify: `server/routes/db.ts`
- Test: `tests/creative-artifact-schema.test.ts`
- Test: `tests/db-import-serialization.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces: `getArtifactCore`, `saveArtifactVersion`, `createArtifactCandidate`, `getArtifactCandidate`, `listArtifactCandidates`, `applyArtifactCandidateDecision`, `markArtifactReviewRequired`.

- [ ] **Step 1: Write isolated schema characterization tests**

Use a unique temporary SQLite file. Assert initialization creates:

```text
creative_artifact_cores
creative_artifact_versions
creative_artifact_candidates
artifact_review_requirements
```

Required ownership and foreign-key fields:

```text
novel_id, artifact_kind, artifact_id, version
```

Candidate rows additionally store `operation`, `goal`, `base_fingerprint`, `source_capability_versions`, `proposed_core`, `proposed_content`, `diff`, `impact_report`, and `status`. In this stack, generic candidate rows are valid only for structured world and character candidates. Outline and manuscript candidates remain in their existing stores.

Assert a legacy database with only existing outline/character/foreshadowing rows initializes without rewriting those rows.

- [ ] **Step 2: Run schema tests and verify RED**

Run:

```bash
NODE_ENV=test node --test --test-concurrency=1 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-schema.test.ts
```

Expected: FAIL because the additive tables and CRUD do not exist.

- [ ] **Step 3: Add tables and indexes**

Add explicit `CREATE TABLE IF NOT EXISTS` statements and indexes for novel/artifact lookup, candidate status, and review requirement lookup. Use JSON text columns following existing project conventions. Add foreign keys to `novels`; do not add polymorphic foreign keys that SQLite cannot enforce.

Do not add columns to every domain table in this task. Store structured cores by `(novel_id, artifact_kind, artifact_id)` so legacy domain rows remain stable. Add a check constraint or domain guard that rejects generic outline/manuscript candidates; their adapters use existing storage.

- [ ] **Step 4: Implement strict row mapping and CRUD**

Parse stored JSON through explicit guards. Invalid candidate/core JSON must throw a domain error such as `CREATIVE_ARTIFACT_INVALID_DATA`; it must not fall back to empty accepted data.

Candidate decisions must be idempotent. Only `pending -> accepted | rejected | stale` is allowed.

- [ ] **Step 5: Extend database import validation**

Update governance schema expectations so a valid new database is accepted and forged/incomplete candidate tables or indexes are rejected. Preserve compatibility for pre-feature databases that are upgraded by normal initialization before import replacement.

- [ ] **Step 6: Run persistence gates**

```bash
NODE_ENV=test node --test --test-concurrency=1 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-schema.test.ts tests/db-import-serialization.test.ts
npm run typecheck
npx eslint server/lib/db-init.ts server/lib/db/creative-artifacts.ts server/routes/db.ts tests/creative-artifact-schema.test.ts
git diff --check
```

Expected: all PASS.

- [ ] **Step 7: Commit persistence**

```bash
git add server/lib/db-init.ts server/lib/db/creative-artifacts.ts server/lib/db.ts server/routes/db.ts tests/creative-artifact-schema.test.ts tests/db-import-serialization.test.ts
git commit -m "feat: persist governed creative artifact candidates"
```

---

### Task 3: Implement Candidate Fingerprints, Diffs, Adapters, and Transactional Apply

**Files:**
- Create: `shared/lib/creative-artifact-fingerprint.ts`
- Create: `shared/lib/creative-artifact-diff.ts`
- Create: `server/helpers/creative-artifact-candidates.ts`
- Create: `server/helpers/creative-artifact-candidate-adapters.ts`
- Create: `server/routes/creative-artifacts.ts`
- Modify: `server.ts`
- Test: `tests/creative-artifact-candidates.test.ts`

**Interfaces:**
- Produces:

```ts
fingerprintCreativeArtifact(input: { kind: CreativeArtifactKind; core?: unknown; content?: string; version: number }): string
buildArtifactDiff(base: unknown, proposed: unknown): ArtifactDiff
previewArtifactCandidate(input: PreviewArtifactCandidateInput): ArtifactCandidate
acceptArtifactCandidate(input: AcceptArtifactCandidateInput): AcceptedArtifactVersion
```

- [ ] **Step 1: Write candidate lifecycle tests**

Cover:

1. Preview is read-only.
2. Stable equivalent input produces the same SHA-256 fingerprint.
3. Accept rejects wrong novel, database generation, changed base fingerprint, invalid capability output, and already rejected candidates.
4. Accept creates a new version, records capability versions and author decision, and marks only reported downstream refs as `review-required`.
5. Repeating the same accepted request is idempotent.
6. Manuscript conflicts remain an impact item and never update `chapters.content`.
7. Outline preview/apply delegates to `outline_artifacts` / `canon_patches`; manuscript preview delegates to production runs/versions; neither creates a generic duplicate candidate row.

- [ ] **Step 2: Run tests and verify RED**

Run the focused Node test with `--test-concurrency=1`. Expected: missing route/helpers.

- [ ] **Step 3: Implement stable fingerprints and structured diffs**

Use Node `crypto.createHash('sha256')` and deterministic key ordering. Do not compare JSON with raw string order. Diffs must report added, changed, and removed field paths without embedding full manuscript content into logs or product events.

- [ ] **Step 4: Implement preview/apply routes**

Add one facade over the domain adapters:

```text
POST /api/novels/:novelId/artifacts/candidates/preview
GET  /api/novels/:novelId/artifacts/candidates/:candidateId
POST /api/novels/:novelId/artifacts/candidates/:candidateId/accept
POST /api/novels/:novelId/artifacts/candidates/:candidateId/reject
```

Validate request bodies with Zod, capture database generation before work, and apply through one DB transaction. Return stable author-facing codes for invalid input, stale base, ownership mismatch, and unsupported artifact operations.

Adapter rules:

```text
world | character       -> generic creative_artifact_candidates
master/volume/chapter   -> outline_artifacts and canon_patches
scene-beats | manuscript -> chapter production runs and versions
```

Reject an operation if its domain adapter cannot preserve the existing source of truth and stale-check contract.

- [ ] **Step 5: Run lifecycle gates and commit**

```bash
NODE_ENV=test node --test --test-concurrency=1 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-candidates.test.ts
npm run typecheck
npx eslint shared/lib/creative-artifact-fingerprint.ts shared/lib/creative-artifact-diff.ts server/helpers/creative-artifact-candidates.ts server/helpers/creative-artifact-candidate-adapters.ts server/routes/creative-artifacts.ts
git diff --check
git add shared/lib/creative-artifact-fingerprint.ts shared/lib/creative-artifact-diff.ts server/helpers/creative-artifact-candidates.ts server/helpers/creative-artifact-candidate-adapters.ts server/routes/creative-artifacts.ts server.ts tests/creative-artifact-candidates.test.ts
git commit -m "feat: add creative artifact candidate lifecycle"
```

---

### Task 4: Extend Capability Contracts and Separate Usage Semantics

**Files:**
- Modify: `shared/types/capability-manifest.ts`
- Modify: `shared/lib/capability-manifest-catalog.ts`
- Create: `shared/lib/artifact-capability-contract.ts`
- Create: `shared/lib/capability-composition.ts`
- Modify: `server/capabilities/manifest.ts`
- Modify: `server/validation.ts`
- Test: `tests/artifact-capability-contract.test.ts`
- Test: `tests/capability-manifest-v3.test.ts`

**Interfaces:**
- Produces: `ArtifactCapabilityContract`, `CapabilityUsageMode`, `validateArtifactCapabilityExecution`, `composeArtifactCapabilities`.
- Consumes: artifact kinds and operations from Task 1.

- [ ] **Step 1: Write compatibility and routing tests**

Assert:

- `bible-character-arc` targets `character`, operation `restructure`, output `artifact-candidate`, `canonEffect: candidate-only`.
- `bible-world-builder` targets `world`, not generic `outline-candidate`.
- `opening-gold-three` targets master/volume/chapter outlines as declared, not every Planner surface.
- prose configuration cards retain `persistent-rule` or `single-run` semantics.
- incompatible artifact/operation/scope is rejected before model execution.
- legacy manifests without the new contract remain readable but cannot execute an artifact transformation until projected through the catalog normalizer.
- compatible multi-card rules produce one frozen snapshot and one candidate; conflicting rules return exact field conflicts before model execution.
- a diagnosed goal is preselected but can be replaced by an author-supplied allowed goal.

- [ ] **Step 2: Run tests and verify RED**

Expected: contract fields and validator missing.

- [ ] **Step 3: Add explicit contracts without changing card IDs**

Extend catalog projection instead of creating duplicate cards. Preserve existing source type, availability, and stage metadata. Define usage separately from operation:

```ts
usageModes: CapabilityUsageMode[];
artifactContract?: ArtifactCapabilityContract;
```

- [ ] **Step 4: Gate server execution**

Validate artifact kind, operation, scope, required input refs, runtime status, and capability version before quota reservation or model execution. Missing flow prerequisites return an explicit artifact-gap response.

Implement composition as a pure function. It returns either a frozen ordered set with a selected goal or `CapabilityCompositionConflict[]`. Do not resolve conflicts by array order.

- [ ] **Step 5: Run and commit**

Run focused capability tests, `npm run typecheck`, target ESLint, and `git diff --check`; then commit only the listed files.

---

### Task 5: Add Version-Frozen Creation Flow Sessions

**Files:**
- Create: `shared/types/creation-flow.ts`
- Create: `server/lib/db/creation-flows.ts`
- Modify: `server/lib/db-init.ts`
- Modify: `server/lib/db.ts`
- Create: `server/routes/creation-flows.ts`
- Modify: `server.ts`
- Test: `tests/creation-flow-session.test.ts`

**Interfaces:**
- Produces: `CreationFlowDefinition`, `CreationFlowStep`, `CreationFlowSession`, `startCreationFlow`, `recordAcceptedFlowOutput`, `buildFlowMigrationCandidate`.
- Consumes: accepted artifact versions and capability contracts from Tasks 3-4.

- [ ] **Step 1: Write flow behavior tests**

Cover:

1. Starting a flow freezes capability IDs and versions.
2. A flow stores ordering and dependencies, not copied prompt/card payloads.
3. An atomic capability can run outside the flow when required artifact refs exist.
4. Missing prerequisites return exact missing artifact kinds.
5. Running a capability does not complete a step; accepting a compatible output version does.
6. Imported projects skip satisfied stages and enter the first missing/stale stage.
7. Updating a catalog capability creates a migration candidate and does not mutate the active session.

- [ ] **Step 2: Run and verify RED**

Run only `tests/creation-flow-session.test.ts` against an isolated database.

- [ ] **Step 3: Add additive session persistence**

Create `creation_flow_sessions` with frozen definition JSON, current step, accepted output refs, status, database generation, and timestamps. Keep runtime abort handles in memory only.

- [ ] **Step 4: Implement start, inspect, advance, and migration preview routes**

No route may mark a step complete without an accepted artifact version matching `producedArtifactKind` and the frozen capability version.

- [ ] **Step 5: Run focused gates and commit**

Run Node tests serially, typecheck, target lint, and `git diff --check` before committing.

---

### Task 6: Add Structured Outline Cores and Cross-Level Validation

**Files:**
- Modify: `shared/types/outline-governance.ts`
- Create: `shared/lib/outline-structure.ts`
- Create: `server/helpers/outline-impact.ts`
- Modify: `server/lib/db/outlines.ts`
- Modify: `server/routes/outlines.ts`
- Modify: `server/routes/canon-patches.ts`
- Test: `tests/outline-structure.test.ts`
- Test: `tests/outline-governance.test.ts`
- Test: `tests/outline-routes.test.ts`

**Interfaces:**
- Produces: `validateOutlineHierarchy`, `buildOutlineImpactReport`, and accepted outline version refs.
- Consumes: candidate apply and review requirement APIs from Tasks 2-3.

- [ ] **Step 1: Write cross-level tests**

Cover parent node references, non-overlapping scope validation, missing master prerequisites, premature narrative-promise payoff, planned action without an existing promise, lost upstream nodes, and stale downstream marking after master/volume activation.

- [ ] **Step 2: Characterize legacy activation**

Preserve current behavior: an active master mirrors readable `Novel.globalOutline`; activating a changed master demotes stale scoped outlines. Add structured impacts without weakening the existing fingerprint checks.

Treat the active master artifact as authoritative and update `Novel.globalOutline` in the same transaction as a compatibility mirror. Add an integrity test that deliberately creates divergence and expects a diagnostic error or repair candidate; never resolve divergence by timestamp guessing.

- [ ] **Step 3: Implement deterministic hierarchy validation**

Validate IDs, scopes, parent references, node order, character/foreshadowing references, and planned ranges without a model call. Semantic quality remains an optional diagnostic capability.

- [ ] **Step 4: Route all outline transformations through candidates**

Existing direct user edits may continue saving readable text. Capability-driven generate/restructure/optimize operations must produce an `ArtifactCandidate`; they cannot directly activate an outline.

- [ ] **Step 5: Run focused outline gates and commit**

Run the three focused tests, typecheck, target lint, and `git diff --check`.

---

### Task 7: Add Structured World and Character Governance

**Files:**
- Create: `shared/lib/character-core.ts`
- Create: `shared/lib/world-core.ts`
- Create: `server/helpers/character-candidates.ts`
- Modify: `server/routes/world.ts`
- Modify: `server/routes/continuation.ts`
- Modify: `src/components/world-bible/CharactersTab.tsx`
- Test: `tests/character-core.test.ts`
- Test: `tests/character-candidate-route.test.ts`
- Test: `tests/pack-sync-integration.test.ts`
- Test: `src/tests/character-candidate-review.test.tsx`

**Interfaces:**
- Produces: structured character/world candidate normalizers and field-level Canon provenance.
- Consumes: candidate lifecycle and capability contracts.

- [ ] **Step 1: Write character completeness and Canon tests**

Define deterministic completeness checks for desire, goal, fear/belief, contradiction, speech/decision patterns, arc, and immutable facts. Empty fields create diagnostic gaps; they do not invent content.

Assert imported summary/Bio/traits remain unchanged after diagnosis and after candidate preview. Only accepted candidate fields update the active core.

- [ ] **Step 2: Preserve imported evidence provenance**

Extend continuation sync output additively so extracted character facts retain source-document references. Do not increase existing prompt/entity bounds or auto-accept extracted facts.

- [ ] **Step 3: Convert character/world capability output to governed candidates**

Reuse `bible-character-arc` and `bible-world-builder`. Remove generic `outline-candidate` output from their runtime path. Produce field-level diffs and impacts on outline nodes, relationships, and narrative promises.

- [ ] **Step 4: Add one reusable candidate review surface**

The Character view shows current readable Bio plus structured gaps and candidate differences. It must not add a permanent card-heavy dashboard or force store navigation.

- [ ] **Step 5: Run focused backend/frontend gates and commit**

Run the listed Node/Vitest tests, typecheck, target lint, and `git diff --check`.

---

### Task 8: Extend Foreshadowing into Narrative-Promise Planning and Evidence

**Files:**
- Modify: `server/lib/db/ideas.ts`
- Create: `shared/lib/narrative-promise.ts`
- Modify: `shared/lib/story-state-ledger.ts`
- Modify: `shared/lib/chapter-production.ts`
- Modify: `src/lib/continuity-critic.ts`
- Modify: `server/routes/production.ts`
- Test: `tests/narrative-promise.test.ts`
- Test: `tests/chapter-production.test.ts`
- Test: `tests/production-versions.test.ts`

**Interfaces:**
- Produces: `deriveForeshadowingCompatibilityStatus`, `validateNarrativePromisePlan`, `buildNarrativePromiseImpacts`.
- Consumes: outline node references and candidate apply.

- [ ] **Step 1: Write plan-versus-evidence tests**

Cover:

- planned payoff without manuscript evidence remains not paid off;
- confirmed plant/hint/payoff evidence derives compatibility status;
- missed planned range reports overdue/deferred impact;
- manuscript-discovered promise produces a candidate, not a committed foreshadowing row;
- changing a promise plan does not erase evidence;
- the Writer context receives only relevant open promises and reveal constraints.

- [ ] **Step 2: Add narrative core persistence through existing artifact core storage**

Keep the existing `foreshadowings` row and status for compatibility. Store structured plan/evidence in the governed core table keyed to the foreshadowing ID.

- [ ] **Step 3: Update continuity review output**

Replace direct `foreshadowingUpdates` application with chapter-fact candidate items containing action, evidence quote, and location. Existing production runs without evidence remain readable but cannot auto-create or auto-pay off a promise.

- [ ] **Step 4: Run focused gates and commit**

Run tests serially because they touch DB singletons; then typecheck, target lint, and `git diff --check`.

---

### Task 9: Project Chapters and Narrative Promises into Story Memory

**Files:**
- Create: `shared/lib/story-memory-projection.ts`
- Modify: `src/components/RelationshipGraph.tsx`
- Modify: `src/components/WorldBibleView.tsx`
- Modify: `src/components/AgentWorkspace.tsx`
- Modify: `src/components/ForeshadowingPanel.tsx`
- Test: `tests/story-memory-projection.test.ts`
- Test: `src/tests/story-memory-graph.test.tsx`
- Test: `src/tests/relationship-graph.test.tsx`

**Interfaces:**
- Produces: `StoryMemoryNode`, `StoryMemoryEdge`, `projectStoryMemory`.
- Consumes: authoritative character/entity/relationship/chapter/timeline/narrative-promise records.

- [ ] **Step 1: Write pure projection tests**

Assert stable node/edge IDs, no duplicate authoritative state, chapter-to-promise plant/hint/payoff edges, and filtered current-chapter projection without losing the global graph.

- [ ] **Step 2: Extend the graph renderer without a new visualization dependency**

Reuse the existing graph component and icons. Add node-kind styling and accessible labels for chapters and narrative promises. Keep graph data read-only; edits route to domain candidate surfaces.

- [ ] **Step 3: Demote manual foreshadowing scanning**

Remove `AI 扫描当前章节伏笔` from the primary Agent workspace navigation. Preserve it in an advanced maintenance surface for legacy manuscript recovery. Normal chapter completion updates memory through fact candidates.

- [ ] **Step 4: Run frontend projection gates and commit**

Run focused Node/Vitest tests, typecheck, target lint, and `git diff --check`.

---

### Task 10: Add Combined Chapter-Fact Candidates

**Files:**
- Create: `shared/types/chapter-facts.ts`
- Create: `server/helpers/chapter-fact-candidates.ts`
- Modify: `server/routes/production.ts`
- Create: `src/lib/chapter-fact-client.ts`
- Create: `src/components/ChapterFactCandidateReview.tsx`
- Modify: `src/components/ProductionRunReview.tsx`
- Test: `tests/chapter-fact-candidates.test.ts`
- Test: `src/tests/chapter-fact-candidate-review.test.tsx`

**Interfaces:**
- Produces: `ChapterFactCandidate` combining character, item, timeline, location, power, and narrative-promise changes.
- Consumes: accepted manuscript version and current story-memory fingerprint.

- [ ] **Step 1: Write atomicity and selection tests**

Assert preview is read-only, each fact retains manuscript evidence, forged entity IDs are rejected, selected facts apply in one transaction, unselected facts remain pending/rejected as chosen, and stale manuscript or database generation rejects the whole apply.

- [ ] **Step 2: Stop applying continuity patches during production-run acceptance**

Applying the prose accepts only scene beats, manuscript, trusted review metadata, and the pending fact candidate ID. Canon changes wait for the separate author confirmation.

- [ ] **Step 3: Implement one confirmation surface**

Group facts by author concept while using one submit action. Default to no destructive/ambiguous Canon changes selected. Display exact manuscript evidence and the affected record.

- [ ] **Step 4: Run focused gates and commit**

Run Node and Vitest tests, typecheck, target lint, and `git diff --check`.

---

### Task 11: Implement the Chapter Completion Orchestrator

**Files:**
- Create: `shared/lib/chapter-completion.ts`
- Create: `server/helpers/chapter-completion.ts`
- Create: `server/lib/db/chapter-completion-attempts.ts`
- Modify: `server/lib/db-init.ts`
- Modify: `server/lib/db.ts`
- Create: `server/routes/chapter-completion.ts`
- Modify: `server.ts`
- Create: `src/lib/chapter-completion-client.ts`
- Test: `tests/chapter-completion.test.ts`
- Test: `tests/chapter-workflow.test.ts`

**Interfaces:**
- Produces:

```ts
deriveChapterCompletionGate(input: ChapterCompletionInput): ChapterCompletionGate
completeChapter(input: CompleteChapterInput): ChapterCompletionResult
acceptChapterRisk(input: AcceptChapterRiskInput): ChapterCompletionResult
```

Also produces durable `ChapterCompletionAttempt` records with phase:

```ts
type ChapterCompletionPhase =
  | 'writes-flushed'
  | 'version-created'
  | 'deterministic-checked'
  | 'ai-reviewed'
  | 'facts-proposed';
```

- [ ] **Step 1: Write completion state tests**

Cover manual and generated prose, current trusted production review reuse, stale review after content/plan changes, deterministic issues, one AI review, AI unavailable/unknown, evidenced local revision eligibility, risk acceptance, and next-chapter readiness.

Also cover interruption after each durable phase. A retry with the same manuscript/plan hash and database generation resumes without duplicating versions, AI reviews, or fact candidates. A changed hash creates a new attempt and leaves the old attempt inspectable.

- [ ] **Step 2: Implement a single orchestration route**

Add `POST /api/chapters/:chapterId/complete`. It must:

1. validate novel/chapter ownership and database generation;
2. bind decisions to content plus scene-beats hash;
3. reuse a current trusted review instead of starting a duplicate audit;
4. run deterministic checks before at most one AI review;
5. create a chapter version before any accepted revision;
6. return explicit `pass | needs-action | unknown` quality state;
7. create a chapter-fact candidate;
8. never create the next chapter automatically.

Persist each completed phase before starting the next one. Runtime abort handles remain in memory; attempt state and safe outputs live in SQLite.

- [ ] **Step 3: Add explicit risk acceptance**

Risk acceptance records unresolved issue IDs, unknown checks, author decision time, and current hash. Editing content makes that decision stale.

- [ ] **Step 4: Run completion gates and commit**

Run focused Node tests serially, typecheck, target lint, and `git diff --check`.

---

### Task 12: Converge the Editor on One Primary Action

**Files:**
- Modify: `src/lib/workflow-state.ts`
- Modify: `src/components/WritingSurface.tsx`
- Modify: `src/components/EditorView.tsx`
- Modify: `src/components/ProjectCockpitView.tsx`
- Modify: `src/components/AgentWorkspace.tsx`
- Create: `src/components/ChapterCompletionReview.tsx`
- Test: `src/tests/workflow-state.test.ts`
- Test: `src/tests/editor-completion-flow.test.tsx`
- Test: `src/tests/project-cockpit-content-gating.test.tsx`

**Interfaces:**
- Consumes: chapter completion and fact candidate APIs.
- Produces: one author-facing primary action state.

- [ ] **Step 1: Rewrite workflow tests before UI changes**

Expected primary actions:

```text
no plan -> generate-plan
confirmed plan, empty prose -> generate-prose
prose present, no completion decision -> complete-chapter
issues -> resolve-issues
ready or accepted-risk, pending facts -> confirm-facts
ready or accepted-risk, facts decided -> create-next-chapter
```

Manual typing remains enabled in every non-loading state.

- [ ] **Step 2: Replace audit/polish primary actions**

Keep full audit and capability tools in advanced surfaces. `Complete chapter` owns default review orchestration. Do not remove underlying audit/polish APIs until compatibility callers and tests are migrated.

- [ ] **Step 3: Add lightweight completion review**

Show passed/issues/AI-check-incomplete state. Keep evidence collapsed by default. Offer local revision previews, return to editing, retry unavailable checks, or accept risk. Never display a fabricated score.

- [ ] **Step 4: Preserve route launch safety**

Existing cockpit launch tokens must load the target chapter before an action. Map legacy `cockpit-audit` and `cockpit-polish` to advanced actions; the primary cockpit recommendation uses completion state.

- [ ] **Step 5: Run focused frontend gates and commit**

Run listed Vitest files, typecheck, target lint, and `git diff --check`.

---

### Task 13: Add Contextual Recommendations and Deduplication

**Files:**
- Create: `shared/types/capability-recommendation.ts`
- Create: `shared/lib/capability-recommendation.ts`
- Create: `server/lib/db/capability-recommendations.ts`
- Modify: `server/lib/db-init.ts`
- Create: `server/routes/capability-recommendations.ts`
- Modify: `src/components/SkillsStudioView.tsx`
- Create: `src/components/ContextualCapabilityRecommendation.tsx`
- Test: `tests/capability-recommendation.test.ts`
- Test: `src/tests/contextual-capability-recommendation.test.tsx`

**Interfaces:**
- Produces recommendation fingerprinting and dismissal state by issue fingerprint plus artifact version.
- Consumes capability contracts and diagnostics.

- [ ] **Step 1: Write ranking and suppression tests**

Assert one primary plus at most two alternatives, compatible artifact contracts only, current-version dismissal, reappearance after artifact/upstream version changes, and no automatic capability execution.

- [ ] **Step 2: Implement deterministic filtering before ranking**

Filter runtime availability, artifact kind, operation, scope, prerequisites, and access before scoring. AI may explain/rank a bounded eligible set but cannot add unknown capability IDs.

- [ ] **Step 3: Add contextual UI**

Lead with the diagnosed problem and expected artifact change. Keep full store navigation secondary. Distinguish `单次能力`, `持续规则`, and `创作流程` in labels and actions.

- [ ] **Step 4: Run focused gates and commit**

Run tests, typecheck, target lint, and `git diff --check`.

---

### Task 14: Add Opt-In Legacy Structuring

**Files:**
- Create: `server/helpers/legacy-artifact-structuring.ts`
- Create: `server/routes/legacy-artifact-structuring.ts`
- Create: `src/lib/legacy-artifact-client.ts`
- Create: `src/components/LegacyArtifactStructuringPrompt.tsx`
- Test: `tests/legacy-artifact-structuring.test.ts`
- Test: `src/tests/legacy-artifact-structuring.test.tsx`

**Interfaces:**
- Produces read-only structured candidates from legacy world text, outlines, character Bio, scene beats, and foreshadowing rows.
- Consumes the standard artifact candidate lifecycle.

- [ ] **Step 1: Write non-destructive migration tests**

Assert opening a legacy project does not call a model or write data; preview preserves original text; parser failure leaves the original active; confirmation creates a new structured version; dismissal suppresses the prompt for the current source fingerprint.

- [ ] **Step 2: Implement explicit preview actions**

Do not run bulk migration at startup. Offer structuring only at the relevant artifact or from advanced project maintenance.

- [ ] **Step 3: Run focused gates and commit**

Run tests, typecheck, target lint, and `git diff --check`.

---

### Task 15: Add End-to-End Journey Gates

**Files:**
- Create: `tests/e2e/unified-creation-new-project.spec.ts`
- Create: `tests/e2e/unified-creation-imported-project.spec.ts`
- Modify: `tests/e2e/helpers.ts` only if a shared isolated setup helper is required
- Modify: `docs/release-readiness.md`

**Interfaces:**
- Consumes all preceding stacks.
- Produces release evidence for the two accepted journeys.

- [ ] **Step 1: Write the new-project journey**

With mocked providers and an isolated database, verify:

```text
create project
-> accept world/character/master-outline candidates
-> set chapter goal
-> accept plan
-> accept prose
-> complete chapter
-> process or accept review result
-> confirm facts
-> create chapter two
```

Assert no forced capability-store detour and no duplicate audit action.

- [ ] **Step 2: Write the imported-project journey**

Verify imported Canon remains unchanged until selected candidate acceptance, thin character diagnosis recommends a compatible character capability, outline/foreshadowing impacts remain candidates, chapter completion works, and the next chapter opens with confirmed memory.

- [ ] **Step 3: Add failure-path coverage**

Run one journey with LLM availability `unknown`. Assert manual prose, save, completion summary, explicit risk acceptance, fact decisions, and next-chapter creation remain available without a fake pass.

- [ ] **Step 4: Run final serial gates**

Use isolated ports and databases. Do not run Node DB suites and Playwright against the same DB.

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npm run build
npx playwright test tests/e2e/unified-creation-new-project.spec.ts tests/e2e/unified-creation-imported-project.spec.ts --project=chromium
git diff --check
```

Expected: all commands exit 0. Record commit SHA, commands, exit codes, and any expected mocked-provider warnings in `docs/release-readiness.md`.

- [ ] **Step 5: Commit journey gate**

```bash
git add tests/e2e/unified-creation-new-project.spec.ts tests/e2e/unified-creation-imported-project.spec.ts tests/e2e/helpers.ts docs/release-readiness.md
git commit -m "test: gate the unified creation journeys"
```

## Parallel Ownership

The dependency chain limits safe parallel implementation. Within a stack, only non-overlapping ownership may run concurrently:

- Stack 1: one implementer owns shared contracts and persistence; one Gatekeeper may inspect tests read-only.
- Stack 2: capability contract and flow session work may proceed in parallel only after Task 3 interfaces are accepted and with no shared-file overlap.
- Stack 3: outline governance and character governance may proceed in parallel; narrative-promise work depends on outline contracts. The Coordinator owns shared type integration.
- Stack 4: backend completion precedes Editor convergence. Recommendation work can proceed in parallel after capability contracts stabilize.
- Stack 5: legacy migration and E2E specs can be drafted in parallel, but final execution is serial against isolated databases.

Implementers must use independent worktrees and branches. No implementer may merge, rewrite unrelated files, change remotes, add dependencies, or broaden a task. The Coordinator reviews real status, full diff, commit, and test exit codes before accepting each stack.

## Stop Conditions

Stop and return to design review if any of the following becomes necessary:

1. Replacing SQLite with a graph database.
2. Destructively converting legacy text at startup.
3. Storing a second authoritative copy of foreshadowing or character Canon.
4. Automatically rewriting accepted manuscript content after an outline/world change.
5. Allowing capability output to bypass candidate confirmation.
6. Adding a new dependency or weakening database-generation/ownership checks.
7. Making manual writing depend on API-key or model availability.

## Requirement Traceability

| Confirmed requirement | Authoritative implementation tasks | Verification evidence |
|---|---|---|
| One repeatable chapter journey and one Editor primary action | 11, 12, 15 | workflow unit tests and both Playwright journeys |
| Generation Critic plus completion review without duplicate audit | 11, 12 | trusted-review reuse and no-duplicate-call tests |
| Local revision preview, version protection, explicit risk acceptance | 10, 11, 12 | completion and UI tests |
| Honest no-key/network/unknown degradation | 11, 12, 15 | unknown-provider E2E path |
| Master/volume/chapter structure and upstream/downstream impacts | 1, 3, 6 | hierarchy, stale, and impact tests |
| Narrative-promise plan versus manuscript evidence | 1, 6, 8, 9 | narrative-promise and projection tests |
| Story-memory graph without duplicate authority | 8, 9 | stable projection and no-duplicate-state tests |
| Structured character core and imported Canon protection | 7, 14 | candidate route and imported-project E2E |
| World/character/outline/scene candidates with diff and impact | 2, 3, 6, 7 | adapter lifecycle tests |
| Single-run, persistent-rule, and flow-step semantics | 4, 5 | contract and frozen-flow tests |
| Flow capabilities independently reusable with prerequisites | 5 | missing-input and accepted-output tests |
| Multi-card conflict handling and preselected goal | 4 | pure composition tests |
| Contextual 1+2 recommendations and version-based suppression | 13 | ranking and suppression tests |
| Opt-in non-destructive legacy structuring | 14 | legacy no-write/open tests |
| Durable phase recovery without duplicate effects | 11 | interruption-after-phase tests |
| No silent rewrite of accepted manuscript or Canon | 3, 7, 10, 11, 15 | ownership/stale/preview-only tests and E2E |

## Rollback

Each task is independently revertible by its commit. Additive tables may remain unused after a code rollback; do not drop tables or delete candidate/version history. UI stacks must preserve compatibility with legacy records lacking new structured fields. If a stack is rejected, revert only that stack's commit and keep all prior accepted contracts.
