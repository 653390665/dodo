/**
 * Plan 271 W2 · 产品真值读数（DB 口径，不依赖埋点）。
 *
 * 三个北极星读数：
 * ① 首章完成率：写过至少一章的作品里，有章节到达 `completionGate=ready` 的占比；
 * ② 交付稿真值：`chapter_production_run_versions.source` 的 model / fallback 分布；
 * ③ 裁决真值：`chapter_production_runs.status` 终态分布、采纳率与 run 耗时中位数。
 *
 * 埋点（product_events）回答「用户做了什么」，这里回答「库里真的产出了什么」，
 * 两者互为交叉验证（PM 诊断：模板稿占比与裁决质量此前没有真值口径）。
 */
import type { RateMetric } from '../../../shared/types/product-events.js';
import type { ProductTruthMetrics } from '../../../shared/types/product-truth.js';
import { getDb } from '../db-instance.js';

export type { ProductTruthMetrics };

function rate(numerator: number, denominator: number): RateMetric {
  return { value: denominator ? Math.min(1, numerator / denominator) : null, numerator, denominator };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function getProductTruthMetrics(
  options: { novelId?: string; days?: number } = {}
): ProductTruthMetrics {
  const days = Math.max(1, Math.min(365, Math.floor(options.days ?? 30)));
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const novelId = options.novelId ?? null;
  const db = getDb();

  const scoped = (sql: string) => (novelId ? `${sql} AND novel_id = ?` : sql);
  const args = (base: Array<string | number>) => (novelId ? [...base, novelId] : base);

  const countNovels = (where: string) =>
    (
      db
        .prepare(scoped(`SELECT COUNT(DISTINCT novel_id) AS n FROM chapters WHERE ${where}`))
        .get(...args([])) as { n: number }
    ).n;

  // ① 首章完成率
  const totalNovels = countNovels('1=1');
  const completedNovels = countNovels("json_extract(workflow_meta, '$.completionGate') = 'ready'");

  // ② 交付稿真值（run 版本行来源）
  const versionRows = db
    .prepare(
      scoped('SELECT run_id AS runId, source AS source FROM chapter_production_run_versions WHERE created_at >= ?')
    )
    .all(...args([since])) as Array<{ runId: string; source: string }>;
  const modelVersions = versionRows.filter((row) => row.source === 'model').length;
  const fallbackVersions = versionRows.filter((row) => row.source === 'fallback').length;
  const runIds = new Set(versionRows.map((row) => row.runId));
  const runsWithModelVersion = new Set(
    versionRows.filter((row) => row.source === 'model').map((row) => row.runId)
  ).size;

  // ③ 裁决真值（run 终态与耗时）
  const runRows = db
    .prepare(
      scoped('SELECT status AS status, created_at AS createdAt, updated_at AS updatedAt FROM chapter_production_runs WHERE created_at >= ?')
    )
    .all(...args([since])) as Array<{ status: string; createdAt: number; updatedAt: number }>;
  const statusCounts = new Map<string, number>();
  for (const row of runRows) statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
  const applied = statusCounts.get('applied') ?? 0;
  const durations = runRows
    .filter((row) => typeof row.createdAt === 'number' && typeof row.updatedAt === 'number')
    .map((row) => Math.max(0, row.updatedAt - row.createdAt));

  return {
    rangeDays: days,
    generatedAt: Date.now(),
    novelId,
    firstChapter: {
      totalNovels,
      completedNovels,
      rate: rate(completedNovels, totalNovels),
    },
    delivery: {
      versions: versionRows.length,
      modelVersions,
      fallbackVersions,
      versionModelShare: rate(modelVersions, versionRows.length),
      runs: runIds.size,
      runsWithModelVersion,
      runModelShare: rate(runsWithModelVersion, runIds.size),
    },
    decision: {
      runs: runRows.length,
      byStatus: [...statusCounts.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      applied,
      adoptionRate: rate(applied, runRows.length),
      medianDecisionMs: median(durations),
    },
  };
}
