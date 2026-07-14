import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';

import { DEFAULT_PROMPT_TEMPLATES } from '../shared/config/prompt-templates';

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('cancelling an editor-agent job aborts provider transport and refunds quota', async () => {
  const configDir = path.join(os.tmpdir(), `inkflow-editor-cancel-config-${Date.now()}`);
  process.env.INKFLOW_CONFIG_DIR = configDir;
  process.env.NODE_ENV = 'test';

  const [{ registerAgentsRoutes }, db, dbInstance, configModule, rateLimitModule] = await Promise.all([
    import('../server/routes/agents'),
    import('../server/lib/db'),
    import('../server/lib/db-instance'),
    import('../server/lib/config'),
    import('../server/middleware/rate-limit'),
  ]);
  const dbPath = path.join(os.tmpdir(), `inkflow-editor-cancel-${Date.now()}.db`);
  db.closeDb();
  db.initDb(dbPath);
  db.createNovel({
    id: 'cancel-novel', title: 'Cancel', authorId: 'local', summary: '', status: 'ongoing',
    projectPreferenceProfile: {
      tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 },
      acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0,
      commercialMode: 'free', quotaLimits: { generateProseCount: 0, generateProseMax: 3 },
    },
    createdAt: 1, updatedAt: 1,
  });
  configModule.saveConfig({
    apiKey: 'mock-google-key',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-pro',
    promptGuardLevel: 'disabled',
    promptTemplates: DEFAULT_PROMPT_TEMPLATES,
  });
  configModule.reloadConfig();
  rateLimitModule.__rateLimitTestHooks.reset();

  const app = express();
  app.use(express.json());
  registerAgentsRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  let providerSignal: AbortSignal | undefined;
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes('generativelanguage.googleapis.com')) {
      return originalFetch(input, init);
    }
    providerSignal = init?.signal ?? undefined;
    return await new Promise<Response>((_resolve, reject) => {
      providerSignal?.addEventListener('abort', () => reject(providerSignal?.reason), { once: true });
    });
  };

  try {
    const response = await originalFetch(`http://127.0.0.1:${port}/api/editor-agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userIntent: 'outline this chapter',
        novelId: 'cancel-novel',
        databaseGeneration: dbInstance.getDatabaseGeneration(),
      }),
    });
    assert.equal(response.status, 200);
    const { jobId, databaseGeneration } = await response.json() as { jobId: string; databaseGeneration: number };
    await waitFor(() => Boolean(providerSignal));

    const cancelResponse = await originalFetch(`http://127.0.0.1:${port}/api/agents/jobs/${jobId}/cancel?databaseGeneration=${databaseGeneration}`, { method: 'POST' });
    assert.equal(cancelResponse.status, 200);
    await waitFor(() => providerSignal?.aborted === true);
    await waitFor(() => db.getNovel('cancel-novel')?.projectPreferenceProfile?.quotaLimits?.generateProseCount === 0);

    const jobResponse = await originalFetch(`http://127.0.0.1:${port}/api/agents/jobs/${jobId}?databaseGeneration=${databaseGeneration}`);
    const job = await jobResponse.json() as { status: string; error?: string };
    assert.equal(job.status, 'failed');
    assert.match(job.error || '', /cancel/i);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.closeDb();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
    delete process.env.INKFLOW_CONFIG_DIR;
  }
});
