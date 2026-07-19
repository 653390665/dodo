# Plan 055: Add helmet security headers
> Priority: P1 | Effort: S | Risk: LOW

## Steps
1. pnpm add helmet
2. server.ts: import helmet from 'helmet'; app.use(helmet());
3. Verify: npx tsc --noEmit
