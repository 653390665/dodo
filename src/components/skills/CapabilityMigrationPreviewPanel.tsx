import React from 'react';
import type { CapabilityMigrationPreview } from '../../lib/capability-migration-client';

export function CapabilityMigrationPreviewPanel({
  preview,
  error,
  busy,
  onConfirm,
  onClose,
}: {
  preview: CapabilityMigrationPreview;
  error?: string | null;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cardLabel = (card?: { id: string; source: string }) => card ? `${card.id} · ${card.source}` : '未选择';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="capability-migration-title">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-theme-border bg-theme-sidebar p-5 shadow-xl">
        <h2 id="capability-migration-title" className="text-base font-bold text-theme-text">能力迁移预览</h2>
        <p className="mt-1 text-xs text-theme-muted">仅预览历史配置候选，确认后才会写入当前作品。</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 text-xs">
          <div className="rounded-lg border border-theme-border p-3"><b>创作流程</b><p className="mt-1 text-theme-muted">{preview.flow ? `${preview.flow.id} · ${preview.flow.source}` : '未识别'}</p></div>
          <div className="rounded-lg border border-theme-border p-3"><b>写作技法</b><p className="mt-1 text-theme-muted">{preview.techniques.length ? preview.techniques.map((item) => `${item.id} · ${item.source}`).join('、') : '未识别'}</p></div>
          <div className="rounded-lg border border-theme-border p-3"><b>主卡</b><p className="mt-1 text-theme-muted">{cardLabel(preview.skillCards.main || preview.mainCard)}</p></div>
          <div className="rounded-lg border border-theme-border p-3"><b>辅卡</b><p className="mt-1 text-theme-muted">{preview.skillCards.support.length ? preview.skillCards.support.map(cardLabel).join('、') : '未识别'}</p></div>
        </div>
        {preview.conflicts.length > 0 && <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs"><b>冲突</b><ul className="mt-1 list-disc pl-4">{preview.conflicts.map((item) => <li key={`${item.id}-${item.reason}`}>{item.id}: {item.reason}</li>)}</ul></div>}
        {preview.migrationPendingIds.length > 0 && <div className="mt-3 rounded-lg border border-theme-border p-3 text-xs"><b>待处理</b><p className="mt-1 text-theme-muted">{preview.migrationPendingIds.join('、')}</p></div>}
        {preview.suggestion && <p className="mt-3 text-xs text-theme-muted">建议：{preview.suggestion}</p>}
        {error && <p role="alert" className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-5 flex gap-2"><button type="button" onClick={onClose} className="flex-1 rounded-lg border border-theme-border px-3 py-2 text-xs text-theme-muted">取消</button><button type="button" onClick={onConfirm} disabled={busy} className="flex-1 rounded-lg bg-theme-text px-3 py-2 text-xs font-bold text-theme-bg disabled:opacity-50">{busy ? '处理中...' : '确认迁移'}</button></div>
      </div>
    </div>
  );
}
