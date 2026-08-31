import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { getConfig } from '../server/lib/config';
import { closeDb, createNovel, initDb } from '../server/lib/db';
import { getDatabaseGeneration } from '../server/lib/db-instance';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';
import { registerWorldRoutes } from '../server/routes/world';

// Behaviour coverage for the world LLM endpoints that previously had none
// (COV-01): success flow delivers the parsed job result; an upstream failure
// surfaces as a normalized job error, never as an HTTP 500 crash.

interface WorldJobResult<T = unknown> {
  status: string;
  result?: T;
  error?: string;
}

async function setupWorldServer(suffix: string) {
  const originalFetch = globalThis.fetch;
  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  const dbPath = path.join(os.tmpdir(), `inkflow-world-llm-${process.pid}-${suffix}.db`);
  closeDb();
  initDb(dbPath);
  __rateLimitTestHooks.reset();
  createNovel({
    id: 'world-llm-novel', title: 'World LLM', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'paid',
    },
    createdAt: 1, updatedAt: 1,
  });

  const app = express();
  app.use(express.json());
  registerWorldRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const teardown = () => {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    __rateLimitTestHooks.reset();
    server.close();
    closeDb();
    try { fs_unlink(dbPath); } catch { /* best effort */ }
    try { fs_unlink(`${dbPath}-wal`); } catch { /* best effort */ }
    try { fs_unlink(`${dbPath}-shm`); } catch { /* best effort */ }
  };
  return { baseUrl, config, teardown };
}

function fs_unlink(p: string) {
  // lazy require kept out of the hot path
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('node:fs').unlinkSync(p);
}

async function waitForJob<T>(baseUrl: string, jobId: string, databaseGeneration: number): Promise<WorldJobResult<T>> {
  const deadline = Date.now() + 5000;
  let job: WorldJobResult<T> | null;
  do {
    const response = await fetch(`${baseUrl}/api/world/jobs/${jobId}?databaseGeneration=${databaseGeneration}`);
    assert.notEqual(response.status, 409, 'stale-generation during polling');
    job = await response.json() as WorldJobResult<T>;
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`job ${jobId} did not settle within 5s (last=${JSON.stringify(job)})`);
}

function mockLlm(originalFetch: typeof fetch, baseUrl: string, content: string) {
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, init);
    return Response.json({ choices: [{ message: { content } }] });
  };
}

test('extract-entities: success delivers parsed entities; upstream 500 fails gracefully', async () => {
  const { baseUrl, config, teardown } = await setupWorldServer('extract');
  const originalFetch = globalThis.fetch;
  const requestGeneration = getDatabaseGeneration();
  try {
    config.apiKey = 'test-key';
    config.baseUrl = 'https://llm.test/v1';
    config.model = 'test-model';
    config.promptGuardLevel = 'disabled';

    mockLlm(originalFetch, baseUrl, JSON.stringify({
      activeExisting: ['李慕白'],
      newEntities: [{ name: '说书人', type: 'character', context: '盲眼老者' }],
    }));

    const start = await fetch(`${baseUrl}/api/extract-entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'world-llm-novel',
        databaseGeneration: requestGeneration,
        text: '李慕白收伞入店。',
        existingNames: ['李慕白'],
      }),
    });
    assert.equal(start.status, 200);
    const { jobId, databaseGeneration } = await start.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForJob<{ activeExisting: string[]; newEntities: Array<{ name: string }> }>(baseUrl, jobId, databaseGeneration);
    assert.equal(job.status, 'completed');
    assert.equal(job.result?.activeExisting[0], '李慕白');
    assert.equal(job.result?.newEntities[0].name, '说书人');

    // Upstream failure -> normalized job error, no HTTP crash.
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(baseUrl)) return originalFetch(input, init);
      return new Response('upstream exploded', { status: 500 });
    };
    const failStart = await fetch(`${baseUrl}/api/extract-entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'world-llm-novel', databaseGeneration: requestGeneration, text: '片段', existingNames: [] }),
    });
    assert.equal(failStart.status, 200);
    const failJob = await failStart.json() as { jobId: string; databaseGeneration: number };
    const failed = await waitForJob(baseUrl, failJob.jobId, failJob.databaseGeneration);
    assert.equal(failed.status, 'failed');
    assert.ok(failed.error, 'normalized error message expected');
    assert.ok(!failed.error.includes('upstream exploded'), 'raw upstream text must not leak');
  } finally {
    teardown();
  }
});

test('detect-foreshadowing: success delivers parsed findings', async () => {
  const { baseUrl, config, teardown } = await setupWorldServer('foreshadow');
  const originalFetch = globalThis.fetch;
  const requestGeneration = getDatabaseGeneration();
  try {
    config.apiKey = 'test-key';
    config.baseUrl = 'https://llm.test/v1';
    config.model = 'test-model';
    config.promptGuardLevel = 'disabled';

    mockLlm(originalFetch, baseUrl, JSON.stringify([
      { title: '枯井', description: '后院枯井藏物', type: 'planted', relatedTo: '' },
    ]));

    const start = await fetch(`${baseUrl}/api/detect-foreshadowing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'world-llm-novel',
        databaseGeneration: requestGeneration,
        chapterContent: '后院有一口枯井。',
        chapterTitle: '第一章',
        existingForeshadowings: [],
      }),
    });
    assert.equal(start.status, 200);
    const { jobId, databaseGeneration } = await start.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForJob<Array<{ title: string; type: string }>>(baseUrl, jobId, databaseGeneration);
    assert.equal(job.status, 'completed');
    assert.equal(job.result?.[0].title, '枯井');
    assert.equal(job.result?.[0].type, 'planted');
  } finally {
    teardown();
  }
});

test('analyze-pacing: success delivers per-chapter scores and strand weave', async () => {
  const { baseUrl, config, teardown } = await setupWorldServer('pacing');
  const originalFetch = globalThis.fetch;
  const requestGeneration = getDatabaseGeneration();
  try {
    config.apiKey = 'test-key';
    config.baseUrl = 'https://llm.test/v1';
    config.model = 'test-model';
    config.promptGuardLevel = 'disabled';

    mockLlm(originalFetch, baseUrl, JSON.stringify([
      { chapterId: 'ch-1', tensionScore: 72, payoffCount: 3, emotionLabel: '紧张', suggestion: '再压半拍' },
    ]));

    const start = await fetch(`${baseUrl}/api/analyze-pacing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'world-llm-novel',
        databaseGeneration: requestGeneration,
        chapters: [{ order: 1, title: '第一章', wordCount: 300, content: '雨水落瓦，他推门而入。' }],
      }),
    });
    assert.equal(start.status, 200);
    const { jobId, databaseGeneration } = await start.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForJob<{ chapters: Array<{ tensionScore: number }>; strandWeave?: unknown }>(baseUrl, jobId, databaseGeneration);
    assert.equal(job.status, 'completed');
    assert.equal(job.result?.chapters[0].tensionScore, 72);
    assert.ok(job.result?.strandWeave, 'strand weave computed alongside chapter results');
  } finally {
    teardown();
  }
});