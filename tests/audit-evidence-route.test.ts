import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerAuditRoutes, __auditTestHooks } from '../server/routes/audit.js';
import { closeDb, createChapter, createNovel, getNovel, initDb, updateNovel } from '../server/lib/db.js';
import { getDatabaseGeneration } from '../server/lib/db-instance.js';
import { DEFAULT_QUOTA_MAX } from '../server/helpers/quota-guard.js';
import { getConfig } from '../server/lib/config.js';
import type { Novel } from '../shared/types';
import { resolveWritingStyleRequest } from '../server/helpers/writing-style-service.js';

const originalFetch = globalThis.fetch;
let server: ReturnType<express.Express['listen']> | undefined;
let dbPath = '';

function mockNovel(id: string): Novel {
  const now = Date.now();
  return {
    id, title: 'Evidence route test', authorId: 'local-user', summary: '', status: 'ongoing',
    mountedSkillIds: [], mountedSkillLoadout: [],
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0, commercialMode: 'free',
      quotaLimits: { advancedAuditCount: 0, advancedAuditMax: DEFAULT_QUOTA_MAX.advancedAudit },
    },
    createdAt: now, updatedAt: now,
  };
}

function prepareScopedWritingStyle(novelId: string) {
  const chapterId = `${novelId}-chapter`;
  createChapter({ id: chapterId, novelId, title: '第一章', content: '正文', order: 1, wordCount: 2, createdAt: 1, updatedAt: 1 });
  const databaseGeneration = getDatabaseGeneration();
  const resolved = resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration });
  const novel = getNovel(novelId);
  assert.ok(novel?.projectPreferenceProfile);
  updateNovel(novelId, { projectPreferenceProfile: {
    ...novel.projectPreferenceProfile,
    writingStyleConfirmation: { mode: resolved.resolution.mode, fingerprint: resolved.resolution.fingerprint, confirmedAt: Date.now() },
  } });
  return { chapterId, databaseGeneration, writingStyleFingerprint: resolved.resolution.fingerprint };
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  closeDb();
  __auditTestHooks.auditJobs.clear();
  if (dbPath) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
    dbPath = '';
  }
});

test('audit job routes use author-facing task errors', async () => {
  const app = express();
  app.use(express.json());
  registerAuditRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const missing = await fetch(`${baseUrl}/api/audit/jobs/missing?databaseGeneration=0`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: '审稿任务不存在或已过期，请重新提交。' });

  __auditTestHooks.auditJobs.set('audit-complete', {
    id: 'audit-complete',
    status: 'completed',
    progress: 100,
    createdAt: Date.now(),
    databaseGeneration: 0,
  });
  const notCancellable = await fetch(`${baseUrl}/api/audit/jobs/audit-complete/cancel?databaseGeneration=0`, { method: 'POST' });
  assert.equal(notCancellable.status, 409);
  assert.deepEqual(await notCancellable.json(), { error: '当前审稿任务不能取消。' });

  const stale = await fetch(`${baseUrl}/api/audit/jobs/audit-complete?databaseGeneration=1`);
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: '审稿任务状态已过期，请重新提交。' });
});

test('completed audit route result transparently returns structured evidence', async () => {
  process.env.NODE_ENV = 'test';
  dbPath = path.join(os.tmpdir(), `inkflow-audit-evidence-${Date.now()}.db`);
  initDb(dbPath);
  createNovel(mockNovel('evidence-route-novel'));
  const writingContext = prepareScopedWritingStyle('evidence-route-novel');

  const evidence = {
    category: 'foreshadowing', severity: 'high', quote: '门后传来第二次敲击。',
    explanation: '结尾悬念已落地。', suggestedFix: '下一章回收线索。', location: '末段',
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('localhost') || String(url).includes('127.0.0.1')) return originalFetch(url, init);
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        scores: {
          '可读性': { score: 8, reason: 'ok' }, '分镜执行度': { score: 8, reason: 'ok' },
          '冲突推进度': { score: 8, reason: 'ok' }, '风格契合度': { score: 8, reason: 'ok' },
          '网文章节感': { score: 8, reason: 'ok' },
        }, totalScore: 40, pass: true, fatalIssues: [], evidence: [evidence],
      }) } }] }),
    } as Response;
  };

  const config = getConfig();
  config.apiKey = 'test-api-key';
  config.baseUrl = 'https://api.openai.com/v1';
  config.model = 'test-model';
  const app = express();
  app.use(express.json());
  registerAuditRoutes(app);
  server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://localhost:${port}`;

  const post = await fetch(`${baseUrl}/api/audit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId: 'evidence-route-novel', ...writingContext, draftContent: '正文', sceneBeats: '分镜', contextStr: '上下文' }),
  });
  assert.equal(post.status, 200);
  const started = await post.json() as { jobId: string; databaseGeneration: number };
  let job: { status: string; result?: { evidence?: unknown[] } } = { status: 'pending' };
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const response = await fetch(`${baseUrl}/api/audit/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
    job = await response.json() as typeof job;
    if (job.status === 'completed' || job.status === 'failed') break;
  }
  assert.equal(job.status, 'completed');
  assert.equal((job.result as { status?: string } | undefined)?.status, 'pass');
  assert.deepEqual(job.result?.evidence, [evidence]);
});

test('completed audit route returns empty evidence for unparseable model output', async () => {
  process.env.NODE_ENV = 'test';
  dbPath = path.join(os.tmpdir(), `inkflow-audit-evidence-raw-${Date.now()}.db`);
  initDb(dbPath);
  createNovel(mockNovel('evidence-raw-novel'));
  const writingContext = prepareScopedWritingStyle('evidence-raw-novel');

  globalThis.fetch = async (url, init) => {
    if (String(url).includes('localhost') || String(url).includes('127.0.0.1')) return originalFetch(url, init);
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '模型输出无法解析为审计 JSON' } }] }),
    } as Response;
  };

  const config = getConfig();
  config.apiKey = 'test-api-key';
  config.baseUrl = 'https://api.openai.com/v1';
  config.model = 'test-model';
  const app = express();
  app.use(express.json());
  registerAuditRoutes(app);
  server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://localhost:${port}`;

  const post = await fetch(`${baseUrl}/api/audit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId: 'evidence-raw-novel', ...writingContext, draftContent: '正文', sceneBeats: '分镜', contextStr: '上下文' }),
  });
  const started = await post.json() as { jobId: string; databaseGeneration: number };
  let job: { status: string; result?: { status?: string; feedback?: string; rawFeedback?: string; evidence?: unknown[]; errorCategory?: string; diagnostic?: string; retriable?: boolean; traceId?: string } } = { status: 'pending' };
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const response = await fetch(`${baseUrl}/api/audit/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
    job = await response.json() as typeof job;
    if (job.status === 'completed' || job.status === 'failed') break;
  }
  assert.equal(job.status, 'completed');
  assert.equal(job.result?.status, 'unknown');
  assert.equal(job.result?.feedback, undefined);
  assert.equal(job.result?.rawFeedback, undefined);
  assert.equal(job.result?.errorCategory, 'plain_text');
  assert.equal(job.result?.retriable, true);
  assert.match(job.result?.traceId || '', /^audit_/);
  assert.doesNotMatch(JSON.stringify(job.result), /模型输出无法解析为审计 JSON/);
  assert.equal(job.result?.evidence, undefined);
});
