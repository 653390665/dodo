# Plan 054: Separate server/client import paths
> Priority: P3 | Effort: L | Risk: HIGH

## Why: Server routes import from src/lib/* (client code territory)

## Steps
1. Create shared/ directory at repo root
2. Move shared types, config, DB interface to shared/
3. Update server tsconfig to resolve shared/
4. Update client tsconfig to resolve shared/
5. Remove all ../../src/lib/* imports from server routes

## Done: npx tsc zero errors, pnpm dev works
