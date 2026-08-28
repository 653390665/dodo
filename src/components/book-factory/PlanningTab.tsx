import React from 'react';
import {
  Feather,
  ListOrdered,
  Loader2,
  Plus,
  Sparkles,
  Lightbulb,
  ArrowRight,
  CheckCircle2,
  RefreshCcw,
  Compass
} from 'lucide-react';
import type { Chapter, Novel, ProjectPreferenceProfile, AgentTab } from '../../../shared/types';
import { cn } from '../../lib/utils';
import { canUseEnhancedCapability, dispatchCapabilityUnavailable } from '../../lib/entitlements';
import {
  SKILL_SERIES_FLOWS,
  inferNovelGovernanceProfile,
  getNovelCurrentStepId,
  getNovelCompletedStepIds,
  getFlowEnhancementPackage,
  isPackageRestricted
} from '../../../shared/lib/prompt-assets-governed.js';

interface PlanningTabProps {
  renderContextReceipt: () => React.ReactNode;
  userIntent: string;
  setUserIntent: (intent: string) => void;
  currentChapter: Chapter | null;
  onCreateChapter?: () => Promise<void>;
  onGenerateBeats: () => Promise<void>;
  isGeneratingBeats: boolean;
  onGenerateContent: () => Promise<void>;
  isGeneratingContent: boolean;
  onRewriteSelectedText: () => Promise<void>;
  onUpdateChapterBeats: (beats: string) => void;
  generationStatus: string | null;
  novel: Novel;
  projectPreferenceProfile?: ProjectPreferenceProfile;
  onPreferenceProfileChange?: (profile: ProjectPreferenceProfile) => Promise<void>;
  onSwitchTab?: (tab: AgentTab) => void;
}

export function PlanningTab({
  renderContextReceipt,
  userIntent,
  setUserIntent,
  currentChapter,
  onCreateChapter,
  onGenerateBeats,
  isGeneratingBeats,
  onGenerateContent,
  isGeneratingContent,
  onRewriteSelectedText,
  onUpdateChapterBeats,
  generationStatus,
  novel,
  projectPreferenceProfile,
  onPreferenceProfileChange,
  onSwitchTab,
}: PlanningTabProps) {
  const liveProfile = projectPreferenceProfile || novel.projectPreferenceProfile;
  const novelWithLiveProfile = { ...novel, projectPreferenceProfile: liveProfile };

  const activeProfile = inferNovelGovernanceProfile(novelWithLiveProfile);
  const activeSeriesId = liveProfile?.capabilityProfile?.activeFlowId
    || liveProfile?.activeSeriesId
    || activeProfile.activeSeriesId
    || 'generic-novel-flow';

  const pkg = getFlowEnhancementPackage(activeSeriesId);
  const isRestricted = Boolean(pkg && isPackageRestricted(pkg.id, liveProfile?.commercialMode || 'free') && !canUseEnhancedCapability({
    commercialMode: liveProfile?.commercialMode,
  }));

  const currentStepId = getNovelCurrentStepId(novelWithLiveProfile, activeSeriesId);
  const completedStepIds = getNovelCompletedStepIds(novelWithLiveProfile, activeSeriesId);

  const flow = SKILL_SERIES_FLOWS.find(f => f.id === activeSeriesId) || SKILL_SERIES_FLOWS[1];

  // If the "completed-flow" tag exists, the entire flow is done.
  // This prevents a fallback to step 1 when no current-step tag is present.
  const isFlowCompleted = (liveProfile?.tags || []).includes(`completed-flow:${activeSeriesId}`);

  const currentStepIdOrDefault = isFlowCompleted
    ? flow.steps[flow.steps.length - 1].id  // keep showing the last step as "current"
    : currentStepId;
  const currentStepIndex = flow.steps.findIndex(s => s.id === currentStepIdOrDefault);
  const currentStep = currentStepIndex !== -1 ? flow.steps[currentStepIndex] : flow.steps[0];
  const displayStepNumber = currentStepIndex !== -1 ? currentStepIndex + 1 : 1;
  const isLastStep = !currentStep.nextStepId;

  const [isSavingStep, setIsSavingStep] = React.useState(false);
  const [stepError, setStepError] = React.useState<string | null>(null);
  const nextStep = isLastStep ? null : flow.steps[currentStepIndex + 1] || null;

  const handleNextStep = async () => {
    if (isRestricted && pkg) {
      dispatchCapabilityUnavailable({
          limitType: 'extractSkill',
          packageName: pkg.name,
          packageDesc: pkg.description,
          novelId: novel.id,
      });
      return;
    }

    if (!onPreferenceProfileChange || isSavingStep) return;

    setIsSavingStep(true);
    try {
      const nextStepId = currentStep.nextStepId;
      const profile = liveProfile || {
        tags: [],
        weights: { styleWeight: 0.2, characterWeight: 0.2, worldWeight: 0.2, plotWeight: 0.2, pacingWeight: 0.2 },
        acceptedDimensions: [],
        rejectedDimensions: [],
        notes: [],
        evidenceCount: 0
      };

      const oldTags = profile.tags || [];
      const otherTags = oldTags.filter(
        t => !t.startsWith(`current-step:${activeSeriesId}:`) &&
             !t.startsWith(`completed-step:${activeSeriesId}:`)
      );

      const newCompletedSet = new Set(completedStepIds);
      newCompletedSet.add(currentStep.id);
      const newCompletedList = Array.from(newCompletedSet);

	      const completedTags = newCompletedList.map(id => `completed-step:${activeSeriesId}:${id}`);
	      const newTags = [...otherTags, ...completedTags];
	      if (nextStepId) {
	        newTags.push(`current-step:${activeSeriesId}:${nextStepId}`);
	      } else {
	        // Last step — mark the entire flow as completed so we never
	        // fall back to step 1 when the current-step tag is absent.
	        newTags.push(`completed-flow:${activeSeriesId}`);
	      }

	      const updatedProfile: ProjectPreferenceProfile = {
	        ...profile,
	        tags: newTags
	      };

	      await onPreferenceProfileChange(updatedProfile);

	      setStepError(null);

	      // Navigate based on the NEXT step's designated target tab.
	      // When step 1 (脑洞灵感闪耀) completes, nextStep is step 2
	      // (世界观架构设定) whose navigateTo:'bible' sends the user to
	      // the bible tab.  Steps with no navigateTo stay on planning.
	      const navigateTo = nextStep?.navigateTo as AgentTab | undefined;
	      if (navigateTo && onSwitchTab) {
	        onSwitchTab(navigateTo);
	      }
    } catch (e) {
      console.error('Failed to advance step:', e);
      setStepError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setIsSavingStep(false);
    }
  };

  const handleResetFlow = async () => {
    if (!onPreferenceProfileChange) return;
    const profile = liveProfile || {
      tags: [],
      weights: { styleWeight: 0.2, characterWeight: 0.2, worldWeight: 0.2, plotWeight: 0.2, pacingWeight: 0.2 },
      acceptedDimensions: [],
      rejectedDimensions: [],
      notes: [],
      evidenceCount: 0
    };

    const oldTags = profile.tags || [];
    const newTags = oldTags.filter(
      t => !t.startsWith(`current-step:${activeSeriesId}:`) &&
           !t.startsWith(`completed-step:${activeSeriesId}:`) &&
           !t.startsWith(`completed-flow:${activeSeriesId}`)
    );
    // Restore step 1 as the current step after reset.
    const firstStep = flow.steps[0];
    if (firstStep) {
      newTags.push(`current-step:${activeSeriesId}:${firstStep.id}`);
    }

    const updatedProfile: ProjectPreferenceProfile = {
      ...profile,
      tags: newTags
    };

    await onPreferenceProfileChange(updatedProfile);
  };

  return (
    <div className="space-y-6">
      {/* 磨砂玻璃态当前创作流程向导栏 (Premium Glassmorphism Workflow Banner) */}
      <div className="relative overflow-hidden rounded-2xl border border-theme-border/50 bg-theme-sidebar/60 backdrop-blur-md p-5 shadow-lg transition-all duration-300 hover:shadow-xl group">
        {/* 顶部 OKLCH 霓虹渐变发光灯带 (Neon Ambient Glow) */}
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500 via-indigo-500 to-pink-500 opacity-80" />
        
        <div className="flex flex-col justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-theme-accent/10 text-theme-accent border border-theme-accent/20">
                <Compass size={10} className="animate-spin-slow" aria-hidden="true" />
                {flow.name}
              </span>
              {isRestricted && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-amber-500/20 to-pink-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0">
                  内测增强
                </span>
              )}
              <span className="text-xs font-semibold text-theme-muted">
                步骤 {displayStepNumber} / {flow.steps.length}
              </span>
            </div>
            
            <h4 className="text-base font-bold text-theme-text flex items-center gap-1.5 leading-snug">
              {currentStep.name}
            </h4>
            
            <p className="text-xs text-theme-muted leading-relaxed max-w-[55ch]">
              {currentStep.description}
            </p>

            {/* 必填质量门栏提示 (Quality Gate Indicator) */}
            <div className="flex items-start gap-1.5 mt-2 bg-theme-accent/5 rounded-lg p-2.5 border border-theme-accent/10 max-w-[55ch]">
              <Lightbulb size={14} className="text-theme-accent shrink-0 mt-0.5 animate-pulse" aria-hidden="true" />
              <div className="space-y-0.5">
                <span className="text-[10px] font-bold text-theme-accent uppercase tracking-wider block">质量检查门栏 (Quality Gate)</span>
                <span className="text-xs text-theme-muted leading-relaxed block">{currentStep.qualityGate}</span>
              </div>
            </div>

            {stepError && (
              <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-600 dark:text-red-400">
                {stepError}
              </div>
            )}
          </div>

          <div className="flex w-full min-w-0 flex-col items-stretch justify-center gap-2">
            {!isFlowCompleted && (
<button
                onClick={handleNextStep}
                disabled={isSavingStep}
                className="w-full min-w-0 whitespace-normal px-4 py-2.5 text-center leading-relaxed bg-gradient-to-r from-theme-accent to-indigo-600 text-white rounded-xl text-xs font-bold shadow-md shadow-theme-accent/10 hover:shadow-lg hover:shadow-theme-accent/20 hover:opacity-95 transition-all duration-300 flex items-center justify-center gap-1.5 group-hover:translate-x-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSavingStep ? (
                  <>
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    保存中...
                  </>
                ) : isLastStep ? (
                  <>
                    <CheckCircle2 size={14} aria-hidden="true" />
                  完成全流程创作
                </>
              ) : (
                <>
                  完成本步并前往：{nextStep?.name || ''}
                  <ArrowRight size={14} aria-hidden="true" />
                </>
              )}
            </button>
            )}

            {(completedStepIds.length > 0 || isFlowCompleted) && (
              <button
                onClick={handleResetFlow}
                className="px-3 py-1.5 bg-transparent hover:bg-theme-border/20 text-theme-muted hover:text-theme-text rounded-lg text-[10px] font-semibold transition-all duration-200 flex items-center justify-center gap-1"
              >
                <RefreshCcw size={10} aria-hidden="true" />
                重置流程进度
              </button>
            )}
          </div>
        </div>
        {isFlowCompleted && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" />
            <span>🎉 全流程已完成！所有创作步骤均已标记完成。</span>
          </div>
        )}
      </div>
      {renderContextReceipt()}
      <div className="space-y-4">
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
          <h3 className="text-xs font-bold text-theme-text mb-2 flex items-center gap-2">
            <ListOrdered size={14} className="text-theme-accent" aria-hidden="true" />
            创作意图
          </h3>
          <textarea
            data-prompt-surface="workspace-beats"
            value={userIntent}
            onChange={(e) => setUserIntent(e.target.value)}
            placeholder="请描述本章创作意图，例如：从当前剧情位置续写，推进XX冲突，或主角在酒馆偶遇了女二..."
            className="w-full h-24 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-sm text-theme-text placeholder:text-theme-muted/60 resize-none shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
          />
          {!currentChapter ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-theme-muted">
                当前还没有章节上下文。创建第一章后即可开始生成分镜。
              </p>
              {onCreateChapter && (
                <button
                  onClick={() => void onCreateChapter()}
                  className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2"
                >
                  <Plus size={16} aria-hidden="true" /> 创建第一章并开始分镜
                </button>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={() => void onGenerateBeats()}
                disabled={isGeneratingBeats}
                className="w-full mt-3 py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isGeneratingBeats ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                {isGeneratingBeats ? '规划中...' : '生成场景分镜（快捷操作）'}
              </button>
              <p className="text-[10px] text-theme-muted mt-1 text-center">推荐先完成"世界与角色设定"再生成分镜，避免两个主操作竞争</p>
            </>
          )}
        </div>

        {currentChapter ? (
          <div className="space-y-3">
            <div
              className={cn(
                'bg-theme-sidebar p-5 rounded-2xl border border-theme-border/40 shadow-sm relative overflow-hidden group',
                !currentChapter.sceneBeats && 'opacity-50',
              )}
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">当前场景分镜规划</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => void onGenerateContent()}
                    disabled={isGeneratingContent || !currentChapter.sceneBeats}
                    className="flex items-center gap-1.5 px-3 py-1 bg-theme-accent text-white rounded-lg text-[10px] font-bold shadow-sm hover:opacity-90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200"
                  >
                    {isGeneratingContent ? <Loader2 size={10} className="animate-spin" aria-hidden="true" /> : <Feather size={10} aria-hidden="true" />}
                    {isGeneratingContent ? '扩写中…' : 'AI 扩写正文'}
                  </button>
                  <button
                    onClick={() => void onRewriteSelectedText()}
                    disabled={isGeneratingContent}
                    className="flex items-center gap-1.5 px-3 py-1 bg-theme-sidebar text-theme-text rounded-lg text-[10px] font-bold shadow-sm border border-theme-border hover:bg-theme-border/50 disabled:opacity-50 transition-[background-color,border-color,opacity,box-shadow] duration-200"
                  >
                    <Sparkles size={10} aria-hidden="true" />
                    选中改写
                  </button>
                </div>
              </div>
              <textarea
                data-prompt-surface="workspace-beats"
                value={currentChapter.sceneBeats || ''}
                onChange={(e) => onUpdateChapterBeats(e.target.value)}
                placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."
                className="w-full h-64 bg-theme-sidebar/10 border-none p-0 text-sm text-theme-text placeholder:text-theme-muted/40 resize-none scrollbar-none font-serif leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/20 rounded-lg"
              />
            </div>

            {isGeneratingContent ? (
              <div className="flex items-center justify-center p-4 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 text-xs text-theme-muted gap-2">
                <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Writer Agent 正在执笔中...
              </div>
            ) : null}
            {generationStatus ? (
              <div className="rounded-xl border border-theme-border/40 bg-theme-sidebar/20 px-3 py-2 text-xs text-theme-muted">
                {generationStatus}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
