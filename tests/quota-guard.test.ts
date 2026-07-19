import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { closeDb, initDb, createNovel, getNovel, updateNovel } from '../server/lib/db';
import {
  __quotaTestHooks,
  checkAndConsumeQuota,
  refundQuota,
  reserveQuota,
} from '../server/helpers/quota-guard';
import type { Novel, ProjectPreferenceProfile } from '../shared/types';

function makeBaseNovel(quotaLimits?: Record<string, number>, commercialMode?: string): Novel {
  const now = Date.now();
  const profile: ProjectPreferenceProfile = {
    tags: [],
    weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    ...(commercialMode ? { commercialMode: commercialMode as 'free' | 'paid' | 'strict' } : {}),
    ...(quotaLimits
      ? {
          quotaLimits: {
            extractSkillMax: quotaLimits.extractSkillMax,
            extractSkillCount: quotaLimits.extractSkillCount,
            generateProseMax: quotaLimits.generateProseMax,
            generateProseCount: quotaLimits.generateProseCount,
            advancedAuditMax: quotaLimits.advancedAuditMax,
            advancedAuditCount: quotaLimits.advancedAuditCount,
          },
        }
      : {}),
  };
  return {
    id: `novel-quota-${Date.now()}`,
    title: 'Quota Guard Test',
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

describe("quota-guard checkAndConsumeQuota", () => {
  let dbPath: string;

  test.beforeEach(() => {
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-quota-test-${Date.now()}.db`);
    initDb(dbPath);
  });

  test.afterEach(() => {
    closeDb();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
  });

  test('undefined novelId is rejected instead of bypassing quota', async () => {
    const result = await checkAndConsumeQuota(undefined, 'generateProse');
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'NOVEL_ID_REQUIRED');
  });

  test('unknown novelId is rejected instead of bypassing quota', async () => {
    const result = await reserveQuota('does-not-exist', 'generateProse');
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'NOVEL_NOT_FOUND');
  });

  test('paid novel returns allowed and does NOT increment count', async () => {
    const novel = makeBaseNovel(undefined, 'paid');
    createNovel(novel);

    const result = await checkAndConsumeQuota(novel.id, 'generateProse');
    assert.equal(result.allowed, true);

    const after = getNovel(novel.id);
    assert.equal(after?.projectPreferenceProfile?.quotaLimits?.generateProseCount, undefined);
  });

  test('free novel with count < max returns allowed and increments count', async () => {
    const novel = makeBaseNovel({ generateProseCount: 2, generateProseMax: 10 });
    createNovel(novel);

    const result = await checkAndConsumeQuota(novel.id, 'generateProse');
    assert.equal(result.allowed, true);
    assert.equal(result.count, 3);

    const after = getNovel(novel.id);
    assert.equal(after?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 3);
  });

  test('free novel with count >= max returns not allowed and does NOT increment', async () => {
    const novel = makeBaseNovel({ generateProseCount: 10, generateProseMax: 10 });
    createNovel(novel);

    const result = await checkAndConsumeQuota(novel.id, 'generateProse');
    assert.equal(result.allowed, false);
    assert.ok(result.error, 'should have an error message');

    const after = getNovel(novel.id);
    assert.equal(after?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 10);
  });

  test('refundQuota is idempotent for the reservation without a caller-side flag', async () => {
    const novel = makeBaseNovel({ advancedAuditCount: 0, advancedAuditMax: 5 });
    createNovel(novel);

    const reserve = await reserveQuota(novel.id, 'advancedAudit');
    assert.ok(reserve.reservationId);
    assert.equal(await refundQuota(reserve.reservationId), true);
    assert.equal(await refundQuota(reserve.reservationId), false);

    const after = getNovel(novel.id);
    assert.equal(after?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount, 0);
  });

  test('concurrent reserve attempts cannot exceed max quota', async () => {
    const novel = makeBaseNovel({ generateProseCount: 9, generateProseMax: 10 });
    createNovel(novel);

    const results = await Promise.all([
      reserveQuota(novel.id, 'generateProse'),
      reserveQuota(novel.id, 'generateProse'),
    ]);

    const allowedCount = results.filter((r) => r.allowed).length;
    assert.equal(allowedCount, 1);

    const after = getNovel(novel.id);
    assert.equal(after?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 10);
  });

  test('failed delivery refunds reserved quota', async () => {
    const novel = makeBaseNovel({ advancedAuditCount: 0, advancedAuditMax: 5 });
    createNovel(novel);

    const reserve = await reserveQuota(novel.id, 'advancedAudit');
    assert.equal(reserve.allowed, true);

    await refundQuota(reserve.reservationId);

    const after = getNovel(novel.id);
    assert.equal(after?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount, 0);
  });

  test('expired active reservations are refunded before ledger pruning', async () => {
    const novel = makeBaseNovel({ advancedAuditCount: 0, advancedAuditMax: 5 });
    createNovel(novel);
    const reserve = await reserveQuota(novel.id, 'advancedAudit');
    assert.ok(reserve.reservationId);
    const ledgerEntry = __quotaTestHooks.quotaReservations.get(reserve.reservationId);
    assert.ok(ledgerEntry);
    ledgerEntry.createdAt = 0;

    await __quotaTestHooks.pruneReservations();

    assert.equal(__quotaTestHooks.quotaReservations.has(reserve.reservationId), false);
    assert.equal(
      getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount,
      0,
    );
  });
});
