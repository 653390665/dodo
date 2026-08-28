# InkFlow Beta Stabilization Baseline - 2026-08-11

## Purpose

Preserve the current high-value but unaudited worktree before starting Beta stabilization implementation.

## Baseline

- Source branch before preservation: `feat/plan-138-clean`
- Source HEAD: `dff4445`
- Current status entries: 365
- Untracked files: 182
- Tracked diff excluding `package-lock.json`: 186 files, 16854 insertions, 6436 deletions
- `git diff --check`: clean

## Included Content Policy

Preserve effective project content:

- source code under `src/`, `server/`, `shared/`
- tests under `src/tests/` and `tests/`
- docs, plans, scripts, config, package metadata
- current stabilization specs and plans

Exclude generated or disposable artifacts:

- `dist/`
- `dist-electron/`
- `release/`
- `coverage/`
- `test-results/`
- Playwright reports and media artifacts

## Current Risk

This baseline is not a release-ready commit. It is a recoverability point for a large in-progress tree.

Known risks:

- Many unrelated domains are mixed in the same working tree.
- Validation is not current for the preserved state.
- Previous `npm run typecheck` attempt exceeded four minutes and was interrupted.
- E2E configuration runs against built `dist`, but CI currently needs explicit build-before-E2E ordering.

## Next Steps

1. Create protection branch `codex/beta-stabilization-baseline`.
2. Commit the preserved worktree as `chore: preserve beta stabilization worktree`.
3. Split follow-up implementation into small tracks:
   - baseline-and-release-evidence
   - writing-mainline-ux
   - capability-skill-card-usability
   - llm-and-save-state-unification
   - task-persistence-reliability

## Reference Docs

- `docs/superpowers/specs/2026-08-11-inkflow-beta-stabilization-design.md`
- `docs/superpowers/plans/2026-08-11-inkflow-beta-stabilization.md`
