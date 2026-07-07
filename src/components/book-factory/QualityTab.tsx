import React from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Bot, Loader2, MessageSquareWarning, Wand2, RefreshCw, Compass,
  HeartCrack, Sparkles, Lightbulb, X
} from 'lucide-react';
import type { Chapter, AgentTab, Novel, MountedSkillLoadoutItem } from '../../../shared/types';
import { extractStructuredAudit, stripEmbeddedStructuredAudit } from '../../../shared/lib/audit-structured';
import { findPatchWindow } from '../../lib/chapter-polish';
import { recommendPromptAssets, getPromptAssetAction, inferNovelGovernanceProfile, getAssetEnhancementPackage, isPackageRestricted } from '../../../shared/lib/prompt-assets-governed';
import type { PromptAssetActionKind } from '../../../shared/types/prompt-assets-governed';
import { toast } from '../../lib/toast';
import { useAppStore } from '../../stores/app-store';

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
  mountedSkillLoadout?: MountedSkillLoadoutItem[];
  onAssignSkill?: (slot: number, skillId: string) => Promise<void>;
  onRemoveSkill?: (slot: number) => Promise<void>;
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
  mountedSkillLoadout = [],
  onAssignSkill,
  onRemoveSkill,
}: QualityTabProps) {
  const isGlobalPremium = useAppStore(state => state.isGlobalPremium);
  const critiqueText = currentChapter?.critique || '';
  const structuredAudit = React.useMemo(() => {
    return extractStructuredAudit(critiqueText);
  }, [critiqueText]);

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

    // 限制最多展示 3 处一键手术精修片段，完全对齐后台执行时的上限
    const slicedAutoFixable = autoFixable.slice(0, 3);
    const overflowAutoFixable = autoFixable.slice(3);

    // 将因溢出上限而暂时未能放入本轮一键手术的自动修复片段，优雅地合并到人工修改建议列表中
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

  const recommendedAssets = React.useMemo(() => {
    const hasIssues = autoFixableIssues.length > 0 || hardIssues.length > 0 || slopIssues.length > 0 || manualFixIssues.length > 0;
    const currentStage = hasCritique ? (hasIssues ? 'polish' : 'review') : 'review';
    const profile = inferNovelGovernanceProfile(novel);
    return recommendPromptAssets({
      targetPlatform: profile.targetPlatform,
      genreTags: profile.genreTags,
      currentStage,
      activeSeriesId: profile.activeSeriesId,
      commercialMode: profile.commercialMode,
      excludeAssetIds: skippedAssetIds,
    });
  }, [novel, hasCritique, autoFixableIssues, hardIssues, slopIssues, manualFixIssues, skippedAssetIds]);

  // 渲染尚未审计状态
  if (!hasCritique) {
    return (
      <div className="space-y-6">
        <div className="bg-theme-sidebar p-6 rounded-2xl border border-theme-border/60 shadow-md flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-theme-accent/5 to-transparent pointer-events-none" />
          <div className="flex items-center justify-center rounded-2xl w-14 h-14 bg-theme-accent/10 text-theme-accent mb-4">
            <Bot size={28} className="opacity-90" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-bold text-theme-text mb-1">AI 章节批判审计</h3>
          <p className="text-xs text-theme-muted mb-6 max-w-[240px] leading-relaxed">
            深入诊断当前章节的逻辑漏洞、干瘪对白、AI机械腔调及节奏硬伤，获得可一键局部精修的手术方案。
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
              <p className="text-[10px] text-theme-muted">诊断已就绪，推荐使用下方一键精修</p>
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
              const isRestricted = !isGlobalPremium && (pkg ? isPackageRestricted(pkg.id, novel.projectPreferenceProfile?.commercialMode || 'free') : false);

              // 判断状态
              const isMounted = actionKind === 'mount-skill' && mountedSkillLoadout.some(item => item.skillId === asset.id);
              const mountedSlotEntry = actionKind === 'mount-skill' ? mountedSkillLoadout.find(item => item.skillId === asset.id) : undefined;
              const isStacked = actionKind === 'deconstruction-card' && stackedDeconstructionCardIds.includes(asset.id);

              return (
                <div
                  key={asset.id}
                  className={`group relative p-4 rounded-xl border transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-3 overflow-hidden ${
                    isMounted || isStacked
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
                          👑 Premium
                        </span>
                      )}
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-theme-border/40 text-theme-muted font-black uppercase shrink-0">
                        {asset.grade}级 ({asset.score}分)
                      </span>
                      {(isMounted || isStacked) && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold shrink-0 animate-pulse">
                          {isMounted ? '已装备' : '已叠加'}
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
                          if (isRestricted && pkg) {
                            window.dispatchEvent(new CustomEvent('trigger-premium-modal', {
                              detail: {
                                limitType: 'extractSkill',
                                packageName: pkg.name,
                                packageDesc: pkg.description,
                                whyUpgrade: pkg.whyUpgrade,
                                novelId: novel.id,
                              }
                            }));
                            return;
                          }
                          if (onRunRecommendedAsset) {
                            await onRunRecommendedAsset(asset.id, actionKind);
                          } else {
                            if (actionKind === 'polish-rewrite' || actionKind === 'audit-enhance') {
                              await onPolishChapterFromAudit();
                            } else if (actionKind === 'open-flow-step') {
                              onSwitchTab?.('planning');
                              toast('正在为您切换到设计规划页执行该步骤', 'info');
                            } else if (actionKind === 'mount-skill') {
                              if (isMounted && mountedSlotEntry) {
                                if (onRemoveSkill) {
                                  await onRemoveSkill(mountedSlotEntry.slot);
                                  toast('已撤销技能卡装备', 'info');
                                }
                              } else {
                                if (onAssignSkill) {
                                  const emptySlot = [1, 2, 3].find(slot => !mountedSkillLoadout.some(item => item.slot === slot)) || 1;
                                  await onAssignSkill(emptySlot, asset.id);
                                  toast('技能卡装备成功，已装配到空闲槽位', 'success');
                                }
                              }
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
                          isMounted || isStacked
                            ? 'bg-emerald-500/10 hover:bg-emerald-500 hover:text-white text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                            : 'bg-theme-accent/10 hover:bg-theme-accent text-theme-accent hover:text-white border-theme-accent/20'
                        }`}
                      >
                        {actionKind === 'polish-rewrite' || actionKind === 'audit-enhance' ? '一键精修' :
                         actionKind === 'open-flow-step' ? '进入步骤' :
                         actionKind === 'mount-skill' ? (isMounted ? '撤销装备' : '装备技能') :
                         (isStacked ? '撤销叠加' : '叠加拆书卡')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. 可一键自动手术精修卡片区 (最多3个片段) */}
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
                <span>一键执行局部手术精修</span>
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
