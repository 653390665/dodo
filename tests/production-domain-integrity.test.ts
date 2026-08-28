import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { ContinuityReport, ProposedLedgerPatch } from '../shared/types';
import { confirmWritingStyleForTest } from './helpers/confirm-writing-style.js';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-production-domain-'));
const databasePath = path.join(testDir, 'production-domain.test.db');
process.env.INKFLOW_DB_PATH = databasePath;

test('chapter production enforces novel ownership and preserves concurrent preferences', async (t) => {
  const db = await import('../server/lib/db');
  const { getConfig } = await import('../server/lib/config');
  const {
    getDb,
    getDatabaseGeneration,
    runInSerializedWrite,
    drainWriteQueue,
  } = await import('../server/lib/db-instance');
  const { resolveWritingStyleRequest } = await import('../server/helpers/writing-style-service');
  const { importDatabaseBuffer, registerDbRoutes } = await import('../server/routes/db');
  const { __rateLimitTestHooks } = await import('../server/middleware/rate-limit');
  const {
    __productionTestHooks,
    registerProductionRoutes,
  } = await import('../server/routes/production');

  db.initDb(databasePath);
  const now = Date.now();
  const reflexionArgs = (novelId: string, chapterId: string) => {
    const databaseGeneration = getDatabaseGeneration();
    return [novelId, databaseGeneration, resolveWritingStyleRequest(novelId, { chapterId, databaseGeneration }).executionSnapshot] as const;
  };
  const emptyProfile = {
    tags: [],
    weights: {
      styleWeight: 1,
      characterWeight: 1,
      worldWeight: 1,
      plotWeight: 1,
      pacingWeight: 1,
    },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    quotaLimits: { generateProseMax: 100, generateProseCount: 0 },
  };

  for (const id of ['novel-a', 'novel-b']) {
    db.createNovel({
      id,
      title: id,
      authorId: 'local-user',
      summary: '',
      status: 'ongoing',
      projectPreferenceProfile: emptyProfile,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const [id, novelId] of [['chapter-a', 'novel-a'], ['chapter-b', 'novel-b']] as const) {
    db.createChapter({
      id,
      novelId,
      title: id,
      content: `content-${id}`,
      order: 1,
      wordCount: 10,
      createdAt: now,
      updatedAt: now,
    });
  }

  db.createContinuationPack({
    id: 'pack-b',
    novelId: 'novel-b',
    title: 'foreign pack',
    status: 'approved',
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
    sourceMap: { sections: [], keyConflicts: [] },
    continuationTask: '',
    createdAt: now,
    updatedAt: now,
  });
  await drainWriteQueue();
  db.createContinuationPack({
    ...db.getContinuationPack('pack-b')!,
    id: 'pack-a',
    novelId: 'novel-a',
    title: 'owned pack',
  });
  await drainWriteQueue();
  const packAFingerprint = confirmWritingStyleForTest('novel-a', 'pack-a');

  db.createCharacter({
    id: 'character-b', novelId: 'novel-b', name: 'foreign character', role: 'supporting',
    summary: 'unchanged', traits: [], bio: '', createdAt: now, updatedAt: now,
  });
  db.createItem({
    id: 'item-b', novelId: 'novel-b', name: 'foreign item', description: 'unchanged', type: '',
    createdAt: now, updatedAt: now,
  });
  db.createForeshadowing({
    id: 'foreshadowing-b', novelId: 'novel-b', title: 'foreign foreshadowing',
    description: '', status: 'planted', relatedCharacterIds: [], notes: 'unchanged',
    createdAt: now, updatedAt: now,
  });

  const app = express();
  app.use(express.json());
  registerDbRoutes(app);
  registerProductionRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const emptyContinuityReport = (): ContinuityReport => ({
    score: 100,
    issues: [],
    proposedPatch: {
      characterUpdates: [],
      itemUpdates: [],
      foreshadowingUpdates: [],
      timelineEventsToCreate: [],
      foreshadowingsToCreate: [],
    },
  });

  const createReviewRun = (
    id: string,
    patch: ProposedLedgerPatch,
    targetChapterId: string | null = 'chapter-a',
    continuationPackId?: string,
  ) => {
    const reviewDraft = Array.from({ length: 8 }, (_, index) => [
      `审查场景${index + 1}里，林舟先确认门外的脚步，再把手从桌沿收回。`,
      '对方没有立刻回答，灯影沿着水痕移动，逼得两人的站位同时改变。',
      '他把线索压回袖中，听见锁舌在远处回应，局势因此向门外又推进一步。',
    ].join('')).join('\n\n');
    db.createChapterProductionRun({
      id,
      novelId: 'novel-a',
      targetChapterId: targetChapterId || undefined,
      status: 'review_required',
      userIntent: '',
      sceneBeats: 'new beats',
      draftContent: reviewDraft,
      styleAudit: 'new audit',
      continuityReport: {
        databaseGeneration: getDatabaseGeneration(),
        score: 100,
        auditMeta: { status: 'pass', source: 'model' },
        issues: [],
        proposedPatch: patch,
        ...(continuationPackId ? { continuationPackId } : {}),
      },
      createdAt: now,
      updatedAt: now,
    });
  };

  try {
    await t.test('rejects a foreign target chapter before creating start and stream runs', async () => {
      __rateLimitTestHooks.reset();
      const requestBody = { novelId: 'novel-a', chapterId: 'chapter-b', databaseGeneration: getDatabaseGeneration(), targetChapterId: 'chapter-b', userIntent: 'continue' };

      const ordinary = await fetch(`${baseUrl}/api/chapter-production-runs/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
      });
      assert.equal(ordinary.status, 403);

      const streamed = await fetch(`${baseUrl}/api/chapter-production-runs/start-stream`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
      });
      assert.equal(streamed.status, 403);
      assert.equal(db.listChapterProductionRuns('novel-a').length, 0);
    });

    await t.test('rejects a continuation pack owned by another novel', async () => {
      __rateLimitTestHooks.reset();
      const requestBody = { novelId: 'novel-a', chapterId: 'chapter-a', databaseGeneration: getDatabaseGeneration(), continuationPackId: 'pack-b', userIntent: 'continue' };

      const ordinary = await fetch(`${baseUrl}/api/chapter-production-runs/start`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
      });
      assert.equal(ordinary.status, 409);

      const streamed = await fetch(`${baseUrl}/api/chapter-production-runs/start-stream`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(requestBody),
      });
      assert.equal(streamed.status, 409);
      assert.equal(db.listChapterProductionRuns('novel-a').length, 0);
    });

    await t.test('preserves continuation-pack provenance when an invalid fallback is rejected', async () => {
      __rateLimitTestHooks.reset();
      const response = await fetch(`${baseUrl}/api/chapter-production-runs/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ novelId: 'novel-a', chapterId: 'chapter-a', databaseGeneration: getDatabaseGeneration(), continuationPackId: 'pack-a', userIntent: 'continue', styleConfirmationFingerprint: packAFingerprint }),
      });
      const payload = await response.json() as {
        code?: string;
        retriable?: boolean;
        violations?: string[];
      };
      const run = db.listChapterProductionRuns('novel-a')
        .find((candidate) => candidate.userIntent === 'continue');
      assert.equal(response.status, 422);
      assert.equal(payload.code, 'DRAFT_QUALITY_GATE_FAILED');
      assert.equal(payload.retriable, true);
      assert.ok(payload.violations?.length);
      assert.ok(run, 'quality failure should preserve a diagnostic run');
      assert.equal(run.status, 'failed');
      assert.equal(run.draftContent, '');
      assert.equal(run.continuityReport.continuationPackId, 'pack-a');
      assert.equal(run.continuityReport.contextReceipt?.packId, 'pack-a');
      assert.equal(typeof run.continuityReport.contextReceipt?.runtimeSha256, 'string');
      assert.equal(db.listChapterProductionRunVersions(run.id).length, 0);
      getDb().prepare('DELETE FROM chapter_production_runs WHERE id = ?').run(run.id);
    });

    await t.test('rejects a forged cross-novel target at apply time with zero writes', async () => {
      createReviewRun('foreign-target-run', emptyContinuityReport().proposedPatch, 'chapter-b');
      const originalA = db.getChapter('chapter-a');
      const originalB = db.getChapter('chapter-b');

      const response = await fetch(`${baseUrl}/api/chapter-production-runs/foreign-target-run/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'novel-a', chapterId: 'chapter-b', databaseGeneration: getDatabaseGeneration() }),
      });
      assert.equal(response.status, 409);
      assert.deepEqual(db.getChapter('chapter-a'), originalA);
      assert.deepEqual(db.getChapter('chapter-b'), originalB);
      assert.equal(db.listChapterVersions('chapter-a').length, 0);
      assert.equal(db.listChapterVersions('chapter-b').length, 0);
      assert.equal(db.getChapterProductionRun('foreign-target-run')?.status, 'review_required');
    });

    await t.test('atomically rejects a production run whose source pack belongs to another novel', async () => {
      createReviewRun(
        'foreign-pack-run',
        emptyContinuityReport().proposedPatch,
        'chapter-a',
        'pack-b',
      );
      const chapterBefore = db.getChapter('chapter-a');
      const versionCountBefore = db.listChapterVersions('chapter-a').length;

      const response = await fetch(`${baseUrl}/api/chapter-production-runs/foreign-pack-run/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'novel-a', chapterId: 'chapter-a', databaseGeneration: getDatabaseGeneration() }),
      });
      const chapterAfter = db.getChapter('chapter-a');
      const versionCountAfter = db.listChapterVersions('chapter-a').length;
      const runStatusAfter = db.getChapterProductionRun('foreign-pack-run')?.status;
      getDb().prepare('DELETE FROM chapter_versions WHERE chapter_id = ?').run('chapter-a');
      if (chapterBefore) db.updateChapter('chapter-a', chapterBefore);
      getDb().prepare('DELETE FROM chapter_production_runs WHERE id = ?').run('foreign-pack-run');

      assert.equal(response.status, 409);
      assert.deepEqual(chapterAfter, chapterBefore);
      assert.equal(versionCountAfter, versionCountBefore);
      assert.equal(runStatusAfter, 'review_required');
    });

    await t.test('rejects a legacy production run without a bound target chapter', async () => {
      createReviewRun('new-chapter-run', emptyContinuityReport().proposedPatch, null, 'pack-a');
      const chapterBefore = db.getChapter('chapter-a');

      const response = await fetch(`${baseUrl}/api/chapter-production-runs/new-chapter-run/apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'novel-a', chapterId: 'chapter-a', databaseGeneration: getDatabaseGeneration() }),
      });
      getDb().prepare('DELETE FROM chapter_production_runs WHERE id = ?').run('new-chapter-run');

      assert.equal(response.status, 409);
      assert.deepEqual(db.getChapter('chapter-a'), chapterBefore);
    });

    await t.test('generic DB proxy cannot mutate production run ownership or generated content', async () => {
      createReviewRun('proxy-ownership-run', emptyContinuityReport().proposedPatch);
      const before = db.getChapterProductionRun('proxy-ownership-run');
      const response = await fetch(`${baseUrl}/api/db`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'updateChapterProductionRun',
          args: ['proxy-ownership-run', {
            novelId: 'novel-b',
            targetChapterId: 'chapter-b',
            draftContent: 'cross-novel overwrite',
          }],
        }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(db.getChapterProductionRun('proxy-ownership-run'), before);

      const packBefore = db.getContinuationPack('pack-a');
      const packResponse = await fetch(`${baseUrl}/api/db`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'updateContinuationPack',
          args: ['pack-a', { novelId: 'novel-b' }],
        }),
      });
      assert.equal(packResponse.status, 400);
      assert.deepEqual(db.getContinuationPack('pack-a'), packBefore);
    });

    const foreignPatchCases: Array<{ name: string; patch: ProposedLedgerPatch }> = [
      {
        name: 'character update',
        patch: { ...emptyContinuityReport().proposedPatch, characterUpdates: [{ characterId: 'character-b', summaryAppend: 'polluted' }] },
      },
      {
        name: 'item update',
        patch: { ...emptyContinuityReport().proposedPatch, itemUpdates: [{ itemId: 'item-b', descriptionAppend: 'polluted' }] },
      },
      {
        name: 'foreshadowing update',
        patch: { ...emptyContinuityReport().proposedPatch, foreshadowingUpdates: [{ foreshadowingId: 'foreshadowing-b', status: 'payoff' as const, notesAppend: 'polluted' }] },
      },
      {
        name: 'planted chapter association',
        patch: { ...emptyContinuityReport().proposedPatch, foreshadowingsToCreate: [{ title: 'bad link', description: '', status: 'planted' as const, plantedChapterId: 'chapter-b' }] },
      },
    ];

    for (const [index, scenario] of foreignPatchCases.entries()) {
      await t.test(`atomically rejects foreign continuity ${scenario.name}`, async () => {
        const runId = `foreign-patch-${index}`;
        createReviewRun(runId, scenario.patch);
        const chapterBefore = db.getChapter('chapter-a');
        const novelBefore = db.getNovel('novel-a');

        const response = await fetch(`${baseUrl}/api/chapter-production-runs/${runId}/apply`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ novelId: 'novel-a', chapterId: 'chapter-a', databaseGeneration: getDatabaseGeneration() }),
        });
        assert.equal(response.status, 409);
        assert.deepEqual(db.getChapter('chapter-a'), chapterBefore);
        assert.deepEqual(db.getNovel('novel-a'), novelBefore);
        assert.equal(db.listChapterVersions('chapter-a').length, 0);
        assert.equal(db.listTimelineEvents('novel-a').length, 0);
        assert.equal(db.listForeshadowings('novel-a').length, 0);
        assert.equal(db.getCharacter('character-b')?.summary, 'unchanged');
        assert.equal(db.getItem('item-b')?.description, 'unchanged');
        assert.equal(db.getForeshadowing('foreshadowing-b')?.notes, 'unchanged');
        assert.equal(db.getChapterProductionRun(runId)?.status, 'review_required');
      });
    }

    await t.test('Reflexion ignores an applied run whose chapter belongs to another novel', async () => {
      db.createChapterProductionRun({
        id: 'foreign-reflexion-run',
        novelId: 'novel-a',
        targetChapterId: 'chapter-b',
        status: 'applied',
        userIntent: '',
        sceneBeats: '',
        draftContent: 'foreign original',
        styleAudit: '',
        continuityReport: emptyContinuityReport(),
        createdAt: now,
        updatedAt: now + 1_000,
      });
      const originalFetch = globalThis.fetch;
      let llmCalls = 0;
      globalThis.fetch = async () => {
        llmCalls += 1;
        throw new Error('foreign chapter must not reach the model');
      };
      try {
        __productionTestHooks.resetReflexionKeys();
        await __productionTestHooks.runEvolutionReflexion(...reflexionArgs('novel-a', 'chapter-a'));
        assert.equal(llmCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
        getDb().prepare('DELETE FROM chapter_production_runs WHERE id = ?').run('foreign-reflexion-run');
      }
    });

    await t.test('Reflexion merges only notes into the latest profile and is idempotent by content', async () => {
      const appliedRunId = 'applied-reflexion-run';
      db.createChapterProductionRun({
        id: appliedRunId,
        novelId: 'novel-a',
        targetChapterId: 'chapter-a',
        status: 'applied',
        userIntent: '',
        sceneBeats: '',
        draftContent: 'AI original',
        styleAudit: '',
        continuityReport: emptyContinuityReport(),
        createdAt: now,
        updatedAt: now + 100,
      });
      db.updateChapter('chapter-a', { content: 'User final content' });

      const config = getConfig();
      const originalConfig = { ...config };
      Object.assign(config, {
        apiKey: 'test-key',
        baseUrl: 'https://reflexion-plan129.test/v1',
        model: 'test-model',
        promptGuardLevel: 'disabled',
      });
      const originalFetch = globalThis.fetch;
      let releaseResponse!: () => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const waitForRelease = new Promise<void>((resolve) => { releaseResponse = resolve; });
      let llmCalls = 0;
      globalThis.fetch = async () => {
        llmCalls += 1;
        markStarted();
        await waitForRelease;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ rules: ['new reflexion rule'] }) } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      };

      try {
        __productionTestHooks.resetReflexionKeys();
        const reflexion = __productionTestHooks.runEvolutionReflexion(...reflexionArgs('novel-a', 'chapter-a'));
        await started;
        const latestProfile = {
          ...emptyProfile,
          tags: ['changed-during-model-call'],
          weights: { ...emptyProfile.weights, styleWeight: 0.25 },
          notes: ['user-note'],
          quotaLimits: { generateProseMax: 100, generateProseCount: 37 },
        };
        db.updateNovel('novel-a', { projectPreferenceProfile: latestProfile });
        releaseResponse();
        await reflexion;

        const persisted = db.getNovel('novel-a')?.projectPreferenceProfile;
        assert.deepEqual(persisted?.tags, ['changed-during-model-call']);
        assert.equal(persisted?.weights.styleWeight, 0.25);
        assert.equal(persisted?.quotaLimits?.generateProseCount, 37);
        assert.deepEqual(persisted?.notes, ['user-note', 'new reflexion rule']);

        await __productionTestHooks.runEvolutionReflexion(...reflexionArgs('novel-a', 'chapter-a'));
        assert.equal(llmCalls, 1, 'the same chapter content must not be analyzed twice in one process');
      } finally {
        globalThis.fetch = originalFetch;
        Object.assign(config, originalConfig);
      }
    });

    await t.test('serializes post-reservation validation and run creation against database import', async () => {
      const ownedPack = db.getContinuationPack('pack-a');
      assert.ok(ownedPack);
      db.closeDb();
      const originalDatabaseBuffer = fs.readFileSync(databasePath);
      const replacementPath = path.join(testDir, 'production-replacement.db');
      db.initDb(replacementPath);
      db.createNovel({
        id: 'novel-a',
        title: 'replacement',
        authorId: 'local-user',
        summary: '',
        status: 'ongoing',
        projectPreferenceProfile: emptyProfile,
        createdAt: now,
        updatedAt: now,
      });
      db.createChapter({
        id: 'chapter-a',
        novelId: 'novel-a',
        title: 'replacement chapter',
        content: 'replacement content',
        order: 1,
        wordCount: 10,
        createdAt: now,
        updatedAt: now,
      });
      db.createContinuationPack({
        ...ownedPack,
        title: 'replacement pack that must never enter old request context',
      });
      db.closeDb();
      const replacementDatabaseBuffer = fs.readFileSync(replacementPath);
      db.initDb(databasePath);

      const requestAcrossImport = async (endpoint: 'start' | 'start-stream') => {
        __rateLimitTestHooks.reset();
        let releaseWrite!: () => void;
        let markWriteStarted!: () => void;
        const writeStarted = new Promise<void>((resolve) => { markWriteStarted = resolve; });
        const holdWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
        const blocker = runInSerializedWrite(async () => {
          markWriteStarted();
          await holdWrite;
        });
        await writeStarted;

        const responsePromise = fetch(`${baseUrl}/api/chapter-production-runs/${endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            novelId: 'novel-a',
            chapterId: 'chapter-a',
            databaseGeneration: getDatabaseGeneration(),
            targetChapterId: 'chapter-a',
            continuationPackId: 'pack-a',
            writingStyleFingerprint: packAFingerprint,
            userIntent: 'continue',
          }),
        });
        await new Promise((resolve) => setTimeout(resolve, 25));
        const importPromise = importDatabaseBuffer(replacementDatabaseBuffer);
        releaseWrite();
        await blocker;

        const response = await responsePromise;
        await importPromise;
        assert.equal(response.status, 409);
        assert.equal(db.listChapterProductionRuns('novel-a').length, 0);
      };

      await requestAcrossImport('start');
      await importDatabaseBuffer(originalDatabaseBuffer);
      assert.equal(db.listChapterProductionRuns('novel-a').some((run) => run.userIntent === 'continue'), false);

      await requestAcrossImport('start-stream');
      await importDatabaseBuffer(originalDatabaseBuffer);
      assert.equal(db.listChapterProductionRuns('novel-a').some((run) => run.userIntent === 'continue'), false);
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
