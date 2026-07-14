import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-continuation-generation-'));
const activeDbPath = path.join(testDir, 'active.test.db');
process.env.INKFLOW_DB_PATH = activeDbPath;

type DeferredLlmResponse = {
  started: Promise<void>;
  release: () => void;
};

test('continuation imports reject async results from an obsolete database generation', async (t) => {
  const db = await import('../server/lib/db');
  const { getDatabaseGeneration } = await import('../server/lib/db-instance');
  const { importDatabaseBuffer } = await import('../server/routes/db');
  const { registerContinuationRoutes } = await import('../server/routes/continuation');
  const { registerWorldRoutes } = await import('../server/routes/world');
  const { getConfig } = await import('../server/lib/config');

  const originalFetch = globalThis.fetch;
  const config = getConfig();
  const originalConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    promptGuardLevel: config.promptGuardLevel,
  };
  const llmQueue: Array<{
    payload: unknown;
    markStarted: () => void;
    waitForRelease: Promise<void>;
  }> = [];

  const queueLlmResponse = (payload: unknown): DeferredLlmResponse => {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const waitForRelease = new Promise<void>((resolve) => { release = resolve; });
    llmQueue.push({ payload, markStarted, waitForRelease });
    return { started, release };
  };

  const createReplacement = (name: string, novelId: string): Buffer => {
    db.closeDb();
    const candidatePath = path.join(testDir, name);
    fs.rmSync(candidatePath, { force: true });
    db.initDb(candidatePath);
    db.createNovel({
      id: novelId,
      title: `replacement-${name}`,
      authorId: 'local-user',
      summary: '',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    db.closeDb();
    const buffer = fs.readFileSync(candidatePath);
    fs.rmSync(candidatePath, { force: true });
    return buffer;
  };

  const resetActiveDatabase = (novelId = 'active-a') => {
    db.closeDb();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${activeDbPath}${suffix}`, { force: true });
    db.initDb(activeDbPath);
    db.createNovel({
      id: novelId,
      title: 'active-a',
      authorId: 'local-user',
      summary: '',
      status: 'ongoing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  };

  let server: ReturnType<express.Express['listen']> | undefined;
  let baseUrl = '';
  try {
    config.apiKey = 'test-key';
    config.baseUrl = 'https://continuation-generation.test/v1';
    config.model = 'test-model';
    config.promptGuardLevel = 'disabled';

    const app = express();
    app.use(express.json({ limit: '20mb' }));
    registerContinuationRoutes(app);
    registerWorldRoutes(app);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith(baseUrl)) return originalFetch(input, init);
      const next = llmQueue.shift();
      assert.ok(next, `unexpected LLM request: ${url}`);
      next.markStarted();
      await next.waitForRelease;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(next.payload) } }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const documentText = '这是用于跨数据库代际回归测试的中文续写资料，内容长度足以通过上传校验。';
    const filedata = Buffer.from(documentText).toString('base64');

    await t.test('does not publish a pending continuation pack after the database changes', async () => {
      const replacement = createReplacement('parse-replacement.db', 'replacement-b');
      resetActiveDatabase();
      const deferred = queueLlmResponse({});
      const sessionResponse = await fetch(`${baseUrl}/api/continuation-packs/import-session`, { method: 'POST' });
      assert.equal(sessionResponse.status, 201);
      const session = await sessionResponse.json() as { novelId: string };

      const parsePromise = fetch(`${baseUrl}/api/continuation-packs/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          novelId: session.novelId,
          title: '旧库资料',
          documents: [{ filename: '资料.txt', filedata }],
        }),
      });
      await deferred.started;
      await importDatabaseBuffer(replacement);
      deferred.release();

      const response = await parsePromise;
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: '数据库已在解析期间切换，请重新导入资料' });
      assert.equal(db.listContinuationPacks('replacement-b').length, 0);
    });

    await t.test('deletes and rejects a pending continuation pack when approval crosses generations', async () => {
      const replacement = createReplacement('approve-replacement.db', 'replacement-b');
      resetActiveDatabase();
      const deferred = queueLlmResponse({});
      const generationA = getDatabaseGeneration();
      const sessionResponse = await fetch(`${baseUrl}/api/continuation-packs/import-session`, { method: 'POST' });
      assert.equal(sessionResponse.status, 201);
      const session = await sessionResponse.json() as { novelId: string };

      const parsePromise = fetch(`${baseUrl}/api/continuation-packs/parse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          novelId: session.novelId,
          title: '待确认资料',
          documents: [{ filename: '资料.txt', filedata }],
        }),
      });
      await deferred.started;
      deferred.release();
      const parseResponse = await parsePromise;
      assert.equal(parseResponse.status, 200);
      const parsed = await parseResponse.json() as { pack: { id: string } };

      await importDatabaseBuffer(replacement);
      assert.notEqual(getDatabaseGeneration(), generationA);
      const approval = await fetch(`${baseUrl}/api/continuation-packs/approve-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          packId: parsed.pack.id,
          mode: 'new',
          newNovel: { title: '不应创建', summary: '' },
        }),
      });
      assert.equal(approval.status, 409);
      assert.deepEqual(await approval.json(), { error: '数据库已在解析后切换，请重新导入资料' });
      assert.equal(db.listNovels().length, 1);
      assert.equal(db.listContinuationPacks('replacement-b').length, 0);

      const retry = await fetch(`${baseUrl}/api/continuation-packs/approve-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          packId: parsed.pack.id,
          mode: 'new',
          newNovel: { title: '仍不应创建', summary: '' },
        }),
      });
      assert.equal(retry.status, 404);
    });

    await t.test('rejects approving a stored continuation pack for another novel', async () => {
      resetActiveDatabase('novel-a');
      const now = Date.now();
      db.createNovel({
        id: 'novel-b',
        title: 'novel-b',
        authorId: 'local-user',
        summary: '',
        status: 'ongoing',
        createdAt: now,
        updatedAt: now,
      });
      db.createContinuationPack({
        id: 'stored-pack-a',
        novelId: 'novel-a',
        title: 'stored pack',
        status: 'draft',
        sourceDocuments: [],
        canonFacts: [],
        characterStates: [],
        plotState: {
          currentTimeline: '', latestScene: '', unresolvedHooks: [], immediateConflict: '', nextLikelyMove: '',
        },
        styleProfile: {
          pov: '', tense: '', pacing: '', dialogueDensity: '', proseTraits: [], avoidTraits: [], sampleEvidence: '',
        },
        contradictions: [],
        continuationTask: '',
        createdAt: now,
        updatedAt: now,
      });

      const response = await fetch(`${baseUrl}/api/continuation-packs/approve-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          packId: 'stored-pack-a',
          mode: 'existing',
          existingNovelId: 'novel-b',
        }),
      });
      assert.equal(response.status, 409);
      assert.equal(db.getContinuationPack('stored-pack-a')?.novelId, 'novel-a');
      assert.equal(db.getContinuationPack('stored-pack-a')?.status, 'draft');
    });

    await t.test('rejects stale world-document jobs and import confirmations', async () => {
      const replacement = createReplacement('world-replacement.db', 'shared-novel');
      resetActiveDatabase('shared-novel');
      const deferred = queueLlmResponse({
        globalOutline: '来自旧库的解析结果',
        worldRules: '',
        characters: [{ name: '旧库人物', role: 'supporting', summary: '', bio: '', traits: [] }],
      });

      const start = await fetch(`${baseUrl}/api/parse-doc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ novelId: 'shared-novel', filename: '设定.txt', filedata }),
      });
      assert.equal(start.status, 202);
      const started = await start.json() as { jobId: string; databaseGeneration: number };
      assert.equal(started.databaseGeneration, getDatabaseGeneration());
      await deferred.started;

      await importDatabaseBuffer(replacement);
      deferred.release();

      const job = await fetch(
        `${baseUrl}/api/parse-doc/jobs/${encodeURIComponent(started.jobId)}?databaseGeneration=${started.databaseGeneration}`,
      );
      assert.equal(job.status, 409);
      assert.deepEqual(await job.json(), { error: '数据库已在解析期间切换，请重新导入设定文档' });

      const importResponse = await fetch(`${baseUrl}/api/world/import-extraction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          databaseGeneration: started.databaseGeneration,
          novelId: 'shared-novel',
          globalOutline: '来自旧库的解析结果',
          worldRules: '',
          characters: [{ name: '旧库人物', role: 'supporting', summary: '', bio: '', traits: [] }],
          locations: [],
          items: [],
          factions: [],
          powerLevels: [],
          timelineEvents: [],
        }),
      });
      assert.equal(importResponse.status, 409);
      assert.equal(db.getNovel('shared-novel')?.globalOutline || '', '');
      assert.equal(db.listCharacters('shared-novel').length, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config, originalConfig);
    if (server) {
      await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    }
    db.closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
