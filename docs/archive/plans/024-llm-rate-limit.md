# Plan 024: LLM Rate Limiting
> Commit: ca53899 | Status: TODO | Category: security | Priority: P2

## Why
No rate limiting on billable LLM endpoints. A loop in the frontend could burn API credits.

## Changes
- `server/middleware/rate-limit.ts` (new): token-bucket per endpoint
- Apply to `/api/editor-agent`, `/api/orchestrate`, `/api/inspiration`, `/api/extract-*`, `/api/generate-*`

## Steps
1. Implement simple in-memory token bucket (refill 1 token/5s, bucket size 5)
2. Apply middleware to LLM routes
3. Return 429 with retry-after header on limit

## Done: `npx tsc --noEmit` zero errors, LLM routes rate-limited
