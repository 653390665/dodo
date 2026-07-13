import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { registerAuditRoutes, __auditTestHooks } from '../server/routes/audit.js';
import { closeDb, createNovel, getNovel, initDb } from '../server/lib/db.js';
import { drainWriteQueue } from '../server/lib/db-instance.js';
import { DEFAULT_QUOTA_MAX } from '../server/helpers/quota-guard.js';
import type { Novel } from '../shared/types';

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

function mockLlmFetch(content: string, options?: { stream?: boolean; throwError?: boolean }) {
  globalThis.fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes('localhost') || urlStr.includes('127.0.0.1')) {
      return originalFetch(url, init);
    }
    if (options?.throwError) {
      throw new Error('LLM timeout');
    }
    const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'));
    if (body.stream === true || options?.stream) {
      const encoder = new TextEncoder();
      const chunks = content.match(/.{1,8}/g) ?? [content];
      const payload = chunks
        .map((part) => `data: {"choices":[{"delta":{"content":${JSON.stringify(part)}}}]}\n\n`)
        .join('') + 'data: [DONE]\n\n';
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(payload));
            controller.close();
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
    if (dbPath) {
      try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
      for (const ext of ['-wal', '-shm', '.bak']) {
        try { fs.rmSync(dbPath + ext, { force: true }); } catch { /* ignore */ }
      }
    }
  });

  async function startAuditServer(): Promise<string> {
    const app = express();
    app.use(express.json());
    registerAuditRoutes(app);
    server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    return `http://localhost:${port}`;
  }

  test('POST /api/audit returns jobId and GET job completes with result', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit'));

    mockLlmFetch('## 审稿报告\n总分：82\n整体评价良好。');

    const baseUrl = await startAuditServer();
    const beforeCount = getNovel('novel-audit')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;

    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-audit',
        draftContent: '测试正文',
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });
    assert.equal(postRes.status, 200);
    const { jobId } = await postRes.json() as { jobId: string };
    assert.ok(jobId);

    let job: { status: string; result?: { feedback?: string } } = { status: 'pending' };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const jobRes = await fetch(`${baseUrl}/api/audit/jobs/${jobId}`);
      job = await jobRes.json();
      if (job.status === 'completed' || job.status === 'failed') break;
    }
    assert.equal(job.status, 'completed');
    assert.ok(job.result?.feedback);

    await drainWriteQueue();
    const afterCount = getNovel('novel-audit')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;
    assert.equal(afterCount, beforeCount + 1);
  });

  test('audit job failure refunds quota exactly once', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-audit-fail-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-audit-fail'));

    mockLlmFetch('', { throwError: true });

    const baseUrl = await startAuditServer();
    const beforeCount = getNovel('novel-audit-fail')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;

    const postRes = await fetch(`${baseUrl}/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-audit-fail',
        draftContent: '测试正文',
        sceneBeats: '测试分镜',
        contextStr: '测试上下文',
      }),
    });
    const { jobId } = await postRes.json() as { jobId: string };

    let job: { status: string } = { status: 'pending' };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const jobRes = await fetch(`${baseUrl}/api/audit/jobs/${jobId}`);
      job = await jobRes.json();
      if (job.status === 'failed') break;
    }
    assert.equal(job.status, 'failed');

    await drainWriteQueue();
    const afterCount = getNovel('novel-audit-fail')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;
    assert.equal(afterCount, beforeCount);
  });

  test('POST /api/rewrite streams tokens and ends with [DONE]', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-rewrite-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-rewrite'));

    mockLlmFetch('改写完成', { stream: true });

    const baseUrl = await startAuditServer();
    const res = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-rewrite',
        text: '原文',
        instruction: '润色',
        contextStr: 'ctx',
      }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);

    const sse = await readSseBody(res);
    assert.equal(sse.done, true);
    assert.ok(sse.tokens.join('').length > 0);
  });

  test('rewrite empty result refunds quota', async () => {
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-rewrite-empty-${Date.now()}.db`);
    initDb(dbPath);
    createNovel(mockNovel('novel-rewrite-empty'));

    mockLlmFetch('   ', { stream: true });

    const baseUrl = await startAuditServer();
    const beforeCount = getNovel('novel-rewrite-empty')?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount ?? 0;

    const res = await fetch(`${baseUrl}/api/rewrite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novelId: 'novel-rewrite-empty',
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
