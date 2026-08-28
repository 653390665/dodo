import React from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Bot, Loader2, MessageSquareWarning, Wand2, RefreshCw, Compass,
  HeartCrack, Sparkles, Lightbulb, X
} from 'lucide-react';
import type { Chapter, AgentTab, Novel, MountedSkillLoadoutItem, ReviewIssue } from '../../../shared/types';
import { extractStructuredAudit, stripEmbeddedStructuredAudit } from '../../../shared/lib/audit-structured';
import { computeChapterWorkflowHash } from '../../../shared/lib/chapter-workflow';
import { DRAFT_QUALITY_SEMANTIC_LABELS } from '../../../shared/lib/quality-contract';
import { findPatchWindow } from '../../lib/chapter-polish';
import { recommendPromptAssets, getPromptAssetAction, inferNovelGovernanceProfile, getAssetEnhancementPackage, isPackageRestricted } from '../../../shared/lib/prompt-assets-governed';
import type { PromptAssetActionKind } from '../../../shared/types/prompt-assets-governed';
import { toast } from '../../lib/toast';
import { canUseEnhancedCapability, dispatchCapabilityUnavailable, filterLicensedAssetsByEntitlement, getEffectiveCommercialMode } from '../../lib/entitlements';

interface QualityTabProps {
  currentChapter: Chapter | null;
  novel: Novel;
  onRunAudit: () => Promise<void>;
  isGeneratingCritique: boolean;
  onPolishChapterFromAudit: () => Promise<void>;
  isGeneratingContent: boolean;
  onSwitchTab?: (tab: AgentTab) => void;
  onRunRecommendedAsset?: (assetId: string, actionKind: PromptAssetActionKind) => Promise<void>;
  skippedAssetIds?: string[];
  stackedDeconstructionCardIds?: string[];
  onStackDeconstructionCard?: (assetId: string) => Promise<void>;
  onUnstackDeconstructionCard?: (assetId: string) => Promise<void>;
  onSkipAsset?: (assetId: string) => Promise<void>;
  /** @deprecated retained for EditorView compatibility; recommendations never mutate this legacy state. */
  mountedSkillLoadout?: MountedSkillLoadoutItem[];
  onAssignSkill?: (slot: number, skillId: string) => Promise<void>;
  onRemoveSkill?: (slot: number) => Promise<void>;
  reviewIssues?: ReviewIssue[];
  onPreviewReviewIssue?: (issueId: string) => void | Promise<void>;
  onFixReviewIssues?: (issueIds: string[], scope?: string) => void | Promise<void>;
  onAcceptReviewIssueRisk?: (issueId: string, reason?: string) => void | Promise<void>;
  onDeferReviewIssue?: (issueId: string) => void | Promise<void>;
  capabilityEffectSummary?: {
    projectCardNames: string[];
    favoriteTechniqueNames: string[];
    chapterCardNames?: string[];
  };
}

interface ReviewIssueDisplay {
  id: string;
  title: string;
  severity: 'critical' | 'major' | 'moderate';
  status: string;
  recommendation: string;
  scope: string;
}

function normalizeReviewIssue(raw: ReviewIssue, index: number): ReviewIssueDisplay {
  const severity = raw.severity === 'critical' || raw.severity === 'moderate' ? raw.severity : 'major';
  return {
    id: raw.id || `review-issue-${index + 1}`,
    title: raw.explanation || '章节问题',
    severity,
    status: typeof raw.status === 'string' && raw.status ? raw.status : 'open',
    recommendation: raw.suggestedFix || '请结合正文判断后处理',
    scope: raw.snippet ? '选区/本章' : '本章',
  };
}

export function QualityTab({
  currentChapter,
  novel,
  onRunAudit,
  isGeneratingCritique,
  onPolishChapterFromAudit,
  isGeneratingContent,
  onSwitchTab,
  onRunRecommendedAsset,
  skippedAssetIds = [],
  stackedDeconstructionCardIds = [],
  onStackDeconstructionCard,
  onUnstackDeconstructionCard,
  onSkipAsset,
  reviewIssues = [],
  onPreviewReviewIssue,
  onFixReviewIssues,
  onAcceptReviewIssueRisk,
  onDeferReviewIssue,
  capabilityEffectSummary,
}: QualityTabProps) {
  const [reviewIssueStatuses, setReviewIssueStatuses] = React.useState<Record<string, string>>({});
  const normalizedReviewIssues = React.useMemo(() => reviewIssues.map(normalizeReviewIssue), [reviewIssues]);
  const critiqueText = currentChapter?.critique || '';
  const structuredAudit = React.useMemo(() => {
    return extractStructuredAudit(critiqueText);
  }, [critiqueText]);
  const semanticReview = React.useMemo(() => {
    const reviewState = currentChapter?.workflowMeta?.reviewState;
    if (!currentChapter || !reviewState) return null;
    return reviewState.contentHash === computeChapterWorkflowHash(currentChapter.content, currentChapter.sceneBeats)
      ? reviewState.semanticReview || null
      : null;
  }, [currentChapter]);

  const cleanCritiqueText = React.useMemo(() => {
    return stripEmbeddedStructuredAudit(critiqueText);
  }, [critiqueText]);

  // 分类与匹配判定
  const {
    autoFixableIssues,
    hardIssues,
    slopIssues,
    manualFixIssues,
  } = React.useMemo(() => {
    if (!structuredAudit || !currentChapter) {
      return { autoFixableIssues: [], hardIssues: [], slopIssues: [], manualFixIssues: [] };
    }

    const issues = structuredAudit.fatalIssues;
    const content = currentChapter.content || '';

    // 检测 snippet 能否在文章中精准匹配 (使用 findPatchWindow 寻找手术匹配窗口)
    const autoFixable = issues.filter(
      (i) => i.snippet && findPatchWindow(content, i.snippet) !== null
    );

    const manualFix = issues.filter(
      (i) => !i.snippet || findPatchWindow(content, i.snippet) === null
    );

    // 限制最多展示 3 处手术精修预览片段，完全对齐后台执行时的上限
    const slicedAutoFixable = autoFixable.slice(0, 3);
    const overflowAutoFixable = autoFixable.slice(3);

    // 将因溢出上限而暂时未能放入本轮预览的自动修复片段，优雅地合并到人工修改建议列表中
    const finalManualFix = [...manualFix, ...overflowAutoFixable];

    const hard = issues.filter((i) =>
      ['duplicate', 'dialogue-logic', 'syntax', 'scene-execution'].includes(i.issueType)
    );

    const slop = issues.filter((i) =>
      ['style-slop', 'action-chain', 'hook-ending'].includes(i.issueType)
    );

    return {
      autoFixableIssues: slicedAutoFixable,
      hardIssues: hard,
      slopIssues: slop,
      manualFixIssues: finalManualFix,
    };
  }, [structuredAudit, currentChapter]);

  const hasCritique = Boolean(critiqueText);
  const hasCapabilityDetails = Boolean(
    capabilityEffectSummary?.projectCardNames.length
      || capabilityEffectSummary?.favoriteTechniqueNames.length
      || capabilityEffectSummary?.chapterCardNames?.length,
  );

  const renderCapabilitySummary = (label: string, emptyMessage: string) => (
    <section className="rounded-xl border border-theme-border bg-theme-sidebar/50 p-3 text-xs" aria-label={label}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-theme-text">{label}</div>
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
        <p className="mt-1 leading-5 text-theme-muted">{emptyMessage}</p>
      ) : null}
      <p className="mt-1 text-[11px] leading-5 text-theme-muted">
        作品默认卡和常用技法会长期影响本书；本章使用卡只影响当前章节。
      </p>
    </section>
  );

  const recommendedAssets = React.useMemo(() => {
    const hasIssues = autoFixableIssues.length > 0 || hardIssues.length > 0 || slopIssues.length > 0 || manualFixIssues.length > 0;
    const currentStage = hasCritique ? (hasIssues ? 'polish' : 'review') : 'review';
    const profile = inferNovelGovernanceProfile(novel);
    const recommendations = recommendPromptAssets({
      targetPlatform: profile.targetPlatform,
      genreTags: profile.genreTags,
      currentStage,
      activeSeriesId: profile.activeSeriesId,
      commercialMode: getEffectiveCommercialMode(novel.projectPreferenceProfile?.commercialMode),
      excludeAssetIds: skippedAssetIds,
    });
    return filterLicensedAssetsByEntitlement(recommendations, novel.projectPreferenceProfile?.commercialMode);
  }, [novel, hasCritique, autoFixableIssues, hardIssues, slopIssues, manualFixIssues, skippedAssetIds]);

  // 渲染尚未审计状态
  if (!hasCritique) {
    return (
      <div className="space-y-6">
        {renderCapabilitySummary('本次审稿能力配置', '还没有配置作品默认卡或常用技法，审稿会先按当前章节与作品上下文继续。')}
        <div className="bg-theme-sidebar p-6 rounded-2xl border border-theme-border/60 shadow-md flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-theme-accent/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-center rounded-2xl w-14 h-14 bg-theme-accent/10 text-theme-accent mb-4">
            <Bot size={28} className="opacity-90" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-bold text-theme-text mb-1">AI 章节批判审计</h3>
          <p className="text-xs text-theme-muted mb-6 max-w-[240px] leading-relaxed">
            深入诊断当前章节的逻辑漏洞、干瘪对白、AI机械腔调及节奏硬伤，获得可确认的局部精修预览。
          </p>
          <button
            onClick={() => void onRunAudit()}
            disabled={isGeneratingCritique || !currentChapter}
            className="w-full py-3 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-95 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isGeneratingCritique ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                <span>审计诊断中... (约需30s)</span>
              </>
            ) : (
              <>
                <MessageSquareWarning size={16} aria-hidden="true" />
                <span>开始 AI 审计</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-left pb-10">
      {renderCapabilitySummary('本次精修能力配置', '还没有配置作品默认卡或常用技法，精修会先按当前审稿意见与章节正文继续。')}
      {/* 1. 质量总览得分面板 (如果解析出结构化数据) */}
      {structuredAudit ? (
        <div className="relative p-5 rounded-2xl border border-theme-border/60 bg-theme-sidebar shadow-md overflow-hidden flex flex-col gap-4">
          <div className="absolute inset-0 bg-gradient-to-br from-theme-accent/5 to-transparent pointer-events-none" />

          <div className="flex items-center justify-between relative z-10 gap-3">
            <div className="flex items-center gap-3.5">
              <div className={`flex items-center justify-center rounded-2xl w-12 h-12 font-mono text-xl font-black ${
                structuredAudit.score >= 80
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : structuredAudit.score >= 60
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}>
                {structuredAudit.score}
              </div>
              <div>
                <h4 className="text-xs font-black text-theme-text uppercase tracking-wider">诊断质量得分</h4>
                <p className="text-[11px] text-theme-muted mt-0.5 leading-relaxed">
                  {structuredAudit.score >= 80
                    ? '质量上乘，表达圆融，人物情感充沛自然'
                    : structuredAudit.score >= 60
                    ? '框架完整，但局部动作链及对白前因需精修'
                    : '存在明显写作硬伤，AI机械腔或套话较多'}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // 回退到普通面板
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border/60 shadow-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Bot size={20} className="text-theme-accent" aria-hidden="true" />
            <div>
              <h4 className="text-xs font-bold text-theme-text">AI 审稿报告</h4>
              <p className="text-[10px] text-theme-muted">诊断已就绪，可在下方生成精修预览</p>
            </div>
          </div>
          <button
            onClick={() => void onRunAudit()}
            disabled={isGeneratingCritique}
            className="px-3 py-1.5 border border-theme-border text-xs font-bold rounded-lg hover:bg-theme-border/40 transition-colors shrink-0 flex items-center gap-1 disabled:opacity-50"
          >
            {isGeneratingCritique ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={12} aria-hidden="true" />}
            重新审计
          </button>
        </div>
      )}

      <section className="rounded-xl border border-theme-border bg-theme-sidebar/50 p-3 text-xs" aria-label="语义质量审阅">
        <div className="font-bold text-theme-text">语义质量审阅</div>
        {!semanticReview ? (
          <p className="mt-1 text-[11px] leading-5 text-amber-700">当前正文尚无有效语义审阅，或正文已在审稿后变化，请重新审稿。</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {semanticReview.checks.map((check) => (
              <div key={check.id} className="rounded border border-theme-border/70 px-2 py-1.5">
                <div className={check.status === 'needs-action' ? 'font-semibold text-amber-700' : check.status === 'pass' ? 'font-semibold text-green-700' : 'font-semibold text-theme-muted'}>
                  {DRAFT_QUALITY_SEMANTIC_LABELS[check.id]}：{check.status === 'pass' ? '通过' : check.status === 'needs-action' ? '需处理' : '未知'}
                </div>
                <p className="mt-0.5 text-[10px] leading-5 text-theme-muted">{check.reason}</p>
                {check.evidence?.map((evidence) => (
                  <div key={`${check.id}:${evidence.quote}`} className="mt-1 border-l-2 border-theme-border pl-2 text-[10px] leading-5 text-theme-muted">
                    “{evidence.quote}”{evidence.location ? `（${evidence.location}）` : ''}：{evidence.explanation} 建议：{evidence.suggestedFix}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 1.5 下一步治理资产推荐 */}
      {hasCritique && recommendedAssets.length > 0 && (
        <div className="space-y-3.5">
          <div className="flex items-center gap-1.5 text-xs font-black text-theme-accent uppercase tracking-wider">
            <Compass size={13} aria-hidden="true" />
            <span>智能推荐下一步治理资产 ({recommendedAssets.length})</span>
          </div>
          <div className="space-y-3">
            {recommendedAssets.map((asset) => {
              let sourceLabel = '广场共享';
              if (asset.sourceType === 'built-in') sourceLabel = '官方内置';
              else if (asset.sourceType === 'licensed') sourceLabel = '私有授权';

              let tierLabel = '引导推荐';
              if (asset.placementTier === 'core-default') tierLabel = '核心底线';
              else if (asset.placementTier === 'optional-style') tierLabel = '风格定制';
              else if (asset.placementTier === 'flow-default') tierLabel = '流程顺承';

              const actionKind = getPromptAssetAction(asset);

              // 臻享/付费增强包判定 (Premium custom package restrictions check)
              const pkg = getAssetEnhancementPackage(asset.id);
              const enhancedUnavailable = !canUseEnhancedCapability({ commercialMode: novel.projectPreferenceProfile?.commercialMode });
              const isRestricted = enhancedUnavailable && (
                asset.sourceType === 'licensed'
                || Boolean(pkg && isPackageRestricted(pkg.id, novel.projectPreferenceProfile?.commercialMode || 'free'))
              );

              // 判断状态
              const isStacked = actionKind === 'deconstruction-card' && stackedDeconstructionCardIds.includes(asset.id);

              return (
                <div
                  key={asset.id}
                  className={`group relative p-4 rounded-xl border transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-3 overflow-hidden ${
                    isStacked
                      ? 'border-emerald-500/40 bg-emerald-500/[0.02] hover:bg-emerald-500/[0.04]'
                      : 'border-theme-border/40 bg-theme-sidebar/30 hover:bg-theme-sidebar/60 hover:border-theme-accent/40'
                  }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-theme-accent/0 to-theme-accent/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

                  {/* 忽略按钮：右上角微型关闭，带过渡动效 */}
                  {onSkipAsset && (
                    <button
                      type="button"
                      aria-label="忽略此推荐"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onSkipAsset(asset.id);
                      }}
                      className="absolute top-2.5 right-2.5 p-1 text-theme-muted hover:text-red-500 hover:bg-red-500/5 rounded-md transition-all duration-200 opacity-0 group-hover:opacity-100 z-20 cursor-pointer"
                    >
                      <X size={11} aria-hidden="true" />
                    </button>
                  )}

                  <div className="space-y-1 z-10 text-left flex-1 pr-6">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-theme-text group-hover:text-theme-accent transition-colors duration-200">
                        {asset.title}
                      </span>
                      {isRestricted && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-gradient-to-r from-amber-500/20 to-pink-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-bold shrink-0">
                          内测增强
                        </span>
                      )}
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-theme-border/40 text-theme-muted font-black uppercase shrink-0">
                        {asset.grade}级 ({asset.score}分)
                      </span>
                      {isStacked && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold shrink-0 animate-pulse">
                          已用于本章
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-theme-muted group-hover:text-theme-text transition-colors duration-200 leading-relaxed">
                      {asset.recommendationReason}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 z-10 text-[9px] font-bold flex-wrap md:flex-nowrap">
                    <span className="px-2 py-0.5 rounded bg-theme-accent/5 border border-theme-accent/10 text-theme-accent shrink-0">
                      {sourceLabel}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-theme-border/40 border border-theme-border/60 text-theme-muted shrink-0">
                      {tierLabel}
                    </span>
                    {actionKind && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isRestricted) {
                            dispatchCapabilityUnavailable({
                              limitType: 'extractSkill',
                              ...(pkg ? { packageName: pkg.name, packageDesc: pkg.description } : {}),
                              novelId: novel.id,
                            });
                            return;
                          }
                          if (actionKind === 'mount-skill') {
                            onSwitchTab?.('skills');
                            toast('已打开作品能力中心，请管理流程、技法与拆书卡', 'info');
                          } else if (onRunRecommendedAsset) {
                            await onRunRecommendedAsset(asset.id, actionKind);
                          } else {
                            if (actionKind === 'polish-rewrite' || actionKind === 'audit-enhance') {
                              await onPolishChapterFromAudit();
                            } else if (actionKind === 'open-flow-step') {
                              onSwitchTab?.('planning');
                              toast('正在为您切换到设计规划页执行该步骤', 'info');
                            } else if (actionKind === 'deconstruction-card') {
                              if (isStacked) {
                                if (onUnstackDeconstructionCard) {
                                  await onUnstackDeconstructionCard(asset.id);
                                }
                              } else {
                                if (onStackDeconstructionCard) {
                                  await onStackDeconstructionCard(asset.id);
                                }
                              }
                            }
                          }
                        }}
                        className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all duration-200 shadow-sm border cursor-pointer select-none shrink-0 ${
                          isStacked
                            ? 'bg-emerald-500/10 hover:bg-emerald-500 hover:text-white text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : 'bg-theme-accent/10 hover:bg-theme-accent text-theme-accent hover:text-white border-theme-accent/20'
                        }`}
                      >
                        {actionKind === 'polish-rewrite' || actionKind === 'audit-enhance' ? '生成精修预览' :
                         actionKind === 'open-flow-step' ? '进入步骤' :
                         actionKind === 'mount-skill' ? '进入作品能力中心' :
                         (isStacked ? '移出本章' : '本章使用')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {normalizedReviewIssues.length > 0 && (
        <section aria-labelledby="review-issues-title" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 id="review-issues-title" className="text-xs font-black text-theme-text uppercase tracking-wider">问题单 ({normalizedReviewIssues.length})</h4>
            <span className="text-[10px] text-theme-muted">逐项处理，不离开当前章节</span>
          </div>
          <div className="space-y-3">
            {normalizedReviewIssues.map((issue) => {
              const status = reviewIssueStatuses[issue.id] || issue.status;
              const severityLabel = issue.severity === 'critical' ? '严重' : issue.severity === 'moderate' ? '中等' : '重要';
              const statusLabel = status === 'accepted-risk' ? '已接受风险' : status === 'deferred' ? '已延期' : status === 'candidate' ? '修正候选待确认' : status === 'previewed' ? '预览已生成，未写入' : status === 'applied' ? '已修正，待复审' : status === 'stale' ? '内容已变化，待复审' : '待处理';
              return (
                <article key={issue.id} className="rounded-xl border border-theme-border/60 bg-theme-sidebar p-3 text-[11px] leading-relaxed">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h5 className="font-bold text-theme-text">{issue.title}</h5>
                    <div className="flex flex-wrap gap-1.5" aria-label="问题状态">
                      <span className={issue.severity === 'critical' ? 'rounded bg-red-500/10 px-1.5 py-0.5 text-red-600' : 'rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600'}>{severityLabel}</span>
                      <span className="rounded bg-theme-bg px-1.5 py-0.5 text-theme-muted">{statusLabel}</span>
                      <span className="rounded bg-theme-bg px-1.5 py-0.5 text-theme-muted">作用域：{issue.scope}</span>
                    </div>
                  </div>
                  <p className="mt-2 text-theme-muted"><span className="font-semibold text-theme-text">建议：</span>{issue.recommendation}</p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button type="button" className="rounded-lg border border-theme-border px-2 py-1.5 text-[10px] font-bold text-theme-text hover:border-theme-accent" aria-label={`预览修正：${issue.title}`} onClick={() => {
                      const previous = reviewIssueStatuses[issue.id];
                      try {
                        const result = onPreviewReviewIssue?.(issue.id);
                        if (result && typeof result.then === 'function') {
                          void result.then(() => {
                            setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'previewed' }));
                          }).catch((error: unknown) => {
                            setReviewIssueStatuses((current) => ({ ...current, ...(previous ? { [issue.id]: previous } : {}) }));
                            toast(error instanceof Error ? error.message : '修正预览失败，请重试。', 'error');
                          });
                        } else {
                          setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'previewed' }));
                        }
                      } catch (error) {
                        toast(error instanceof Error ? error.message : '修正预览失败，请重试。', 'error');
                      }
                    }}>预览修正</button>
                    <button type="button" className="rounded-lg bg-theme-text px-2 py-1.5 text-[10px] font-bold text-theme-bg disabled:opacity-50" aria-label={`修正并复审：${issue.title}`} onClick={() => {
                      const previous = reviewIssueStatuses[issue.id];
                      try {
                        const result = onFixReviewIssues?.([issue.id], issue.scope);
                        if (result && typeof result.then === 'function') {
                          void result.then(() => {
                            setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'candidate' }));
                          }).catch((error: unknown) => {
                            setReviewIssueStatuses((current) => ({ ...current, ...(previous ? { [issue.id]: previous } : {}) }));
                            toast(error instanceof Error ? error.message : '修正并复审失败，原内容已保留。', 'error');
                          });
                        } else {
                          setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'candidate' }));
                        }
                      } catch (error) {
                        toast(error instanceof Error ? error.message : '修正并复审失败，原内容已保留。', 'error');
                      }
                    }}>修正并复审</button>
                    <button type="button" className="rounded-lg border border-amber-500/40 px-2 py-1.5 text-[10px] font-bold text-amber-700 hover:bg-amber-500/10" aria-label={`接受风险：${issue.title}`} onClick={() => {
                      const previous = reviewIssueStatuses[issue.id];
                      try {
                        const result = onAcceptReviewIssueRisk?.(issue.id);
                        if (result && typeof result.then === 'function') {
                          void result.then(() => {
                            setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'accepted-risk' }));
                          }).catch((error: unknown) => {
                            setReviewIssueStatuses((current) => ({ ...current, ...(previous ? { [issue.id]: previous } : {}) }));
                            toast(error instanceof Error ? error.message : '风险决定保存失败，请重试。', 'error');
                          });
                        } else {
                          setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'accepted-risk' }));
                        }
                      } catch (error) {
                        toast(error instanceof Error ? error.message : '风险决定保存失败，请重试。', 'error');
                      }
                    }}>接受风险</button>
                    <button type="button" className="rounded-lg border border-theme-border px-2 py-1.5 text-[10px] font-bold text-theme-muted hover:text-theme-text" aria-label={`延期到后续章节：${issue.title}`} onClick={() => {
                      const previous = reviewIssueStatuses[issue.id];
                      try {
                        const result = onDeferReviewIssue?.(issue.id);
                        if (result && typeof result.then === 'function') {
                          void result.then(() => {
                            setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'deferred' }));
                          }).catch((error: unknown) => {
                            setReviewIssueStatuses((current) => ({ ...current, ...(previous ? { [issue.id]: previous } : {}) }));
                            toast(error instanceof Error ? error.message : '延期决定保存失败，请重试。', 'error');
                          });
                        } else {
                          setReviewIssueStatuses((current) => ({ ...current, [issue.id]: 'deferred' }));
                        }
                      } catch (error) {
                        toast(error instanceof Error ? error.message : '延期决定保存失败，请重试。', 'error');
                      }
                    }}>延期到后续章节</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* 2. 可生成手术精修预览的卡片区 (最多3个片段) */}
      {autoFixableIssues.length > 0 && (
        <div className="bg-gradient-to-br from-violet-600/5 via-indigo-600/5 to-transparent border border-indigo-500/20 p-5 rounded-2xl shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              <Sparkles size={13} className="animate-pulse" aria-hidden="true" />
              <span>局部手术式精修 ({autoFixableIssues.length} 处)</span>
            </div>
            <span className="text-[9px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full font-bold">
              高置信度匹配
            </span>
          </div>

          <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1 no-scrollbar">
            {autoFixableIssues.slice(0, 3).map((issue, idx) => (
              <div key={issue.snippet + idx} className="bg-theme-sidebar/60 p-3 rounded-xl border border-theme-border/40 text-[11px] leading-relaxed relative">
                <div className="font-bold text-theme-text flex items-center gap-1.5 mb-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  <span>
                    {issue.issueType === 'style-slop' ? '文笔去AI味' :
                     issue.issueType === 'action-chain' ? '增强动作链' :
                     issue.issueType === 'hook-ending' ? '收尾加固' : '硬伤修复'}
                    <span className="text-theme-muted font-normal"> · {issue.explanation}</span>
                  </span>
                </div>
                <div className="space-y-2 mt-1.5 pl-3 border-l-2 border-theme-border/60">
                  <div>
                    <span className="text-[10px] text-theme-muted block uppercase tracking-wider font-semibold mb-0.5">原文片段:</span>
                    <span className="italic font-serif text-theme-muted block line-clamp-2">“{issue.snippet.trim()}”</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-indigo-500 block uppercase tracking-wider font-semibold mb-0.5">手术预估:</span>
                    <span className="text-theme-text block font-medium">{issue.patchHint}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            data-prompt-surface="chapter-polish"
            onClick={() => void onPolishChapterFromAudit()}
            disabled={isGeneratingContent || !currentChapter?.content}
            className="w-full relative group overflow-hidden py-3 bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-700 text-white rounded-xl text-xs font-black shadow-lg hover:shadow-indigo-500/10 hover:brightness-105 active:scale-[0.99] transition-all duration-300 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {isGeneratingContent ? (
              <>
                <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                <span>手术精修中，请稍后...</span>
              </>
            ) : (
              <>
                <Wand2 size={13} className="group-hover:rotate-12 transition-transform duration-300" aria-hidden="true" />
                <span>执行局部手术精修</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* 3. 分类问题详情 */}
      {structuredAudit && (
        <div className="space-y-4">
          {/* 硬伤警告 */}
          {hardIssues.length > 0 && (
            <div className="bg-red-500/5 border border-red-500/15 p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400">
                <HeartCrack size={13} aria-hidden="true" />
                <span>逻辑与场景硬伤 ({hardIssues.length})</span>
              </div>
              <div className="space-y-2 divide-y divide-theme-border/20">
                {hardIssues.map((issue, idx) => (
                  <div key={issue.explanation + idx} className="pt-2 first:pt-0 text-[11px] leading-relaxed">
                    <div className="font-bold text-theme-text">{issue.explanation}</div>
                    {issue.snippet && (
                      <div className="mt-1 pl-2.5 border-l border-theme-border/50 text-theme-muted italic font-serif">
                        “{issue.snippet}”
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-theme-muted font-medium">修补建议: {issue.patchHint}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 机械感警告 */}
          {slopIssues.length > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/15 p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                <Sparkles size={13} aria-hidden="true" />
                <span>文风机械感 / AI腔 ({slopIssues.length})</span>
              </div>
              <div className="space-y-2 divide-y divide-theme-border/20">
                {slopIssues.map((issue, idx) => (
                  <div key={issue.explanation + idx} className="pt-2 first:pt-0 text-[11px] leading-relaxed">
                    <div className="font-bold text-theme-text">{issue.explanation}</div>
                    {issue.snippet && (
                      <div className="mt-1 pl-2.5 border-l border-theme-border/50 text-theme-muted italic font-serif">
                        “{issue.snippet}”
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-theme-muted font-medium">修补建议: {issue.patchHint}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 软性人工建议卡片 */}
          {(structuredAudit.surgerySuggestions.length > 0 || manualFixIssues.length > 0) && (
            <div className="bg-blue-500/5 border border-blue-500/15 p-4 rounded-xl space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600 dark:text-blue-400">
                <Lightbulb size={13} aria-hidden="true" />
                <span>人工修改及方向建议</span>
              </div>
              <ul className="space-y-1.5 pl-3 list-disc text-[11px] text-theme-muted leading-relaxed">
                {manualFixIssues.map((issue, idx) => (
                  <li key={issue.explanation + idx} className="marker:text-blue-500">
                    <span className="font-bold text-theme-text">{issue.explanation}</span>：{issue.patchHint}
                  </li>
                ))}
                {structuredAudit.surgerySuggestions.map((sug, idx) => (
                  <li key={`sug-${sug.trim().slice(0, 15)}-${idx}`} className="marker:text-blue-500/60">
                    {sug}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 4. 原文 Critique 展示 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-theme-text uppercase tracking-wider">诊断报告全文</h4>
          {structuredAudit && (
            <button
              onClick={() => void onRunAudit()}
              disabled={isGeneratingCritique}
              className="py-1 px-2.5 border border-theme-border hover:bg-theme-border/30 rounded-lg text-[10px] font-bold text-theme-muted hover:text-theme-text flex items-center gap-1 transition-colors shrink-0 disabled:opacity-50"
            >
              {isGeneratingCritique ? <Loader2 size={10} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={10} aria-hidden="true" />}
              重新审计章节
            </button>
          )}
        </div>

        <div className="prose prose-sm prose-slate prose-p:leading-relaxed max-w-none bg-theme-sidebar p-5 rounded-2xl border border-theme-border/60 shadow-sm max-h-[350px] overflow-y-auto">
          <div data-prompt-surface="chapter-review" className="text-[12px] text-theme-text leading-relaxed">
            <ReactMarkdown>{cleanCritiqueText}</ReactMarkdown>
          </div>
        </div>
      </div>

      {/* 5. 底部快捷工具栏 */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-theme-border/40">
        {/* 如果没有任何可以自动修复的致命问题，我们依然保留通用的精修按钮，让用户可以强制调用 */}
        {autoFixableIssues.length === 0 && (
          <button
            data-prompt-surface="chapter-polish"
            onClick={() => void onPolishChapterFromAudit()}
            disabled={isGeneratingContent || !currentChapter?.critique || !currentChapter?.content}
            className="flex-1 py-2 bg-theme-sidebar border border-theme-border text-theme-text hover:bg-theme-border/40 rounded-xl text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            {isGeneratingContent ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Wand2 size={13} aria-hidden="true" />}
            {isGeneratingContent ? '精修中...' : '按审计精修正文'}
          </button>
        )}

        {onSwitchTab && (
          <button
            onClick={() => onSwitchTab('planning')}
            className="flex-1 py-2 bg-theme-sidebar border border-theme-border text-theme-muted hover:text-theme-text hover:bg-theme-border/40 rounded-xl text-xs font-bold transition-all duration-200 flex items-center justify-center gap-1.5"
          >
            <Compass size={13} aria-hidden="true" />
            回看分镜规划
          </button>
        )}
      </div>
    </div>
  );
}
