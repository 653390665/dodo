import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkflow-quota-generation-'));
const activeDbPath = path.join(testDir, 'active.test.db');
const candidateDbPath = path.join(testDir, 'candidate.test.db');
process.env.INKFLOW_DB_PATH = activeDbPath;

test('reserveQuota does not consume quota after a queued database replacement', async () => {
  const { closeDb, createNovel, getNovel, initDb } = await import('../server/lib/db');
  const { runInSerializedWrite } = await import('../server/lib/db-instance');
  const { importDatabaseBuffer } = await import('../server/routes/db');
  const { __quotaTestHooks, reserveQuota } = await import('../server/helpers/quota-guard');
  const novelId = 'quota-generation-novel';

  const createQuotaNovel = () => {
    const now = Date.now();
    createNovel({
      id: novelId,
      title: 'Quota Generation Test',
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
        quotaLimits: { generateProseCount: 0, generateProseMax: 10 },
      },
      createdAt: now,
      updatedAt: now,
    });
  };

  try {
    initDb(candidateDbPath);
    createQuotaNovel();
    closeDb();
    const candidateBuffer = fs.readFileSync(candidateDbPath);

    initDb(activeDbPath);
    createQuotaNovel();

    let releaseWrite!: () => void;
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeCanFinish = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const blockingWrite = runInSerializedWrite(async () => {
      markWriteStarted();
      await writeCanFinish;
    });
    await writeStarted;

    const importPromise = importDatabaseBuffer(candidateBuffer);
    const reservePromise = reserveQuota(novelId, 'generateProse');
    releaseWrite();

    await blockingWrite;
    await importPromise;
    const reservation = await reservePromise;

    assert.equal(reservation.allowed, false);
    assert.match(reservation.error ?? '', /数据库已切换/);
    assert.equal(
      getNovel(novelId)?.projectPreferenceProfile?.quotaLimits?.generateProseCount,
      0,
      'a reservation queued against the old database must not consume quota in the imported database',
    );
  } finally {
    __quotaTestHooks.quotaReservations.clear();
    closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
