# Plan 062: Wire validate(dbSchema) into /api/db route
> Source: Audit 2026-06-30 | Priority: P1 | Effort: S

## Why: dbSchema defined in validation.ts but never applied to /api/db

## Step 1: Add validate(dbSchema) middleware to app.post('/api/db', ...) in server/routes/db.ts
## Step 2: Verify npx tsc --noEmit
