# Plan 057: Selective SSE cache invalidation
> Priority: P3 | Effort: M | Risk: MEDIUM

## Why: Every DB write triggers full data reload in all mounted components

## Steps
1. Extend SSE data format with entity type
2. Components subscribe with entity filter
3. Only refetch when relevant entity type changes

## Done: SSE refetch reduced by ~70%
