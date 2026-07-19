# Plan 009: Fix dark mode — replace bg-white with theme tokens
> Commit: ca53899 | Status: TODO

## Finding
`bg-white` appears in 100+ locations across ~30 component files. The project already defines semantic tokens in `src/index.css` (`--theme-sidebar`: `#FFFFFF` light / `#1a1a1a` dark), but components bypass them with hardcoded `bg-white`. In dark mode, cards, panels, drawers, and inputs remain bright white while the surrounding UI turns dark — a broken experience.

Similarly, `text-gray-400`/`text-gray-500` are used in ~7 places instead of `text-theme-muted` (`#888888` light / `#777777` dark).

## Goal
Replace all hardcoded `bg-white` with `bg-theme-sidebar` and `text-gray-400`/`text-gray-500` with `text-theme-muted`, except in `index.css` theme definitions.

## Files
In scope (~30 files with `bg-white` matches):
- `src/App.tsx`
- `src/components/AgentWorkspace.tsx`
- `src/components/AgentWorkspaceTracePanel.tsx`
- `src/components/AIAssistant.tsx`
- `src/components/WritingSurface.tsx`
- `src/components/Library.tsx`
- `src/components/CopilotHomePanel.tsx`
- `src/components/SkillCard.tsx`
- `src/components/WorldBibleView.tsx`
- `src/components/Sidebar.tsx`
- `src/components/ChapterSidebar.tsx`
- `src/components/EditorView.tsx`
- `src/components/EditorHeader.tsx`
- `src/components/ErrorBoundary.tsx`
- `src/components/SplitWorkspace.tsx`
- `src/components/BookFactoryView.tsx`
- `src/components/ContinuationImportView.tsx`
- `src/components/WelcomeView.tsx`
- `src/components/SkillsStudioView.tsx`
- Plus any other files with `bg-white` matches found at execution time.

Out of scope:
- `src/index.css` — contains the theme variable definitions; do NOT touch
- Any file outside `src/`

## Steps

### Step 1: Replace `bg-white` globally
- Action: Run `grep -rn "bg-white" src/` to get the full file list (may differ from the list above).
- For each file, replace `bg-white` → `bg-theme-sidebar`.
- **Exception**: If `bg-white` appears in `data-theme` selectors inside CSS files, skip it.
- **Exception**: If `bg-white` is part of a gradient (`bg-gradient-to-* from-white`), replace with `from-theme-sidebar`.
- Verify: `grep -rn "bg-white" src/` returns zero matches (excluding `index.css` theme definitions).

### Step 2: Replace `text-gray-400` and `text-gray-500`
- Action: Replace `text-gray-400` → `text-theme-muted`, `text-gray-500` → `text-theme-muted`.
- Key locations (from audit): `App.tsx:405,550,566,582`, `ErrorBoundary.tsx:34`.
- Verify: `grep -rn "text-gray-400\|text-gray-500" src/` returns zero matches.

### Step 3: Type-check and dev smoke test
- Action: Run `npx tsc --noEmit` and confirm zero errors.
- Action: Run `pnpm dev` briefly, toggle dark mode via browser devtools (`localStorage.setItem('inkflow-theme', 'dark')`), and visually confirm:
  - Cards/panels/sidebar backgrounds are dark, not white
  - Muted text is legible on dark background
  - No visual regressions in light mode
- Verify: TypeScript passes; dark mode no longer shows white-on-dark panels.

## Done Criteria
- [ ] `grep -rn "bg-white" src/` returns zero matches outside `index.css`
- [ ] `grep -rn "text-gray-400\|text-gray-500" src/` returns zero matches
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm dev` starts successfully
- [ ] Dark mode panels/cards no longer appear white

## STOP Conditions
- If `bg-white` appears inside CSS custom property definitions (e.g., `--card-bg: #FFFFFF`), do NOT change it — those define the token values.
- If a component uses `bg-white` as part of a conditional interactive state (e.g., `hover:bg-white`, `data-[state=open]:bg-white`), confirm the token equivalent works before replacing.
- If replacing any `text-gray-400` breaks border colors (unlikely), revert that specific instance.

## Maintenance notes
- When adding new components, always use `bg-theme-sidebar` and `text-theme-muted` instead of raw color tokens.
- The theme tokens are defined in `src/index.css` under `:root` (light) and `[data-theme="dark"]` selectors. New semantic tokens should be added there, not overridden per-component.
