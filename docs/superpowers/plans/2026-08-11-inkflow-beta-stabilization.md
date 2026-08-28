# InkFlow Beta Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Turn the current chaotic Beta candidate into an auditable, writing-first, release-checkable project state where capability store and deconstruction skill cards are actually usable while writing.
**Architecture:** Split work into five independent tracks: baseline preservation, release evidence, writing mainline UX, capability/skill-card usability, and reliability design. Do not start broad architecture refactors until the baseline and product mainline are stable.
**Tech Stack:** React, TypeScript, Vite, Express, Electron, SQLite via better-sqlite3, Node test runner, Vitest, Playwright.

## Current Status (2026-08-17)

**PARTIALLY COMPLETE.** Tasks 4-7 are implemented: writing opens directly into the editor, capability cards are usable by stage and scope, LLM/save states use honest shared states, and continuation extraction jobs persist recoverable status. Tasks 1-3 remain release work: current-SHA release evidence, target-platform packaging/signing, and real-provider verification must not be inferred from historical checks. The original checkboxes below remain as the execution template and are not retroactively rewritten.

## Source Spec

- `docs/superpowers/specs/2026-08-11-inkflow-beta-stabilization-design.md`

## Plan Boundaries

This is a master plan. Create narrower execution plans before code changes for:

1. `baseline-and-release-evidence`
2. `writing-mainline-ux`
3. `capability-skill-card-usability`
4. `llm-and-save-state-unification`
5. `task-persistence-reliability`

Detailed child plan now exists for:

- `docs/superpowers/plans/2026-08-11-llm-save-state-unification.md`
- `docs/superpowers/plans/2026-08-11-writing-mainline-ux.md`
- `docs/superpowers/plans/2026-08-11-capability-skill-card-usability.md`
- `docs/superpowers/plans/2026-08-11-task-persistence-reliability.md`

Do not modify implementation code from this master plan alone.

Locked execution decisions:

- Mobile is out of scope for this stabilization track.
- Dependency upgrades are out of scope unless needed for a P0 security fix.
- Capability cards are a differentiator and must become usable from the writing flow.
- Do not add mandatory "skill effect explanation" UI; skill impact should be felt in output quality, with only lightweight state/scope visibility.
- Broad route/component refactors wait until baseline, release evidence, and mainline UX are stable.

## Task 1: Preserve Current Baseline

Files:

- Modify or create: `docs/release-readiness.md` or a new dated stabilization report.
- Git only: create a branch or WIP commit after user approval.

Steps:

- [ ] Run:

```bash
git branch --show-current
git rev-parse --short HEAD
git status --short
git diff --stat -- . ':!package-lock.json'
git ls-files --others --exclude-standard
```

- [ ] Save command outputs into the stabilization report.
- [ ] Ask for explicit approval before creating a branch, stash, or WIP commit.
- [ ] After approval, create one recoverable baseline.
- [ ] Verify:

```bash
git status --short
git log --oneline -3
```

Expected result:

- Current state has a named recovery point.
- Report states whether the tree is clean or intentionally dirty.

## Task 2: Make CI E2E Evidence Current-Commit Based

Files:

- Modify: `.github/workflows/build.yml`
- Inspect: `playwright.config.ts`

Steps:

- [ ] Add a build step before Playwright E2E in the `check` job.
- [ ] Keep Playwright running against built bundle because current config intentionally disables Vite middleware.
- [ ] Run the smallest local validation possible:

```bash
npm run build
npx playwright test
```

- [ ] If full Playwright is too slow locally, run:

```bash
npx playwright test tests/e2e/reliability-contracts.spec.ts
```

- [ ] Verify CI job order by reading `.github/workflows/build.yml`.

Expected result:

- E2E cannot accidentally test stale `dist`.
- CI failure points to current commit build or tests.

## Task 3: Create Release Evidence Template

Files:

- Modify: `docs/release-readiness.md`
- Optional modify: `README.md`

Steps:

- [ ] Add a release evidence section with exact fields:

```markdown
## Release Evidence

- Commit SHA:
- Branch:
- Date:
- Commands:
  - `npm run typecheck`: exit
  - `npm run lint`: exit
  - `npm test`: exit
  - `npm run test:frontend`: exit
  - `npm run build`: exit
  - `npx playwright test`: exit
- Artifacts:
  - macOS:
  - Windows:
- SHA-256:
  - macOS:
  - Windows:
- Known gaps:
```

- [ ] Make old validation reports clearly historical if they are not tied to the current SHA.
- [ ] Ensure README wording does not imply signed or fully verified platforms unless evidence exists.

Expected result:

- A reader can tell exactly what was tested, on which commit, and what artifacts came out.

## Task 4: Direct Writing Mainline UX Plan

Detailed plan:

- `docs/superpowers/plans/2026-08-11-writing-mainline-ux.md`

Files to inspect for the detailed plan:

- `src/lib/workspace-nav.ts`
- `src/components/AppShell.tsx`
- `src/components/ProjectCockpitView.tsx`
- `src/components/WorldBibleOnboarding.tsx`
- `src/components/EditorView.tsx`
- Relevant tests under `src/tests/`

Steps:

- [ ] Decide whether `创作工作台` opens editor directly or gets renamed to `作品驾驶舱`.
- [ ] Define a visible "先写正文" path for new project setup.
- [ ] Keep cockpit accessible from editor/workspace without blocking writing.
- [ ] Write focused tests before code changes.

Expected tests:

```bash
npm run test:frontend -- --run src/tests/workspace-nav.test.tsx
npm run test:frontend -- --run src/tests/world-bible-onboarding*.test.tsx
```

Expected result:

- Returning users reach editor directly.
- New users can start writing before completing 3 setup items.

## Task 5: Capability Store and Skill Card Usability Plan

Detailed plan:

- `docs/superpowers/plans/2026-08-11-capability-skill-card-usability.md`

Files to inspect for the detailed plan:

- `src/components/SkillsStudioView.tsx`
- `src/components/skills/SkillCard.tsx`
- `src/components/skills/SkillLoadoutBoard.tsx`
- `src/components/skills/SkillDetailDrawer.tsx`
- `src/components/book-factory/SkillCardDetails.tsx`
- `src/components/EditorView.tsx`
- `src/components/AgentWorkspace.tsx`
- `src/lib/capability-launch.ts`
- `src/lib/chapter-capability-state.ts`
- `src/lib/skill-client.ts`
- `src/lib/capability-client.ts`
- `shared/types/skills.ts`
- `shared/types/capability-manifest.ts`
- Relevant tests under `src/tests/skills-*`, `src/tests/capability-*`, and `src/tests/plan158-*`

Steps:

- [ ] Define the Beta role of capability store: advanced management, not required before the first successful writing session.
- [ ] Define the Editor role: show effective project/chapter skills and provide one clear action to apply a deck or card.
- [ ] Normalize user-facing action scopes:

```text
用于本章
设为项目默认
仅运行一次
```

- [ ] Normalize user-facing card states:

```text
未使用
本章使用
作品默认
系统启用
```

- [ ] Define author-facing card categories:

```text
文风卡
结构卡
世界观卡
审稿卡
精修卡
护栏卡
```

- [ ] Route each category to the actions where it may affect output:

```text
开书/规划 -> 结构卡, 世界观卡, 护栏卡
世界观 -> 世界观卡, 护栏卡
写作/生成正文 -> 文风卡, 结构卡, 护栏卡
审稿 -> 审稿卡, 护栏卡, 可选文风参考
精修 -> 精修卡, 文风卡, 审稿结果, 护栏卡
```

- [ ] Ensure deconstruction output becomes a usable 文风卡 deck and may include optional 审稿/护栏 suggestions.
- [ ] Ensure outline/world/review/polish cards can be applied from their relevant stage actions without opening the full store.
- [ ] Define card precedence:

```text
系统护栏 > 本章使用 > 作品默认 > 推荐卡
```

- [ ] Keep default new-project behavior simple: system guardrails can be active by default; style cards require confirmation.
- [ ] Ensure AI writeback from polish always previews first and creates a version after user confirmation.
- [ ] Ensure world-bible writes require user confirmation.
- [ ] Write focused tests before code changes.

Expected tests:

```bash
npm run test:frontend -- --run src/tests/capability-launch.test.ts
npm run test:frontend -- --run src/tests/chapter-capability-state.test.ts
npm run test:frontend -- --run src/tests/skills-studio-current-state.test.tsx
npm run test:frontend -- --run src/tests/plan158-deck-ui.test.tsx
```

Expected result:

- User can see which skills affect the current project/chapter from the writing flow.
- User can apply a deconstruction skill card/deck without understanding the whole store.
- User can apply structure/world/review/polish cards from the relevant action context.
- Persistent configuration and one-time execution are not mixed in one ambiguous button.
- Current action shows only the cards that affect that action, with overflow folded after roughly 3-5 visible cards.
- Writing UI does not include a verbose prompt/debug explanation for each card.

## Task 6: LLM and Save State Unification Plan

Detailed plan:

- `docs/superpowers/plans/2026-08-11-llm-save-state-unification.md`

Files to inspect for the detailed plan:

- `src/components/WelcomeView.tsx`
- `src/components/EditorView.tsx`
- `src/components/ProjectCockpitView.tsx`
- `src/components/EditorStatusBar.tsx`
- `src/lib/hooks/useEditorPersistence.ts`
- `src/lib/client-logger.ts`
- `server/lib/config.ts`

Steps:

- [ ] Define shared UI state names: `connected`, `missing`, `unknown`.
- [ ] Remove user-facing technical copy such as `LOCAL_RESERVED`.
- [ ] Move cockpit AI action availability to the same state model.
- [ ] Split editor save copy from generic sync copy.
- [ ] Add tests for each state and copy/action combination.

Expected tests:

```bash
npm run test:frontend -- --run src/tests/p0-ai-trust.test.ts
npm run test:frontend -- --run src/tests/editor-persistence.test.tsx
```

Expected result:

- Same LLM state means same visual status and same user actions everywhere.
- Editor save indicator answers whether chapter content is saved.

## Task 7: Task Persistence Reliability Design

Detailed plan:

- `docs/superpowers/plans/2026-08-11-task-persistence-reliability.md`

Files to inspect for the detailed plan:

- `server/routes/continuation.ts`
- `server/routes/agents.ts`
- `server/routes/world.ts`
- `server/routes/audit.ts`
- `server/lib/db-init.ts`
- `server/lib/db/continuation-jobs.ts`
- `shared/types/continuation.ts`
- Related tests under `tests/continuation-*`

Steps:

- [ ] Inventory all process-memory maps used for user-visible jobs.
- [ ] Classify each entry as persisted state or runtime handle.
- [ ] Choose first persistence target: continuation import/entity extraction.
- [ ] Define SQLite table fields, startup recovery behavior, cleanup TTL, and cancellation semantics.
- [ ] Write a separate implementation plan before editing code.

Expected result:

- A durable-job design exists before any route rewrite.
- Broad route splitting is postponed until restart recovery behavior is clear.

## Validation Strategy

Smallest first:

```bash
npm run typecheck
npm run lint
npm run test:frontend -- --run <focused-test>
npm test -- <focused-backend-test>
npm run build
npx playwright test <focused-e2e>
```

Full gate after Phase 1 and Phase 2:

```bash
npm run typecheck
npm run lint
npm test
npm run test:frontend
npm run build
npx playwright test
```

## Execution Handoff

Recommended path:

1. Use subagent-driven development for each narrow plan.
2. Keep write scopes disjoint.
3. Main thread reviews diff, status, and validation.

Inline execution is acceptable only for Task 2 or documentation-only edits.
