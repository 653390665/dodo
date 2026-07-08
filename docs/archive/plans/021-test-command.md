# Plan 021: Add pnpm test command
> Commit: ca53899 | Status: DONE | Category: DX

## Why
63 .test.ts files existed but no test script in package.json.

## Changes
- `package.json`: added "test": "vitest run" and "test:watch": "vitest"
