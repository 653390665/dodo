# Artifact Candidate Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement master-plan Task 3: deterministic artifact fingerprints and diffs plus a governed candidate facade that previews and applies changes without duplicating existing outline or manuscript authority.

**Architecture:** Keep `creative_artifact_candidates` as the proposal store only for world and character. Route outline operations through `outline_artifacts` and `canon_patches`, and manuscript/scene-beats operations through chapter production runs and versions. Every accepted write is ownership-, generation-, version-, and fingerprint-guarded and transactional.

**Tech Stack:** TypeScript 5.8, Express 4, Zod, SQLite via `better-sqlite3`, Node crypto and Node test runner.

## Current Status (2026-08-17)

**DONE.** Deterministic fingerprints/diffs, authority-preserving adapters, and the governed preview/get/accept/reject HTTP facade are implemented. The 2026-08-17 isolated Node regression passed `65/65` across candidate lifecycle, legacy structuring, and pack sync; `npm run typecheck` also passed. The original RED/GREEN/commit checkboxes are retained as historical execution steps.

## Global Constraints

- Base branch is `codex/beta-stabilization-baseline` at or after `f68397d`.
- Do not add dependencies or change existing authority stores.
- Preview is read-only; no AI result writes Canon or manuscript without acceptance.
- Generic candidates are only `world | character`.
- Outline candidates must use `outline_artifacts` / `canon_patches`; manuscript candidates must use production runs / versions.
- Every write validates novel ownership and database generation.
- Candidate acceptance rejects stale fingerprints and executes transactionally.
- Tests use `:memory:` or unique temporary databases, never the running `data.db`.
- Do not modify capability manifests, frontend code, creation flows, outline hierarchy rules, chapter completion, or story-memory projection.
- Completion boundary: the exact Task 3 interfaces, four routes, lifecycle tests, full typecheck, target lint, and diff check. No extra UI, background job, audit, migration, or refactor.

---

### Task 1: Deterministic Fingerprints and Structured Diffs

**Files:**
- Create: `shared/lib/creative-artifact-fingerprint.ts`
- Create: `shared/lib/creative-artifact-diff.ts`
- Test: `tests/creative-artifact-candidates.test.ts`

**Interfaces:**
- Produces: `fingerprintCreativeArtifact(input): string` and `buildArtifactDiff(base, proposed): ArtifactDiff`.
- Consumes: `CreativeArtifactKind` and `ArtifactDiff` from `shared/types/creative-artifacts.ts`.

- [ ] **Step 1: Write failing pure-function tests**

Cover stable SHA-256 output for objects with different key insertion order, explicit differentiation by kind/version/content, nested added/removed/changed paths, array changes as field changes, and no mutation of inputs.

- [ ] **Step 2: Verify RED**

Run the focused test and confirm failure because the two modules do not exist.

- [ ] **Step 3: Implement minimal deterministic helpers**

Use `node:crypto` and recursively ordered object keys. Preserve array order. Diff recursively through plain objects, emit stable sorted paths, and keep `before`/`after` only in returned data, never logs.

- [ ] **Step 4: Verify GREEN and commit**

Run focused tests, typecheck, target lint, and `git diff --check`; commit only the two helpers and test additions.

---

### Task 2: Domain Adapter Contract and Candidate Lifecycle

**Files:**
- Create: `server/helpers/creative-artifact-candidates.ts`
- Create: `server/helpers/creative-artifact-candidate-adapters.ts`
- Modify: `tests/creative-artifact-candidates.test.ts`

**Interfaces:**
- Produces: `previewArtifactCandidate(input): ArtifactCandidate` and `acceptArtifactCandidate(input): AcceptedArtifactVersion`.
- Consumes: persistence CRUD from `server/lib/db/creative-artifacts.ts`, existing outline/canon-patch APIs, existing chapter-production APIs, and Task 1 helpers.

- [ ] **Step 1: Characterize existing domain adapters**

Record exact ownership, version, transaction, and idempotency behavior for world/character, outline, and manuscript stores. Stop if any adapter cannot preserve its existing source of truth and stale contract.

- [ ] **Step 2: Write failing lifecycle tests**

Cover read-only preview; world/character candidate persistence; wrong novel/generation/fingerprint rejection; invalid output rejection; accepted version provenance; downstream review markers; idempotent repeated acceptance; rejected-candidate refusal; manuscript conflict without chapter-content write; and no generic rows for outline/manuscript.

- [ ] **Step 3: Verify RED**

Run the focused test and confirm failures are missing lifecycle helpers, not invalid fixtures.

- [ ] **Step 4: Implement the smallest adapter facade**

Use one explicit switch by artifact kind. Reuse existing transactional APIs. Do not introduce a new framework, registry, or duplicate persistence. Make world/character acceptance write the structured core and candidate state in one transaction; delegate outline and manuscript acceptance to their governed stores.

- [ ] **Step 5: Verify GREEN and commit**

Run focused tests serially, full typecheck, target lint, and diff check; commit only the helper files and test changes.

---

### Task 3: Governed HTTP Facade

**Files:**
- Create: `server/routes/creative-artifacts.ts`
- Modify: `server/routes/index.ts`
- Modify: `server.ts` only if the repository route-registration pattern requires it
- Modify: `tests/creative-artifact-candidates.test.ts`

**Interfaces:**
- Produces four routes under `/api/novels/:novelId/artifacts/candidates` for preview, get, accept, and reject.
- Consumes: lifecycle helpers from Task 2 and the repository's existing validation/error conventions.

- [ ] **Step 1: Write failing route tests**

Cover strict Zod bodies, invalid IDs, novel isolation, generation mismatch, stale base, unsupported operation, successful preview/get/accept/reject, and stable error codes.

- [ ] **Step 2: Verify RED**

Run focused tests and confirm 404/missing registration failures.

- [ ] **Step 3: Implement minimal route registration**

Register exactly four routes. Validate before persistence, never expose CRUD through `DB_WHITELIST`, and map domain errors without leaking content or SQL details.

- [ ] **Step 4: Run Task 3 delivery gates**

Run:

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-candidates.test.ts tests/creative-artifact-contracts.test.ts tests/creative-artifact-schema.test.ts tests/creative-artifact-persistence.test.ts tests/db-import-serialization.test.ts
npm run typecheck
npx eslint shared/lib/creative-artifact-fingerprint.ts shared/lib/creative-artifact-diff.ts server/helpers/creative-artifact-candidates.ts server/helpers/creative-artifact-candidate-adapters.ts server/routes/creative-artifacts.ts server/routes/index.ts tests/creative-artifact-candidates.test.ts --no-ignore --max-warnings=0
git diff f68397d...HEAD --check
```

- [ ] **Step 5: Scope audit and commit**

Confirm no dependency, frontend, capability, flow, chapter completion, story-memory, direct Canon rewrite, or duplicate outline/manuscript candidate store. Commit only declared files and stop before master-plan Task 4.

## Stop Conditions

- An adapter would require a second authoritative copy of outline, manuscript, character Canon, or foreshadowing.
- Existing generation, ownership, or stale-fingerprint checks must be weakened.
- Candidate acceptance cannot remain transactional or idempotent.
- A new dependency, frontend change, capability-manifest change, or schema migration becomes necessary.
- Three consecutive fix rounds make no progress on the same gate.

## Completion Definition

1. Equivalent structured inputs have the same SHA-256 fingerprint and meaningful changes have different fingerprints.
2. Structured diffs deterministically report added, removed, and changed paths.
3. Preview is read-only and all accepts enforce ownership, generation, and stale checks.
4. World/character use generic candidate persistence; outlines/manuscripts use their existing stores only.
5. Repeated acceptance is idempotent and manuscript conflicts never rewrite `chapters.content`.
6. Exactly four governed routes exist with strict validation and stable errors.
7. Focused tests, full typecheck, target lint, diff check, and scope review pass.
