# Plan 042: Offline blank novel — no API key required
> Priority: P0 | Effort: S | Status: DONE

## Goal: Add "创建空白作品" button that creates novel + chapter without AI
- Added handleCreateBlankNovel to App.tsx
- Wired WelcomeView onCreateBlank prop
- `npx tsc --noEmit` passes
