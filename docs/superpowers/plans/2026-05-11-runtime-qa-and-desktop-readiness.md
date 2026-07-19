# Runtime QA And Desktop Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans

**Goal:** Bring InkFlow from feature-complete phase-one implementation to a stable local runtime that can support browser smoke checks and Electron packaging.
**Architecture:** Keep the product feature code unchanged unless validation exposes a concrete bug. First restore the normal Express + Vite development path, then restore DOCX import, then add repeatable runtime checks, and only after that validate Electron build scripts.
**Tech Stack:** React 19, Vite 6, Express 4, TypeScript 5.8, better-sqlite3, mammoth, Electron 33, node:test.

## Scope Guard

This plan does not add new product features. It only stabilizes runtime, validation, import support, and release readiness.

Do not change:

- onboarding product flow
- copilot suggestion rules
- skill fusion scoring rules
- project preference flywheel semantics
- prompt templates, unless a runtime endpoint fails because of serialization
- database schema, unless an existing migration/read path fails in validation

## Current Verified Status

- Core tests pass with `node --import tsx --test tests/*.test.ts`.
- `npm run lint` passes after the better-sqlite3 shim typing fix.
- `npm run build` passes with only the existing chunk-size warning.
- `localhost:3000` can run the Express server.
- `localhost:3456` can proxy `/api/*` to `localhost:3000`.
- SSE endpoint returns `Content-Type: text/event-stream` and initial `retry: 3000`.

## Task 1: Restore normal development frontend middleware

Files:

- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/server.ts`

Steps:

- [ ] Change the Vite middleware flag so development mode enables middleware by default.

Replace:

```ts
const enableDevViteMiddleware = process.env.ENABLE_VITE_DEV_MIDDLEWARE === '1';

// Vite middleware for development
if (process.env.NODE_ENV !== "production" && enableDevViteMiddleware) {
```

With:

```ts
const disableDevViteMiddleware = process.env.DISABLE_VITE_DEV_MIDDLEWARE === '1';

// Vite middleware for development
if (process.env.NODE_ENV !== "production" && !disableDevViteMiddleware) {
```

- [ ] Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run dev
```

Expected output:

```text
Server running on http://localhost:3000
```

- [ ] Verify:

```bash
curl -I http://localhost:3000
curl -s http://localhost:3000/api/config
```

Expected behavior:

```text
HTTP/1.1 200 OK
```

`/api/config` must include `hasApiKey`, `baseUrl`, and `model`, and must not include raw `apiKey`.

## Task 2: Restore DOCX parsing through dynamic mammoth import

Files:

- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/server.ts`

Steps:

- [ ] Replace the temporary DOCX 503 response in `/api/parse-doc`.

Replace:

```ts
return res.status(503).json({ error: 'DOCX 解析暂时不可用，请先转换为 TXT 后再导入。' });
```

With:

```ts
const mammoth = await import('mammoth');
const buffer = Buffer.from(filedata, 'base64');
const result = await mammoth.extractRawText({ buffer });
text = result.value;
```

- [ ] Verify the module import:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node -e "require('mammoth'); console.log('mammoth-ok')"
```

Expected output:

```text
mammoth-ok
```

- [ ] Verify TXT parse path remains healthy:

```bash
curl -s -X POST http://localhost:3000/api/parse-doc \
  -H 'Content-Type: application/json' \
  -d '{"filename":"sample.txt","filedata":"5LiW55WM6K6+5a6a"}'
```

Expected behavior:

```text
The endpoint should return JSON or a model/API error, not Unsupported file type.
```

## Task 3: Add a repeatable runtime smoke command

Files:

- Create: `/Users/Zhuanz/Documents/dodo-inkflow/scripts/runtime-smoke.mjs`
- Modify: `/Users/Zhuanz/Documents/dodo-inkflow/package.json`

Steps:

- [ ] Create `scripts/runtime-smoke.mjs`.

```js
const baseUrl = process.env.INKFLOW_BASE_URL || 'http://localhost:3000';

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await check('config does not expose apiKey', async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if ('apiKey' in json) throw new Error('apiKey leaked from /api/config');
  if (typeof json.hasApiKey !== 'boolean') throw new Error('hasApiKey missing');
});

await check('db listSkills responds', async () => {
  const response = await fetch(`${baseUrl}/api/db`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'listSkills', args: [] }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (!Array.isArray(json.result)) throw new Error('listSkills did not return an array');
});

await check('sse endpoint opens', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${baseUrl}/api/db/events`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      throw new Error(`Unexpected content-type: ${contentType}`);
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
});

if (process.exitCode) process.exit(process.exitCode);
```

- [ ] Add a package script:

```json
"smoke:runtime": "node scripts/runtime-smoke.mjs"
```

- [ ] Run:

```bash
npm run smoke:runtime
```

Expected output:

```text
ok config does not expose apiKey
ok db listSkills responds
ok sse endpoint opens
```

## Task 4: Validate Electron build readiness

Files:

- Read: `/Users/Zhuanz/Documents/dodo-inkflow/scripts/build-server.mjs`
- Read: `/Users/Zhuanz/Documents/dodo-inkflow/scripts/build-electron.mjs`
- Read: `/Users/Zhuanz/Documents/dodo-inkflow/electron.cjs`
- Modify only if build output proves a concrete issue.

Steps:

- [ ] Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
npm run build:electron
```

Expected outputs:

```text
dist/index.html exists
dist-electron/server.cjs exists
dist-electron/main.cjs exists
```

- [ ] Verify built server can boot in production mode:

```bash
NODE_ENV=production node dist-electron/server.cjs
```

Expected output:

```text
{"port":3000}
```

If port `3000` is occupied, run:

```bash
PORT=3010 NODE_ENV=production node dist-electron/server.cjs
```

Expected output:

```text
{"port":3010}
```

## Task 5: Browser smoke checklist

Files:

- Read: `/Users/Zhuanz/Documents/dodo-inkflow/src/App.tsx`
- Read: `/Users/Zhuanz/Documents/dodo-inkflow/src/components/ErrorBoundary.tsx`

Steps:

- [ ] Open:

```text
http://localhost:3000
```

- [ ] Verify these views render without ErrorBoundary fallback:

```text
我的书库
灵感助手
拆书工厂
技能仓库
设置
创作舞台
```

- [ ] Verify browser console has no uncaught exceptions.
- [ ] Verify expected handled failures are logged with `.catch()` instead of unhandled promise rejection.

Expected result:

```text
No ErrorBoundary fallback.
No uncaught exception.
No unhandled promise rejection.
```

## Task 6: Final validation bundle

Run:

```bash
cd /Users/Zhuanz/Documents/dodo-inkflow
node --import tsx --test tests/*.test.ts
npm run lint
npm run build
npm run smoke:runtime
```

Expected result:

```text
# pass 44
tsc exits 0
vite build exits 0
runtime smoke exits 0
```

Known acceptable warning:

```text
Some chunks are larger than 500 kB after minification.
```

## Self-Review

- The plan covers runtime startup, DOCX import recovery, SSE validation, browser smoke, and Electron readiness.
- The plan does not change product behavior for onboarding, copilot, skill fusion, or preference flywheel.
- The plan includes exact files, exact commands, and expected outputs.
- There are no `TODO`, `TBD`, or placeholder implementation steps.
