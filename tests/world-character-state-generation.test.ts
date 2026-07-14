import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { getConfig } from '../server/lib/config';
import { closeDb, createCharacter, createNovel, getCharacter, initDb } from '../server/lib/db';
import { advanceDatabaseGeneration, getDatabaseGeneration } from '../server/lib/db-instance';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';
import { registerWorldRoutes } from '../server/routes/world';

test('queued character-state work cannot write after the database generation changes', async () => {
  const originalFetch = globalThis.fetch;
  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  const dbPath = path.join(os.tmpdir(), `inkflow-character-state-generation-${process.pid}.db`);
  closeDb();
  initDb(dbPath);
  __rateLimitTestHooks.reset();
  createNovel({
    id: 'generation-novel', title: 'Generation', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'paid',
    },
    createdAt: 1, updatedAt: 1,
  });
  createCharacter({
    id: 'character-1', novelId: 'generation-novel', name: '叶半夏', role: 'protagonist',
    summary: '', traits: [], bio: '', createdAt: 1, updatedAt: 1,
  });
  const initialCharacterState = getCharacter('character-1')?.current_state;

  const app = express();
  app.use(express.json());
  registerWorldRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let releaseProviders!: () => void;
  const providerBlocker = new Promise<void>((resolve) => { releaseProviders = resolve; });
  let providerCalls = 0;

  try {
    config.apiKey = 'test-api-key';
    config.baseUrl = 'https://generation.test/v1';
    config.model = 'test-model';
    config.promptGuardLevel = 'disabled';
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(baseUrl)) return originalFetch(input, init);
      providerCalls += 1;
      if (providerCalls <= 2) await providerBlocker;
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          characters: [{ name: '叶半夏', changes: { mood: '不应跨代写入' } }],
        }) } }],
      });
    };

    const requestGeneration = getDatabaseGeneration();
    const startJob = async () => {
      const response = await fetch(`${baseUrl}/api/update-character-state`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          novelId: 'generation-novel',
          chapterContent: '叶半夏走进雨幕。',
          databaseGeneration: requestGeneration,
        }),
      });
      assert.equal(response.status, 200);
      return response.json();
    };

    await Promise.all([startJob(), startJob(), startJob()]);
    assert.equal(providerCalls, 2, 'the third job must be queued behind the per-operation semaphore');
    advanceDatabaseGeneration();
    releaseProviders();

    const deadline = Date.now() + 2_000;
    while (providerCalls < 3 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(providerCalls, 3);
    assert.equal(getCharacter('character-1')?.current_state, initialCharacterState);
  } finally {
    releaseProviders();
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    __rateLimitTestHooks.reset();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});
