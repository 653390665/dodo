import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { registerAuditRoutes, __auditTestHooks } from '../server/routes/audit.js';
import { closeDb, createChapter, createForeshadowing, createNovel, createSkill, getNovel, initDb, updateNovel } from '../server/lib/db.js';
import { advanceDatabaseGeneration, drainWriteQueue, getDatabaseGeneration } from '../server/lib/db-instance.js';
import { DEFAULT_QUOTA_MAX } from '../server/helpers/quota-guard.js';
import { getConfig } from '../server/lib/config.js';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit.js';
import type { Novel } from '../shared/types';
import { resolveWritingStyleRequest } from '../server/helpers/writing-style-service.js';

const originalFetch = globalThis.fetch;

function mockNovel(id: string, auditCount = 0): Novel {
  const now = Date.now();
  return {
    id,
    title: 'Audit Test Novel',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [],
      weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0,
      commercialMode: 'free',
      quotaLimits: {
        advancedAuditCount: auditCount,
        advancedAuditMax: DEFAULT_QUOTA_MAX.advancedAudit,
      },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function mockLlmFetch(content: string, options?: {
  stream?: boolean;
  throwError?: boolean;
  chunkDelayMs?: number;
  missingDone?: boolean;
  invalidJson?: boolean;
  onPrompt?: (prompt: string) => void;
}) {
  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) {
      return originalFetch(url, init);
    }
    if (options?.throwError) {
      throw new Error('LLM timeout');
    }
    const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
    options?.onPrompt?.(String(body.prompt || '') || JSON.stringify(body));
    if (body.stream === true || options?.stream) {
      const encoder = new TextEncoder();
      const chunks = content.match(/.{1,8}/g) ?? [content];
      const events = chunks.map((part) =>
        `data: {"choices":[{"delta":{"content":${JSON.stringify(part)}}}]}\n\n`,
      );
      if (options?.invalidJson) events.push('data: {invalid-json}\n\n');
      if (!options?.missingDone) events.push('data: [DONE]\n\n');
      let eventIndex = 0;
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          async pull(controller) {
            if (eventIndex >= events.length) {
              controller.close();
              return;
            }
            if (options?.chunkDelayMs) {
              await new Promise((resolve) => setTimeout(resolve, options.chunkDelayMs));
            }
            controller.enqueue(encoder.encode(events[eventIndex++]));
          },
        }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content } }],
      }),
    } as Response;
  };
}

function prepareScopedWritingStyle(novelId: string): { chapterId: string; databaseGeneration: number; writingStyleFingerprint: string } {
  const chapterId = `${novelId}-chapter`;
  createChapter({ id: chapterId, novelId, title: '第一章', content: '测试正文', order: 1, wordCount: 4, createdAt: 1, updatedAt: 1 });
  const databaseGeneration = getDatabaseGeneration();
  const resolved = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration });
  const novel = getNovel(novelId);
  assert.ok(novel?.projectPreferenceProfile);
  updateNovel(novelId, {
    projectPreferenceProfile: {
      ...novel.projectPreferenceProfile,
      writingStyleConfirmation: {
        mode: resolved.resolution.mode,
        fingerprint: resolved.resolution.fingerprint,
        confirmedAt: Date.now(),
      },
    },
  });
  return { chapterId, databaseGeneration, writingStyleFingerprint: resolved.resolution.fingerprint };
}

async function readSseBody(response: Response): Promise<{ tokens: string[]; done: boolean; error?: string }> {
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let buffer = '';
  const tokens: string[] = [];
  let done = false;
  let error: string | undefined;

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'data: [DONE]') {
        done = true;
      } else if (trimmed.startsWith('data: ')) {
        const parsed = JSON.parse(trimmed.slice(6));
        if (parsed.token) tokens.push(parsed.token);
        if (parsed.error) error = parsed.error;
      }
    }
  }
  return { tokens, done, error };
}

describe('audit / rewrite route integration', () => {
  let dbPath: string;
  let server: ReturnType<express.Express['listen']> | undefined;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    await drainWriteQueue();
    closeDb();
    __auditTestHooks.auditJobs.clear();
    __rateLimitTestHooks.reset();
    if (dbPath) {
      try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
      for (const ext of ['-wal', '-shm', '.bak']) {
        try { fs.rmSync(dbPath + ext, { force: true }); } catch { /* ignore */ }
      }
    }
  });

  async function startAuditServer(): Promise<string> {
    const config = getConfig();
    config.apiKey = 'test-api-key';
    config.baseUrl = 'https://api.openai.com/v1';
    config.model = 'test-model';
    const app = express();
    app.use(express.json());
    registerAuditRoutes(app);
    server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    return `http://localhost:${port}`;
  }

  async function waitForAuditJob(baseUrl: string, jobId: string, databaseGeneration: number) {
    let job: { status: string; error?: string; result?: { status?: string; feedback?: string; errorCategory?: string; diagnostic?: string } } = { status: 'pending' };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const jobRes = await fetch(`${baseUrl}/api/audit/jobs/${jobId}?databaseGeneration=${databaseGeneration}`);
      job = await jobRes.json();
      if (job.status === 'completed' || job.status === 'failed') break;
    }
    return job;
  }

  test('POST /api/audit returns jobId and GET job completes with result', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit'));
    const writingContext = prepareScopedWritingStyle('novel-audit');

    mockLlmFetch(JSON.stringify({
      score: 82,
      fatalIssues: [],
      sceneChecks: [],
      surgerySuggestions: [],
    }));

    const baseUrl = await startAuditServer();
    const beforeCount = getNovel('novel-audit')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;

    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-audit',
        ...writingContext,
        draftContent: '测试正文',
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });
    assert.equal(postRes.status, 200);
    const { jobId, databaseGeneration } = await postRes.json() as { jobId: string; databaseGeneration: number };
    assert.ok(jobId);
    assert.equal(Number.isInteger(databaseGeneration), true);

    let job: { status: string; result?: { status?: string; feedback?: string } } = { status: 'pending' };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const jobRes = await fetch(`${baseUrl}/api/audit/jobs/${jobId}?databaseGeneration=${databaseGeneration}`);
      job = await jobRes.json();
      if (job.status === 'completed' || job.status === 'failed') break;
    }
    assert.equal(job.status, 'completed');
    assert.ok(job.result?.feedback);

    await drainWriteQueue();
    const afterCount = getNovel('novel-audit')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;
    assert.equal(afterCount, beforeCount + 1);
  });

  test('POST /api/audit returns writing style choices when confirmation is required', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-style-required-${Date.now()}.db`);
    initDb(dbPath);
    const novel = mockNovel('novel-audit-style-required');
    novel.projectPreferenceProfile = {
      ...novel.projectPreferenceProfile!,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['de-ai-slop-shield'],
      },
    };
    createNovel(novel);
    const chapterId = `${novel.id}-chapter`;
    createChapter({ id: chapterId, novelId: novel.id, title: '第一章', content: '测试正文', order: 1, wordCount: 4, createdAt: 1, updatedAt: 1 });
    const databaseGeneration = getDatabaseGeneration();
    const expected = resolveWritingStyleRequest(novel.id, { chapterId, databaseGeneration });
    globalThis.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) return originalFetch(url, init);
      assert.fail('audit should not call the model before writing style confirmation');
    };

    const baseUrl = await startAuditServer();
    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: novel.id,
        chapterId,
        databaseGeneration,
        draftContent: `开头定位标记。${'中段冲突推进。'.repeat(500)}章末伏笔与钩子定位标记。`,
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });

    assert.equal(postRes.status, 409);
    const body = await postRes.json() as { code?: string; resolution?: { fingerprint?: string }; candidates?: unknown[] };
    assert.equal(body.code, 'STYLE_CONFIRMATION_REQUIRED');
    assert.equal(body.resolution?.fingerprint, expected.resolution.fingerprint);
    assert.ok((body.candidates || []).length > 0);
  });

  test('audit marks five-dimension result unknown when fatalIssues is missing', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-contract-missing-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit-contract-missing'));
    const writingContext = prepareScopedWritingStyle('novel-audit-contract-missing');
    mockLlmFetch(JSON.stringify({
      scores: {
        '可读性': { score: 8, reason: 'ok' }, '分镜执行度': { score: 8, reason: 'ok' },
        '冲突推进度': { score: 8, reason: 'ok' }, '风格契合度': { score: 8, reason: 'ok' }, '网文章节感': { score: 8, reason: 'ok' },
      },
      totalScore: 40,
      pass: true,
    }));

    const baseUrl = await startAuditServer();
    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-audit-contract-missing', ...writingContext, draftContent: '测试正文', sceneBeats: '测试分镜', contextStr: '测试上下文' }),
    });
    const started = await postRes.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForAuditJob(baseUrl, started.jobId, started.databaseGeneration);
    assert.equal(job.status, 'completed');
    assert.equal(job.result?.status, 'unknown');
    assert.notEqual((job.result as { pass?: boolean } | undefined)?.pass, true);
  });

  test('audit marks metadata residue unknown when provider omits matching fatalIssues', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-residue-contract-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit-residue-contract'));
    const writingContext = prepareScopedWritingStyle('novel-audit-residue-contract');
    mockLlmFetch(JSON.stringify({
      scores: {
        '可读性': { score: 8, reason: 'ok' }, '分镜执行度': { score: 8, reason: 'ok' },
        '冲突推进度': { score: 8, reason: 'ok' }, '风格契合度': { score: 8, reason: 'ok' }, '网文章节感': { score: 8, reason: 'ok' },
      },
      totalScore: 40,
      pass: true,
      fatalIssues: [],
    }));

    const baseUrl = await startAuditServer();
    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-audit-residue-contract',
        ...writingContext,
        draftContent: '作品：潮汐城。\n\n林舟推开生锈的铁门。',
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });
    const started = await postRes.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForAuditJob(baseUrl, started.jobId, started.databaseGeneration);
    assert.equal(job.status, 'completed');
    assert.equal(job.result?.status, 'unknown');
    assert.equal(job.result?.errorCategory, 'missing_fatal_issues');
    assert.match(String(job.result?.diagnostic), /残留/);
    assert.notEqual((job.result as { pass?: boolean } | undefined)?.pass, true);
  });

  test('audit marks five-dimension result unknown when an issue is incomplete', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-contract-filtered-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit-contract-filtered'));
    const writingContext = prepareScopedWritingStyle('novel-audit-contract-filtered');
    mockLlmFetch(JSON.stringify({
      scores: {
        '可读性': { score: 8, reason: 'ok' }, '分镜执行度': { score: 8, reason: 'ok' },
        '冲突推进度': { score: 8, reason: 'ok' }, '风格契合度': { score: 8, reason: 'ok' }, '网文章节感': { score: 8, reason: 'ok' },
      },
      totalScore: 40,
      pass: true,
      fatalIssues: [{ snippet: '缺少解释和修复建议' }],
    }));

    const baseUrl = await startAuditServer();
    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-audit-contract-filtered', ...writingContext, draftContent: '测试正文', sceneBeats: '测试分镜', contextStr: '测试上下文' }),
    });
    const started = await postRes.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForAuditJob(baseUrl, started.jobId, started.databaseGeneration);
    assert.equal(job.status, 'completed');
    assert.equal(job.result?.status, 'unknown');
    assert.notEqual((job.result as { pass?: boolean } | undefined)?.pass, true);
  });


  test('POST /api/audit preserves critic techniques when project skill cards are long', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-technique-prompt-${Date.now()}.db`);
    initDb(dbPath);
    createSkill({
      id: 'long-style-card',
      name: '长风格卡',
      description: '用于复现长项目卡挤掉审稿技法',
      style: `长篇写法规则${'，必须保留卡片层级'.repeat(180)}`,
      pacing: '保持节奏稳定',
      stabilityScore: 90,
      evaluationFeedback: '',
      version: 1,
      sourceBadge: 'book-extracted',
      sourceType: 'book-extracted',
      deconstructionCardType: 'style-card',
      executionScore: 90,
      isRuntimeReady: true,
      sanitizationStatus: 'runtime-ready',
      runtimeStatus: 'active',
      createdAt: 1,
      updatedAt: 1,
    });
    const novel = mockNovel('novel-audit-technique-prompt');
    novel.projectPreferenceProfile = {
      ...novel.projectPreferenceProfile!,
      capabilityModelVersion: 3,
      capabilityProfile: {
        version: 3,
        projectSkillDeck: { mainCardId: 'long-style-card', supportCardIds: [], updatedAt: 1 },
        favoriteTechniqueIds: ['de-ai-slop-shield'],
      },
    };
    createNovel(novel);
    const chapterId = `${novel.id}-chapter`;
    createChapter({ id: chapterId, novelId: novel.id, title: '第一章', content: '测试正文', order: 1, wordCount: 4, createdAt: 1, updatedAt: 1 });
    const databaseGeneration = getDatabaseGeneration();
    const resolved = resolveWritingStyleRequest(novel.id, { chapterId, databaseGeneration });
    assert.match(resolved.executionSnapshot.stagePrompts.critic, /【阶段技法：de-ai-slop-shield】/);
    updateNovel(novel.id, {
      projectPreferenceProfile: {
        ...getNovel(novel.id)!.projectPreferenceProfile!,
        writingStyleConfirmation: { mode: resolved.resolution.mode, fingerprint: resolved.resolution.fingerprint, confirmedAt: Date.now() },
      },
    });

    let capturedPrompt = '';
    globalThis.fetch = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) return originalFetch(url, init);
      capturedPrompt = JSON.stringify(JSON.parse(String((init as RequestInit)?.body ?? '{}')));
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: JSON.stringify({
          score: 82,
          fatalIssues: [],
          sceneChecks: [],
          surgerySuggestions: [],
        }) } }] }),
      } as Response;
    };

    const baseUrl = await startAuditServer();
    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: novel.id,
        chapterId,
        databaseGeneration,
        writingStyleFingerprint: resolved.resolution.fingerprint,
        draftContent: `开头定位标记。${'中段冲突推进。'.repeat(500)}章末伏笔与钩子定位标记。`,
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });
    assert.equal(postRes.status, 200);
    const { jobId, databaseGeneration: jobGeneration } = await postRes.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForAuditJob(baseUrl, jobId, jobGeneration);

    assert.equal(job.status, 'completed');
    assert.match(capturedPrompt, /【阶段技法：de-ai-slop-shield】/);
    assert.match(capturedPrompt, /开头定位标记/);
    assert.match(capturedPrompt, /章末伏笔与钩子定位标记/);
    assert.deepEqual((JSON.parse(capturedPrompt) as { response_format?: unknown }).response_format, { type: 'json_object' });
  });

  test('audit job failure refunds quota exactly once', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-fail-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit-fail'));
    const writingContext = prepareScopedWritingStyle('novel-audit-fail');

    mockLlmFetch('', { throwError: true });

    const baseUrl = await startAuditServer();
    const beforeCount = getNovel('novel-audit-fail')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;

    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-audit-fail',
        ...writingContext,
        draftContent: '测试正文',
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });
    const { jobId, databaseGeneration } = await postRes.json() as { jobId: string; databaseGeneration: number };

    let job: { status: string } = { status: 'pending' };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const jobRes = await fetch(`${baseUrl}/api/audit/jobs/${jobId}?databaseGeneration=${databaseGeneration}`);
      job = await jobRes.json();
      if (job.status === 'failed') break;
    }
    assert.equal(job.status, 'failed');

    await drainWriteQueue();
    const afterCount = getNovel('novel-audit-fail')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;
    assert.equal(afterCount, beforeCount);
  });

  test('blank audit fails, refunds quota, and exposes only a generic error', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-blank-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit-blank'));
    const writingContext = prepareScopedWritingStyle('novel-audit-blank');

    mockLlmFetch('   ');

    const baseUrl = await startAuditServer();
    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-audit-blank',
        ...writingContext,
        draftContent: '测试正文',
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });
    const { jobId, databaseGeneration } = await postRes.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForAuditJob(baseUrl, jobId, databaseGeneration);

    assert.equal(job.status, 'failed');
    assert.equal(job.error, 'Internal server error');
    assert.equal(JSON.stringify(job).includes('empty feedback'), false);

    await drainWriteQueue();
    assert.equal(
      getNovel('novel-audit-blank')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount,
      0,
    );
  });

  test('audit result cannot be polled after the active database generation changes', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-generation-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit-generation'));
    const writingContext = prepareScopedWritingStyle('novel-audit-generation');
    mockLlmFetch('完整审稿结果');

    const baseUrl = await startAuditServer();
    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-audit-generation',
        ...writingContext,
        draftContent: '旧数据库正文',
        sceneBeats: '分镜',
        contextStr: '上下文',
      }),
    });
    const started = await postRes.json() as { jobId: string; databaseGeneration: number };
    advanceDatabaseGeneration();

    const jobRes = await fetch(
      `${baseUrl}/api/audit/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`,
    );
    assert.equal(jobRes.status, 409);
  });

  test('POST /api/rewrite streams tokens and ends with [DONE]', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-rewrite-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-rewrite'));
    const writingContext = prepareScopedWritingStyle('novel-rewrite');

    mockLlmFetch('改写完成', { stream: true, chunkDelayMs: 15 });

    const baseUrl = await startAuditServer();
    const res = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-rewrite',
        ...writingContext,
        text: '原文',
        instruction: '润色',
        contextStr: 'ctx',
      }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    assert.match(res.headers.get('x-inkflow-database-generation') || '', /^\d+$/);

    const sse = await readSseBody(res);
    assert.equal(sse.done, true);
    assert.ok(sse.tokens.join('').length > 0);
  });

  test('audit and rewrite both rebuild server canon even when the client context omits it', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-server-context-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-server-context'));
    const writingContext = prepareScopedWritingStyle('novel-server-context');
    createForeshadowing({
      id: 'promise-route-only-91',
      novelId: 'novel-server-context',
      title: '路由独有的灰烬信',
      description: '灰烬信会在主角撒谎时恢复一个字。',
      status: 'planted',
      plantedChapterId: writingContext.chapterId,
      relatedCharacterIds: [],
      createdAt: 1,
      updatedAt: 1,
    });

    const prompts: string[] = [];
    mockLlmFetch(JSON.stringify({ score: 82, fatalIssues: [], sceneChecks: [], surgerySuggestions: [] }), {
      onPrompt: (prompt) => prompts.push(prompt),
    });
    const baseUrl = await startAuditServer();
    const auditRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-server-context',
        ...writingContext,
        draftContent: '测试正文',
        sceneBeats: '测试分镜',
        contextStr: '客户端没有伏笔',
      }),
    });
    assert.equal(auditRes.status, 200);
    const auditStarted = await auditRes.json() as { jobId: string; databaseGeneration: number };
    const auditJob = await waitForAuditJob(baseUrl, auditStarted.jobId, auditStarted.databaseGeneration);
    assert.equal(auditJob.status, 'completed');

    mockLlmFetch('改写完成', { stream: true, onPrompt: (prompt) => prompts.push(prompt) });
    const rewriteRes = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-server-context',
        ...writingContext,
        text: '原文',
        instruction: '精修',
        contextStr: '客户端依然没有伏笔',
      }),
    });
    assert.equal(rewriteRes.status, 200);
    const rewriteSse = await readSseBody(rewriteRes);
    assert.equal(rewriteSse.done, true);

    assert.equal(prompts.length, 2);
    for (const prompt of prompts) {
      assert.match(prompt, /promise-route-only-91/);
      assert.match(prompt, /路由独有的灰烬信/);
      assert.match(prompt, /客户端补充上下文/);
    }
  });

  test('rewrite fails immediately on malformed upstream SSE JSON and refunds quota', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-rewrite-json-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-rewrite-json'));
    const writingContext = prepareScopedWritingStyle('novel-rewrite-json');

    mockLlmFetch('部分内容', { stream: true, invalidJson: true });

    const baseUrl = await startAuditServer();
    const res = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-rewrite-json', text: '原文', contextStr: 'ctx', ...writingContext }),
    });
    const sse = await readSseBody(res);

    assert.equal(sse.done, false);
    assert.equal(sse.error, 'Internal server error');
    await drainWriteQueue();
    assert.equal(
      getNovel('novel-rewrite-json')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount,
      0,
    );
  });

  test('rewrite without upstream [DONE] fails and refunds quota', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-rewrite-no-done-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-rewrite-no-done'));
    const writingContext = prepareScopedWritingStyle('novel-rewrite-no-done');

    mockLlmFetch('截断内容', { stream: true, missingDone: true });

    const baseUrl = await startAuditServer();
    const res = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-rewrite-no-done', text: '原文', contextStr: 'ctx', ...writingContext }),
    });
    const sse = await readSseBody(res);

    assert.equal(sse.done, false);
    assert.equal(sse.error, 'Internal server error');
    await drainWriteQueue();
    assert.equal(
      getNovel('novel-rewrite-no-done')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount,
      0,
    );
  });

  test('aborted rewrite refunds quota and never emits a completed delivery', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-rewrite-abort-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-rewrite-abort'));
    const writingContext = prepareScopedWritingStyle('novel-rewrite-abort');

    mockLlmFetch('这是一个足够长的延迟改写结果，用来确保客户端能在完成前中断连接。', {
      stream: true,
      chunkDelayMs: 30,
    });

    const baseUrl = await startAuditServer();
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ novelId: 'novel-rewrite-abort', text: '原文', contextStr: 'ctx', ...writingContext }),
      signal: controller.signal,
    });
    const reader = res.body?.getReader();
    assert.ok(reader);
    await reader.read();
    controller.abort();

    const deadline = Date.now() + 2000;
    let quotaAfterAbort: number | undefined;
    do {
      await drainWriteQueue();
      quotaAfterAbort = getNovel('novel-rewrite-abort')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount;
      if (quotaAfterAbort === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    assert.equal(quotaAfterAbort, 0);
  });

  test('rewrite empty result refunds quota', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-rewrite-empty-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-rewrite-empty'));
    const writingContext = prepareScopedWritingStyle('novel-rewrite-empty');

    mockLlmFetch('   ', { stream: true });

    const baseUrl = await startAuditServer();
    const beforeCount = getNovel('novel-rewrite-empty')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;

    const res = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-rewrite-empty',
        ...writingContext,
        text: '原文',
        instruction: '润色',
        contextStr: 'ctx',
      }),
    });
    const sse = await readSseBody(res);
    assert.ok(sse.error);

    await drainWriteQueue();
    const afterCount = getNovel('novel-rewrite-empty')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;
    assert.equal(afterCount, beforeCount);
  });
});
