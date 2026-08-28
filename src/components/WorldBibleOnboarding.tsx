import React, { useEffect, useState } from 'react';
import { Globe, Sparkles } from 'lucide-react';
import { SetupTaskDraft, StoryIdeaCard } from '../../shared/types';
import { SetupTaskCard } from './onboarding/SetupTaskCard';
import { SetupAssistantPanel } from './onboarding/SetupAssistantPanel';
import { CURATED_PRODUCT_SKILLS, SKILL_SERIES_FLOWS } from '../../shared/lib/public-skill-catalog';
import { filterGovernedAssets, getGovernedStageRecommendations } from '../lib/capability-governance';

export function WorldBibleOnboarding({
  onboarding,
  isGlobalAssistantOpen = false,
}: {
  onboarding: {
    card?: StoryIdeaCard;
    tasks: SetupTaskDraft[];
    activeTask?: SetupTaskDraft;
    onSelectTask: (key: SetupTaskDraft['key']) => void;
    onConfirmTask: (key: SetupTaskDraft['key']) => void;
    assistantInput: string;
    onAssistantInputChange: (value: string) => void;
    onAssistantSubmit: () => void;
    assistantLoading: boolean;
    assistantError?: string | null;
    completedCount: number;
    canEnterEditor: boolean;
    onEnterEditor: () => void;
    acceptedSkillIds: string[];
    recommendedSkills: Array<{
      skillId: string;
      skillName: string;
      reason: string;
    }>;
    acceptedRecommendedSkills: boolean;
    onAcceptRecommendedSkills: () => void;
  };
  isGlobalAssistantOpen?: boolean;
}) {
  const [showCapabilityRecommendations, setShowCapabilityRecommendations] = useState(true);
  const stageRecommendations = getGovernedStageRecommendations('creative-setup');
  const defaultGuardrail = filterGovernedAssets(CURATED_PRODUCT_SKILLS, 'guardrail')[0];
  const optionalOverlay = stageRecommendations.find((entry) => entry.capability === 'overlay')?.asset;
  const defaultFlow = SKILL_SERIES_FLOWS.find((flow) => flow.id === 'generic-novel-flow');
  // 核心状态：设定助手抽屉是否开启。
  // 遵循 Google 编程规范，此处采用惰性初始化（Lazy Initialization）安全读取 localStorage，
  // 支持从欢迎页（WelcomeView）的“补全世界观与角色”动作一键自适应路由并静默触发助手面板。
  const [isAssistantOpen, setIsAssistantOpen] = useState(() => {
    try {
      const shouldAutoOpen = localStorage.getItem('inkflow_auto_open_bible_assistant') === 'true';
      if (shouldAutoOpen) {
        // 消费后立即安全抹除该临时标识，保证无残留垃圾，且后续用户手动刷新时不会重复弹出
        localStorage.removeItem('inkflow_auto_open_bible_assistant');
        return true;
      }
    } catch {
      // localStorage 不可用时保持本地助手关闭，继续提供手动入口。
    }
    return false;
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close local drawer when global drawer opens
    if (isGlobalAssistantOpen) setIsAssistantOpen(false);
  }, [isGlobalAssistantOpen]);

  return (
    <div className="h-full flex flex-col bg-transparent">
      <header className="px-8 py-6 border-b border-theme-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-theme-text flex items-center gap-3">
            <Globe className="text-theme-accent" />
            设定记忆引导
          </h1>
          <p className="text-sm text-theme-muted mt-1">可以先写正文，设定骨架随时补全。</p>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-theme-text">{onboarding.completedCount} / 3 项核心设定已确认</div>
          <p className="mt-1 text-xs text-theme-muted">
            设定越完整，后续生成越稳
          </p>
        </div>
      </header>

      <div className="px-8 py-5 border-b border-theme-border/60 bg-theme-bg/40">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-bold text-theme-text">当前阶段：故事方案已选，正在补全设定骨架</span>
          <span className="text-theme-muted">{Math.min(onboarding.completedCount, 3)} / 3</span>
        </div>
        <div className="h-2 rounded-full bg-theme-sidebar">
          <div
            className="h-2 rounded-full bg-theme-accent transition-all"
            style={{ width: `${Math.min((onboarding.completedCount / 3) * 100, 100)}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-8 py-8 relative">
        <div className="h-full">
          <section className="h-full overflow-y-auto pr-1">
            <div className="mb-5">
              <h2 className="text-2xl font-serif font-bold text-theme-text">关键设定任务</h2>
              <p className="mt-1 text-sm text-theme-muted">左侧确认故事骨架，右侧随时插话干预设定走向。</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {onboarding.tasks.map((task) => (
                <SetupTaskCard
                  key={task.key}
                  task={task}
                  active={task.key === onboarding.activeTask?.key}
                  onSelect={() => onboarding.onSelectTask(task.key)}
                  onConfirm={() => onboarding.onConfirmTask(task.key)}
                />
              ))}
            </div>
            <div className="mt-6 rounded-3xl border border-theme-border bg-theme-sidebar p-5 shadow-sm">
              {showCapabilityRecommendations && (
                <div className="mb-5 rounded-2xl border border-theme-accent/25 bg-theme-accent/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-serif font-bold text-theme-text">本阶段能力建议</h3>
                      <p className="mt-1 text-sm text-theme-muted">只展示建议，不会自动应用；可稍后在作品能力中心调整。</p>
                    </div>
                    <button type="button" onClick={() => setShowCapabilityRecommendations(false)} className="text-xs text-theme-muted hover:text-theme-text">稍后调整</button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-theme-border/60 bg-theme-sidebar px-3 py-2">
                      <div className="text-[10px] font-bold text-theme-accent">创作流程</div>
                      <div className="mt-1 text-xs font-semibold text-theme-text">{defaultFlow?.name || '通用创作流程'}</div>
                    </div>
                    <div className="rounded-xl border border-theme-border/60 bg-theme-sidebar px-3 py-2">
                      <div className="text-[10px] font-bold text-theme-accent">系统护栏</div>
                      <div className="mt-1 text-xs font-semibold text-theme-text">{defaultGuardrail?.title || '系统默认护栏'}</div>
                    </div>
                    <div className="rounded-xl border border-theme-border/60 bg-theme-sidebar px-3 py-2">
                      <div className="text-[10px] font-bold text-theme-accent">本章使用卡（可选）</div>
                      <div className="mt-1 text-xs font-semibold text-theme-text">{optionalOverlay?.title || '暂无本章使用卡'}</div>
                    </div>
                  </div>
                </div>
              )}
              {onboarding.recommendedSkills.length > 0 && (
                <div className="mb-5 rounded-2xl border border-theme-border bg-theme-bg/40 p-4">
                  <div className="mb-3">
                    <h3 className="text-base font-serif font-bold text-theme-text">推荐的角色写作配置</h3>
                    <p className="mt-1 text-sm text-theme-muted">基于你选中的故事方案，提供可选的角色写作配置；不会自动写入作品。</p>
                  </div>
                  <div className="space-y-3">
                    {onboarding.recommendedSkills.slice(0, 3).map((skill) => (
                      <div key={skill.skillId} className="rounded-2xl border border-theme-border/70 bg-theme-sidebar px-4 py-3">
                        <div className="text-sm font-bold text-theme-text">{skill.skillName}</div>
                        <p className="mt-1 text-xs leading-5 text-theme-muted">{skill.reason}</p>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={onboarding.onAcceptRecommendedSkills}
                    disabled={onboarding.acceptedRecommendedSkills}
                    className="mt-4 w-full rounded-full bg-theme-accent px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {onboarding.acceptedRecommendedSkills ? '已加入待确认配置' : '加入待确认配置'}
                  </button>
                </div>
              )}

              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-serif font-bold text-theme-text">放行到创作舞台</h3>
                  <p className="mt-1 text-sm text-theme-muted">
                    {onboarding.canEnterEditor
                      ? '骨架已经够稳，可以带着这套设定进入正文。'
                      : '设定可以稍后补全，先进入编辑器写第一版正文。'}
                  </p>
                </div>
                <button
                  onClick={onboarding.onEnterEditor}
                  className="rounded-full bg-theme-accent px-5 py-3 text-sm font-bold text-white"
                >
                  {onboarding.canEnterEditor ? '进入创作舞台' : '先写正文'}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Floating entry for Setup Assistant */}
        {!isAssistantOpen && !isGlobalAssistantOpen && (
          <button
            onClick={() => setIsAssistantOpen(true)}
            className="fixed bottom-8 right-8 z-40 flex items-center gap-2 rounded-full bg-theme-accent px-6 py-3 font-bold text-white shadow-xl transition-all hover:scale-105 active:scale-95 group"
          >
            <Sparkles size={18} className="group-hover:animate-pulse" />
            智能管家
          </button>
        )}

        {/* Setup Assistant Drawer */}
        {isAssistantOpen && (
          <>
            <div
              onClick={() => setIsAssistantOpen(false)}
              className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[2px]"
            />
            <div
              className="fixed right-0 top-0 z-50 h-full w-[420px] max-w-[90vw] border-l border-theme-border bg-theme-sidebar shadow-2xl"
            >
              <SetupAssistantPanel
                selectedTask={onboarding.activeTask}
                summaryCard={onboarding.card}
                textareaValue={onboarding.assistantInput}
                onTextareaChange={onboarding.onAssistantInputChange}
                onSubmit={onboarding.onAssistantSubmit}
                submitting={onboarding.assistantLoading}
                error={onboarding.assistantError}
                onClose={() => setIsAssistantOpen(false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
