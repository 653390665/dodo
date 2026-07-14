import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import { registerAgentsRoutes } from '../server/routes/agents';
import { registerPromptTestRoutes } from '../server/routes/prompt-test';
import { registerAuditRoutes } from '../server/routes/audit';
import { registerWorldRoutes } from '../server/routes/world';
import { registerSimpleLlmRoutes } from '../server/routes/simple-llm';
import { registerContinuationRoutes } from '../server/routes/continuation';
import { registerSkillsRoutes } from '../server/routes/skills';
import { registerConfigRoutes } from '../server/routes/config';
import { closeDb, createContinuationPack, createNovel, initDb } from '../server/lib/db';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';
import { getDatabaseGeneration } from '../server/lib/db-instance';
import { getConfig } from '../server/lib/config';
import {
  configConnectionSchema,
  setupTaskRefineSchema,
  worldSetupExtractSchema,
} from '../server/validation';

test('pre-project model inputs have bounded runtime schemas', () => {
  assert.equal(configConnectionSchema.safeParse({ apiKey: 'x'.repeat(20_001) }).success, false);
  assert.equal(setupTaskRefineSchema.safeParse({ taskTitle: 'task', storyContext: 'x'.repeat(100_001) }).success, false);
  assert.equal(worldSetupExtractSchema.safeParse({ documentText: 'x'.repeat(150_001) }).success, false);
});

test('background and pre-project LLM routes use the shared gate and forward its signal', () => {
  const expectations = new Map([
    ['server/routes/continuation.ts', ['parse-world-document', 'parse-continuation-pack']],
    ['server/routes/onboarding.ts', ['onboarding-story-cards', 'onboarding-setup-task-refine', 'onboarding-world-setup']],
    ['server/routes/config.ts', ['config-test-connection', 'startup-connection-check']],
    ['server/routes/skills.ts', ['extract-skill']],
  ]);

  for (const [filename, operations] of expectations) {
    const source = fs.readFileSync(filename, 'utf8');
    assert.match(source, /createLlmExecution/);
    for (const operation of operations) {
      assert.match(source, new RegExp(`operation: ['"]${operation}['"]`));
    }
    const modelCalls = source.match(/(?:await )?generateText\(/g)?.length || 0;
    const forwardedSignals = source.match(/\n\s+signal,?\n/g)?.length || 0;
    assert.ok(forwardedSignals >= modelCalls, `${filename} must forward the gate signal to every model call`);
  }
});

test('the sixth pre-project connection test burst is rate limited', async () => {
  const originalFetch = globalThis.fetch;
  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  __rateLimitTestHooks.reset();
  config.apiKey = 'test-api-key';
  config.baseUrl = 'https://connection-rate.test/v1';
  config.model = 'test-model';
  config.promptGuardLevel = 'disabled';

  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    return Response.json({ choices: [{ message: { content: 'OK' } }] });
  };

  const app = express();
  app.use(express.json());
  registerConfigRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/config/test-connection`;

  try {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 200);
    }
    const blocked = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'Rate limited', code: 'RATE_LIMITED', retryAfter: 5 });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    __rateLimitTestHooks.reset();
  }
});

test('LLM routes reject missing novels and amplified editor chains before starting jobs', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-llm-governance-${Date.now()}.db`);
  initDb(dbPath);
  createNovel({ id: 'novel-a', title: 'A', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createNovel({ id: 'novel-b', title: 'B', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createContinuationPack({
    id: 'pack-b', novelId: 'novel-b', title: 'B pack', status: 'approved',
    sourceDocuments: [], canonFacts: [], characterStates: [], contradictions: [], continuationTask: '',
    plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
    styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
    createdAt: 1, updatedAt: 1,
  });
  __rateLimitTestHooks.reset();

  const app = express();
  app.use(express.json());
  registerAgentsRoutes(app);
  registerPromptTestRoutes(app);
  registerAuditRoutes(app);
  registerWorldRoutes(app);
  registerSimpleLlmRoutes(app);
  registerContinuationRoutes(app);
  registerSkillsRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const missingNovel = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userIntent: 'outline this chapter' }),
    });
    assert.equal(missingNovel.status, 400);

    const unknownNovel = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'missing-novel',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(unknownNovel.status, 404);

    const duplicateChain = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'missing-novel',
        chain: ['chainConcept', 'chainConcept'],
      }),
    });
    assert.equal(duplicateChain.status, 400);

    const oversizedChain = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'missing-novel',
        chain: [
          'chainConcept',
          'chainOpening',
          'chainVolumeOutline',
          'chainPlotLogic',
          'chainCharacterConsistency',
          'chainTransition',
          'chainDialogue',
        ],
      }),
    });
    assert.equal(oversizedChain.status, 400);

    __rateLimitTestHooks.reset();
    const crossNovelPack = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'novel-a',
        continuationPackId: 'pack-b',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(crossNovelPack.status, 409);

    __rateLimitTestHooks.reset();
    const crossNovelOutlinePack = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'A outline',
        novelId: 'novel-a',
        continuationPackId: 'pack-b',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(crossNovelOutlinePack.status, 409);

    const invalidPromptKey = await fetch(`${baseUrl}/api/prompt-template-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'not-a-real-template' }),
    });
    assert.equal(invalidPromptKey.status, 400);

    const promptUnknownNovel = await fetch(`${baseUrl}/api/prompt-template-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'missing-novel', key: 'editorAgent' }),
    });
    assert.equal(promptUnknownNovel.status, 404);

    __rateLimitTestHooks.reset();
    for (let index = 0; index < 5; index += 1) {
      const allowedInvalidPrompt = await fetch(`${baseUrl}/api/prompt-template-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'not-a-real-template' }),
      });
      assert.equal(allowedInvalidPrompt.status, 400);
    }
    const rateLimitedPrompt = await fetch(`${baseUrl}/api/prompt-template-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'not-a-real-template' }),
    });
    assert.equal(rateLimitedPrompt.status, 429);

    const auditWithoutNovel = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'chapter text' }),
    });
    assert.equal(auditWithoutNovel.status, 400);

    const rewriteUnknownNovel = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'old', instruction: 'polish', novelId: 'missing-novel' }),
    });
    assert.equal(rewriteUnknownNovel.status, 404);

    const missingNovelRequests = [
      ['/api/generate-bio', { name: 'Lin' }],
      ['/api/generate-outline', { title: 'Novel' }],
      ['/api/extract-entities', { text: 'chapter', existingNames: [] }],
      ['/api/detect-foreshadowing', { chapterContent: 'chapter', chapterTitle: 'One' }],
      ['/api/analyze-pacing', { chapters: [{ content: 'chapter' }] }],
      ['/api/generate-entity-details', { name: 'Sword', type: 'item', context: 'chapter' }],
      ['/api/expand-fragment', { content: 'idea', type: 'scene' }],
      ['/api/inspiration', { prompt: 'idea', surface: 'workspace-draft' }],
    ] as const;
    for (const [route, body] of missingNovelRequests) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, `${route} must reject an unbound model call`);
    }

    const filedata = Buffer.from('这是足够长的中文设定文档，用于验证模型调用必须绑定真实存在的作品。').toString('base64');
    const unknownWorldDocument = await fetch(`${baseUrl}/api/parse-doc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'missing-novel', filename: '设定.txt', filedata }),
    });
    assert.equal(unknownWorldDocument.status, 404);

    const unsupportedZipDocument = await fetch(`${baseUrl}/api/parse-doc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-a', filename: '设定.zip', filedata }),
    });
    assert.equal(unsupportedZipDocument.status, 400);

    const unknownContinuation = await fetch(`${baseUrl}/api/continuation-packs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'missing-novel',
        title: '资料包',
        documents: [{ filename: '资料.txt', filedata }],
      }),
    });
    assert.equal(unknownContinuation.status, 404);

    const forgedDraft = await fetch(`${baseUrl}/api/continuation-packs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'continuation-import-draft-forged',
        title: '伪造导入',
        documents: [{ filename: '资料.txt', filedata }],
      }),
    });
    assert.equal(forgedDraft.status, 400);
    assert.match(String((await forgedDraft.json() as { error?: string }).error), /导入会话无效/);

    const sessionResponse = await fetch(`${baseUrl}/api/continuation-packs/import-session`, { method: 'POST' });
    assert.equal(sessionResponse.status, 201);
    const session = await sessionResponse.json() as { novelId: string };
    const shortFiledata = Buffer.from('太短').toString('base64');
    const consumeSession = await fetch(`${baseUrl}/api/continuation-packs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: session.novelId,
        title: '一次性会话',
        documents: [{ filename: '资料.txt', filedata: shortFiledata }],
      }),
    });
    assert.equal(consumeSession.status, 400);
    const replaySession = await fetch(`${baseUrl}/api/continuation-packs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: session.novelId,
        title: '重放会话',
        documents: [{ filename: '资料.txt', filedata: shortFiledata }],
      }),
    });
    assert.equal(replaySession.status, 400);
    assert.match(String((await replaySession.json() as { error?: string }).error), /导入会话无效/);

    const unboundSkillExtraction = await fetch(`${baseUrl}/api/extract-skill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '夜雨中的剑客追踪失落账本，冲突持续升级并揭开旧案真相。' }),
    });
    assert.equal(unboundSkillExtraction.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});
