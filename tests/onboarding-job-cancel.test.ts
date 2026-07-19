import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { registerOnboardingRoutes } from '../server/routes/onboarding';
import { getConfig } from '../server/lib/config';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';
import { __onboardingLlmSessionTestHooks } from '../server/helpers/onboarding-llm-session';
import { closeDb, createNovel, initDb } from '../server/lib/db';
import { advanceDatabaseGeneration } from '../server/lib/db-instance';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('cancelling a story-card job aborts the provider request', async () => {
  const originalFetch = globalThis.fetch;
  const config = getConfig();
  const originalConfig = { ...config };
  let baseUrl = '';
  let providerSignal: AbortSignal | undefined;

  config.apiKey = 'test-key';
  config.baseUrl = 'https://provider.test/v1';
  config.model = 'test-model';
  config.promptGuardLevel = 'disabled';
  __rateLimitTestHooks.reset();
  __onboardingLlmSessionTestHooks.reset();

  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, init);
    providerSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => reject(providerSignal?.reason || new DOMException('Aborted', 'AbortError'));
      if (providerSignal?.aborted) onAbort();
      else providerSignal?.addEventListener('abort', onAbort, { once: true });
    });
  };

  const app = express();
  app.use(express.json());
  registerOnboardingRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const sessionResponse = await fetch(`${baseUrl}/api/onboarding/llm-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'story-cards' }),
    });
    const session = await sessionResponse.json() as { sessionId: string };
    const startResponse = await fetch(`${baseUrl}/api/story-cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        onboardingSessionId: session.sessionId,
        ideaSeed: '雨夜失踪案牵出一座城市被遗忘的共同记忆',
        chatContext: '',
        planning: { expectedWordCount: 100_000, storyFocus: 'plot', pacingPreference: 'tight' },
      }),
    });
    assert.equal(startResponse.status, 200);
    const started = await startResponse.json() as { jobId: string };
    assert.ok(started.jobId);

    for (let attempt = 0; attempt < 50 && !providerSignal; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(providerSignal);

    const cancelResponse = await fetch(`${baseUrl}/api/story-cards/jobs/${started.jobId}/cancel`, { method: 'POST' });
    assert.equal(cancelResponse.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(providerSignal.aborted, true);

    const statusResponse = await fetch(`${baseUrl}/api/story-cards/jobs/${started.jobId}`);
    const status = await statusResponse.json() as { status: string; error?: string };
    assert.equal(status.status, 'failed');
    assert.match(status.error || '', /cancel/i);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('world-setup job aborts and rejects polling after a database generation change', async () => {
  const originalFetch = globalThis.fetch;
  const config = getConfig();
  const originalConfig = { ...config };
  const dbPath = path.join(os.tmpdir(), `inkflow-world-setup-generation-${Date.now()}.db`);
  let baseUrl = '';
  let providerSignal: AbortSignal | undefined;

  closeDb();
  initDb(dbPath);
  createNovel({
    id: 'world-setup-generation', title: 'World setup', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, commercialMode: 'paid',
    },
    createdAt: 1, updatedAt: 1,
  });
  config.apiKey = 'test-key';
  config.baseUrl = 'https://provider.test/v1';
  config.model = 'test-model';
  config.promptGuardLevel = 'disabled';

  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith(baseUrl)) return originalFetch(input, init);
    providerSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => reject(providerSignal?.reason || new DOMException('Aborted', 'AbortError'));
      if (providerSignal?.aborted) onAbort();
      else providerSignal?.addEventListener('abort', onAbort, { once: true });
    });
  };

  const app = express();
  app.use(express.json());
  registerOnboardingRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const startResponse = await fetch(`${baseUrl}/api/extract-world-setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'world-setup-generation', documentText: '角色阿遥来自北境。' }),
    });
    assert.equal(startResponse.status, 200);
    const started = await startResponse.json() as { jobId: string; databaseGeneration: number };
    for (let attempt = 0; attempt < 50 && !providerSignal; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(providerSignal);

    advanceDatabaseGeneration();
    const statusResponse = await fetch(
      `${baseUrl}/api/extract-world-setup/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`,
    );
    assert.equal(statusResponse.status, 409);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(providerSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});
