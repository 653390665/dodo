import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { useProductionStore } from '../stores/production-store';

type SegmentTone = 'done' | 'active' | 'pending' | 'warn' | 'failed';

interface Segment {
  key: string;
  label: string;
  tone: SegmentTone;
  detail: string;
}

const toneStyles: Record<SegmentTone, string> = {
  done: 'text-emerald-600 border-emerald-500/30 bg-emerald-500/5',
  active: 'text-theme-accent border-theme-accent/40 bg-theme-accent/5',
  pending: 'text-theme-muted border-theme-border/50 bg-theme-bg/40',
  warn: 'text-amber-600 border-amber-500/30 bg-amber-500/5',
  failed: 'text-red-600 border-red-500/30 bg-red-500/5',
};

function toneIcon(tone: SegmentTone) {
  if (tone === 'done') return <CheckCircle2 size={12} />;
  if (tone === 'active') return <Loader2 size={12} className="animate-spin" />;
  if (tone === 'failed') return <XCircle size={12} />;
  return <CircleDashed size={12} />;
}

function sourceSegment(key: string, label: string, source: 'fallback' | 'model' | null, running: boolean): Segment {
  if (source === 'model') return { key, label, tone: 'done', detail: '完成' };
  if (source === 'fallback') return { key, label, tone: 'warn', detail: '降级' };
  if (running) return { key, label, tone: 'active', detail: '进行中' };
  return { key, label, tone: 'pending', detail: '未生成' };
}

/**
 * 006：统一状态条——分镜 → 正文 → 审稿 → 待写入。
 * 完整生产从 production-store 推导四段；快速模式（无 run 记录）由
 * 候选/写入状态覆盖后两段。两种模式共用同一组件、同一套说法。
 */
export function GenerationStatusBar({ mode = 'full', quickDraftReady = false, quickWritten = false }: {
  mode?: 'full' | 'quick';
  /** 快速模式：草稿候选已就绪（覆盖②④段推导）。 */
  quickDraftReady?: boolean;
  /** 快速模式：正文已接受写入。 */
  quickWritten?: boolean;
}) {
  const isProductionRunning = useProductionStore((state) => state.isProductionRunning);
  const isApplyingProductionRun = useProductionStore((state) => state.isApplyingProductionRun);
  const productionError = useProductionStore((state) => state.productionError);
  const beatsSource = useProductionStore((state) => state.productionBeatsSource);
  const draftSource = useProductionStore((state) => state.productionDraftSource);
  const auditSource = useProductionStore((state) => state.productionAuditSource);
  const activeRun = useProductionStore((state) => state.activeProductionRun);

  const segments: Segment[] = [];
  if (mode === 'full') {
    segments.push(sourceSegment('beats', '① 分镜', beatsSource, isProductionRunning));
    segments.push(sourceSegment('draft', '② 正文', draftSource, isProductionRunning));
    if (productionError && isProductionRunning) {
      segments.push({ key: 'audit', label: '③ 审稿', tone: 'failed', detail: '未通过' });
    } else if (auditSource === 'model') {
      segments.push({ key: 'audit', label: '③ 审稿', tone: 'done', detail: '完成' });
    } else if (auditSource === 'fallback') {
      segments.push({ key: 'audit', label: '③ 审稿', tone: 'warn', detail: '降级' });
    } else {
      segments.push({ key: 'audit', label: '③ 审稿', tone: 'pending', detail: '未运行' });
    }
    if (isApplyingProductionRun) {
      segments.push({ key: 'write', label: '④ 写入', tone: 'active', detail: '写入中' });
    } else if (activeRun?.status === 'applied') {
      segments.push({ key: 'write', label: '④ 写入', tone: 'done', detail: '已写入' });
    } else if (activeRun?.status === 'failed') {
      segments.push({ key: 'write', label: '④ 写入', tone: 'failed', detail: '已取消' });
    } else if (activeRun) {
      segments.push({ key: 'write', label: '④ 写入', tone: 'active', detail: '待写入' });
    } else {
      segments.push({ key: 'write', label: '④ 写入', tone: 'pending', detail: '待生成' });
    }
  } else {
    segments.push({ key: 'beats', label: '① 分镜', tone: beatsSource ? 'done' : 'pending', detail: beatsSource === 'fallback' ? '降级' : beatsSource ? '完成' : '未生成' });
    if (quickWritten) {
      segments.push({ key: 'draft', label: '② 正文', tone: 'done', detail: '完成' });
      segments.push({ key: 'audit', label: '③ 审稿', tone: 'pending', detail: '已跳过' });
      segments.push({ key: 'write', label: '④ 写入', tone: 'done', detail: '已写入' });
    } else if (quickDraftReady) {
      segments.push({ key: 'draft', label: '② 正文', tone: 'done', detail: '就绪' });
      segments.push({ key: 'audit', label: '③ 审稿', tone: 'pending', detail: '已跳过' });
      segments.push({ key: 'write', label: '④ 写入', tone: 'active', detail: '待写入' });
    } else {
      segments.push({ key: 'draft', label: '② 正文', tone: isProductionRunning ? 'active' : 'pending', detail: isProductionRunning ? '进行中' : '未生成' });
      segments.push({ key: 'audit', label: '③ 审稿', tone: 'pending', detail: '已跳过' });
      segments.push({ key: 'write', label: '④ 写入', tone: 'pending', detail: '待生成' });
    }
  }

  return (
    <div role="status" aria-label="生成进度" className="flex flex-wrap items-center gap-2">
      {segments.map((segment, index) => (
        <span key={segment.key} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden="true" className="text-theme-border">→</span>}
          <span className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-bold', toneStyles[segment.tone])}>
            {toneIcon(segment.tone)}
            {segment.label}
            <span className="font-medium opacity-80">· {segment.detail}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
