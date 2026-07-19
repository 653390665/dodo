import React from 'react';
import { FileText } from 'lucide-react';
import type { ContinuationPack, Novel, ChapterProductionRun } from '../../../shared/types';
import { ProductionRunReview } from '../ProductionRunReview';
import { cn } from '../../lib/utils';

interface ProductionTabProps {
  novel: Novel;
  continuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
  setSelectedContinuationPackId: (packId: string) => void;
  selectedContinuationPack: ContinuationPack | null;
  activeProductionRun: ChapterProductionRun | null;
  productionIntent: string;
  isProductionRunning: boolean;
  isApplyingProductionRun: boolean;
  productionError: string | null;
  productionBeatsSource?: 'fallback' | 'model' | null;
  productionDraftSource?: 'fallback' | 'model' | null;
  productionAuditSource?: 'fallback' | 'model' | null;
  productionStatusMessage?: string | null;
  setProductionIntent: (intent: string) => void;
  onStartProductionRun: () => Promise<void>;
  onApplyProductionRun: (runOverride?: ChapterProductionRun) => Promise<void>;
  packTimeFormatter: Intl.DateTimeFormat;
  renderContextReceipt: () => React.ReactNode;
}

export function ProductionTab({
  novel,
  continuationPacks,
  selectedContinuationPackId,
  setSelectedContinuationPackId,
  selectedContinuationPack,
  activeProductionRun,
  productionIntent,
  isProductionRunning,
  isApplyingProductionRun,
  productionError,
  productionBeatsSource,
  productionDraftSource,
  productionAuditSource,
  productionStatusMessage,
  setProductionIntent,
  onStartProductionRun,
  onApplyProductionRun,
  packTimeFormatter,
  renderContextReceipt,
}: ProductionTabProps) {
  return (
    <div className="space-y-4">
      {renderContextReceipt()}
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm space-y-3">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-theme-accent" aria-hidden="true" />
          <h3 className="text-xs font-bold text-theme-text">续写资料包</h3>
        </div>
        {continuationPacks.length > 0 ? (
          <>
            <select
              value={selectedContinuationPackId}
              onChange={(e) => setSelectedContinuationPackId(e.target.value)}
              className="w-full rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2 text-sm text-theme-text outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
            >
              <option value="">不使用资料包，仅按当前作品上下文续写</option>
              {continuationPacks.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.title} {pack.status === 'approved' ? '· 已确认' : '· 待审核'}
                </option>
              ))}
            </select>
            {selectedContinuationPack ? (
              <div className="rounded-2xl border border-theme-border bg-theme-sidebar/20 px-3 py-3 text-xs text-theme-muted space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-theme-text">{selectedContinuationPack.title}</div>
                    <div className="text-[10px] text-theme-muted">
                      {selectedContinuationPack.status === 'approved'
                        ? '已确认资料包会直接接入自动生产上下文。'
                        : '当前接入的是待审核资料包，也会进入自动生产上下文，但内容还没有经过最终确认。'}
                    </div>
                  </div>
                  <div className="rounded-full bg-theme-sidebar px-2 py-1 text-[10px] font-medium text-theme-muted border border-theme-border">
                    更新于 {packTimeFormatter.format(new Date(selectedContinuationPack.updatedAt))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={cn(
                    'rounded-full px-2.5 py-1 text-[10px] font-medium border',
                    selectedContinuationPack.status === 'approved'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200',
                  )}>
                    {selectedContinuationPack.status === 'approved' ? '已确认资料包' : '待审核资料包'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                    <div className="text-[10px] text-theme-muted">续写任务</div>
                    <div className="mt-1 text-theme-text font-bold leading-relaxed">
                      {selectedContinuationPack.continuationTask || '未指定'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                    <div className="text-[10px] text-theme-muted">当前剧情锚点</div>
                    <div className="mt-1 text-theme-text font-bold leading-relaxed">
                      {selectedContinuationPack.plotState.latestScene || '未提供最近场景'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                    硬设定 {selectedContinuationPack.canonFacts.length}
                  </span>
                  <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                    人物状态 {selectedContinuationPack.characterStates.length}
                  </span>
                  <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                    审读问题 {selectedContinuationPack.readingQuestions?.length || 0}
                  </span>
                  <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                    续写缺口 {selectedContinuationPack.continuationGaps?.length || 0}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                    <div className="text-[10px] text-theme-muted">即时冲突</div>
                    <div className="mt-1 text-theme-text leading-relaxed">
                      {selectedContinuationPack.plotState.immediateConflict || '未指定'}
                    </div>
                  </div>
                  <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                    <div className="text-[10px] text-theme-muted">下一步建议</div>
                    <div className="mt-1 text-theme-text leading-relaxed">
                      {selectedContinuationPack.plotState.nextLikelyMove || '未指定'}
                    </div>
                  </div>
                </div>

                {selectedContinuationPack.continuationGaps?.length ? (
                  <div className="rounded-xl border border-dashed border-theme-border bg-theme-sidebar/70 px-3 py-2">
                    <div className="text-[10px] font-bold text-theme-text">最值得先补的资料缺口</div>
                    <div className="mt-1.5 space-y-1">
                      {selectedContinuationPack.continuationGaps.slice(0, 2).map((gap) => (
                        <div key={gap.id} className="text-[11px] leading-relaxed text-theme-muted">
                          <span className="font-bold text-theme-text">{gap.description}</span>
                          {gap.suggestedDirection ? ` · ${gap.suggestedDirection}` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-theme-border bg-theme-sidebar/20 px-3 py-3 text-xs text-theme-muted">
            当前还没有资料包。先去“世界设定集 → 资料续写”上传资料包，再回来接入续写。
          </div>
        )}
      </div>

      <ProductionRunReview
        run={activeProductionRun}
        userIntent={productionIntent}
        running={isProductionRunning}
        applying={isApplyingProductionRun}
        error={productionError}
        novelId={novel.id}
        beatsSource={productionBeatsSource}
        draftSource={productionDraftSource}
        auditSource={productionAuditSource}
        statusMessage={productionStatusMessage}
        onIntentChange={setProductionIntent}
        onStart={() => void onStartProductionRun()}
        onApply={(runOverride) => void onApplyProductionRun(runOverride)}
      />
    </div>
  );
}
