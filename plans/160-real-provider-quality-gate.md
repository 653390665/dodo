# Plan 160: Close Real-Provider Prose Quality Risk

> **Executor instructions**: Add deterministic output-quality coverage and an optional real-provider smoke path. Do not expose secrets, do not modify database schema, and do not make a real provider call unless the required environment is configured.

## Status

- **State**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug / tests
- **Planned at**: commit `f4eac24`, 2026-08-19
- **Completed at**: 2026-08-19

## Why this matters

Deterministic browser fixtures prove the workflow controls, but they do not prove that a real provider response is usable prose. The current routes already reject metadata, model reasoning tags, mojibake, placeholders, and duplicate paragraphs through `shared/lib/draft-quality.ts`; the remaining gap is stronger detection of repeated sentence patterns and a repeatable provider smoke command that skips honestly when no key is configured.

## Current state

- `shared/lib/draft-quality.ts` validates generated draft text and returns human-readable violations.
- `server/routes/agents.ts` and `server/routes/production.ts` invoke this validator before delivering or applying generated prose.
- `server/lib/server-llm.ts` performs provider-level anti-slop correction and rejects `quality_rejected` after one correction attempt.
- `scripts/runtime-smoke.mjs` is the existing pattern for a local runtime smoke command.

## Scope

In scope:

- `shared/lib/draft-quality.ts`
- `tests/draft-quality.test.ts`
- `scripts/provider-quality-smoke.ts`
- `package.json` only for a script entry if needed
- focused route/provider tests for stable quality error details

Out of scope:

- database schema or migrations
- provider credentials and `.env` files
- changing the fallback draft into a second generation system
- weakening the existing quality gate

## Steps

### Step 1: Strengthen deterministic quality checks

Detect repeated non-empty sentences or repeated sentence openings when the repetition is clearly mechanical, while allowing intentional dialogue repetition. Add tests for repeated cadence, metadata, mojibake, and a clean narrative sample.

**Verified**: `tests/draft-quality.test.ts` covers metadata, 问答残片、乱码、占位符、重复段落、重复句式和正常对白；本地保底扩写已避免重复上下文提示和机械循环。

### Step 2: Preserve actionable quality failure details

When a generated draft fails `validateDraftQuality`, return a stable `DRAFT_QUALITY_GATE_FAILED` code with the violation list through the existing stream error envelope. Keep the existing generic fallback for unexpected provider failures and never include prompts, keys, or stack traces.

**Verified**: agents/production quality failures return `DRAFT_QUALITY_GATE_FAILED` with sanitized `violations` and `retriable` fields.

### Step 3: Add optional real-provider smoke

Create a script modeled on `scripts/runtime-smoke.mjs`. It must use an isolated temporary database/config, call one minimal scoped prose generation path only when a provider key is present, assert a non-empty response passes `validateDraftQuality`, and print only provider/model status without secrets. With no key, exit 0 with `SKIP: provider credentials not configured`.

**Verified**: configured local provider smoke passed (`126` chars, `4576ms`); empty isolated config exits 0 with `SKIP: provider credentials not configured`.

### Step 4: Run final gates

Run typecheck, lint, backend/frontend tests, build, and the deterministic full-browser journey three times. Do not use production `data.db`.

## Done criteria

- [x] Repetition/metadata/乱码 quality cases have deterministic tests.
- [x] Quality rejection exposes a stable code and sanitized violation list.
- [x] Provider smoke skips honestly without credentials and never prints a secret.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:frontend`, and `npm run build` pass.
- [x] Full browser journey passes three consecutive times.

## STOP conditions

- Stop if the provider smoke would require writing to production `data.db`.
- Stop if a quality rule rejects the existing clean narrative fixtures without a narrowly justified adjustment.
- Stop if route changes require changing a public response shape beyond adding backward-compatible error fields.
