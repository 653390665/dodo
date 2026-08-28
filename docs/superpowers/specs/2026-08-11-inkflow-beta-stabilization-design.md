# InkFlow Beta Stabilization Design

## Decision

Current priority is **Beta stabilization plus writing mainline cleanup**.

InkFlow should be presented as a **local-first AI writing assistant** for the next Beta. "Autonomous novel factory" remains roadmap language, not a Beta promise.

## Locked Decisions

- First target: internal/dogfood Beta, not broad public release.
- Mainline: create/open project -> editor -> write -> save -> audit/polish.
- AI unavailable mode: local editing, world bible, backup/export, and manual writing must still work.
- Mobile: do not test or claim mobile support in this stabilization track.
- Dependency upgrades: frozen unless a P0 security issue requires action.
- Worktree preservation: prefer a dedicated `codex/beta-stabilization-baseline` branch plus WIP commit after approval.
- Untracked file preservation: include source/docs/tests/plans/scripts/config metadata; exclude build/test artifacts.
- UI change budget: entry, state, copy, and small layout changes only.
- Capability store and deconstruction skill cards are differentiators, but must serve the writing flow instead of becoming a separate maze.
- Capability cards do not need a mandatory "effect evidence" strip in the writing UI; the quality gap between skilled and unskilled output is the primary proof.
- Data/privacy: diagnostics and local metrics stay local by default and must not include manuscript text, world bible content, or API keys.

## Problem

The project feels chaotic because five different kinds of work are mixed in one workspace:

1. Release safety work: CI, package verification, release evidence.
2. Product mainline work: create/open project, enter editor, write, save, use AI when available.
3. Differentiation work: capability store, deconstruction, skill cards, style transfer.
4. Reliability work: long-running LLM/import tasks, crash recovery, database consistency.
5. Architecture cleanup: giant route/component files, database boundary drift, mixed client request protocols.

Treating these as one task creates unreviewable diffs and unclear success criteria.

## Goals

- Preserve the current work before more changes.
- Make CI and release evidence trustworthy.
- Make the core writing path direct and understandable.
- Make capability store and deconstruction skill cards usable inside the writing flow.
- Make LLM and save states honest and consistent.
- Define the next architecture reliability track without starting a broad rewrite.

## Non-Goals

- Do not implement autonomous Planner -> Writer -> Critic orchestration in this Beta track.
- Do not redesign the whole UI.
- Do not split every large route/component file.
- Do not add payment, membership, activation codes, cloud sync, or hosted model quota.
- Do not introduce new dependencies.
- Do not test or claim mobile support in this Beta stabilization track.
- Do not raise broad coverage thresholds until critical writing journeys are protected.

## Users

- New writer: wants to create a project and start writing quickly.
- Returning writer: wants to open a project and continue the current chapter without hunting for the editor.
- Power writer: wants world bible, continuation packs, skills, audit, and polish, but only when those tools help the current writing step.
- Style-driven writer: wants deconstruction skill cards and capability decks to shape prose, but does not want to manage a complex store before writing.
- Maintainer: needs a versioned, auditable release baseline.

## Requirements

### R1. Baseline Preservation

- Create a recoverable baseline before feature edits.
- Capture changed-file count, untracked-file list, branch, latest commit, and validation status.
- Do not publish or call the tree release-ready while hundreds of files are uncommitted.

Acceptance:

- A protection branch or WIP commit exists.
- `git status --short` is recorded in release notes or a stabilization report.
- The baseline can be restored without relying on memory.

### R2. Trustworthy CI and Release Evidence

- E2E must run against a bundle built from the current commit.
- Release notes must bind evidence to commit SHA, commands, exit codes, and artifact hashes.
- CI artifact and formal Release must be clearly separated.

Acceptance:

- CI runs `npm run build` before `npx playwright test`.
- Release readiness docs include SHA, command list, exit code summary, and SHA-256 hashes.
- README does not imply unavailable signed releases or unverified platforms.

### R3. Direct Writing Mainline

- Opening "创作工作台" should not bury the editor behind another dashboard.
- New projects may skip setup and enter editor.
- Setup completeness is a warning/risk signal, not a hard blocker.

Acceptance:

- Existing project can reach editor in one primary action.
- New project can choose "先写正文".
- Dashboard remains available as project overview/recommendation, not as the only path to writing.

### R4. Unified LLM Availability State

- Use one user-facing state model across Welcome, Workspace, Cockpit, Editor, and AI actions:
  - 已连接
  - 未配置
  - 暂时无法确认
- AI actions launched from cockpit must show availability before the user waits for failure.

Acceptance:

- No user-facing `LOCAL_RESERVED`.
- Same unavailable state gives same actions: configure, retry, continue local writing.
- Cockpit AI recommendations are disabled or clearly marked when LLM state is unavailable/unknown.

### R5. Explicit Save State

- Editor save state must answer: "Is my current writing saved?"
- Avoid mixing generic sync success with chapter content save success.

Acceptance:

- Editor shows: 正在保存 / 已保存 / 保存失败.
- Save failure includes retry path.
- Navigation still blocks when pending writes fail.

### R6. Reliability Track Definition

- Long-running task state that users can query or resume must have SQLite as source of truth.
- In-memory maps may keep runtime handles only.
- First target is continuation/import/entity extraction, because it directly affects recovery and data integrity.

Acceptance:

- A separate implementation plan exists for task persistence.
- It lists which maps become persisted records and which remain runtime-only handles.
- It defines startup recovery and cleanup behavior.

### R7. Capability Store and Skill Card Usability

- Capability store and deconstruction skill cards remain a Beta differentiator.
- They must not block the writing mainline or force users through store management before writing.
- The store should emphasize "my skills" and deconstruction-derived skills before "marketplace" language.
- In the Editor, users must be able to answer:
  - Which skills/capabilities affect this project?
  - Which skills/capabilities affect this chapter?
  - What happens if I click this action?
- The Editor should not explain every prompt-level effect inline. Keep skill visibility lightweight; avoid turning the writing surface into a debugging panel.
- Capability actions must use clear scopes:
  - 用于本章
  - 设为项目默认
  - 仅运行一次
- New projects should get system guardrails by default, but style cards require user confirmation.
- User-facing card state names:
  - 未使用
  - 本章使用
  - 作品默认
  - 系统启用

Acceptance:

- Editor shows current effective capability/skill influence without requiring a trip to Skills Studio.
- Skill card actions do not mix persistent configuration with one-time execution.
- Deconstruction output can be accepted into a usable deck, then applied to project/chapter with visible scope.
- Skills Studio remains available for advanced management, but it is not required for the first successful writing session.

### R8. Stage-Based Capability Card Model

Beta capability cards should be organized by author-facing writing stage, not internal implementation type.

Minimum card categories:

1. 文风卡: affects prose voice, diction, rhythm, and forbidden phrases.
2. 结构卡: affects opening, outline, chapter beats, pacing, and scene structure.
3. 世界观卡: affects world bible setup, setting expansion, entity completion, and continuity checks.
4. 审稿卡: affects critique standards and review report shape.
5. 精修卡: affects rewrite, polish, local refinement, and preview quality.
6. 护栏卡: affects safety, anti-slop, forbidden tropes, and quality constraints.

Stage routing:

- 开书/规划: structure cards, world cards, system guardrails.
- 世界观: world cards, continuity guardrails.
- 写作/生成正文: project style cards, chapter temporary cards, structure cards, system guardrails.
- 审稿: review cards, system guardrails, optional style references.
- 精修: polish cards, active style cards, review output, system guardrails.

Card precedence:

1. 系统护栏
2. 本章使用
3. 作品默认
4. 推荐卡

Acceptance:

- Every card declares usable stages.
- Current action shows only cards that affect that action.
- A single action uses a small visible set by default, roughly 3-5 cards, with overflow folded.
- Conflicts are shown only when they affect the current action.
- AI writeback always previews first; confirmed writeback creates a version.
- World-bible writes require user confirmation.

## Diagnosis Map

### P0

- Worktree is not auditable: large tracked diff plus many untracked files.
- Long-running task state relies on process memory.

### P1

- CI E2E can run without explicitly building current `dist`.
- Route layer writes database tables directly in places.
- `server/lib/db.ts` re-exports every domain and weakens boundaries.
- `db-init.ts` mixes schema creation, migration, compatibility repair, and backup.
- Workspace navigation and setup gate slow down the writing path.
- LLM state and save state are inconsistent across views.
- Capability store and skill cards are differentiated but too hard to apply during normal writing.

### P2

- Giant components and route files increase review cost.
- Frontend coverage is low and uneven.
- Release packaging lacks signing/checksum/provenance clarity.
- Product narrative still over-promises compared with Beta capability.

## Phasing

### Phase 0: Stabilize Baseline

Purpose: stop losing work and stop adding unreviewable drift.

Scope:

- Protection branch or WIP commit.
- Current status report.
- No behavior changes.

Validation:

- `git status --short`
- `git diff --stat`
- restore check by branch/commit reference

### Phase 1: Make Release Evidence Trustworthy

Purpose: make CI and release docs represent the current code.

Scope:

- CI build-before-E2E.
- Release evidence template.
- Platform support wording cleanup.

Validation:

- `npm run build`
- `npx playwright test`
- CI job order inspection

### Phase 2: Fix Writing Mainline UX

Purpose: make the app feel like a writing tool first.

Scope:

- Direct editor entry.
- Setup skip path.
- Effective capability/skill summary in the writing flow.
- Unified LLM state display.
- Explicit editor save state.

Validation:

- Focused frontend tests for navigation and setup skip.
- Component tests for LLM state copy/actions.
- Editor persistence test for save states.
- Capability scope tests for project/chapter/run-once actions.

### Phase 3: Reliability Architecture Plan

Purpose: start durable recovery without broad rewrite.

Scope:

- Design task persistence for continuation/import/entity extraction.
- Define SQLite records, runtime handles, startup recovery.
- Identify direct SQL that should move behind domain functions.

Validation:

- Design review.
- Test plan for restart/resume.
- No implementation until Phase 0-2 are stable.

## Workstream Split

Create separate implementation plans:

1. `baseline-and-release-evidence`
2. `writing-mainline-ux`
3. `capability-skill-card-usability`
4. `llm-and-save-state-unification`
5. `task-persistence-reliability`

Do not merge these into one mega plan. They touch different risk surfaces and need different validation.

## Open Questions

1. Should Phase 0 use a WIP commit, stash, or dedicated stabilization branch?
2. Should "创作工作台" be renamed to "作品驾驶舱" if it continues to open dashboard first?
3. Should new project setup skip be a visible button or a secondary text action?
4. What is the minimum useful "effective skills" summary in the Editor?
5. Should task persistence start with continuation import only, or include world bible assistant jobs in the same schema?

## Recommendation

Proceed in this order:

1. Baseline preservation.
2. CI/release evidence.
3. Direct writing mainline.
4. Capability/skill card usability in Editor.
5. Unified LLM/save state.
6. Task persistence design.

This keeps the first delivery small, testable, and reversible.
