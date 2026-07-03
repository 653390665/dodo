import React, { useState } from 'react';
import { Globe, Sparkles } from 'lucide-react';
import { SetupTaskDraft, StoryIdeaCard } from '../../shared/types';
import { SetupTaskCard } from './onboarding/SetupTaskCard';
import { SetupAssistantPanel } from './onboarding/SetupAssistantPanel';

export function WorldBibleOnboarding({
  onboarding,
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
    completedCount: number;
    canEnterEditor: boolean;
    onEnterEditor: () => void;
    recommendedSkills: Array<{
      skillId: string;
      skillName: string;
      reason: string;
    }>;
    acceptedRecommendedSkills: boolean;
    onAcceptRecommendedSkills: () => void;
  };
}) {
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);

  return (
    <div className="h-full flex flex-col bg-transparent">
      <header className="px-8 py-6 border-b border-theme-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-bold text-theme-text flex items-center gap-3">
            <Globe className="text-theme-accent" />
            设定记忆引导
          </h1>
          <p className="text-sm text-theme-muted mt-1">先把这部作品的骨架立住，再进入正式创作舞台。</p>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold text-theme-text">{onboarding.completedCount} / 3 项核心设定已确认</div>
          <p className="mt-1 text-xs text-theme-muted">
            至少确认 3 项后即可进入正文写作
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
              {onboarding.recommendedSkills.length > 0 && (
                <div className="mb-5 rounded-2xl border border-theme-border bg-theme-bg/40 p-4">
                  <div className="mb-3">
                    <h3 className="text-base font-serif font-bold text-theme-text">推荐 Skill 装配</h3>
                    <p className="mt-1 text-sm text-theme-muted">基于你选中的故事方案，先给这部作品挂上最顺手的 3 张卡。</p>
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
                    {onboarding.acceptedRecommendedSkills ? '已装配推荐 Skill' : '一键接受推荐 Skill'}
                  </button>
                </div>
              )}

              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-serif font-bold text-theme-text">放行到创作舞台</h3>
                  <p className="mt-1 text-sm text-theme-muted">
                    {onboarding.canEnterEditor
                      ? '骨架已经够稳，可以带着这套设定进入正文。'
                      : `还差 ${Math.max(3 - onboarding.completedCount, 0)} 项核心设定确认。`}
                  </p>
                </div>
                <button
                  onClick={onboarding.onEnterEditor}
                  disabled={!onboarding.canEnterEditor}
                  className="rounded-full bg-theme-accent px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
                >
                  进入创作舞台
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Floating entry for Setup Assistant */}
        {!isAssistantOpen && (
          <button
            onClick={() => setIsAssistantOpen(true)}
            className="fixed bottom-8 right-8 z-40 flex items-center gap-2 rounded-full bg-theme-accent px-6 py-3 font-bold text-white shadow-xl transition-all hover:scale-105 active:scale-95 group"
          >
            <Sparkles size={18} className="group-hover:animate-pulse" />
            设定助手
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
                onClose={() => setIsAssistantOpen(false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
