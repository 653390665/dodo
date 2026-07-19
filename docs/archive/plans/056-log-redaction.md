# Plan 056: Redact user content from server logs
> Priority: P3 | Effort: M | Risk: LOW

## Why: console.error(e) may log chapter text, character details

## Steps
1. Create server/logger.ts — wraps console with content redaction
2. Replace console.error(e) with logger.error('context', e)
3. Redact fields: content, bio, summary, text, description, traits

## Done: No user content in server stdout/stderr
