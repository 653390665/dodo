# Plan 117: Add Zod validation to export route

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- server/routes/export.ts server/validation.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

The `/api/export` endpoint accesses `req.body.novelId` and `req.body.format` without Zod validation, unlike every other POST route in the codebase. While the risk is low (local-first app), this is a defense-in-depth gap and inconsistency with the project's established pattern.

## Current state

- `server/routes/export.ts:86-89` — raw body access without validation:
  ```typescript
  app.post('/api/export', async (req, res) => {
    try {
      const { novelId, format } = req.body;
      if (!novelId) return res.status(400).json({ error: 'Missing novelId' });
  ```
- `server/validation.ts` — existing Zod schemas and `validate()` middleware
- All other POST routes use `validate(schema)` middleware

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `npx tsc --noEmit`       | exit 0, no errors   |
| Lint      | `npx eslint server/routes/export.ts` | exit 0 |

## Scope

**In scope**:
- `server/routes/export.ts`
- `server/validation.ts`

**Out of scope**:
- No other files

## Steps

### Step 1: Add export schema to validation.ts

In `server/validation.ts`, add a new schema after the existing schemas (after line 114):

```typescript
export const exportSchema = z.object({
  novelId: z.string().min(1),
  format: z.enum(['txt', 'epub']).optional().default('txt'),
});
```

**Verify**: `npx tsc --noEmit` → exit 0

### Step 2: Apply validate middleware to export route

In `server/routes/export.ts`:

1. Add import at the top (after existing imports):
   ```typescript
   import { validate, exportSchema } from '../validation';
   ```

2. Change the route registration from:
   ```typescript
   app.post('/api/export', async (req, res) => {
   ```
   to:
   ```typescript
   app.post('/api/export', validate(exportSchema), async (req, res) => {
   ```

3. Remove the manual `novelId` check at line 89:
   ```typescript
   if (!novelId) return res.status(400).json({ error: 'Missing novelId' });
   ```
   (Zod validation now handles this)

**Verify**: `npx tsc --noEmit` → exit 0

### Step 3: Run lint

```bash
npx eslint server/routes/export.ts server/validation.ts
```

Expected: exit 0

## Test plan

- No new tests needed — this adds validation middleware consistent with existing patterns
- Manual verification: call `/api/export` without `novelId` and confirm 400 response with validation error details

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx eslint server/routes/export.ts server/validation.ts` exits 0
- [ ] `grep -n "validate(exportSchema)" server/routes/export.ts` returns a match
- [ ] `grep -n "exportSchema" server/validation.ts` returns a match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The code at the locations in "Current state" doesn't match the excerpts.
- A step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file.

## Maintenance notes

- Future routes should follow this pattern: define schema in `validation.ts`, apply `validate(schema)` middleware.
- The `format` field uses `z.enum(['txt', 'epub'])` to restrict allowed values.
