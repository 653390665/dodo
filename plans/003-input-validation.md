# Plan 003: Input Validation
> Commit: fcb3b9b | Status: TODO | Blocks: None

## Finding
All POST endpoints trust req.body without validation, allowing malformed data to cause runtime errors or security issues.

## Goal
Add input validation using Zod schemas to critical POST endpoints.

## Files
- Create: `server/validation.ts` — shared validation middleware and schemas
- Modify: route files — apply validation middleware to endpoints

## Steps
### Step 1: Install Zod
- Action: Run `npm install zod` to add Zod dependency.
- Verify: `package.json` contains `"zod": "^3.x.x"` in dependencies

### Step 2: Create validation middleware
- Action: Create `server/validation.ts` that:
  1. Exports a `validate(schema)` middleware function
  2. Takes a Zod schema and validates `req.body` against it
  3. Returns 400 with structured error (field, message) if validation fails
  4. Calls `next()` if validation passes
  5. Exports shared schemas for common data structures
- Verify: `npx tsc --noEmit server/validation.ts` compiles without errors

### Step 3: Define schemas for critical endpoints
- Action: In `server/validation.ts`, create Zod schemas for:
  1. `/api/db` — database operations (e.g., `{ action: string, data: object }`)
  2. `/api/config` — configuration updates (e.g., `{ key: string, value: any }`)
  3. `/api/extract-skill` — skill extraction (e.g., `{ text: string, options?: object }`)
  4. `/api/chapter-production-runs/start` — production run start (e.g., `{ chapterId: string, options?: object }`)
  5. `/api/story-cards` — story card operations (e.g., `{ action: string, card: object }`)
- Verify: Each schema validates sample valid and invalid data correctly

### Step 4: Apply validation middleware
- Action: In each route file, import the validation middleware and apply it to the corresponding POST routes:
  1. `app.post('/api/db', validate(dbSchema), handler)`
  2. `app.post('/api/config', validate(configSchema), handler)`
  3. `app.post('/api/extract-skill', validate(extractSkillSchema), handler)`
  4. `app.post('/api/chapter-production-runs/start', validate(productionRunSchema), handler)`
  5. `app.post('/api/story-cards', validate(storyCardSchema), handler)`
- Verify: `grep -r "validate(" server/` shows middleware applied to all 5 endpoints

### Step 5: Test validation
- Action: Test each endpoint with invalid data:
  1. Send empty body → should return 400
  2. Send wrong types → should return 400 with specific field errors
  3. Send valid data → should return 200 (or appropriate success)
- Verify: All endpoints return 400 with structured error for invalid input

## Done Criteria
- [ ] `server/validation.ts` exists with validation middleware and schemas
- [ ] Zod is installed and listed in package.json
- [ ] All 5 critical endpoints have validation middleware applied
- [ ] Invalid requests return 400 with structured error response
- [ ] Valid requests still work as expected

## STOP Conditions
- If the project doesn't use Express (e.g., uses Fastify, Koa), stop and report framework mismatch.
- If there are existing validation mechanisms that would conflict, stop and report.
- If the endpoint structures don't match the assumed schemas, stop and report actual structures.
- If adding validation breaks existing client implementations, stop and report.