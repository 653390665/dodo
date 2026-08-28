import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';

import { registerOnboardingRoutes } from '../server/routes/onboarding';
import { getConfig } from '../server/lib/config';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';
import { __onboardingLlmSessionTestHooks } from '../server/helpers/onboarding-llm-session';
import { closeDb, createNovel, initDb } from '../server/lib/db';
import { advanceDatabaseGeneration } from '../server/lib/db-instance';
import { getDatabaseGeneration } from '../server/lib/db-instance';
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
    const invalidOperation = await fetch(`${baseUrl}/api/onboarding/llm-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'unknown' }),
    });
    assert.equal(invalidOperation.status, 400);
    assert.deepEqual(await invalidOperation.json(), { error: '新手引导模型操作无效，请重新打开当前流程。' });

    const missingStoryJob = await fetch(`${baseUrl}/api/story-cards/jobs/missing`);
    assert.equal(missingStoryJob.status, 404);
    assert.deepEqual(await missingStoryJob.json(), { error: '故事卡任务不存在或已过期，请重新生成。' });

    const missingStoryCancel = await fetch(`${baseUrl}/api/story-cards/jobs/missing/cancel`, { method: 'POST' });
    assert.equal(missingStoryCancel.status, 404);
    assert.deepEqual(await missingStoryCancel.json(), { error: '故事卡任务不存在或已过期，请重新生成。' });

    const staleGeneration = getDatabaseGeneration() + 1;
    const staleCards = await fetch(`${baseUrl}/api/story-cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        onboardingSessionId: 'stale-session',
        ideaSeed: '雨夜失踪案牵出一座城市被遗忘的共同记忆',
        databaseGeneration: staleGeneration,
      }),
    });
    assert.equal(staleCards.status, 409);
    assert.deepEqual(await staleCards.json(), { error: '数据库已切换，请刷新后重试', code: 'DATABASE_GENERATION_MISMATCH' });

    const staleRefine = await fetch(`${baseUrl}/api/setup-task-refine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'stale-novel',
        taskTitle: '补全人物关系',
        databaseGeneration: staleGeneration,
      }),
    });
    assert.equal(staleRefine.status, 409);
    assert.deepEqual(await staleRefine.json(), { error: '数据库已切换，请刷新后重试', code: 'DATABASE_GENERATION_MISMATCH' });

    const blankRefineTask = await fetch(`${baseUrl}/api/setup-task-refine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'stale-novel',
        taskTitle: '   ',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(blankRefineTask.status, 400);
    assert.deepEqual(await blankRefineTask.json(), { error: '请先选择要完善的设定任务。' });

    const sessionResponse = await fetch(`${baseUrl}/api/onboarding/llm-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'story-cards' }),
    });
    const session = await sessionResponse.json() as { sessionId: string };
    const blankIdea = await fetch(`${baseUrl}/api/story-cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        onboardingSessionId: session.sessionId,
        ideaSeed: '   ',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(blankIdea.status, 400);
    assert.deepEqual(await blankIdea.json(), { error: '请先输入故事创意，再生成故事卡。' });

    const nextSessionResponse = await fetch(`${baseUrl}/api/onboarding/llm-session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'story-cards' }),
    });
    const nextSession = await nextSessionResponse.json() as { sessionId: string };
    const startResponse = await fetch(`${baseUrl}/api/story-cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        onboardingSessionId: nextSession.sessionId,
        ideaSeed: '雨夜失踪案牵出一座城市被遗忘的共同记忆',
        chatContext: '',
        planning: { expectedWordCount: 100_000, storyFocus: 'plot', pacingPreference: 'tight' },
        databaseGeneration: getDatabaseGeneration(),
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

    const cancelAgainResponse = await fetch(`${baseUrl}/api/story-cards/jobs/${started.jobId}/cancel`, { method: 'POST' });
    assert.equal(cancelAgainResponse.status, 409);
    assert.deepEqual(await cancelAgainResponse.json(), { error: '当前故事卡任务不能取消。' });

    const statusResponse = await fetch(`${baseUrl}/api/story-cards/jobs/${started.jobId}`);
    const status = await statusResponse.json() as { status: string; error?: string };
    assert.equal(status.status, 'failed');
    assert.equal(status.error, '故事卡任务已取消。');
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
    const blankDocument = await fetch(`${baseUrl}/api/extract-world-setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'world-setup-generation', documentText: '   ' }),
    });
    assert.equal(blankDocument.status, 400);
    assert.deepEqual(await blankDocument.json(), { error: '请先粘贴或上传设定资料，再开始提取。' });

    const missingStatus = await fetch(`${baseUrl}/api/extract-world-setup/jobs/missing?databaseGeneration=${getDatabaseGeneration()}`);
    assert.equal(missingStatus.status, 404);
    assert.deepEqual(await missingStatus.json(), { error: '设定提取任务不存在或已过期，请重新提交。' });

    const missingCancel = await fetch(`${baseUrl}/api/extract-world-setup/jobs/missing/cancel?databaseGeneration=${getDatabaseGeneration()}`, { method: 'POST' });
    assert.equal(missingCancel.status, 404);
    assert.deepEqual(await missingCancel.json(), { error: '设定提取任务不存在或已过期，请重新提交。' });

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

    const staleStatus = await fetch(
      `${baseUrl}/api/extract-world-setup/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration + 1}`,
    );
    assert.equal(staleStatus.status, 409);
    assert.deepEqual(await staleStatus.json(), { error: '设定提取任务状态已过期，请重新提交。' });

    advanceDatabaseGeneration();
    const statusResponse = await fetch(
      `${baseUrl}/api/extract-world-setup/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`,
    );
    assert.equal(statusResponse.status, 409);
    assert.deepEqual(await statusResponse.json(), { error: '数据库已在设定提取任务期间切换，请重新提交。' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(providerSignal.aborted, true);

    const cancelFailedResponse = await fetch(
      `${baseUrl}/api/extract-world-setup/jobs/${started.jobId}/cancel?databaseGeneration=${started.databaseGeneration}`,
      { method: 'POST' },
    );
    assert.equal(cancelFailedResponse.status, 409);
    assert.deepEqual(await cancelFailedResponse.json(), { error: '当前设定提取任务不能取消。' });
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
