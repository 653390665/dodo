import React from 'react';

interface TensionPoint {
  order: number;
  title: string;
  tensionScore: number;
}

interface Props {
  chapters: TensionPoint[];
  min: number;
  max: number;
  avg: number;
  trend: 'rising' | 'falling' | 'flat';
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = 40;

export const TensionChart: React.FC<Props> = ({ chapters, min, max, avg, trend }) => {
  if (chapters.length < 2) {
    return (
      <div className="flex items-center justify-center h-48 text-theme-muted text-sm">
        需要至少 2 个已审计章节才能显示张力曲线
      </div>
    );
  }

  const plotWidth = WIDTH - PADDING * 2;
  const plotHeight = HEIGHT - PADDING * 2;
  const range = max - min || 1;

  const points = chapters.map((c, i) => ({
    x: PADDING + (i / Math.max(chapters.length - 1, 1)) * plotWidth,
    y: PADDING + plotHeight - ((c.tensionScore - min) / range) * plotHeight,
    ...c,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const colorForScore = (s: number) => (s >= 7 ? '#22c55e' : s >= 4 ? '#eab308' : '#ef4444');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 text-sm">
        <span className="text-theme-muted">
          平均 <strong className="text-theme-text">{avg.toFixed(1)}</strong> / 10
        </span>
        <span className="text-theme-muted">
          趋势{' '}
          <strong
            className={
              trend === 'rising'
                ? 'text-emerald-400'
                : trend === 'falling'
                  ? 'text-red-400'
                  : 'text-theme-muted'
            }
          >
            {trend === 'rising' ? '↑ 上升' : trend === 'falling' ? '↓ 下行' : '→ 平稳'}
          </strong>
        </span>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto rounded-lg bg-theme-bg/50">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = PADDING + plotHeight * (1 - frac);
          return (
            <g key={frac}>
              <line x1={PADDING} y1={y} x2={WIDTH - PADDING} y2={y} stroke="var(--theme-border, #334155)" strokeWidth="0.5" />
              <text x={PADDING - 8} y={y + 4} textAnchor="end" className="text-[10px]" fill="var(--theme-muted, #94a3b8)">
                {Math.round(min + frac * range)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path
          d={`${pathD} L ${points[points.length - 1].x.toFixed(1)} ${PADDING + plotHeight} L ${points[0].x.toFixed(1)} ${PADDING + plotHeight} Z`}
          fill="url(#tensionGradient)"
          opacity="0.15"
        />

        {/* Line */}
        <path d={pathD} fill="none" stroke="var(--theme-accent, #6366f1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={p.tensionScore < 4 ? 5 : 3} fill={colorForScore(p.tensionScore)} stroke="var(--theme-bg, #0f172a)" strokeWidth="1.5" />
            <title>{`第${p.order}章 ${p.title}: ${p.tensionScore}/10`}</title>
          </g>
        ))}

        <defs>
          <linearGradient id="tensionGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--theme-accent, #6366f1)" />
            <stop offset="100%" stopColor="var(--theme-accent, #6366f1)" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {trend === 'falling' && chapters[chapters.length - 1].tensionScore < 5 && (
        <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
          ⚠️ 张力下行 — 最近章节评分 {chapters[chapters.length - 1].tensionScore}/10，建议检查节奏
        </div>
      )}
    </div>
  );
};
