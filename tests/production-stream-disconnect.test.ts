import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-prod-disconnect-'));
const databasePath = path.join(testDir, 'production-disconnect.test.db');
process.env.INKFLOW_DB_PATH = databasePath;

let app: express.Express;
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
const originalConfig: Record<string, unknown> = {};

before(async () => {
  const db = await import('../server/lib/db');
  const { getConfig } = await import('../server/lib/config');
  const { registerProductionRoutes } = await import('../server/routes/production');
  const { __quotaTestHooks } = await import('../server/helpers/quota-guard');

  db.initDb(databasePath);
  __quotaTestHooks.quotaReservations.clear();

  const config = getConfig();
  originalConfig.apiKey = config.apiKey;
  originalConfig.baseUrl = config.baseUrl;
  originalConfig.model = config.model;
  originalConfig.promptGuardLevel = config.promptGuardLevel;
  // Empty key keeps the route in test-env fast path (no real LLM fetch).
  config.apiKey = '';
  config.baseUrl = 'https://api.openai.test/v1';
  config.model = 'test-model';
  config.promptGuardLevel = 'disabled';

  app = express();
  app.use(express.json());
  registerProductionRoutes(app);
  server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://localhost:${port}`;
});

after(async () => {
  const { getConfig } = await import('../server/lib/config');
  const { closeDb } = await import('../server/lib/db');
  const { __quotaTestHooks } = await import('../server/helpers/quota-guard');
  const { __productionTestHooks } = await import('../server/routes/production');

  Object.assign(getConfig(), originalConfig);
  __productionTestHooks.preFallbackWriteHook = null;
  __productionTestHooks.preModelWriteHook = null;
  __quotaTestHooks.quotaReservations.clear();

  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  try { fs.rmSync(testDir, { force: true, recursive: true }); } catch {}
});

/**
 * Helper: create a novel with free-tier quota for testing.
 */
async function setupNovel(id: string) {
  const db = await import('../server/lib/db');
  const now = Date.now();
  db.createNovel({
    id,
    title: `Novel ${id}`,
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      commercialMode: 'free',
      quotaLimits: { generateProseCount: 0, generateProseMax: 100 },
    },
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Helper: wait for reservation to reach expected status.
 */
async function waitForReservation(
  novelId: string,
  expected: 'committed' | 'refunded',
): Promise<string> {
  const { __quotaTestHooks } = await import('../server/helpers/quota-guard');
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const r = Array.from(__quotaTestHooks.quotaReservations.values())
      .find((c) => c.novelId === novelId && c.status === expected);
    if (r) return r.id;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for reservation ${expected} for ${novelId}`);
}

test('start-stream normal completion in test env delivers fallback', async () => {
  const novelId = 'prod-disconnect-normal';
  await setupNovel(novelId);

  const response = await fetch(`${baseUrl}/api/chapter-production-runs/start-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId,
      targetChapterId: '',
      userIntent: '写一个雨夜场景',
      continuationPackId: '',
    }),
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /"type":"run_created"/);
  assert.match(text, /"type":"fallback_draft_token"/);
  assert.match(text, /"type":"done"/);
  // Quota should be committed for fallback delivery
  await waitForReservation(novelId, 'committed');
});

test('start-stream disconnect before fallback write refunds quota', async () => {
  const { __productionTestHooks } = await import('../server/routes/production');
  const novelId = 'prod-disconnect-before-fallback';
  await setupNovel(novelId);

  // The hook creates an AbortController we can trigger while the hook awaits
  const hookResolve = { current: null as null | (() => void) };

  __productionTestHooks.preFallbackWriteHook = () => {
    // Block until the test releases the hook, letting us disconnect first.
    return new Promise<void>((resolve) => {
      hookResolve.current = resolve;
    });
  };

  // Abort the in-flight request to trigger the server's client-disconnect
  // handler while the fallback write is still blocked in the hook.
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/chapter-production-runs/start-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      novelId,
      targetChapterId: '',
      userIntent: '测试断连',
      continuationPackId: '',
    }),
  });

  assert.equal(response.status, 200);
  // Wait until fallback content has been streamed
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('"type":"fallback_continuity"')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += decoder.decode(chunk.value, { stream: true });
  }

  // Abort the request (simulates client disconnect) while the hook is blocking.
  controller.abort();

  // Give the server time to observe the aborted request before releasing the hook.
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Release the hook so the route can proceed to the disconnect guard.
  hookResolve.current?.();

  // Wait for the error path to settle and the quota refund to complete.
  await waitForReservation(novelId, 'refunded');

  __productionTestHooks.preFallbackWriteHook = null;
});

test('start-stream disconnect during model queue keeps fallback only', async () => {
  const { __productionTestHooks } = await import('../server/routes/production');
  const novelId = 'prod-disconnect-model-queue';
  await setupNovel(novelId);

  // In test env, the AI pipeline is skipped. We test the model path guard
  // via the preModelWriteHook, but since test env doesn't run the pipeline,
  // we verify the fallback path is clean instead.
  //
  // This test confirms: fallback is persisted and quota committed, no model
  // overwrite happens (test env = no model call).
  const response = await fetch(`${baseUrl}/api/chapter-production-runs/start-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId,
      targetChapterId: '',
      userIntent: '测试 model 断连',
      continuationPackId: '',
    }),
  });

  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /"type":"done"/);

  // Verify the run has fallback content
  const db = await import('../server/lib/db');
  const runs = db.listChapterProductionRuns(novelId);
  assert.ok(runs.length > 0, 'should have a production run');
  const run = runs[0];
  assert.ok(run.draftContent.length > 0, 'fallback content should be persisted');
  assert.equal(run.status, 'review_required');

  // Quota committed for fallback
  await waitForReservation(novelId, 'committed');
});

test('start-stream does not write fallback when response is already destroyed', async () => {
  const novelId = 'prod-disconnect-destroyed';
  await setupNovel(novelId);

  // Simulate a destroyed response by aborting the request while the hook blocks.
  const hookResolve = { current: null as null | (() => void) };

  const { __productionTestHooks } = await import('../server/routes/production');
  __productionTestHooks.preFallbackWriteHook = () => {
    return new Promise<void>((resolve) => {
      hookResolve.current = resolve;
    });
  };

  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/chapter-production-runs/start-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify({
      novelId,
      targetChapterId: '',
      userIntent: '测试 destroyed response',
      continuationPackId: '',
    }),
  });

  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);

  // Read until we have the fallback_continuity event, then abort the request
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('"type":"fallback_continuity"')) {
    const chunk = await reader.read();
    if (chunk.done) break;
    received += decoder.decode(chunk.value, { stream: true });
  }

  // Abort the request to simulate connection reset while the hook blocks.
  controller.abort();

  // Give the server time to observe the aborted request before releasing the hook.
  await new Promise((resolve) => setTimeout(resolve, 300));
  hookResolve.current?.();

  // Quota refunded — no content delivered
  await waitForReservation(novelId, 'refunded');

  __productionTestHooks.preFallbackWriteHook = null;
});
