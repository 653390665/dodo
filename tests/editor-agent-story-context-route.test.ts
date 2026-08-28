import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { registerAgentsRoutes } from '../server/routes/agents.ts';
import { closeDb, createChapter, createForeshadowing, createNovel, initDb } from '../server/lib/db.ts';
import { getDatabaseGeneration } from '../server/lib/db-instance.ts';
import { reloadConfig, saveConfig } from '../server/lib/config.ts';
import { DEFAULT_PROMPT_TEMPLATES } from '../shared/config/prompt-templates.ts';

let dbPath = '';
let server: ReturnType<express.Express['listen']> | undefined;
const originalFetch = globalThis.fetch;

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  dbPath = '';
});

test('editor-agent rebuilds server story context instead of trusting client contextStr', async () => {
  process.env.NODE_ENV = 'test';
  dbPath = path.join(os.tmpdir(), `inkflow-editor-story-context-${Date.now()}.db`);
  closeDb();
  initDb(dbPath);
  createNovel({
    id: 'editor-context-novel', title: '编辑上下文测试', authorId: 'local-user', summary: '摘要', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'free', quotaLimits: { generateProseCount: 0, generateProseMax: 3 },
    },
    worldRules: '只有午夜的钟声能打开灰门。', createdAt: 1, updatedAt: 1,
  });
  createChapter({ id: 'editor-context-chapter', novelId: 'editor-context-novel', title: '第一章', content: '', sceneBeats: '进入钟楼', order: 1, wordCount: 0, createdAt: 1, updatedAt: 1 });
  createForeshadowing({
    id: 'editor-route-promise-27', novelId: 'editor-context-novel', title: '编辑路由伏笔',
    description: '灰门后有一封写给未来自己的信。', status: 'planted', plantedChapterId: 'editor-context-chapter',
    relatedCharacterIds: [], createdAt: 1, updatedAt: 1,
  });
  saveConfig({ apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'test-model', promptGuardLevel: 'disabled', promptTemplates: DEFAULT_PROMPT_TEMPLATES });
  reloadConfig();

  let capturedBody = '';
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('api.openai.com')) return originalFetch(url, init);
    capturedBody = String((init as RequestInit | undefined)?.body || '');
    return Response.json({ choices: [{ message: { content: '生成的分镜' } }] });
  };

  const app = express();
  app.use(express.json());
  registerAgentsRoutes(app);
  server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const databaseGeneration = getDatabaseGeneration();
  const response = await fetch(`http://127.0.0.1:${port}/api/editor-agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userIntent: '生成本章分镜', novelId: 'editor-context-novel', chapterId: 'editor-context-chapter',
      databaseGeneration, contextStr: '客户端上下文没有伏笔', surface: 'workspace-beats',
    }),
  });
  assert.equal(response.status, 200);
  const started = await response.json() as { jobId: string; databaseGeneration: number };
  let job: { status: string; result?: { text?: string } } = { status: 'pending' };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const jobResponse = await fetch(`http://127.0.0.1:${port}/api/agents/jobs/${started.jobId}?databaseGeneration=${started.databaseGeneration}`);
    job = await jobResponse.json();
    if (job.status === 'completed' || job.status === 'failed') break;
  }

  assert.equal(job.status, 'completed');
  assert.match(capturedBody, /editor-route-promise-27/);
  assert.match(capturedBody, /编辑路由伏笔/);
  assert.match(capturedBody, /客户端补充上下文/);
});
