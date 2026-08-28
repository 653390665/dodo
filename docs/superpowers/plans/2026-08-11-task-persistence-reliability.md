# Task Persistence Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Make user-visible long-running tasks recoverable enough that restart/crash does not silently erase progress state.
**Architecture:** SQLite becomes the source of truth for user-visible job status. In-memory maps keep only runtime handles such as AbortController and rerun callbacks. Start with continuation import/entity extraction; do not rewrite every async job at once.
**Tech Stack:** Express, TypeScript, better-sqlite3, existing DB generation guard, Node test runner.

## Scope

First target:

- continuation import / entity extraction jobs in `server/routes/continuation.ts`

Files likely involved:

- `server/routes/continuation.ts`
- `server/lib/db-init.ts`
- `server/lib/db/continuation-jobs.ts`
- `server/lib/db.ts`
- `server/lib/db-mappers.ts`
- `shared/types/continuation.ts`
- `tests/continuation-extraction-job-recovery.test.ts`
- `tests/continuation-sync-state.test.ts`

Do not:

- persist raw manuscript/source document text beyond existing storage behavior
- add a new dependency
- rewrite all route files
- change API response shape unless a test locks the compatibility path
- move unrelated direct SQL out of routes in this slice

## Task 1: Inventory Runtime Maps

Steps:

- [x] List all maps in `server/routes/continuation.ts`.
- [x] Classify each as:

```text
persisted state
runtime handle only
temporary import session
candidate for later phase
```

- [x] Document classification in comments or the child implementation notes.

Current classification:

```text
entityExtractionJobs -> persisted state
parseDocJobs -> temporary non-persisted parse task for Beta; expired/restarted jobs return PARSE_DOC_JOB_EXPIRED and ask the user to re-upload
entityExtractionAbortControllers -> runtime handle only
entityExtractionRerunners -> runtime handle only
entityExtractionResumeContexts -> runtime repair cursor for current process; durable retry metadata lives in checkpointJson
pendingContinuationImports -> temporary import session for Beta; expired/restarted approval returns CONTINUATION_IMPORT_PACK_EXPIRED and asks the user to re-import
continuationImportSessions -> temporary import session for Beta; expired/restarted parse returns CONTINUATION_IMPORT_SESSION_EXPIRED and asks the user to re-import
```

## Task 2: Define Persisted Job Shape

Steps:

- [x] Reuse existing `continuation-jobs` module if it already represents extraction jobs.
- [x] Persist minimum fields for entity extraction jobs:

```text
id
novelId
packId
status
progress
stageText
databaseGeneration
totalChunks
currentChunk
traceId
error
code
outputDiagnostic
failedChunk
schemaIssues
warnings
createdAt
lastActivityAt
completedAt
```

Notes:
- `completedAt` is represented by `updatedAt` for the completed transition in the current schema; no schema expansion was added.
- `traceId`, `failedChunk`, `schemaIssues`, `warnings`, `outputDiagnostic`, `chunkMeta`, and partial progress snapshots are serialized into `checkpointJson`.
- `result` is serialized into `resultJson`.

- [x] Keep runtime-only fields out of SQLite:

```text
AbortController
rerunner callback
active run Set membership
```

- [x] Add mappers using safe JSON parse / validation where persisted snapshots are hydrated.

## Task 3: Write Recovery Semantics

Steps:

- [x] On startup/init, jobs left `running` or `queued` become `interrupted`.
- [x] Completed jobs remain queryable until TTL cleanup.
- [x] Failed/interrupted jobs expose retry metadata, not fake success.
- [x] Cancellation remains explicit and visible.
- [x] Cleanup removes old terminal jobs after TTL.

Compatibility:

- [x] Existing polling endpoints still return current shape.
- [x] If a runtime handle is missing after restart, cancel/retry produces a clear error or restart path.

## Task 4: Route Reads/Writes Through DB Helpers

Steps:

- [x] Replace direct `entityExtractionJobs.set/get` state reads with helper calls where state is user-visible.
- [x] Keep in-memory AbortController map for cancellation during current process lifetime.
- [x] Update progress at chunk boundaries and failure/success transitions.
- [x] Keep database generation guard before writing extracted world data.

Notes:
- Direct `entityExtractionJobs.set` remains only for cache hydration and job creation, behind local helpers.
- `runPersistedExtractionJob` now preserves provider diagnostics and schema issues on persisted resume failures.
- `parseDocJobs` remains intentionally non-persisted for Beta and now fails honestly with `PARSE_DOC_JOB_EXPIRED` so users can re-upload instead of polling a vanished task.
- `pendingContinuationImports` and `continuationImportSessions` remain intentionally non-persisted for Beta, but now fail honestly with stable invalidation codes (`CONTINUATION_IMPORT_PACK_EXPIRED`, `CONTINUATION_IMPORT_SESSION_EXPIRED`, `CONTINUATION_IMPORT_GENERATION_CHANGED`) so users can restart the import flow instead of seeing a vague missing-pack error.

## Task 5: Tests

Required focused tests:

- [x] job creation persists queued/running state
- [x] chunk progress survives by reading from DB helper
- [x] startup recovery marks stale running/queued job as interrupted
- [x] failed job preserves `traceId`, `failedChunk`, schema issues, and diagnostic
- [x] retry path does not write stale data after database generation changes

Additional covered cases:
- persisted terminal job TTL cleanup
- DB-only cancel behavior
- initial checkpoint persistence before runner checkpoint
- persisted resume provider diagnostics
- persisted resume schema issues
- expired parse-doc jobs produce a re-upload action
- checkpoint/result corruption recovery
- source hash mismatch on resume

Commands:

```bash
npm test -- tests/continuation-extraction-job-recovery.test.ts
npm test -- tests/continuation-sync-state.test.ts
```

If the Node test runner does not support passing files through `npm test --`, use the underlying configured command with explicit test file.

## Validation

Focused:

```bash
NODE_ENV=test node --test --test-concurrency=1 --test-timeout=45000 --import tsx --import ./tests/helpers/test-db-preload.ts tests/continuation-extraction-job-recovery.test.ts
```

Broader:

```bash
npm run typecheck
npm test
```

## Rollback

Revert only files touched by this plan. If schema changes are made, include reverse-safe startup behavior or a follow-up migration note; do not delete user data.
