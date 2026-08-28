import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import type { ContinuationPack, Novel } from '../shared/types';

test('relationship repair route classifies provider billing errors safely', async () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-relationship-repair-route-'));
  const dbPath = path.join(testDir, 'test.db');
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  const db = await import('../server/lib/db');
  const { getDatabaseGeneration } = await import('../server/lib/db-instance');
  const { registerContinuationRoutes } = await import('../server/routes/continuation');
  const { getConfig } = await import('../server/lib/config');

  let server: ReturnType<express.Express['listen']> | undefined;
  const config = getConfig();
  const originalConfig = { apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model, promptGuardLevel: config.promptGuardLevel };
  try {
    process.env.NODE_ENV = 'test';
    db.initDb(dbPath);
    const now = Date.now();
    const novel: Novel = {
      id: 'billing-route-novel', title: 'billing route test', authorId: 'local-user', summary: '',
      status: 'ongoing', createdAt: now, updatedAt: now,
    };
    db.createNovel(novel);
    const pack: ContinuationPack = {
      id: 'billing-route-pack', novelId: novel.id, title: 'billing route pack', status: 'approved',
      sourceDocuments: [{ id: 'source-1', packId: 'billing-route-pack', filename: 'source.txt', kind: 'other', text: 'A与B是盟友。', excerpt: 'A与B是盟友。', createdAt: now }],
      canonFacts: [], characterStates: [],
      plotState: { currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '' },
      styleProfile: { pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '' },
      contradictions: [], continuationTask: '', createdAt: now, updatedAt: now,
    };
    db.createContinuationPack(pack);

    config.apiKey = 'test-key';
    config.baseUrl = 'https://provider-billing.test/v1';
    config.model = 'test-model';
    config.promptGuardLevel = 'disabled';

    const app = express();
    app.use(express.json());
    registerContinuationRoutes(app);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith(baseUrl)) return originalFetch(input, init);
      return new Response('provider raw quota response must not escape', { status: 402 });
    };

    const response = await fetch(`${baseUrl}/api/continuation-packs/recommend-relationship-repairs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        packId: pack.id, novelId: novel.id, databaseGeneration: getDatabaseGeneration(),
        relationships: [{ index: 0, sourceName: 'A', sourceType: 'character', targetName: 'B', targetType: 'character', relationshipType: '盟友', description: '' }],
        candidates: { character: ['A', 'B'], location: [], item: [], faction: [] },
      }),
    });
    const body = await response.json() as { code?: string; error?: string };
    assert.equal(response.status, 402);
    assert.equal(body.code, 'billing');
    assert.equal(body.error, '模型服务额度不足，请充值或更换可用模型');
    assert.doesNotMatch(JSON.stringify(body), /provider raw quota response/);
  } finally {
    globalThis.fetch = originalFetch;
    config.apiKey = originalConfig.apiKey;
    config.baseUrl = originalConfig.baseUrl;
    config.model = originalConfig.model;
    config.promptGuardLevel = originalConfig.promptGuardLevel;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    server?.close();
    db.closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
