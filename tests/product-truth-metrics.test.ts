/**
 * Plan 271 W2 · 产品真值读数（DB 口径）单元测试。
 *
 * 覆盖：
 * ① 首章完成率（作品口径：有章节 vs 有 completionGate=ready 章节）；
 * ② 交付稿真值（run 版本行 source 分布 + 有 model 版本行的 run 占比）；
 * ③ 裁决真值（run 终态分布、采纳率、run 耗时中位数）；
 * ④ `novelId` 范围收敛与空库（rate 为 null）。
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { Chapter, Novel } from '../shared/types';
import { closeDb, createChapter, createNovel, initDb } from '../server/lib/db';
import { getDb } from '../server/lib/db-instance';
import { getProductTruthMetrics } from '../server/lib/db/product-truth';

const novel = (id: string): Novel => ({
  id,
  title: id,
  authorId: 'local',
  summary: '',
  status: 'ongoing',
  createdAt: 1,
  updatedAt: 1,
});

const chapter = (id: string, novelId: string): Chapter => ({
  id,
  novelId,
  title: id,
  content: '',
  order: 0,
  wordCount: 0,
  createdAt: 1,
  updatedAt: 1,
});

function seedRun(
  id: string,
  novelId: string,
  status: string,
  createdAt: number,
  updatedAt: number
): void {
  getDb()
    .prepare(
      'INSERT INTO chapter_production_runs (id, novel_id, target_chapter_id, status, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)'
    )
    .run(id, novelId, status, createdAt, updatedAt);
}

function seedVersion(id: string, runId: string, novelId: string, source: string, createdAt: number): void {
  getDb()
    .prepare(
      'INSERT INTO chapter_production_run_versions (id, run_id, novel_id, target_chapter_id, source, content_hash, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)'
    )
    .run(id, runId, novelId, source, `hash-${id}`, createdAt);
}

function markCompletionGate(chapterId: string): void {
  getDb()
    .prepare('UPDATE chapters SET workflow_meta = ? WHERE id = ?')
    .run(JSON.stringify({ completionGate: 'ready' }), chapterId);
}

describe('product truth metrics', () => {
  beforeEach(() => initDb(':memory:'));
  afterEach(() => closeDb());

  test('reads first-chapter, delivery and decision truth from the database', () => {
    const now = Date.now() - 60_000;
    createNovel(novel('n1'));
    createNovel(novel('n2'));
    createChapter(chapter('c1', 'n1'));
    createChapter(chapter('c2', 'n1'));
    createChapter(chapter('c3', 'n2'));
    markCompletionGate('c1');
    seedRun('r1', 'n1', 'applied', now, now + 30_000);
    seedRun('r2', 'n1', 'review_required', now, now + 10_000);
    seedRun('r3', 'n2', 'applied', now, now + 20_000);
    seedVersion('v1', 'r1', 'n1', 'model', now);
    seedVersion('v2', 'r1', 'n1', 'fallback', now);
    seedVersion('v3', 'r2', 'n1', 'fallback', now);
    seedVersion('v4', 'r3', 'n2', 'model', now);

    const metrics = getProductTruthMetrics({ days: 30 });

    assert.equal(metrics.firstChapter.totalNovels, 2);
    assert.equal(metrics.firstChapter.completedNovels, 1);
    assert.deepEqual(metrics.firstChapter.rate, { value: 0.5, numerator: 1, denominator: 2 });

    assert.equal(metrics.delivery.versions, 4);
    assert.equal(metrics.delivery.modelVersions, 2);
    assert.equal(metrics.delivery.fallbackVersions, 2);
    assert.deepEqual(metrics.delivery.versionModelShare, {
      value: 0.5,
      numerator: 2,
      denominator: 4,
    });
    assert.equal(metrics.delivery.runs, 3);
    assert.equal(metrics.delivery.runsWithModelVersion, 2);
    assert.deepEqual(metrics.delivery.runModelShare, {
      value: 2 / 3,
      numerator: 2,
      denominator: 3,
    });

    assert.equal(metrics.decision.runs, 3);
    assert.deepEqual(metrics.decision.byStatus, [
      { status: 'applied', count: 2 },
      { status: 'review_required', count: 1 },
    ]);
    assert.equal(metrics.decision.applied, 2);
    assert.deepEqual(metrics.decision.adoptionRate, {
      value: 2 / 3,
      numerator: 2,
      denominator: 3,
    });
    assert.equal(metrics.decision.medianDecisionMs, 20_000);
  });

  test('scopes every reading to one novel when novelId is given', () => {
    const now = Date.now() - 60_000;
    createNovel(novel('n1'));
    createNovel(novel('n2'));
    createChapter(chapter('c1', 'n1'));
    createChapter(chapter('c3', 'n2'));
    markCompletionGate('c1');
    seedRun('r1', 'n1', 'applied', now, now + 30_000);
    seedRun('r2', 'n1', 'review_required', now, now + 10_000);
    seedRun('r3', 'n2', 'applied', now, now + 20_000);
    seedVersion('v1', 'r1', 'n1', 'model', now);
    seedVersion('v2', 'r1', 'n1', 'fallback', now);
    seedVersion('v3', 'r2', 'n1', 'fallback', now);
    seedVersion('v4', 'r3', 'n2', 'model', now);

    const metrics = getProductTruthMetrics({ novelId: 'n1', days: 30 });

    assert.equal(metrics.novelId, 'n1');
    assert.equal(metrics.firstChapter.totalNovels, 1);
    assert.equal(metrics.firstChapter.completedNovels, 1);
    assert.deepEqual(metrics.firstChapter.rate, { value: 1, numerator: 1, denominator: 1 });
    assert.equal(metrics.delivery.versions, 3);
    assert.equal(metrics.delivery.modelVersions, 1);
    assert.equal(metrics.delivery.runs, 2);
    assert.equal(metrics.delivery.runsWithModelVersion, 1);
    assert.equal(metrics.decision.runs, 2);
    assert.equal(metrics.decision.applied, 1);
    assert.equal(metrics.decision.medianDecisionMs, 20_000);
  });

  test('reports null rates and null latency on an empty database', () => {
    const metrics = getProductTruthMetrics({ days: 7 });

    assert.equal(metrics.rangeDays, 7);
    assert.equal(metrics.firstChapter.totalNovels, 0);
    assert.equal(metrics.firstChapter.rate.value, null);
    assert.equal(metrics.delivery.versionModelShare.value, null);
    assert.equal(metrics.delivery.runModelShare.value, null);
    assert.equal(metrics.decision.adoptionRate.value, null);
    assert.equal(metrics.decision.medianDecisionMs, null);
    assert.deepEqual(metrics.decision.byStatus, []);
  });
});
