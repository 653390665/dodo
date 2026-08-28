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
import { closeDb, createChapter, createContinuationPack, createNovel, initDb } from '../server/lib/db';
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
  createChapter({ id: 'chapter-a', novelId: 'novel-a', title: 'Chapter', content: '', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });
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
    assert.deepEqual(await missingNovel.json(), { error: '编辑助手请求参数无效，请检查章节和作品上下文。' });

    const unknownNovel = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'missing-novel',
        chapterId: 'missing-chapter',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(unknownNovel.status, 404);

    __rateLimitTestHooks.reset();
    const firstChapter = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'novel-a',
        chapterId: 'chapter-a',
        chapterOrder: 0,
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(firstChapter.status, 200);

    __rateLimitTestHooks.reset();
    const negativeChapter = await fetch(`${baseUrl}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'novel-a',
        chapterOrder: -1,
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(negativeChapter.status, 400);

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
        chapterId: 'chapter-a',
        continuationPackId: 'pack-b',
        databaseGeneration: getDatabaseGeneration(),
      }),
    });
    assert.equal(crossNovelPack.status, 409);
    assert.deepEqual(await crossNovelPack.json(), { error: '导入资料不属于当前作品，请重新选择。' });

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
    assert.deepEqual(await invalidPromptKey.json(), {
      error: '提示词试跑参数无效，请先选择作品和模板。',
      code: 'PROMPT_TEST_INVALID_INPUT',
    });

    const promptUnknownNovel = await fetch(`${baseUrl}/api/prompt-template-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'missing-novel', key: 'editorAgent' }),
    });
    assert.equal(promptUnknownNovel.status, 404);

    const unknownPromptTemplate = await fetch(`${baseUrl}/api/prompt-template-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-a', key: 'not-a-real-template' }),
    });
    assert.equal(unknownPromptTemplate.status, 400);
    assert.deepEqual(await unknownPromptTemplate.json(), {
      error: '未找到这张提示词模板，请重新选择。',
      code: 'PROMPT_TEST_INVALID_INPUT',
    });

    const nativeFetch = globalThis.fetch;
    const promptConfig = getConfig();
    const originalPromptConfig = { apiKey: promptConfig.apiKey, baseUrl: promptConfig.baseUrl, model: promptConfig.model, promptGuardLevel: promptConfig.promptGuardLevel };
    promptConfig.apiKey = 'prompt-test-secret-key';
    promptConfig.baseUrl = 'https://prompt-provider.test/v1';
    promptConfig.model = 'prompt-test-model';
    promptConfig.promptGuardLevel = 'disabled';
    let providerFailure = new Error('request timed out');
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith(baseUrl)) return nativeFetch(input, init);
      return Promise.reject(providerFailure);
    }) as typeof fetch;
    try {
      __rateLimitTestHooks.reset();
      const timeoutPrompt = await fetch(`${baseUrl}/api/prompt-template-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ novelId: 'novel-a', key: 'editorAgent' }),
      });
      assert.equal(timeoutPrompt.status, 504);
      const timeoutPayload = await timeoutPrompt.json() as { code?: string; promptPreview?: string; error?: string };
      assert.equal(timeoutPayload.code, 'PROMPT_TEST_TIMEOUT');
      assert.ok(timeoutPayload.promptPreview?.trim());
      assert.doesNotMatch(JSON.stringify(timeoutPayload), /prompt-test-secret-key/);

      __rateLimitTestHooks.reset();
      providerFailure = new Error('provider exploded');
      const failedPrompt = await fetch(`${baseUrl}/api/prompt-template-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ novelId: 'novel-a', key: 'editorAgent' }),
      });
      assert.equal(failedPrompt.status, 502);
      const failurePayload = await failedPrompt.json() as { code?: string; promptPreview?: string; error?: string };
      assert.equal(failurePayload.code, 'PROMPT_TEST_PROVIDER_ERROR');
      assert.ok(failurePayload.promptPreview?.trim());
      assert.doesNotMatch(JSON.stringify(failurePayload), /prompt-test-secret-key|provider exploded/);
    } finally {
      globalThis.fetch = nativeFetch;
      Object.assign(promptConfig, originalPromptConfig);
      __rateLimitTestHooks.reset();
    }

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
    assert.deepEqual(await rateLimitedPrompt.json(), {
      error: '提示词试跑请求过于频繁，请稍后再试。',
      code: 'PROMPT_TEST_RATE_LIMITED',
      retryAfter: 5,
    });

    const auditWithoutNovel = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'chapter text' }),
    });
    assert.equal(auditWithoutNovel.status, 400);
    assert.deepEqual(await auditWithoutNovel.json(), { error: '请先选择作品，再发起审稿。' });

    const rewriteUnknownNovel = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'old', instruction: 'polish', novelId: 'missing-novel', chapterId: 'missing-chapter', databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(rewriteUnknownNovel.status, 404);

    const missingNovelRequests = [
      ['/api/generate-bio', { name: 'Lin', databaseGeneration: getDatabaseGeneration() }, '请求参数校验失败'],
      ['/api/generate-outline', { title: 'Novel', databaseGeneration: getDatabaseGeneration() }, '大纲生成参数无效'],
      ['/api/extract-entities', { text: 'chapter', existingNames: [], databaseGeneration: getDatabaseGeneration() }, '请先选择作品，再使用世界观能力。'],
      ['/api/detect-foreshadowing', { chapterContent: 'chapter', chapterTitle: 'One', databaseGeneration: getDatabaseGeneration() }, '请先选择作品，再使用世界观能力。'],
      ['/api/analyze-pacing', { chapters: [{ content: 'chapter' }], databaseGeneration: getDatabaseGeneration() }, '请先选择作品，再使用世界观能力。'],
      ['/api/generate-entity-details', { name: 'Sword', type: 'item', context: 'chapter', databaseGeneration: getDatabaseGeneration() }, '请先选择作品，再使用世界观能力。'],
      ['/api/expand-fragment', { content: 'idea', type: 'scene' }, '扩写请求参数无效'],
      ['/api/inspiration', { prompt: 'idea', surface: 'workspace-draft' }, undefined],
    ] as const;
    for (const [route, body, expectedError] of missingNovelRequests) {
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, `${route} must reject an unbound model call`);
      if (expectedError) {
        const payload = await response.json() as { error?: string };
        assert.equal(payload.error, expectedError);
      }
    }

    const missingWorldContextRequests = [
      ['/api/extract-entities', { novelId: 'novel-a', text: 'chapter', existingNames: [] }, '请先刷新写作上下文，再嗅探实体。'],
      ['/api/detect-foreshadowing', { novelId: 'novel-a', chapterContent: 'chapter', chapterTitle: 'One' }, '请先刷新写作上下文，再检测伏笔。'],
      ['/api/analyze-pacing', { novelId: 'novel-a', chapters: [{ content: 'chapter' }] }, '请先刷新写作上下文，再分析节奏。'],
      ['/api/generate-entity-details', { novelId: 'novel-a', name: 'Sword', type: 'item', context: 'chapter' }, '请先刷新写作上下文，再生成设定详情。'],
    ] as const;
    for (const [route, body, expectedError] of missingWorldContextRequests) {
      __rateLimitTestHooks.reset();
      const response = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400, `${route} must reject stale world context`);
      assert.deepEqual(await response.json(), { error: expectedError });
    }

    const missingForeshadowingChapter = await fetch(`${baseUrl}/api/detect-foreshadowing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-a', chapterTitle: 'One', databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(missingForeshadowingChapter.status, 400);
    assert.deepEqual(await missingForeshadowingChapter.json(), { error: '请先提供章节正文，再检测伏笔。' });

    const missingPacingChapters = await fetch(`${baseUrl}/api/analyze-pacing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-a', databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(missingPacingChapters.status, 400);
    assert.deepEqual(await missingPacingChapters.json(), { error: '请先提供章节列表，再分析节奏。' });

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

    const missingContinuationNovel = await fetch(`${baseUrl}/api/continuation-packs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: '',
        title: '资料包',
        documents: [{ filename: '资料.txt', filedata }],
      }),
    });
    assert.equal(missingContinuationNovel.status, 400);
    assert.match(await missingContinuationNovel.text(), /请先选择作品或重新开始资料导入。/);

    const missingContinuationDocument = await fetch(`${baseUrl}/api/continuation-packs/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-a',
        title: '资料包',
        documents: [],
      }),
    });
    assert.equal(missingContinuationDocument.status, 400);
    assert.match(await missingContinuationDocument.text(), /请至少上传一份续写资料。/);

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
