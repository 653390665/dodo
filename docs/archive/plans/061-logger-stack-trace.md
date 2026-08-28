# Plan 061: Preserve error stack traces in logger
> Source: Audit 2026-06-30 | Priority: P1 | Effort: S

## Why: logger.error drops err.stack — makes production debugging impossible

## Step 1: Add err.stack to safe output in logger.ts:34-39
## Step 2: Verify npx tsc --noEmit
