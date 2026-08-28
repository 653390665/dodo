import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { closeDb, createCharacter, createNovel, getArtifactCore, initDb } from '../server/lib/db.js';
import { getConfig } from '../server/lib/config.js';
import { getDatabaseGeneration } from '../server/lib/db-instance.js';
import { registerWorldRoutes } from '../server/routes/world.js';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit.js';

const waitForJob = async (baseUrl: string, jobId: string, generation: number) => {
  for (let i = 0; i < 100; i += 1) {
    const response = await fetch(`${baseUrl}/api/world/jobs/${jobId}?databaseGeneration=${generation}`);
    const job = await response.json() as { status: string; result?: { kind?: string; candidate?: { target?: { kind?: string }; proposedContent?: string; proposedCore?: { desire?: string }; diff?: { fields: unknown[] } } }; error?: string };
    if (job.status === 'completed' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('job timeout');
};

test('bible capabilities return governed candidates and never write readable Canon', async () => {
  closeDb();
  initDb(':memory:');
  const config = getConfig();
  const originalFetch = globalThis.fetch;
  const originalConfig = { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, promptGuardLevel: config.promptGuardLevel };
  createNovel({ id: 'n1', title: 'N', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });
  createCharacter({ id: 'c1', novelId: 'n1', name: '阿青', role: 'protagonist', summary: '守门人', bio: '原始小传', traits: [], createdAt: 1, updatedAt: 1 });
  config.apiKey = 'test-key'; config.baseUrl = 'https://candidate.test/v1'; config.model = 'candidate-model'; config.promptGuardLevel = 'disabled';
  const app = express(); app.use(express.json()); registerWorldRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  globalThis.fetch = async (input, init) => String(input).startsWith(baseUrl)
    ? originalFetch(input, init)
    : Response.json({ choices: [{ message: { content: JSON.stringify({ core: { desire: '守住北门' }, proposedContent: '结构化候选内容' }) } }] });
  try {
    const generation = getDatabaseGeneration();
    const response = await fetch(`${baseUrl}/api/generate-outline`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'n1', databaseGeneration: generation, techniqueId: 'bible-character-arc' }) });
    assert.equal(response.status, 200);
    const started = await response.json() as { jobId: string; databaseGeneration: number };
    const job = await waitForJob(baseUrl, started.jobId, started.databaseGeneration);
    assert.equal(job.status, 'completed');
    assert.equal(job.result?.kind, 'character');
    assert.equal(job.result?.candidate?.target?.kind, 'character');
    assert.equal(job.result?.candidate?.proposedContent, '结构化候选内容');
    assert.equal(job.result?.candidate?.proposedCore?.desire, '守住北门');
    assert.ok((job.result?.candidate?.diff?.fields.length || 0) > 0);
    assert.equal(getArtifactCore('n1', 'character', 'c1'), undefined);
  } finally {
    globalThis.fetch = originalFetch; Object.assign(config, originalConfig); __rateLimitTestHooks.reset();
    await new Promise<void>((resolve) => server.close(() => resolve())); closeDb();
  }
});
