import React from 'react';
import { FileText } from 'lucide-react';
import type { AgentTab, ContinuationPack, Novel, ChapterProductionRun } from '../../../shared/types';
import { ProductionRunReview } from '../ProductionRunReview';
import { cn } from '../../lib/utils';
import { WritingStyleControl } from '../WritingStyleControl';
import type { WritingStyleCandidate, WritingStyleMode, WritingStyleResolution } from '../../lib/writing-style-client';

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
  onStopProductionRun?: () => void;
  onApplyProductionRun: (runOverride?: ChapterProductionRun) => Promise<void>;
  onOpenBibleAssistant?: (prompt: string) => void;
  packTimeFormatter: Intl.DateTimeFormat;
  renderContextReceipt: () => React.ReactNode;
  writingStyleResolution?: WritingStyleResolution | null;
  writingStyleCandidates?: WritingStyleCandidate[];
  onConfirmWritingStyle?: (mode: WritingStyleMode) => Promise<string | void> | string | void;
  onGenerateWithWritingStyle?: (fingerprint?: string) => Promise<void> | void;
  onOpenWritingStyle?: () => void;
  writingStyleConfirmed?: boolean;
  capabilityEffectSummary?: {
    projectCardNames: string[];
    favoriteTechniqueNames: string[];
    chapterCardNames?: string[];
  };
  onSwitchTab?: (tab: AgentTab) => void;
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
  onStopProductionRun,
  onApplyProductionRun,
  onOpenBibleAssistant,
  packTimeFormatter,
  renderContextReceipt,
  writingStyleResolution,
  writingStyleCandidates,
  onConfirmWritingStyle,
  onGenerateWithWritingStyle,
  onOpenWritingStyle,
  writingStyleConfirmed,
  capabilityEffectSummary,
  onSwitchTab,
}: ProductionTabProps) {
  const hasCapabilityDetails = Boolean(
    capabilityEffectSummary?.projectCardNames.length
      || capabilityEffectSummary?.favoriteTechniqueNames.length
      || capabilityEffectSummary?.chapterCardNames?.length,
  );
  const shouldShowCapabilitySummary = hasCapabilityDetails || Boolean(onSwitchTab);

  return (
    <div className="space-y-4">
      {renderContextReceipt()}
      {shouldShowCapabilitySummary ? (
        <section className="rounded-xl border border-theme-border bg-theme-sidebar/50 p-3 text-xs" aria-label="本次生成能力配置">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-theme-text">本次生成能力配置</div>
            {onSwitchTab ? (
              <button
                type="button"
                onClick={() => onSwitchTab('skills')}
                className="shrink-0 rounded-lg border border-theme-border px-2 py-1 text-[10px] font-bold text-theme-text hover:bg-theme-border/30"
              >
                核对写法与能力
              </button>
            ) : null}
          </div>
          {capabilityEffectSummary?.projectCardNames.length ? (
            <p className="mt-1 leading-5 text-theme-muted">
              作品默认卡：<span className="text-theme-text">{capabilityEffectSummary.projectCardNames.join('、')}</span>
            </p>
          ) : null}
          {capabilityEffectSummary?.favoriteTechniqueNames.length ? (
            <p className="mt-1 leading-5 text-theme-muted">
              常用技法：<span className="text-theme-text">{capabilityEffectSummary.favoriteTechniqueNames.join('、')}</span>
            </p>
          ) : null}
          {capabilityEffectSummary?.chapterCardNames?.length ? (
            <p className="mt-1 leading-5 text-theme-muted">
              本章使用卡：<span className="text-theme-text">{capabilityEffectSummary.chapterCardNames.join('、')}</span>
            </p>
          ) : null}
          {!hasCapabilityDetails ? (
            <p className="mt-1 leading-5 text-theme-muted">
              还没有配置作品默认卡或常用技法，生成会先按当前章节与作品上下文继续。
            </p>
          ) : null}
          <p className="mt-1 text-[11px] leading-5 text-theme-muted">
            作品默认卡和常用技法会长期影响本书；本章使用卡只影响当前章节。
          </p>
        </section>
      ) : null}
      {(writingStyleResolution || writingStyleCandidates?.length) ? (
        <WritingStyleControl
          resolution={writingStyleResolution}
          candidates={writingStyleCandidates}
          onConfirm={onConfirmWritingStyle}
          onGenerate={onGenerateWithWritingStyle}
          onOpenWritingStyle={onOpenWritingStyle}
          confirmed={Boolean(writingStyleConfirmed ?? writingStyleResolution?.confirmed)}
          disabled={isProductionRunning || isApplyingProductionRun}
        />
      ) : null}
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
                        ? '已确认资料包会作为本次生成参考。'
                        : '当前选择的是待审核资料包，会作为本次生成参考，但内容还没有经过最终确认。'}
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
                        <div key={gap.id} className="flex items-start justify-between gap-2 text-[11px] leading-relaxed text-theme-muted">
                          <div className="min-w-0">
                            <span className="font-bold text-theme-text">{gap.description}</span>
                            {gap.suggestedDirection ? ` · ${gap.suggestedDirection}` : ''}
                          </div>
                          {onOpenBibleAssistant ? (
                            <button
                              type="button"
                              aria-label={`让智能管家补齐：${gap.description}`}
                              onClick={() => {
                                const prompt = [
                                  `请补充资料缺口：${gap.description}`,
                                  gap.suggestedDirection ? `建议方向：${gap.suggestedDirection}` : '',
                                  gap.relatedFacts?.length ? `相关事实：${gap.relatedFacts.join('；')}` : '',
                                  '请先生成可编辑确认单，不要直接写入。',
                                ].filter(Boolean).join('\n');
                                onOpenBibleAssistant(prompt);
                              }}
                              className="shrink-0 rounded-lg border border-theme-border bg-theme-sidebar px-2 py-1 text-[10px] font-medium text-theme-text hover:bg-theme-border/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/30"
                            >
                              让智能管家补齐
                            </button>
                          ) : null}
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
        onStop={onStopProductionRun}
        onApply={(runOverride) => void onApplyProductionRun(runOverride)}
        showStartAction={!onGenerateWithWritingStyle}
      />
    </div>
  );
}
