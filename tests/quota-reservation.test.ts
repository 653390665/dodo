import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  reserveQuota,
  refundQuota,
  commitQuotaReservation,
  __quotaTestHooks,
} from '../server/helpers/quota-guard.js';
import type { Novel, ProjectPreferenceProfile } from '../shared/types';

function makeNovel(id: string, count: number, max: number): Novel {
  const now = Date.now();
  const profile: ProjectPreferenceProfile = {
    tags: [],
    weights: { styleWeight: 0.5, characterWeight: 0.5, worldWeight: 0.5, plotWeight: 0.5, pacingWeight: 0.5 },
    acceptedDimensions: [],
    rejectedDimensions: [],
    notes: [],
    evidenceCount: 0,
    commercialMode: 'free',
    quotaLimits: {
      generateProseCount: count,
      generateProseMax: max,
    },
  };
  return {
    id,
    title: 'Quota Reservation Test',
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

describe('quota reservation ledger', () => {
  let dbPath: string;

  test.beforeEach(() => {
    closeDb();
    dbPath = path.join(os.tmpdir(), `inkflow-qres-${Date.now()}.db`);
    initDb(dbPath);
    __quotaTestHooks.quotaReservations.clear();
  });

  test.afterEach(() => {
    closeDb();
    try { fs.rmSync(dbPath, { force: true }); } catch { /* ignore */ }
  });

  test('refundQuota is idempotent for the same reservationId', async () => {
    const novel = makeNovel('novel-refund-idempotent', 0, 10);
    createNovel(novel);

    const reserve = await reserveQuota(novel.id, 'generateProse');
    assert.ok(reserve.reservationId);

    const first = await refundQuota(reserve.reservationId);
    const second = await refundQuota(reserve.reservationId);
    assert.equal(first, true);
    assert.equal(second, false);

    const after = getNovel(novel.id);
    assert.equal(after?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 0);
  });

  test('commit prevents later refund', async () => {
    const novel = makeNovel('novel-commit', 0, 10);
    createNovel(novel);

    const reserve = await reserveQuota(novel.id, 'generateProse');
    commitQuotaReservation(reserve.reservationId);
    const refunded = await refundQuota(reserve.reservationId);

    assert.equal(refunded, false);
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 1);
  });

  test('concurrent refund attempts only decrement once', async () => {
    const novel = makeNovel('novel-concurrent-refund', 0, 10);
    createNovel(novel);

    const reserve = await reserveQuota(novel.id, 'generateProse');
    const results = await Promise.all([
      refundQuota(reserve.reservationId),
      refundQuota(reserve.reservationId),
    ]);

    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(getNovel(novel.id)?.projectPreferenceProfile?.quotaLimits?.generateProseCount, 0);
  });
});

import { buildFallbackDraft } from '../server/helpers/fallback-draft.js';

describe('orchestrate fallback delivery semantics', () => {
  test('fallback draft is non-empty deliverable content', () => {
    const draft = buildFallbackDraft('主角进入剑冢', '上下文');
    assert.ok(draft.trim().length > 0);
  });
});
