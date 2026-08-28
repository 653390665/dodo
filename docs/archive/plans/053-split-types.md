# Plan 053: Split types.ts into domain modules
> Priority: P3 | Effort: L | Risk: MEDIUM

## Why: types.ts at 827 lines — 90+ interfaces in single file

## Steps
1. Create src/types/novel.ts — Novel, Chapter, ChapterVersion, SetupTaskDraft
2. Create src/types/world.ts — Character, Location, Item, Faction, PowerLevel
3. Create src/types/skills.ts — Skill, SkillUsageRecord, etc.
4. Create src/types/continuation.ts — ContinuationPack, parser types
5. Create src/types/index.ts — re-export all
6. Update all imports (should resolve via barrel)

## Done: npx tsc zero errors, all types still importable from '../types'
