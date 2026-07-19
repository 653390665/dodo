# Plan 020: Add input validation to routes
> Commit: ca53899 | Status: DONE | Category: security

## Why
/config had SSRF risk (unvalidated baseUrl). /start-stream had no validation unlike /start.

## Changes
- `server/routes/config.ts`: POST now validates with configSchema
- `server/routes/production.ts`: /start-stream now validates with chapterProductionSchema
