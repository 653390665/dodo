/**
 * SourceBadge — per LLM Output Fallback and Replacement skill spec:
 *   model   → green/blue badge "AI"
 *   fallback → amber/yellow badge "保底"
 *   cached  → grey badge "缓存"
 */
export type ContentSource = 'model' | 'fallback' | 'cached';

interface SourceBadgeProps {
  source: ContentSource;
  className?: string;
}

const SOURCE_CONFIG: Record<ContentSource, { label: string; className: string }> = {
  model:   { label: 'AI',   className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  fallback:{ label: '保底', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  cached:  { label: '缓存', className: 'border-slate-200 bg-slate-50 text-slate-500' },
};

export function SourceBadge({ source, className = '' }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${config.className} ${className}`}
      title={source === 'model' ? 'AI 模型生成' : source === 'fallback' ? '本地规则保底' : '缓存复用'}
    >
      {config.label}
    </span>
  );
}
