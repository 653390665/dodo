# Plan 114: 启用 CSP 并为 config/sync 添加输入验证

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a90ff4bb..HEAD -- server.ts server/routes/config.ts server/validation.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `a90ff4bb`, 2026-07-10

## Why this matters

Two issues in one plan:

1. **CSP globally disabled**: `server.ts:15` sets `contentSecurityPolicy: false`, meaning no CSP header is sent to browsers. If an XSS vector exists (e.g., via LLM-generated content rendered with react-markdown without sanitization), there is no browser-level mitigation to block inline script execution.

2. **config/sync unvalidated**: `server/routes/config.ts:48` accepts `req.body.apiKey` and passes it directly to `updateCachedApiKey()` without any Zod schema validation. The existing `configSchema` (defined in `server/validation.ts:44-50`) is used on `POST /api/config` (line 29) but NOT on `POST /api/config/sync` (line 48).

## Current state

### CSP disabled

- `server.ts` — Express app setup; Helmet is used at line 14-16 but with CSP disabled.

```typescript
// server.ts line 13-16
// Register helmet for secure headers (CSP, XSS, MIME Sniffing, Clickjacking)
app.use(helmet({
  contentSecurityPolicy: false, // Disable default restrictive CSP in local Dev Vite overlay mode
}));
```

### config/sync unvalidated

- `server/routes/config.ts` — config routes; `POST /api/config` at line 29 uses `validate(configSchema)`, but `POST /api/config/sync` at line 48 has no validation middleware.

```typescript
// server/routes/config.ts line 29 — HAS validation
app.post('/api/config', validate(configSchema), (req, res) => {
  // ...
});

// server/routes/config.ts line 48-60 — NO validation
app.post('/api/config/sync', (req, res) => {
  try {
    const { apiKey } = req.body;
    if (apiKey !== undefined) {
      updateCachedApiKey(apiKey);
    }
    reloadConfig();
    res.json({ ok: true });
  } catch (e) {
    logger.error('POST /api/config/sync error:', e);
    res.status(500).json({ error: 'Failed to sync config' });
  }
});
```

- `server/validation.ts` — validation middleware; `configSchema` at lines 44-50:

```typescript
// server/validation.ts line 44-50
export const configSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional().or(z.literal('')),
  model: z.string().optional(),
  promptGuardLevel: z.enum(['strict', 'balanced', 'disabled']).optional(),
  promptTemplates: z.record(z.string(), z.unknown()).optional(),
});
```

### Repo conventions to follow

- Helmet usage: already imported and used in `server.ts:14`. The existing comment says CSP is disabled for "local Dev Vite overlay mode". The fix should conditionally enable CSP in production while keeping it disabled in development.
- Validation: the `validate(schema)` middleware pattern is used throughout route files. See `server/routes/config.ts:29` and `server/routes/production.ts` for examples.
- Environment detection: `process.env.NODE_ENV` is used in `server.ts:18` to control port retry behavior. Use the same pattern for CSP.

## Commands you will need

| Purpose | Command | Expected on success |
|-----------|---------|---------------------|
| Typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Lint | `npx eslint server.ts server/routes/config.ts --max-warnings=0` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `server.ts` — conditionally enable CSP based on NODE_ENV
- `server/routes/config.ts` — add `validate(configSchema)` to `/api/config/sync`

**Out of scope** (do NOT touch, even though they look related):
- `server/validation.ts` — the `configSchema` already covers apiKey, do not modify the schema
- `server/middleware/auth.ts` — auth middleware, not related to this fix
- `server/routes/production.ts` — other routes, not related
- React frontend XSS hardening (react-markdown sanitization) — separate concern

## Steps

### Step 1: Conditionally enable CSP in production

In `server.ts`, replace the Helmet configuration at lines 14-16 with a version that enables CSP when `NODE_ENV === 'production'` and disables it in development (for Vite overlay).

Replace:

```typescript
app.use(helmet({
  contentSecurityPolicy: false, // Disable default restrictive CSP in local Dev Vite overlay mode
}));
```

With:

```typescript
const isProduction = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  } : false,
}));
```

Notes:
- `'unsafe-inline'` is needed for `styleSrc` because the app uses inline styles (CSS custom properties, `data-theme` attribute styling) and Vite-injected styles in dev. In production, this should be reviewed but is a safe starting point.
- `connectSrc: ['self']` covers both `/api` REST calls and SSE EventSource connections (same-origin).
- `imgSrc` allows `data:` and `blob:` for cover images and data URIs.
- In development mode, `contentSecurityPolicy: false` is kept to avoid conflicts with Vite dev overlay.

**Verify**: `npx tsc --noEmit` → exit 0, no errors

### Step 2: Add validation to config/sync route

In `server/routes/config.ts`, add `validate(configSchema)` middleware to the `POST /api/config/sync` route at line 48.

Replace line 48:

```typescript
app.post('/api/config/sync', (req, res) => {
```

With:

```typescript
app.post('/api/config/sync', validate(configSchema), (req, res) => {
```

The `validate` function and `configSchema` are already imported at the top of the file (line 5: `import { validate, configSchema } from '../validation';`). After validation, `req.body` is the parsed and validated body, so `const { apiKey } = req.body` at line 50 will receive a validated string or undefined.

**Verify**: `npx tsc --noEmit` → exit 0, no errors

### Step 3: Verify lint passes

**Verify**: `npx eslint server.ts server/routes/config.ts --max-warnings=0` → exit 0

## Test plan

- No new automated test is required for this plan. The CSP change is a configuration change best verified by manual inspection of response headers. The validation change is covered by the existing `configSchema` which already validates apiKey as `z.string().optional()`.
- If automated verification is desired: a simple test could send a POST to `/api/config/sync` with a non-string `apiKey` (e.g., `{"apiKey": 123}`) and verify the response is 400 with validation error details. This can be added to a future integration test plan.
- Manual verification for CSP: start the server with `NODE_ENV=production npm run dev`, make a request, and check that the `Content-Security-Policy` header is present in the response.

## Done criteria

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx eslint server.ts server/routes/config.ts --max-warnings=0` exits 0
- [ ] `server.ts` Helmet config includes a production-conditional CSP with directives
- [ ] `server/routes/config.ts` line 48 includes `validate(configSchema)` middleware
- [ ] In development mode (`NODE_ENV !== 'production'`), CSP remains disabled
- [ ] No files outside the in-scope list are modified (`git status`)

## STOP conditions

Stop and report back (do not improvise) if:
- The code at the locations in "Current state" doesn't match the excerpts (the codebase has drifted since this plan was written).
- Enabling CSP in production causes the Electron renderer to fail loading resources (test by running `npm run electron:dev` with `NODE_ENV=production` if possible; if the renderer fails, report what CSP directive is blocking).
- `configSchema` does not accept the fields that `config/sync` needs (verify the schema covers `apiKey` — it does at `validation.ts:45`).

## Maintenance notes

- The `'unsafe-inline'` in `styleSrc` is a known compromise. A future improvement is to use nonce-based or hash-based CSP for styles, which requires Vite plugin configuration changes. This is deferred.
- The CSP directives should be reviewed whenever a new external resource is loaded (e.g., if fonts are loaded from a CDN, `fontSrc` needs the CDN origin). The current config only allows self-hosted resources.
- If `react-markdown` output is found to contain inline scripts or event handlers, the CSP will block them. This is the desired behavior. If it breaks functionality, the root cause is the markdown sanitization, not the CSP — add `rehype-sanitize` to the ReactMarkdown component instead of weakening CSP.