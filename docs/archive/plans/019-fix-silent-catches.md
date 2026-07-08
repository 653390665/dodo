# Plan 019: Fix silent catch blocks in AI pipeline
> Commit: ca53899 | Status: DONE | Category: correctness

## Why
3 catch blocks silently swallowed LLM errors. Added console.warn before each fallback.

## Changes
- `server/helpers/ai-production-pipeline.ts`: Planner/Writer/Critic catches now log warnings
