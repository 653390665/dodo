# Plan 002: Server Authentication Binding
> Commit: fcb3b9b | Status: TODO | Blocks: None

## Finding
Server binds to 0.0.0.0 with zero authentication, exposing all 30+ endpoints to the network.

## Goal
Add token-based authentication and bind to localhost only to secure the server.

## Files
- Create: `server/middleware/auth.ts` — authentication middleware
- Modify: `server.ts` — apply middleware and change binding

## Steps
### Step 1: Create auth middleware
- Action: Create `server/middleware/auth.ts` that:
  1. Generates a random token on startup using `crypto.randomUUID()`
  2. Stores token in `~/.inkflow/.auth-token` (create directory if needed)
  3. Exports middleware that checks `Authorization: Bearer <token>` header
  4. Returns 401 if token missing or invalid
  5. Skips auth for `/api/db/events` (SSE) or allows token as query param
- Verify: `npx tsc --noEmit server/middleware/auth.ts` compiles without errors

### Step 2: Update server.ts binding
- Action: In `server.ts`, find the `listen` call and change `0.0.0.0` to `127.0.0.1`.
- Verify: `grep -n "listen(" server.ts` shows `127.0.0.1`

### Step 3: Apply auth middleware
- Action: In `server.ts`, import the auth middleware and add `app.use('/api', authMiddleware)` before route registration.
- Verify: `grep -n "authMiddleware" server.ts` shows the middleware is applied

### Step 4: Test authentication
- Action: Start the server and test:
  1. `curl localhost:3000/api/config` → should return 401
  2. `curl -H "Authorization: Bearer <token>" localhost:3000/api/config` → should return 200
  3. `curl localhost:3000/api/db/events` → should work without auth (SSE endpoint)
- Verify: All three test cases pass as expected

## Done Criteria
- [ ] `server/middleware/auth.ts` exists and exports auth middleware
- [ ] `server.ts` binds to `127.0.0.1` instead of `0.0.0.0`
- [ ] Auth middleware is applied to `/api` routes
- [ ] Unauthenticated requests to `/api/config` return 401
- [ ] SSE endpoint `/api/db/events` works without authentication

## STOP Conditions
- If the server uses a framework other than Express (e.g., Fastify, Koa), stop and report framework mismatch.
- If there are existing authentication mechanisms that would conflict, stop and report.
- If changing the binding to localhost breaks existing client connections or deployment, stop and report.
- If the SSE endpoint requires different authentication handling, stop and report.