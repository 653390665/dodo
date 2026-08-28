import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { confirmWritingStyleForTest } from './helpers/confirm-writing-style.js';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-prod-disconnect-'));
const databasePath = path.join(testDir, 'production-disconnect.test.db');
process.env.INKFLOW_DB_PATH = databasePath;

let app: express.Express;
let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
const originalConfig: Record<string, unknown> = {};
const originalFetch = globalThis.fetch;
const styleFingerprints = new Map<string, string>();
let readDatabaseGeneration: () => number = () => 0;

before(async () => {
  const db = await import('../server/lib/db');
  const { getConfig } = await import('../server/lib/config');
  const { registerProductionRoutes } = await import('../server/routes/production');
  const { __quotaTestHooks } = await import('../server/helpers/quota-guard');
  const { getDatabaseGeneration } = await import('../server/lib/db-instance');
  readDatabaseGeneration = getDatabaseGeneration;

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
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(baseUrl) && typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const fingerprint = typeof body.novelId === 'string' ? styleFingerprints.get(body.novelId) : undefined;
        if (typeof body.novelId === 'string') {
          init = { ...init, body: JSON.stringify({
            ...body,
            chapterId: body.chapterId || `${body.novelId}-chapter`,
            databaseGeneration: body.databaseGeneration ?? readDatabaseGeneration(),
            ...(fingerprint && !body.styleConfirmationFingerprint ? { styleConfirmationFingerprint: fingerprint } : {}),
          }) };
        }
      } catch { /* pass through */ }
    }
    return originalFetch(url, init);
  };
});

after(async () => {
  const { getConfig } = await import('../server/lib/config');
  const { closeDb } = await import('../server/lib/db');
  const { __quotaTestHooks } = await import('../server/helpers/quota-guard');
  const { __productionTestHooks } = await import('../server/routes/production');

  Object.assign(getConfig(), originalConfig);
  globalThis.fetch = originalFetch;
  __productionTestHooks.preFallbackWriteHook = null;
  __productionTestHooks.preModelWriteHook = null;
  __productionTestHooks.disconnectObservedHook = null;
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
  db.createChapter({
    id: `${id}-chapter`, novelId: id, title: 'Chapter', content: '', order: 1,
    wordCount: 0, createdAt: now, updatedAt: now,
  });
  styleFingerprints.set(id, confirmWritingStyleForTest(id));
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

test('start-stream rejects a mechanical fallback without exposing or persisting prose', async () => {
  const novelId = 'prod-disconnect-normal';
  await setupNovel(novelId);
  const db = await import('../server/lib/db');
  const now = Date.now();
  const novel = db.getNovel(novelId)!;
  db.updateNovel(novelId, {
    worldRules: '世界证据-潮汐城每逢午夜倒流',
    projectPreferenceProfile: {
      ...novel.projectPreferenceProfile!,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: now },
        favoriteTechniqueIds: [],
        projectTechniqueIds: ['prose-action-booster'],
      },
    },
  });
  db.createCharacter({
    id: `${novelId}-character`, novelId, name: '角色证据-林舟', role: 'protagonist',
    summary: '只用左手解读导师暗号', traits: ['克制'], bio: '', createdAt: now, updatedAt: now,
  });
  db.createForeshadowing({
    id: `${novelId}-foreshadowing`, novelId, title: '伏笔证据-青铜铃',
    description: '第三次响起会打开地下城门', status: 'planted', relatedCharacterIds: [],
    createdAt: now, updatedAt: now,
  });
  styleFingerprints.set(novelId, confirmWritingStyleForTest(novelId));

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
  assert.doesNotMatch(text, /"type":"fallback_draft_token"/);
  assert.doesNotMatch(text, /"type":"fallback_draft_done"/);
  assert.doesNotMatch(text, /"type":"done"/);
  const events = text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as {
      type: string;
      code?: string;
      retriable?: boolean;
      violations?: string[];
    });
  const error = events.find((event) => event.type === 'error');
  assert.equal(error?.code, 'DRAFT_QUALITY_GATE_FAILED');
  assert.equal(error?.retriable, true);
  assert.ok(error?.violations?.length);

  const [run] = db.listChapterProductionRuns(novelId);
  assert.ok(run, 'quality failure should remain visible as a failed run');
  assert.equal(run.status, 'failed');
  assert.equal(run.draftContent, '');
  assert.equal(db.listChapterProductionRunVersions(run.id).length, 0);
  assert.ok(run.continuityReport.executionReceipt?.capabilityRefs.includes('prose-action-booster'));
  assert.deepEqual(run.continuityReport.executionReceipt?.contextDimensions, ['world', 'character', 'foreshadowing']);
  await waitForReservation(novelId, 'refunded');
});

test('start-stream disconnect before fallback write refunds quota', async () => {
  const { __productionTestHooks } = await import('../server/routes/production');
  const novelId = 'prod-disconnect-before-fallback';
  await setupNovel(novelId);

  // The hook creates an AbortController we can trigger while the hook awaits
  const hookResolve = { current: null as null | (() => void) };
  let resolveDisconnectObserved!: () => void;
  const disconnectObserved = new Promise<void>((resolve) => {
    resolveDisconnectObserved = resolve;
  });
  __productionTestHooks.disconnectObservedHook = resolveDisconnectObserved;

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
  // Wait until diagnostic provenance has been streamed, then disconnect
  // before any fallback persistence can run.
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
  await disconnectObserved;

  // Release the hook so the route can proceed to the disconnect guard.
  hookResolve.current?.();

  // Wait for the error path to settle and the quota refund to complete.
  await waitForReservation(novelId, 'refunded');

  __productionTestHooks.preFallbackWriteHook = null;
  __productionTestHooks.disconnectObservedHook = null;
});

test('start-stream invalid fallback does not enter the model queue in test env', async () => {
  const { __productionTestHooks } = await import('../server/routes/production');
  const novelId = 'prod-disconnect-model-queue';
  await setupNovel(novelId);

  let modelWriteReached = false;
  __productionTestHooks.preModelWriteHook = () => {
    modelWriteReached = true;
  };
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
  assert.match(text, /"code":"DRAFT_QUALITY_GATE_FAILED"/);
  assert.doesNotMatch(text, /"type":"fallback_draft_token"/);
  assert.doesNotMatch(text, /"type":"done"/);
  assert.equal(modelWriteReached, false);

  const db = await import('../server/lib/db');
  const runs = db.listChapterProductionRuns(novelId);
  assert.ok(runs.length > 0, 'should have a production run');
  const run = runs[0];
  assert.equal(run.draftContent, '');
  assert.equal(run.status, 'failed');
  assert.equal(db.listChapterProductionRunVersions(run.id).length, 0);

  await waitForReservation(novelId, 'refunded');
  __productionTestHooks.preModelWriteHook = null;
});

test('start-stream does not write fallback when response is already destroyed', async () => {
  const novelId = 'prod-disconnect-destroyed';
  await setupNovel(novelId);

  // Simulate a destroyed response by aborting the request while the hook blocks.
  const hookResolve = { current: null as null | (() => void) };

  const { __productionTestHooks } = await import('../server/routes/production');
  let resolveDisconnectObserved!: () => void;
  const disconnectObserved = new Promise<void>((resolve) => {
    resolveDisconnectObserved = resolve;
  });
  __productionTestHooks.disconnectObservedHook = resolveDisconnectObserved;
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
  await disconnectObserved;
  hookResolve.current?.();

  // Quota refunded — no content delivered
  await waitForReservation(novelId, 'refunded');

  __productionTestHooks.preFallbackWriteHook = null;
  __productionTestHooks.disconnectObservedHook = null;
});
