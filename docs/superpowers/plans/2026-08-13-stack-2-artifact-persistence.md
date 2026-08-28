# Stack 2 Creative Artifact Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add additive SQLite persistence for structured artifact cores, versions, world/character candidates, and downstream review requirements without changing existing Canon or exposing new HTTP behavior.

**Architecture:** Preserve existing domain sources of truth. Store structured cores as additive records linked by `(novel_id, artifact_kind, artifact_id)`; store generic candidates only for `world` and `character`; keep outlines, manuscripts, and foreshadowing lifecycle in their existing stores. Import validation treats the four new tables and their indexes as one optional, complete governance set so legacy backups remain importable.

**Tech Stack:** TypeScript 5.8, Node test runner, Express 4, SQLite via `better-sqlite3`.

## Current Status (2026-08-17)

**DONE.** The four additive governance tables, strict CRUD, transactional version/candidate operations, and optional-but-complete import validation are implemented without exposing raw CRUD through `DB_WHITELIST`. Verification includes the 2026-08-16 full Node gate and the 2026-08-17 isolated artifact lifecycle regression. The original RED/GREEN/commit checkboxes are retained as historical execution steps and do not imply new commits in the current dirty worktree.

## Global Constraints

- Base branch: `codex/beta-stabilization-baseline` at or after `2dd0622`.
- Execute in isolated worktrees. Prefix branches with `codex/`.
- Do not add dependencies.
- Do not add HTTP routes or modify `server.ts`.
- Do not add the new CRUD functions to `DB_WHITELIST`; Task 3 will expose a governed facade.
- Do not modify `characters`, `foreshadowings`, `outline_artifacts`, `canon_patches`, `chapters`, or `chapter_versions` rows.
- Do not store outline or manuscript candidates in `creative_artifact_candidates`.
- `applyArtifactCandidateDecision` changes candidate lifecycle state only. It must not apply Canon or manuscript content.
- Do not use table-level `CHECK` or `UNIQUE` constraints. Existing import validation rejects them; enforce domains in CRUD and use explicitly governed indexes.
- All schema changes are additive and idempotent.
- All tests use `:memory:` or a unique temporary database, never the running `data.db`.
- No JSON parse failure may fall back to empty accepted data.
- No AI call, UI change, migration parser, fingerprint/diff algorithm, candidate adapter, or chapter-completion behavior is part of this delivery.

## Authority Boundaries

```text
World/character readable Canon  -> existing novels/characters rows
Structured core attachment      -> creative_artifact_cores + versions
World/character proposal        -> creative_artifact_candidates
Outline proposal                -> existing outline_artifacts/canon_patches
Manuscript proposal             -> existing chapter_production_runs/versions
Foreshadowing lifecycle         -> existing foreshadowings
Downstream stale marker         -> artifact_review_requirements
```

## Data Contract

Four tables form one optional import-governance set.

```sql
CREATE TABLE creative_artifact_cores (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  core_json TEXT NOT NULL,
  readable_content TEXT,
  provenance_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE creative_artifact_versions (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  core_json TEXT NOT NULL,
  readable_content TEXT,
  provenance_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE creative_artifact_candidates (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  target_version INTEGER NOT NULL,
  operation TEXT NOT NULL,
  goal TEXT NOT NULL,
  base_fingerprint TEXT NOT NULL,
  source_capability_versions TEXT NOT NULL,
  proposed_core TEXT NOT NULL,
  proposed_content TEXT,
  diff TEXT NOT NULL,
  impact_report TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  decided_at INTEGER,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);

CREATE TABLE artifact_review_requirements (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  artifact_kind TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  artifact_version INTEGER NOT NULL,
  source_candidate_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
  FOREIGN KEY (source_candidate_id) REFERENCES creative_artifact_candidates(id) ON DELETE SET NULL
);
```

Required indexes:

```text
idx_creative_artifact_cores_identity          UNIQUE(novel_id, artifact_kind, artifact_id)
idx_creative_artifact_versions_identity       UNIQUE(novel_id, artifact_kind, artifact_id, version)
idx_creative_artifact_versions_novel          (novel_id, artifact_kind, artifact_id)
idx_creative_artifact_candidates_status       (novel_id, status, created_at)
idx_creative_artifact_candidates_target       (novel_id, artifact_kind, artifact_id)
idx_artifact_review_requirements_lookup        (novel_id, artifact_kind, artifact_id, status)
idx_artifact_review_requirements_candidate     (source_candidate_id)
```

## Runtime Interfaces

Define these in `server/lib/db/creative-artifacts.ts`:

```ts
export type GovernedCoreKind = CreativeArtifactKind;
export type GenericCandidateKind = 'world' | 'character';

export interface StoredArtifactCore<T = unknown> {
  id: string;
  novelId: string;
  artifactKind: GovernedCoreKind;
  artifactId: string;
  version: number;
  core: T;
  readableContent?: string;
  provenance: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactReviewRequirement {
  id: string;
  novelId: string;
  artifactKind: CreativeArtifactKind;
  artifactId: string;
  artifactVersion: number;
  sourceCandidateId?: string;
  reason: string;
  status: 'review-required' | 'resolved';
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
}

export function getArtifactCore(
  novelId: string,
  artifactKind: CreativeArtifactKind,
  artifactId: string,
): StoredArtifactCore | undefined;

export function saveArtifactVersion(input: {
  novelId: string;
  artifactKind: CreativeArtifactKind;
  artifactId: string;
  expectedVersion?: number;
  core: unknown;
  readableContent?: string;
  provenance: Record<string, unknown>;
}): StoredArtifactCore;

export function createArtifactCandidate<T>(
  input: Omit<ArtifactCandidate<T>, 'status'>,
): ArtifactCandidate<T>;

export function getArtifactCandidate(
  novelId: string,
  candidateId: string,
): ArtifactCandidate | undefined;

export function listArtifactCandidates(
  novelId: string,
  filters?: { artifactKind?: GenericCandidateKind; status?: ArtifactCandidate['status'] },
): ArtifactCandidate[];

export function applyArtifactCandidateDecision(
  novelId: string,
  candidateId: string,
  decision: 'accepted' | 'rejected' | 'stale',
): ArtifactCandidate;

export function markArtifactReviewRequired(input: {
  novelId: string;
  artifact: CreativeArtifactRef;
  sourceCandidateId?: string;
  reason: string;
}): ArtifactReviewRequirement;
```

Stable error codes:

```text
CREATIVE_ARTIFACT_NOVEL_NOT_FOUND
CREATIVE_ARTIFACT_INVALID_KIND
CREATIVE_ARTIFACT_INVALID_INPUT
CREATIVE_ARTIFACT_INVALID_DATA
CREATIVE_ARTIFACT_VERSION_STALE
CREATIVE_ARTIFACT_CANDIDATE_NOT_FOUND
CREATIVE_ARTIFACT_CANDIDATE_TERMINAL
CREATIVE_ARTIFACT_SOURCE_CANDIDATE_NOT_FOUND
```

Version rules:

```text
No current core   -> expectedVersion must be absent or 0; saved version is 1
Current core Vn   -> expectedVersion must equal n; saved version is n + 1
Candidate target -> target.version may be 0 when legacy Canon has no structured core
Stored core       -> version must be a positive integer
```

## Multi-Agent Execution

```text
Coordinator
  -> Implementer A: schema + schema characterization
  -> after A accepted, parallel:
       Implementer B: CRUD + persistence tests
       Implementer C: import governance + import tests
  -> Coordinator integration review
  -> parallel Gatekeepers: typecheck/lint, Node tests, diff/scope review
```

Implementers must use separate worktrees. B and C branch from accepted A commit. File ownership must not overlap.

---

### Task 1: Add the Four Additive Tables

**Owner:** Implementer A

**Files:**
- Modify: `server/lib/db-init.ts`
- Create: `tests/creative-artifact-schema.test.ts`

**Interfaces:**
- Consumes: table and index contract above.
- Produces: initialized tables and indexes used by Tasks 2 and 3.

- [ ] **Step 1: Write schema characterization tests**

Create a unique temporary database, call `initDb(tempPath)`, and assert:

```ts
const tables = ['creative_artifact_cores', 'creative_artifact_versions', 'creative_artifact_candidates', 'artifact_review_requirements'];
for (const name of tables) {
  assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name = ?").get(name)?.type, 'table');
}
```

Assert exact required columns, all seven explicit indexes, the `novel_id -> novels.id ON DELETE CASCADE` foreign keys, and `source_candidate_id -> creative_artifact_candidates.id ON DELETE SET NULL`.

Add a legacy-upgrade test:

1. Create legacy `novels`, `characters`, `foreshadowings`, and `outline_artifacts` rows in a temporary database.
2. Snapshot their complete row values.
3. Close and initialize through `initDb(tempPath)`.
4. Assert all snapshots are byte-for-byte equivalent after initialization.

- [ ] **Step 2: Verify RED**

Run:

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-schema.test.ts
```

Expected: FAIL because the four tables do not exist.

- [ ] **Step 3: Add minimal schema and indexes**

Add the four `CREATE TABLE IF NOT EXISTS` statements to the existing initialization transaction and the seven `CREATE INDEX IF NOT EXISTS` statements to the existing index block. Use the exact names and columns in this plan.

Do not add columns to existing domain tables. Do not add triggers, views, table-level `CHECK`, or table-level `UNIQUE` constraints.

- [ ] **Step 4: Verify GREEN**

Run the focused schema test and:

```bash
npx eslint server/lib/db-init.ts tests/creative-artifact-schema.test.ts --max-warnings=0
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```bash
git add server/lib/db-init.ts tests/creative-artifact-schema.test.ts
git commit -m "feat: add creative artifact persistence schema"
```

**Stop if:** legacy rows change, an existing table requires alteration, or import-validator constraints require weakening.

---

### Task 2: Implement Strict Persistence CRUD

**Owner:** Implementer B, starting from accepted Task 1 commit

**Files:**
- Create: `server/lib/db/creative-artifacts.ts`
- Modify: `server/lib/db.ts`
- Create: `tests/creative-artifact-persistence.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; Task 1 shared types from `shared/types/creative-artifacts.ts`.
- Produces: runtime interfaces and stable error codes defined above.

- [ ] **Step 1: Write lifecycle tests**

Use `initDb(':memory:')` and create an owning novel. Cover:

1. `saveArtifactVersion` creates version `1`, writes both current core and immutable version row.
2. A second save with `expectedVersion: 1` creates version `2` and preserves version `1`.
3. A stale `expectedVersion` throws `CREATIVE_ARTIFACT_VERSION_STALE` and writes nothing.
4. Missing novel throws `CREATIVE_ARTIFACT_NOVEL_NOT_FOUND`.
5. Candidate creation accepts only target kinds `world` and `character`.
6. `master-outline`, `volume-outline`, `chapter-outline`, and `scene-beats` candidates throw `CREATIVE_ARTIFACT_INVALID_KIND` and create no row.
7. Candidate transitions allow only `pending -> accepted | rejected | stale`.
8. Repeating the same terminal decision is idempotent; a different terminal decision throws `CREATIVE_ARTIFACT_CANDIDATE_TERMINAL`.
9. List/get isolate novels.
10. A review requirement rejects a missing or cross-novel source candidate.
11. Corrupt each JSON column with direct SQL and assert reads throw `CREATIVE_ARTIFACT_INVALID_DATA`.

- [ ] **Step 2: Verify RED**

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-persistence.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement row guards and mapping**

Implement one `CreativeArtifactPersistenceError` carrying the stable `code`. Validate:

```text
artifact kinds       -> exact CreativeArtifactKind union
candidate kinds      -> world | character only
operations           -> exact ArtifactOperation union
candidate statuses   -> pending | accepted | rejected | stale
review statuses      -> review-required | resolved
stored core versions -> positive integers
candidate versions   -> non-negative integers
JSON objects         -> non-null plain objects
JSON arrays          -> arrays with required item shapes
```

Malformed stored data throws `CREATIVE_ARTIFACT_INVALID_DATA`; never substitute `{}`, `[]`, or accepted defaults.

- [ ] **Step 4: Implement version writes transactionally**

Within one `runInTransaction`:

1. Validate novel ownership.
2. Read current version.
3. Reject mismatched or omitted `expectedVersion` when a current core already exists.
4. Insert immutable version row.
5. Insert or update current core row.
6. Return the mapped current core.

Use `generateId()` and existing `notify()` conventions. Notify only after a transaction changes data.

- [ ] **Step 5: Implement candidate and review state operations**

Candidate creation persists `status = 'pending'`. Decision changes state only; it must not call world, character, outline, chapter, or Canon CRUD.

`markArtifactReviewRequired` validates the optional source candidate belongs to the same novel, then inserts `status = 'review-required'`. No automatic deduplication is required in this delivery.

- [ ] **Step 6: Export and verify**

Export the module from `server/lib/db.ts`. Do not modify `DB_WHITELIST`.

Run:

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-schema.test.ts tests/creative-artifact-persistence.test.ts
npm run typecheck
npx eslint server/lib/db/creative-artifacts.ts server/lib/db.ts tests/creative-artifact-persistence.test.ts --max-warnings=0
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 7: Commit**

```bash
git add server/lib/db/creative-artifacts.ts server/lib/db.ts tests/creative-artifact-persistence.test.ts
git commit -m "feat: persist structured artifact records"
```

**Stop if:** applying a candidate requires updating Canon, fingerprints, database-generation guards, or HTTP validation. Those belong to Task 3 in the master plan.

---

### Task 3: Govern Database Import Compatibility

**Owner:** Implementer C, starting from accepted Task 1 commit; may run in parallel with Task 2

**Files:**
- Modify: `server/routes/db.ts`
- Modify: `tests/db-import-serialization.test.ts`

**Interfaces:**
- Consumes: exact Task 1 table/index/foreign-key contract.
- Produces: safe legacy and current database import validation.

- [ ] **Step 1: Add import-validation tests**

Extend existing candidate-database helpers. Cover:

1. A legacy backup with none of the four tables is accepted before normal initialization.
2. A current backup containing all four tables, all seven indexes, and exact foreign keys is accepted.
3. Any partial presence of the four tables or seven indexes is rejected as an incomplete governance set.
4. Missing required column, wrong column type/nullability, unexpected expression default, wrong index order/uniqueness, or wrong foreign key action is rejected.
5. An unexpected trigger, view, `CHECK`, table-level `UNIQUE`, or extra index remains rejected.
6. After a legacy import is installed and `initDb` runs, all four new tables exist without changing legacy domain rows.

- [ ] **Step 2: Verify RED**

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/db-import-serialization.test.ts
```

Expected: the current-schema candidate is rejected because the tables/indexes are not allowlisted, or partial-set validation is absent.

- [ ] **Step 3: Extend optional schema governance**

In `server/routes/db.ts`:

1. Add the four tables to `OPTIONAL_IMPORT_SCHEMA`.
2. Add them to `ALLOWED_IMPORT_TABLES`.
3. Add all seven indexes to `ALLOWED_IMPORT_INDEXES`, preserving column order and uniqueness.
4. Add exact foreign keys to `EXPECTED_IMPORT_FOREIGN_KEYS`.
5. Add one completeness group containing all four tables and all seven indexes.

Generalize the current outline/canon completeness check into a small data-driven helper only if needed to avoid duplicating the same loop. Do not refactor unrelated validation.

- [ ] **Step 4: Verify GREEN**

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/db-import-serialization.test.ts
npx eslint server/routes/db.ts tests/db-import-serialization.test.ts --max-warnings=0
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/db.ts tests/db-import-serialization.test.ts
git commit -m "feat: validate creative artifact backup schema"
```

**Stop if:** accepting the new schema requires relaxing the ban on executable schema objects, unsafe defaults, extra indexes, or forged foreign keys.

---

### Task 4: Integrate and Gate the Delivery

**Owner:** Coordinator

**Files:** No new feature files. Resolve integration only within files already owned above.

**Interfaces:**
- Consumes: accepted Task 1, Task 2, and Task 3 commits.
- Produces: one reviewed persistence delivery; no HTTP behavior.

- [ ] **Step 1: Inspect actual branch state**

```bash
git status --short --branch
git log --oneline --decorate -8
git diff <base-commit>...HEAD --stat
git diff <base-commit>...HEAD --name-status
git diff <base-commit>...HEAD --check
```

Reject any changed file outside the declared ownership list, except conflict resolution strictly required to combine accepted commits.

- [ ] **Step 2: Run focused persistence tests**

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/creative-artifact-contracts.test.ts tests/creative-artifact-schema.test.ts tests/creative-artifact-persistence.test.ts tests/db-import-serialization.test.ts
```

Expected: all pass, zero skipped failures.

- [ ] **Step 3: Run static gates in parallel**

Gatekeeper A:

```bash
npm run typecheck
```

Gatekeeper B:

```bash
npx eslint server/lib/db-init.ts server/lib/db/creative-artifacts.ts server/lib/db.ts server/routes/db.ts tests/creative-artifact-schema.test.ts tests/creative-artifact-persistence.test.ts tests/db-import-serialization.test.ts --max-warnings=0
```

Gatekeeper C:

```bash
git diff <base-commit>...HEAD --check
git status --short
```

- [ ] **Step 4: Audit every boundary**

Confirm with `rg` and diff review:

```text
No new dependency
No server.ts change
No new HTTP route
No DB_WHITELIST exposure
No existing Canon/manuscript row update
No outline/manuscript generic candidate
No CHECK/trigger/view/table-level UNIQUE
No test path reaches running data.db
Decision method changes status only
Legacy import remains supported
```

- [ ] **Step 5: Stop**

Report changed files, commits, test counts, and residual risks. Do not begin master-plan Task 3.

## Hard Stop Conditions

Stop the goal and report instead of expanding scope when any condition occurs:

- More than three implementation commits are required.
- A fourth fix round is needed for the same failing gate.
- Any change is needed in `server.ts`, frontend code, capability runtime, outlines, chapters, world CRUD, or production routes.
- Any new dependency is proposed.
- Existing import security checks must be weakened.
- Legacy rows cannot remain byte-for-byte unchanged.
- Candidate acceptance cannot remain a state-only transition.
- Focused tests pass but `npm run typecheck` fails for a newly introduced error.

## Completion Definition

This plan is complete only when:

1. All four tables and seven indexes initialize additively.
2. Legacy domain rows remain unchanged.
3. Strict CRUD/version/candidate/review tests pass.
4. Generic candidates reject every kind except `world` and `character`.
5. Import accepts legacy absence or the complete valid set, and rejects partial/forged sets.
6. Focused tests, full typecheck, target lint, and diff checks all exit `0`.
7. Coordinator verifies no scope expansion.
