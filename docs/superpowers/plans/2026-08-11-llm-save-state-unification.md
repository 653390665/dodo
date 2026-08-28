# LLM And Save State Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Make AI availability and editor save state consistent, honest, and actionable across the writing mainline.
**Architecture:** Keep existing backend config and editor write queue. Add a shared frontend state model and replace scattered user-facing copy, without changing provider behavior or editor persistence semantics.
**Tech Stack:** React, TypeScript, Vitest, Express config route, existing editor write queue.

## Current Status (2026-08-17)

**DONE.** Welcome, editor, and project cockpit share `connected | missing | unknown`; network failures remain `unknown`, local writing stays available, and editor save copy remains separate from AI connectivity. Verification: focused Vitest `16/16`, `npm run typecheck` exit `0`, plus the 2026-08-16 full frontend gate. The original checkboxes below are retained as historical plan steps.

## Scope

Modify only the smallest set needed:

- `src/components/WelcomeView.tsx`
- `src/components/EditorView.tsx`
- `src/components/ProjectCockpitView.tsx`
- `src/components/EditorStatusBar.tsx`
- `src/lib/hooks/useEditorPersistence.ts`
- create optional small helper under `src/lib/llm-availability.ts`
- focused tests under `src/tests/`

Do not:

- change provider APIs
- add dependencies
- add automatic provider polling
- record prompts or manuscript content
- redesign the editor

## Task 1: Define Shared LLM Availability Model

Files:

- Create: `src/lib/llm-availability.ts`
- Test: `src/tests/llm-availability.test.ts`

Steps:

- [ ] Create type:

```ts
export type LlmAvailabilityState = 'connected' | 'missing' | 'unknown';
```

- [ ] Create mapper:

```ts
export function deriveLlmAvailability(input: {
  hasApiKey?: boolean | null;
  livenessStatus?: 'connected' | 'unknown' | 'disconnected' | string;
}): LlmAvailabilityState {
  if (input.livenessStatus === 'unknown') return 'unknown';
  if (input.livenessStatus === 'disconnected') return 'missing';
  return input.hasApiKey ? 'connected' : 'missing';
}
```

- [ ] Create labels/actions:

```ts
export const LLM_AVAILABILITY_COPY = {
  connected: {
    label: '已连接',
    helper: 'AI 生成与审阅可用。',
  },
  missing: {
    label: '未配置',
    helper: '可继续本地写作、保存和整理设定；需要 AI 时请先配置 API Key。',
  },
  unknown: {
    label: '暂时无法确认',
    helper: '网络或配置检测暂时不可确认；可继续本地写作，稍后重试 AI。',
  },
} as const;
```

- [ ] Test all mapper cases.

Run:

```bash
npm run test:frontend -- --run src/tests/llm-availability.test.ts
```

## Task 2: Replace Welcome Technical Copy

Files:

- Modify: `src/components/WelcomeView.tsx`
- Test: existing `src/tests/p0-ai-trust.test.ts` if suitable, otherwise add focused component test.

Steps:

- [ ] Replace `LOCAL_RESERVED` user-facing copy with `未配置`.
- [ ] Replace `STATE_UNKNOWN` user-facing copy with `暂时无法确认`.
- [ ] Use `deriveLlmAvailability()` for `/api/config` response mapping.
- [ ] Keep local editing and setup copy explicit.

Run:

```bash
npm run test:frontend -- --run src/tests/p0-ai-trust.test.ts
```

## Task 3: Use Shared LLM State In Editor And Cockpit

Files:

- Modify: `src/components/EditorView.tsx`
- Modify: `src/components/ProjectCockpitView.tsx`
- Optional modify: `src/components/EditorHeader.tsx` or existing prop consumers if state is displayed there.

Steps:

- [ ] Replace local config mapping in `EditorView` with shared helper.
- [ ] Pass availability into cockpit recommendations or AI action buttons.
- [ ] For unavailable/unknown AI actions, keep buttons visible but mark as unavailable with configure/retry/local-writing guidance.
- [ ] Do not hide AI capabilities.

Run focused tests:

```bash
npm run test:frontend -- --run src/tests/project-cockpit-content-gating.test.tsx
npm run test:frontend -- --run src/tests/p0-ai-trust.test.ts
```

## Task 4: Tighten Editor Save Copy

Files:

- Modify: `src/components/EditorStatusBar.tsx`
- Modify only if necessary: `src/lib/hooks/useEditorPersistence.ts`
- Test: `src/tests/editor-persistence.test.ts`

Steps:

- [ ] Keep existing `EditorSaveStatus` enum unless tests prove it is insufficient.
- [ ] Change labels to answer "current writing saved?":

```ts
loading: '正在读取保存状态'
pending: '正在保存'
saved: '正文已保存'
failed: '保存失败，请重试'
unknown: '尚未检测到保存结果'
```

- [ ] Preserve navigation blocking on failed/pending writes.
- [ ] If adding retry UI, use existing `flushPendingEditorWrites()` path.

Run:

```bash
npm run test:frontend -- --run src/tests/editor-persistence.test.ts
```

## Task 5: Verify No Technical Status Leaks

Files:

- Search only unless failures require minimal copy edits.

Steps:

- [ ] Run:

```bash
rg -n "LOCAL_RESERVED|STATE_UNKNOWN|livenessStatus ===|hasApiKey" src/components src/lib
```

- [ ] Keep internal code names if not user-facing; remove user-facing status strings.
- [ ] Run focused frontend tests.

Expected result:

- Users see `已连接`, `未配置`, or `暂时无法确认`.
- Editor save state says whether current writing is saved.
- AI unavailable state never blocks local editing.
