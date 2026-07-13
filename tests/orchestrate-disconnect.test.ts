import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getConfig } from '../server/lib/config.js';
import { registerAgentsRoutes } from '../server/routes/agents.js';
import { closeDb, createNovel, getNovel, initDb } from '../server/lib/db.js';
import { __quotaTestHooks } from '../server/helpers/quota-guard.js';
import type { Novel, ProjectPreferenceProfile } from '../shared/types.js';

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
let upstreamMode: 'pending' | 'success' = 'success';

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
      return originalFetch(url, init);
    }
    if (upstreamMode === 'pending') {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const rejectAbort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (signal?.aborted) rejectAbort();
        else signal?.addEventListener('abort', rejectAbort, { once: true });
      });
    }
    const requestBody = typeof init?.body === 'string' ? JSON.parse(init.body) as { stream?: boolean } : {};
    if (requestBody.stream) {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"灵感内容"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '正文内容'.repeat(180) } }],
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
  const response = await fetch(`${baseUrl}/api/inspiration`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '给我一个雨夜灵感' }),
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /"token":"灵感内容"/);
  assert.match(body, /data: \[DONE\]/);
});

test('orchestrate-draft disconnect before prose delivery refunds quota', async () => {
  const novelId = 'disconnect-before-delivery';
  createNovel(makeNovel(novelId));
  upstreamMode = 'pending';

  const response = await fetch(`${baseUrl}/api/orchestrate-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId, contextStr: '上下文', sceneBeats: '场景节拍' }),
  });
  assert.equal(response.status, 200);
  await response.body?.cancel();

  await waitForQuota(novelId, 0);
});

test('orchestrate-draft disconnect after first prose token commits quota', async () => {
  const novelId = 'disconnect-after-delivery';
  createNovel(makeNovel(novelId));
  upstreamMode = 'success';

  const response = await fetch(`${baseUrl}/api/orchestrate-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ novelId, contextStr: '上下文', sceneBeats: '场景节拍' }),
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let received = '';
  while (!received.includes('"type":"token"')) {
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    received += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  await waitForQuota(novelId, 1);
});

test('orchestrate disconnect before prose delivery refunds quota', async () => {
  const novelId = 'orchestrate-disconnect-before-delivery';
  createNovel(makeNovel(novelId));
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

  await waitForQuota(novelId, 0);
});

test('orchestrate disconnect after first prose token commits quota', async () => {
  const novelId = 'orchestrate-disconnect-after-delivery';
  createNovel(makeNovel(novelId));
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
    const chunk = await reader.read();
    assert.equal(chunk.done, false);
    received += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  await waitForQuota(novelId, 1);
});
