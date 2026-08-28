# Plan 022: Knowledge graph — entity relationships MVP
> Commit: ca53899 | Status: DONE | Category: direction

## Why
Long-form novel writers lose track of character relationships across chapters. Flat entity tables don't show connections.

## Changes
- `src/lib/db.ts`: entity_relationships table + CRUD
- `src/lib/world-client.ts`: client wrappers
- `server.ts`: DB_WHITELIST entries
- `src/components/RelationshipGraph.tsx`: SVG force-directed graph (no deps)
- `src/components/WorldBibleView.tsx`: 'graph' tab with visualization

## Done: `npx tsc --noEmit` zero errors, graph tab visible in WorldBible
