import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { closeDb, initDb, createNovel, getNovel } from '../server/lib/db';
import {
  __quotaTestHooks,
  checkQuota,
  checkAndConsumeQuota,
  isMonetizationEnabled,
  refundQuota,
  reserveQuota,
} from '../server/helpers/quota-guard';
import type { Novel, ProjectPreferenceProfile } from '../shared/types';

let novelSequence = 0;

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
    id: `novel-quota-${++novelSequence}`,
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
  const originalMonetization = process.env.INKFLOW_ENABLE_MONETIZATION;
  const originalNodeEnv = process.env.NODE_ENV;

  test.beforeEach(() => {
    delete process.env.INKFLOW_ENABLE_MONETIZATION;
    process.env.NODE_ENV = 'test';
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-quota-test-${Date.now()}.db`);
    initDb(dbPath);
  });

  test.afterEach(() => {
    closeDb();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
    try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
    if (originalMonetization === undefined) delete process.env.INKFLOW_ENABLE_MONETIZATION;
    else process.env.INKFLOW_ENABLE_MONETIZATION = originalMonetization;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  test('undefined novelId is rejected instead of bypassing quota', async () => {
    const result = await checkAndConsumeQuota(undefined, 'generateProse');
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'NOVEL_ID_REQUIRED');
  });

  test('monetization switch defaults by environment and explicit values override it', () => {
    const originalMonetization = process.env.INKFLOW_ENABLE_MONETIZATION;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.INKFLOW_ENABLE_MONETIZATION;
      process.env.NODE_ENV = 'production';
      assert.equal(isMonetizationEnabled(), false);
      process.env.NODE_ENV = 'development';
      assert.equal(isMonetizationEnabled(), false);
      process.env.NODE_ENV = 'test';
      assert.equal(isMonetizationEnabled(), true);
      process.env.NODE_ENV = 'production';
      process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
      assert.equal(isMonetizationEnabled(), true);
      process.env.NODE_ENV = 'test';
      process.env.INKFLOW_ENABLE_MONETIZATION = 'false';
      assert.equal(isMonetizationEnabled(), false);
    } finally {
      if (originalMonetization === undefined) delete process.env.INKFLOW_ENABLE_MONETIZATION;
      else process.env.INKFLOW_ENABLE_MONETIZATION = originalMonetization;
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
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

  test('monetization disabled allows exhausted existing novels without consuming or reserving', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'false';
    const novel = makeBaseNovel({ generateProseCount: 10, generateProseMax: 10 });
    createNovel(novel);

    const directCheck = checkQuota(novel.id, 'generateProse');
    assert.equal(directCheck.allowed, true);
    const check = await checkAndConsumeQuota(novel.id, 'generateProse');
    assert.equal(check.allowed, true);
    const reservation = await reserveQuota(novel.id, 'generateProse');
    assert.equal(reservation.allowed, true);
    assert.equal(reservation.reservationId, undefined);
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 10);
  });

  test('strict mode enforces quota when monetization is enabled', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
    const novel = makeBaseNovel({ generateProseCount: 1, generateProseMax: 1 }, 'strict');
    createNovel(novel);

    const blocked = await checkAndConsumeQuota(novel.id, 'generateProse');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.code, 'QUOTA_EXCEEDED');
  });

  test('basic BYOK access bypasses exhausted generate quota without consuming or reserving', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
    const novel = makeBaseNovel({ generateProseCount: 1, generateProseMax: 1 });
    createNovel(novel);

    const checked = checkQuota(novel.id, 'generateProse', 'basic-byok');
    assert.equal(checked.allowed, true);
    const reserved = await reserveQuota(novel.id, 'generateProse', 'basic-byok');
    assert.equal(reserved.allowed, true);
    assert.equal(reserved.reservationId, undefined);
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 1);
  });

  test('enhanced workflow still blocks exhausted generate quota', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
    const novel = makeBaseNovel({ generateProseCount: 1, generateProseMax: 1 });
    createNovel(novel);

    const reserved = await reserveQuota(novel.id, 'generateProse', 'enhanced-workflow');
    assert.equal(reserved.allowed, false);
    assert.equal(reserved.code, 'QUOTA_EXCEEDED');
  });

  test('strict mode consumes quota when below the limit', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
    const novel = makeBaseNovel({ generateProseCount: 0, generateProseMax: 1 }, 'strict');
    createNovel(novel);

    const allowed = await checkAndConsumeQuota(novel.id, 'generateProse');
    assert.equal(allowed.allowed, true);
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 1);
  });

  test('strict mode remains strict after consuming quota', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
    const novel = makeBaseNovel({ generateProseCount: 0, generateProseMax: 1 }, 'strict');
    createNovel(novel);

    await checkAndConsumeQuota(novel.id, 'generateProse');
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.commercialMode, 'strict');
  });

  test('strict reservation refund preserves mode, resets count, and is idempotent', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
    const novel = makeBaseNovel({ advancedAuditCount: 0, advancedAuditMax: 1 }, 'strict');
    createNovel(novel);

    const reservation = await reserveQuota(novel.id, 'advancedAudit');
    assert.ok(reservation.reservationId);
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.commercialMode, 'strict');
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount, 1);
    assert.equal(await refundQuota(reservation.reservationId), true);
    assert.equal(await refundQuota(reservation.reservationId), false);
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.commercialMode, 'strict');
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.advancedAuditCount, 0);
  });

  test('quota exhaustion messages remain neutral about commercial upgrades', async () => {
    process.env.INKFLOW_ENABLE_MONETIZATION = 'true';
    for (const limitType of ['extractSkill', 'generateProse', 'advancedAudit'] as const) {
      const novel = makeBaseNovel({
        [`${limitType}Count`]: 1,
        [`${limitType}Max`]: 1,
      });
      createNovel(novel);
      const result = await checkAndConsumeQuota(novel.id, limitType);
      assert.equal(result.allowed, false);
      assert.doesNotMatch(result.error ?? '', /Premium|无限|会员|升舱/);
      assert.match(result.error ?? '', /联系管理员开通/);
      assert.doesNotMatch(result.error ?? '', /联系管理员启用/);
    }
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
