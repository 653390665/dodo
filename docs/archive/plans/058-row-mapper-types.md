# Plan 058: Type-safe row mappers — remove any from rowTo*
> Priority: P2 | Effort: M | Risk: MEDIUM

## Why: 27 rowTo* functions use any parameter — no compiler detection of schema drift

## Steps
1. Define RowMapper<T> generic type
2. Replace any with RowMapper<T> in all 27 rowTo* functions
3. Verify: npx tsc --noEmit catches schema mismatches
