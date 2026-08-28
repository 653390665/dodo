# Writing Mainline UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Make the writing path direct: open project -> editor -> write -> save, with cockpit as a secondary overview instead of a gate.
**Architecture:** Reuse existing AppShell routing, Welcome persistence, Editor guide banners, and EditorStatusBar. Avoid new state stores and avoid redesigning the editor.
**Tech Stack:** React, TypeScript, Vitest, Playwright for focused e2e only if needed.

## Current Status (2026-08-17)

**DONE.** Existing projects enter the editor from the writing workspace, new projects expose `先写正文`, the cockpit remains a secondary overview with direct writing actions, and empty chapters remain editable. Verification includes the 2026-08-16 full frontend gate and the 2026-08-17 focused AppShell/cockpit regression set. The original checkboxes below are retained as historical plan steps.

## Scope

Allowed files:

- `src/components/AppShell.tsx`
- `src/components/WelcomeView.tsx`
- `src/components/EditorGuideBanners.tsx`
- `src/components/ProjectCockpitView.tsx` only if required for copy/entry consistency
- `src/components/EditorView.tsx` only if required for route handoff
- focused tests under `src/tests/`
- `tests/e2e/core-flow.spec.ts` only if existing assertions break

Do not:

- redesign cockpit
- add dependencies
- trigger AI generation automatically from the new "先写正文" path
- touch capability store files
- touch backend files

## Task 1: Make Workspace Main Entry Prefer Editor

Steps:

- [ ] Read the current `AppShell` workspace render branch.
- [ ] Preserve cockpit as an accessible project overview.
- [ ] Change sidebar/workspace main action so returning users land in `EditorView`.
- [ ] Keep `workspaceFocus` and active sidebar state consistent.
- [ ] Add or update a focused test proving "创作工作台" opens editor for an existing selected novel.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/app-shell-novel-restore.test.tsx
```

## Task 2: Add "先写正文" Path In New Project Flow

Steps:

- [ ] In `WelcomeView`, reuse existing `handlePersistStory('editor')`.
- [ ] Add user-facing copy/action: `先写正文`.
- [ ] Ensure it creates/saves the project and first editable chapter without starting production generation.
- [ ] Keep existing setup/world-bible path available.
- [ ] Add focused test for the choice.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/writing-mainline-ux.test.tsx
```

If creating the new test file is too heavy, extend the closest existing Welcome/AppShell test.

## Task 3: Keep Cockpit Useful But Not Blocking

Steps:

- [ ] Verify cockpit still exposes direct writing actions.
- [ ] If copy implies cockpit is the default workspace, rename/copy it toward `作品驾驶舱`.
- [ ] Do not remove recommendation cards.
- [ ] Do not execute audit/polish until target chapter is loaded in Editor.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/project-cockpit-content-gating.test.tsx
```

## Task 4: Keep Editor First Screen Light

Steps:

- [ ] Reuse existing `EditorGuideBanners` and `EditorStatusBar`.
- [ ] Ensure empty chapter state permits typing.
- [ ] Avoid adding a heavy new panel.
- [ ] If needed, update guide copy to emphasize writing, save state, and optional next actions.

Expected test command:

```bash
npm run test:frontend -- --run src/tests/editor-guidance-layout.test.tsx
```

## Validation

Smallest focused set:

```bash
npm run test:frontend -- --run src/tests/app-shell-novel-restore.test.tsx src/tests/project-cockpit-content-gating.test.tsx src/tests/editor-guidance-layout.test.tsx
```

Broader check if routing changed:

```bash
npm run typecheck
npx playwright test tests/e2e/core-flow.spec.ts
```

## Rollback

Revert only the files listed in Scope. No database or migration changes are involved.
