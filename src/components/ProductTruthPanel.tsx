/**
 * Plan 271 W2 · 产品真值面板（驾驶舱只读）：首章完成率 / 模型稿占比 / run 采纳率与裁决耗时。
 *
 * 诚实性：rate 为 null 或耗时未知时显示「未知」（琥珀降级），不按 0 计；
 * 读取失败保留上一次成功值并给出可读错误，从未成功则全部显示「未知」。
 * 口径全部来自服务端 `/api/product-truth/metrics`，前端不再计算。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { fetchProductTruthMetrics } from '../lib/product-truth-client';
import type { ProductTruthMetrics, ProductTruthSnapshot } from '../../shared/types/product-truth';

const UNKNOWN_TEXT = '未知';
const UNKNOWN_VALUE_CLASS = 'text-amber-800';
const KNOWN_VALUE_CLASS = 'text-theme-text';

function percentLabel(metric: { value: number | null; numerator: number; denominator: number }): string {
  if (metric.value === null) return UNKNOWN_TEXT;
  return `${Math.round(metric.value * 100)}%（${metric.numerator}/${metric.denominator}）`;
}

function durationLabel(ms: number | null): string {
  if (ms === null) return UNKNOWN_TEXT;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

const ROWS: Array<{
  key: string;
  label: string;
  hint: string;
  read: (metrics: ProductTruthMetrics) => { value: string; known: boolean; detail: string };
}> = [
  {
    key: 'first-chapter',
    label: '首章完成率',
    hint: '写作过至少一章的作品里，有章节到达成章门 ready 的占比',
    read: (metrics) => ({
      value: percentLabel(metrics.firstChapter.rate),
      known: metrics.firstChapter.rate.value !== null,
      detail: `完成 ${metrics.firstChapter.completedNovels} / 有章节 ${metrics.firstChapter.totalNovels}`,
    }),
  },
  {
    key: 'delivery',
    label: '模型稿占比',
    hint: 'run 版本行的来源分布（fallback = 保底稿）',
    read: (metrics) => ({
      value: percentLabel(metrics.delivery.versionModelShare),
      known: metrics.delivery.versionModelShare.value !== null,
      detail: `model ${metrics.delivery.modelVersions} / fallback ${metrics.delivery.fallbackVersions}`,
    }),
  },
  {
    key: 'adoption',
    label: 'run 采纳率',
    hint: '终态 applied 的 run 占比（review_required = 作者还没裁决）',
    read: (metrics) => ({
      value: percentLabel(metrics.decision.adoptionRate),
      known: metrics.decision.adoptionRate.value !== null,
      detail: `applied ${metrics.decision.applied} / run ${metrics.decision.runs}`,
    }),
  },
  {
    key: 'latency',
    label: '裁决耗时中位数',
    hint: 'run 创建→最后更新的中位数（含等待作者的时间）',
    read: (metrics) => ({
      value: durationLabel(metrics.decision.medianDecisionMs),
      known: metrics.decision.medianDecisionMs !== null,
      detail: metrics.decision.byStatus.length
        ? metrics.decision.byStatus.map((row) => `${row.status} ${row.count}`).join(' · ')
        : '无 run',
    }),
  },
];

export function ProductTruthPanel({ novelId, days = 30 }: { novelId: string; days?: number }) {
  const [snapshot, setSnapshot] = useState<ProductTruthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      try {
        const next = await fetchProductTruthMetrics(novelId, days, signal);
        if (signal.aborted) return;
        setSnapshot(next);
        setError(null);
      } catch (reason) {
        if (signal.aborted || (reason instanceof Error && reason.name === 'AbortError')) return;
        setError(reason instanceof Error ? reason.message : '产品真值读数失败，请稍后重试。');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [days, novelId]
  );

  useEffect(() => {
    const controller = new AbortController();
    /* eslint-disable react-hooks/set-state-in-effect -- data fetching on mount */
    void load(controller.signal);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => controller.abort();
  }, [load, refreshToken]);

  const columns: Array<{ key: string; label: string; metrics: ProductTruthMetrics | null }> = [
    { key: 'novel', label: '本书', metrics: snapshot?.novel ?? null },
    { key: 'global', label: '全局', metrics: snapshot?.global ?? null },
  ];

  return (
    <section
      data-testid="product-truth-panel"
      className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
          <Gauge size={12} className="text-theme-accent" />
          产品真值
        </span>
        <button
          type="button"
          data-testid="product-truth-refresh"
          className="text-[10px] font-mono text-theme-muted hover:text-theme-text"
          onClick={() => setRefreshToken((token) => token + 1)}
        >
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>
      <p className="text-[10px] text-theme-muted leading-relaxed">
        直接读库口径（章节成章门 / run 版本行 / run 终态），不依赖埋点；缺失显示「{UNKNOWN_TEXT}」，不按 0 计。
      </p>
      {error ? (
        <p data-testid="product-truth-error" className="text-[10px] text-amber-800">
          {error}
        </p>
      ) : null}
      <div className="space-y-2">
        {ROWS.map((row) => (
          <div key={row.key} data-testid={`product-truth-row-${row.key}`} className="text-xs font-mono">
            <span className="block text-[10px] text-theme-muted">{row.label}</span>
            <div className="grid grid-cols-2 gap-3">
              {columns.map((column) => {
                const reading = column.metrics
                  ? row.read(column.metrics)
                  : { value: UNKNOWN_TEXT, known: false, detail: column.label };
                return (
                  <div key={column.key} data-testid={`product-truth-${row.key}-${column.key}`}>
                    <span className="block text-[10px] text-theme-muted">{column.label}</span>
                    <span className={reading.known ? KNOWN_VALUE_CLASS : UNKNOWN_VALUE_CLASS}>
                      {reading.value}
                    </span>
                    <span className="block text-[10px] text-theme-muted">{reading.detail}</span>
                  </div>
                );
              })}
            </div>
            <span className="block text-[10px] text-theme-muted">{row.hint}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
