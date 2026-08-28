# Plan 041: Generic CRUD helper — eliminate 13× entity boilerplate
> Priority: P3 | Effort: L | Risk: HIGH | Category: tech-debt

## Why
13 entity types share identical CRUD patterns (~600 lines). A generic helper reduces to ~50 lines of config.

## Goal
`createCrudHelpers<T>(config)` factory → `{ list, get, create, update, delete }`. Replace 13 entity CRUD blocks.

## Steps

### Step 1: Define generic CRUD factory
- `src/lib/db-crud.ts`: type-safe factory with table/column/row-mapper config
- Verify: `npx tsc --noEmit` for new module

### Step 2: Migrate Novel as proof-of-concept
- Replace Novel CRUD with factory call, verify behavior identical

### Step 3: Migrate remaining 12 entities
- Each migration: ~50 lines → 1 factory call
- Verify after each: tsc + CRUD works

### Step 4: Remove old boilerplate (~600 lines)

## Done: tsc passes, all 65 CRUD operations work identically
