import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import { registerWorldRoutes } from '../server/routes/world';
import { closeDb, createNovel, initDb } from '../server/lib/db';
import { getDatabaseGeneration } from '../server/lib/db-instance';
import { getConfig } from '../server/lib/config';
import { __rateLimitTestHooks } from '../server/middleware/rate-limit';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('generate-outline survives a DeepSeek json_object rejection via plain fallback', async () => {
  closeDb();
  const dbPath = path.join(os.tmpdir(), `inkflow-outline-deepseek-${Date.now()}.db`);
  initDb(dbPath);
  createNovel({ id: 'deepseek-outline-novel', title: 'DeepSeek', authorId: 'local', summary: '', status: 'ongoing', createdAt: 1, updatedAt: 1 });

  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  config.apiKey = 'deepseek-test-key';
  config.baseUrl = 'https://api.deepseek.com';
  config.model = 'deepseek-chat';
  config.promptGuardLevel = 'disabled';
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (requests.length === 1) {
      // DeepSeek rejects response_format:{type:'json_object'} when the prompt
      // (the Chinese-only outline template) lacks the literal word "json".
      return Response.json({
        error: {
          message: "Content Must contain the word 'json' in order to use response format of json_object",
          type: 'invalid_request_error',
        },
      }, { status: 400 });
    }
    return Response.json({ choices: [{ message: { content: '第一卷：主角发现王城密道。' } }] });
  };

  const app = express();
  app.use(express.json());
  registerWorldRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const databaseGeneration = getDatabaseGeneration();

  try {
    __rateLimitTestHooks.reset();
    const started = await fetch(`${baseUrl}/api/generate-outline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ novelId: 'deepseek-outline-novel', databaseGeneration }),
    });
    assert.equal(started.status, 200);
    const { jobId } = await started.json() as { jobId: string };

    let job: { status: string; error?: string; result?: { outline?: string } };
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/world/jobs/${jobId}?databaseGeneration=${databaseGeneration}`);
      job = await response.json() as typeof job;
      if (job.status === 'completed' || job.status === 'failed') break;
      await wait(25);
    }
    assert.equal(job!.status, 'completed', job!.error || '');
    assert.equal(job!.result?.outline, '第一卷：主角发现王城密道。');

    // The first request carried json_object and was rejected with 400; the
    // compatibility fallback must retry without response_format instead of
    // surfacing the 400 as a failed outline job.
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0]?.response_format, { type: 'json_object' });
    assert.equal('response_format' in (requests[1] || {}), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    __rateLimitTestHooks.reset();
    closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
  }
});
