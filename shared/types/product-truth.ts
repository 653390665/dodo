/**
 * Plan 271 W2 · 产品真值读数的共享类型（服务端计算 / 前端渲染同源）。
 *
 * 三个北极星读数：首章完成率、交付稿模型占比、run 采纳率与裁决耗时中位数。
 * 口径实现：`server/lib/db/product-truth.ts`。
 */
import type { RateMetric } from './product-events.js';

export interface ProductTruthMetrics {
  rangeDays: number;
  generatedAt: number;
  novelId: string | null;
  firstChapter: {
    totalNovels: number;
    completedNovels: number;
    rate: RateMetric;
  };
  delivery: {
    versions: number;
    modelVersions: number;
    fallbackVersions: number;
    versionModelShare: RateMetric;
    runs: number;
    runsWithModelVersion: number;
    runModelShare: RateMetric;
  };
  decision: {
    runs: number;
    byStatus: Array<{ status: string; count: number }>;
    applied: number;
    adoptionRate: RateMetric;
    medianDecisionMs: number | null;
  };
}

export interface ProductTruthSnapshot {
  global: ProductTruthMetrics;
  /** 带 `novelId` 请求时才有值（本书范围）。 */
  novel: ProductTruthMetrics | null;
}
