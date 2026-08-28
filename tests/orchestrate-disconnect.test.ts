import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getConfig } from '../server/lib/config.js';
import { registerAgentsRoutes } from '../server/routes/agents.js';
import { closeDb, createChapter, createNovel, getNovel, initDb } from '../server/lib/db.js';
import { advanceDatabaseGeneration, getDatabaseGeneration } from '../server/lib/db-instance.js';
import { __quotaTestHooks } from '../server/helpers/quota-guard.js';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit.js';
import type { Novel, ProjectPreferenceProfile } from '../shared/types.js';
import { confirmWritingStyleForTest } from './helpers/confirm-writing-style.js';

const originalFetch = globalThis.fetch;
const config = getConfig();
const originalConfig = {
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  model: config.model,
  promptGuardLevel: config.promptGuardLevel,
};

let server: ReturnType<express.Express['listen']>;
let baseUrl: string;
let dbPath: string;
let upstreamMode: 'pending' | 'success' | 'failure' | 'generation-change' | 'critic-failure' = 'success';
let upstreamRequestCount = 0;
let criticFailureRequestCount = 0;
let lastUpstreamRequestBody: Record<string, unknown> | undefined;
const styleFingerprints = new Map<string, string>();

const deterministicDraft = [
  '雨夜的旧车站只剩一盏灯，灯罩被风吹得轻轻摇晃。',
  '林砚把没有署名的信压在掌心，纸边已经被雨水浸软。',
  '远处的铁轨传来一声闷响，站台尽头却没有列车进站。',
  '他抬头看向钟楼，停摆的指针正好指在午夜零点。',
  '信封里没有解释，只有一枚沾着黑灰的旧钥匙。',
  '钥匙齿缝里夹着细沙，像是刚从河岸某处挖出来。',
  '林砚收起信，朝检票口走去，售票窗后的影子忽然熄灭。',
  '广播响了两遍，报出的却是十年前已经废弃的站名。',
  '他停在门前没有回头，身后的积水里多出了一串陌生脚印。',
  '脚印一路延伸到黑暗里，最后一枚正落在他的鞋尖旁。',
].join('\n');

function makeNovel(id: string): Novel {
  const now = Date.now();
  const profile: ProjectPreferenceProfile = {
    tags: [],
    weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    commercialMode: 'free',
    quotaLimits: { generateProseCount: 0, generateProseMax: 10 },
  };
  return {
    id,
    title: 'Disconnect quota test',
    authorId: 'local-user',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    projectPreferenceProfile: profile,
    createdAt: now,
    updatedAt: now,
  };
}

function createTestNovel(id: string): string {
  createNovel(makeNovel(id));
  createChapter({ id: `${id}-chapter`, novelId: id, title: 'Chapter', content: '', order: 1, wordCount: 0, createdAt: Date.now(), updatedAt: Date.now() });
  const fingerprint = confirmWritingStyleForTest(id);
  styleFingerprints.set(id, fingerprint);
  return fingerprint;
}

async function waitForQuota(novelId: string, expected: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const count = getNovel(novelId)?.projectPreferenceProfile?.quotaLimits?.generateProseCount ?? 0;
    if (count === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(
    getNovel(novelId)?.projectPreferenceProfile?.quotaLimits?.generateProseCount,
    expected,
  );
}

before(() => {
  dbPath = path.join(os.tmpdir(), `inkflow-orchestrate-disconnect-${process.pid}.db`);
  closeDb();
  initDb(dbPath);
  __quotaTestHooks.quotaReservations.clear();

  config.apiKey = 'test-api-key';
  config.baseUrl = 'https://api.openai.test/v1';
  config.model = 'test-model';
  config.promptGuardLevel = 'disabled';

  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(baseUrl)) {
      if (typeof init?.body === 'string') {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          const novelId = typeof body.novelId === 'string' ? body.novelId : undefined;
          const fingerprint = novelId ? styleFingerprints.get(novelId) : undefined;
          const isOrchestrate = String(url).includes('/api/orchestrate');
          if (isOrchestrate) {
            init = { ...init, body: JSON.stringify({
              ...body,
              chapterId: body.chapterId || `${novelId}-chapter`,
              databaseGeneration: body.databaseGeneration ?? getDatabaseGeneration(),
              ...(fingerprint && !body.styleConfirmationFingerprint ? { styleConfirmationFingerprint: fingerprint } : {}),
            }) };
          } else if (fingerprint && !body.styleConfirmationFingerprint) {
            init = { ...init, body: JSON.stringify({ ...body, styleConfirmationFingerprint: fingerprint }) };
          }
        } catch { /* non-JSON requests pass through */ }
      }
      return originalFetch(url, init);
    }
    upstreamRequestCount += 1;
    if (upstreamMode === 'pending') {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) rejectAbort();
        else signal?.addEventListener('abort', rejectAbort, { once: true });
      });
    }
    if (upstreamMode === 'failure') {
      throw new Error('Simulated upstream failure');
    }
    const requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) as {
      stream?: boolean;
      prompt?: string;
      messages?: Array<{ content?: string }>;
    } : {};
    lastUpstreamRequestBody = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    if (upstreamMode === 'critic-failure' && !requestBody.stream) {
      criticFailureRequestCount += 1;
      if (criticFailureRequestCount >= 2) throw new Error('Simulated critic failure');
    }
    if (upstreamMode === 'generation-change' && requestBody.stream) {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"首个 token"}}]}\n\n'));
          advanceDatabaseGeneration();
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }), { status: 200 });
    }
    if (requestBody.stream) {
      const encoder = new TextEncoder();
      const requestText = [requestBody.prompt, ...(requestBody.messages || []).map((message) => message.content || '')].join('\n');
      const isInspirationFixture = /雨夜灵感|检查设定冲突|继续对话/.test(requestText);
      const streamContent = isInspirationFixture ? '灵感内容' : deterministicDraft;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: streamContent } }] })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: deterministicDraft } }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const app = express();
  app.use(express.json());
  registerAgentsRoutes(app);
  server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  baseUrl = `http://localhost:${port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  Object.assign(config, originalConfig);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
});

test('inspiration normal completion sends token and [DONE]', async () => {
  upstreamMode = 'success';
  const novelId = 'inspiration-completion';
  createNovel(makeNovel(novelId));
  const response = await fetch(`${baseUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '给我一个雨夜灵感', surface: 'workspace-draft', novelId, databaseGeneration: getDatabaseGeneration() }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-inkflow-database-generation'), String(getDatabaseGeneration()));
  const body = await response.text();
  assert.match(body, /"token":"灵感内容"/);
  assert.match(body, /data: \[DONE\]/);
  assert.equal(lastUpstreamRequestBody?.max_tokens, 2048);
  const messages = lastUpstreamRequestBody?.messages as Array<{ role?: string; content?: string }> | undefined;
  assert.match(messages?.[0]?.content || '', /资深网文策划编辑/);
});

test('inspiration rejects a stale databaseGeneration before opening the model execution', async () => {
  const novelId = 'inspiration-stale-generation';
  createNovel(makeNovel(novelId));
  const beforeReservations = [...__quotaTestHooks.quotaReservations.values()].filter((reservation) => reservation.novelId === novelId).length;
  const response = await fetch(`${baseUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '生成灵感', surface: 'workspace-draft', novelId, databaseGeneration: getDatabaseGeneration() + 1 }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: '数据库已变化，请刷新后重试', code: 'DATABASE_GENERATION_STALE' });
  const afterReservations = [...__quotaTestHooks.quotaReservations.values()].filter((reservation) => reservation.novelId === novelId).length;
  assert.equal(afterReservations, beforeReservations);
});

test('inspiration configuration failures return a typed recoverable error', async () => {
  const novelId = 'inspiration-config-failure';
  createNovel(makeNovel(novelId));
  const previousApiKey = config.apiKey;
  config.apiKey = '';
  try {
    const response = await fetch(`${baseUrl}/api/inspiration`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '整理资料', surface: 'workspace-draft', novelId, purpose: 'sync-extraction', databaseGeneration: getDatabaseGeneration() }),
    });
    assert.equal(response.status, 503);
    const body = await response.json() as { error?: string; code?: string; traceId?: string; retriable?: boolean };
    assert.deepEqual({ error: body.error, code: body.code, retriable: body.retriable }, {
      error: '模型配置不可用，请检查设置', code: 'configuration', retriable: false,
    });
    assert.match(body.traceId || '', /^llm_/);
  } finally {
    config.apiKey = previousApiKey;
  }
});

test('sync extraction does not consume the prose generation quota', async () => {
  const novelId = 'inspiration-sync-quota';
  createNovel(makeNovel(novelId));
  upstreamMode = 'success';
  const response = await fetch(`${baseUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '输出结构化 JSON', surface: 'workspace-draft', purpose: 'sync-extraction', novelId, databaseGeneration: getDatabaseGeneration() }),
  });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(lastUpstreamRequestBody?.max_tokens, 8192);
  assert.equal(getNovel(novelId)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 0);
});

test('world-bible assistance remains available when prose quota is exhausted', async () => {
  const novel = makeNovel('inspiration-world-bible-quota');
  novel.projectPreferenceProfile!.quotaLimits!.generateProseCount = 10;
  createNovel(novel);
  upstreamMode = 'success';

  const response = await fetch(`${baseUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '检查设定冲突',
      surface: 'workspace-draft',
      purpose: 'world-bible',
      novelId: novel.id,
      databaseGeneration: getDatabaseGeneration(),
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /"token":"灵感内容"/);
  assert.match(body, /data: \[DONE\]/);
  assert.equal(lastUpstreamRequestBody?.max_tokens, 8192);
  assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 10);
});

test('conversation remains available when prose experiment quota is exhausted', async () => {
  const novel = makeNovel('inspiration-conversation-quota');
  novel.projectPreferenceProfile!.quotaLimits!.generateProseCount = 10;
  createNovel(novel);
  // Keep this contract test independent from the inspiration request bucket
  // consumed by the preceding SSE cases.
  __rateLimitTestHooks.reset();

  const response = await fetch(`${baseUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '继续对话',
      surface: 'workspace-draft',
      purpose: 'conversation',
      novelId: novel.id,
      databaseGeneration: getDatabaseGeneration(),
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /"token":"灵感内容"/);
  assert.match(body, /data: \[DONE\]/);
  assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 10);
});

test('inspiration stops normally completing when database generation changes', async () => {
  const novelId = 'inspiration-generation-change';
  createNovel(makeNovel(novelId));
  upstreamMode = 'generation-change';

  const response = await fetch(`${baseUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '生成灵感', surface: 'workspace-draft', novelId, databaseGeneration: getDatabaseGeneration() }),
  });

  assert.equal(response.status, 502);
  const body = await response.text();
  assert.doesNotMatch(body, /data: \[DONE\]/);
  upstreamMode = 'success';
});

test('orchestrate-draft disconnect before prose delivery creates no basic BYOK reservation', async () => {
  const novelId = 'disconnect-before-delivery';
  createTestNovel(novelId);
  upstreamMode = 'pending';

  const response = await fetch(`${baseUrl}/api/orchestrate-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId, contextStr: '上下文', sceneBeats: '场景节拍' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-inkflow-database-generation') || '', /^\d+$/);
  await response.body?.cancel();

  assert.equal(Array.from(__quotaTestHooks.quotaReservations.values()).some((reservation) => reservation.novelId === novelId), false);
  await waitForQuota(novelId, 0);
});

test('orchestrate-draft disconnect after first prose token creates no basic BYOK reservation', async () => {
  const novelId = 'disconnect-after-delivery';
  createTestNovel(novelId);
  upstreamMode = 'success';

  const response = await fetch(`${baseUrl}/api/orchestrate-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId, contextStr: '上下文', sceneBeats: '场景节拍' }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-inkflow-database-generation') || '', /^\d+$/);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('"type":"token"')) {
    const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
    assert.equal(chunk.done, false);
    received += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  assert.equal(Array.from(__quotaTestHooks.quotaReservations.values()).some((reservation) => reservation.novelId === novelId), false);
  await waitForQuota(novelId, 0);
});

test('orchestrate disconnect before prose delivery creates no basic BYOK reservation', async () => {
  const novelId = 'orchestrate-disconnect-before-delivery';
  createTestNovel(novelId);
  upstreamMode = 'pending';

  const response = await fetch(`${baseUrl}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId,
      contextStr: '上下文',
      sceneBeats: '场景节拍',
      includeCritic: false,
    }),
  });
  assert.equal(response.status, 200);
  await response.body?.cancel();

  assert.equal(Array.from(__quotaTestHooks.quotaReservations.values()).some((reservation) => reservation.novelId === novelId), false);
  await waitForQuota(novelId, 0);
});

test('orchestrate disconnect after first prose token creates no basic BYOK reservation', async () => {
  const novelId = 'orchestrate-disconnect-after-delivery';
  createTestNovel(novelId);
  upstreamMode = 'success';

  const response = await fetch(`${baseUrl}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId,
      contextStr: '上下文',
      sceneBeats: '场景节拍',
      includeCritic: false,
    }),
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('"type":"token"')) {
    const chunk: ReadableStreamReadResult<Uint8Array> = await reader.read();
    assert.equal(chunk.done, false);
    received += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  assert.equal(Array.from(__quotaTestHooks.quotaReservations.values()).some((reservation) => reservation.novelId === novelId), false);
  await waitForQuota(novelId, 0);
});

test('orchestrate bills delivered fallback when critic is unavailable', async () => {
  const novelId = 'orchestrate-fallback-critic-failure';
  createTestNovel(novelId);
  upstreamMode = 'failure';
  const requestCountBefore = upstreamRequestCount;

  const response = await fetch(`${baseUrl}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId,
      contextStr: '雨夜的旧车站里只剩一盏灯',
      sceneBeats: '主角发现一封没有署名的信',
      includeCritic: true,
      maxIterations: 1,
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /"type":"token"/);
  assert.match(body, /"type":"critic_done"/);
  assert.match(body, /"status":"unknown"/);
  assert.match(body, /"type":"done","status":"unknown"/);
  assert.doesNotMatch(body, /"type":"error"/);
  assert.equal(upstreamRequestCount - requestCountBefore, 2);

  assert.equal(Array.from(__quotaTestHooks.quotaReservations.values()).some((reservation) => reservation.novelId === novelId), false);
  await waitForQuota(novelId, 0);
});

test('one max-iteration orchestrate workflow is not rate-limited by its own provider calls', async () => {
  const novelId = 'orchestrate-five-iterations';
  createTestNovel(novelId);
  upstreamMode = 'success';
  const requestCountBefore = upstreamRequestCount;

  const response = await fetch(`${baseUrl}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId,
      contextStr: '雨夜的旧车站里只剩一盏灯',
      sceneBeats: '主角发现一封没有署名的信',
      includeCritic: true,
      maxIterations: 5,
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /"type":"done"/);
  assert.doesNotMatch(body, /"type":"error"/);
  assert.equal(upstreamRequestCount - requestCountBefore, 2);
});

test('orchestrate critic failure emits unknown and completes the delivered draft', async () => {
  const novelId = 'orchestrate-critic-failure-unknown';
  createTestNovel(novelId);
  upstreamMode = 'critic-failure';
  criticFailureRequestCount = 0;

  const response = await fetch(`${baseUrl}/api/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelId,
      contextStr: '雨夜的旧车站里只剩一盏灯',
      sceneBeats: '主角发现一封没有署名的信',
      includeCritic: true,
      maxIterations: 2,
    }),
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /"type":"critic_done"/);
  assert.match(body, /"status":"unknown"/);
  assert.match(body, /"isValid":false/);
  assert.match(body, /"type":"done","status":"unknown"/);
  assert.doesNotMatch(body, /"type":"error"/);
  await waitForQuota(novelId, 0);
});
