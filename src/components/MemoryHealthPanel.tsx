/**
 * 批次 D · 记忆健康度看板（2026-09-27）：驾驶舱只读面板。
 *
 * 只渲染服务端 `/api/novels/:novelId/memory-health` 返回的四项指标（口径在
 * `shared/lib/memory-health.ts`，与后端同源）；本地不做任何再计算。
 *
 * 诚实性（沿用 llm-status-honesty 口径）：
 * - 指标为 null → 显示「未知」（琥珀降级），不显示 0；
 * - 读取失败 → 保留上一次成功值并给出可读错误；从未成功过则四项均显示「未知」。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { fetchMemoryHealth } from '../lib/knowledge-client';
import {
  memoryHealthUnknownMetrics,
  memoryHealthValueLabel,
  MEMORY_HEALTH_UNKNOWN_TEXT,
  type MemoryHealthMetric,
} from '../../shared/lib/memory-health';

const UNKNOWN_VALUE_CLASS = 'text-amber-800';
const KNOWN_VALUE_CLASS = 'text-theme-text';

export function MemoryHealthPanel({ novelId }: { novelId: string }) {
  const [metrics, setMetrics] = useState<MemoryHealthMetric[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      try {
        const snapshot = await fetchMemoryHealth(novelId, signal);
        if (signal.aborted) return;
        setMetrics(snapshot.metrics);
        setError(null);
      } catch (reason) {
        if (signal.aborted || (reason instanceof Error && reason.name === 'AbortError')) return;
        setError(reason instanceof Error ? reason.message : '记忆健康度读取失败，请稍后重试。');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [novelId]
  );

  useEffect(() => {
    const controller = new AbortController();
    /* eslint-disable react-hooks/set-state-in-effect -- data fetching on mount */
    void load(controller.signal);
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => controller.abort();
  }, [load, refreshToken]);

  const displayMetrics = metrics ?? memoryHealthUnknownMetrics('数据未能读取：请刷新重试');

  return (
    <section
      data-testid="memory-health-panel"
      className="border border-theme-border/40 bg-theme-sidebar/10 rounded-xl p-4 space-y-2.5"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-theme-text uppercase tracking-wider font-mono flex items-center gap-1">
          <Activity size={12} className="text-theme-accent" />
          记忆健康度
        </span>
        <span className="text-[10px] font-mono text-theme-muted">只读摘要</span>
      </div>
      <p className="text-[10px] text-theme-muted leading-relaxed">
        口径与后端同一实现；数据缺失显示「{MEMORY_HEALTH_UNKNOWN_TEXT}」，不按 0 计。
      </p>

      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        {displayMetrics.map((metric) => (
          <div key={metric.key} data-testid={`memory-health-metric-${metric.key}`}>
            <span className="block text-[10px] text-theme-muted">{metric.label}</span>
            <span
              className={`font-bold ${metric.value === null ? UNKNOWN_VALUE_CLASS : KNOWN_VALUE_CLASS}`}
            >
              {memoryHealthValueLabel(metric)}
            </span>
            {metric.detail ? (
              <span className="block text-[10px] text-theme-muted">{metric.detail}</span>
            ) : null}
            {metric.unknownReason ? (
              <span className="block text-[10px] text-theme-muted">{metric.unknownReason}</span>
            ) : null}
          </div>
        ))}
      </div>

      {loading ? <p className="text-[10px] text-theme-muted">正在读取…</p> : null}
      {error ? (
        <p role="alert" className="text-[10px] leading-relaxed text-amber-800">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          className="text-[10px] font-mono text-theme-muted hover:text-theme-text underline underline-offset-2"
        >
          刷新
        </button>
      </div>
    </section>
  );
}
