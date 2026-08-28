import React from 'react';
import { Bot, FileText, Loader2, MessageSquareWarning, Plus, Radar, RefreshCw, Sparkles } from 'lucide-react';

import {
  Novel, Chapter, CopilotActionKey, AgentTab, ViewType,
} from '../../shared/types';
import { cn } from '../lib/utils';
import { deriveProjectWorkflowState, type WorkflowSyncState } from '../lib/workflow-state';
import { writeContinuationSyncIntent } from '../lib/continuation-sync-intent';

interface WritingSurfaceProps {
  novel: Novel;
  currentChapter: Chapter | null;
  chapterLoading?: boolean;

  // States
  isGeneratingBeats: boolean;
  isGeneratingCritique: boolean;
  isGeneratingContent: boolean;
  isCompletingChapter?: boolean;
  generationStatus: string | null;
  auditStatus: string | null;
  auditUnknownFeedback?: string | null;
  isChapterEmpty: boolean;
  mountedSkillsCount: number;

  runCopilotAction: (key: CopilotActionKey) => Promise<void>;

  // Refs
  contentRef: React.RefObject<HTMLTextAreaElement | null>;

  // Handlers
  onGenerateBeats: () => Promise<void>;
  onRunAudit: () => Promise<void>;
  onCompleteChapter?: () => Promise<void>;
  onConfirmFacts?: () => Promise<void>;
  onUpdateContent: (content: string) => void;
  onQueueContentWrite: (content: string) => void;
  onAddFirstChapter: () => Promise<void>;
  onAddChapter: () => Promise<void>;

  // Navigation / UI
  setAgentTab: (tab: AgentTab) => void;
  setIsAgentSidebarOpen: (open: boolean) => void;
  onNavigate?: (view: ViewType) => void;
  packStatus?: 'approved' | 'draft' | 'none';
  syncState?: WorkflowSyncState;
  packId?: string;
}

export const WritingSurface = React.memo(function WritingSurface({
  novel,
  currentChapter,
  chapterLoading = false,
  isGeneratingBeats,
  isGeneratingCritique,
  isGeneratingContent,
  isCompletingChapter = false,
  generationStatus,
  auditStatus: _auditStatus,
  auditUnknownFeedback = null,
  isChapterEmpty,
  mountedSkillsCount,
  runCopilotAction,
  contentRef,
  onGenerateBeats,
  onRunAudit,
  onCompleteChapter,
  onConfirmFacts,
  onUpdateContent,
  onQueueContentWrite,
  onAddFirstChapter,
  onAddChapter,
  setAgentTab,
  setIsAgentSidebarOpen,
  onNavigate,
  packStatus = 'none',
  syncState = 'not-required',
  packId
}: WritingSurfaceProps) {
  const [prevChapterId, setPrevChapterId] = React.useState(currentChapter?.id);
  const [prevChapterContent, setPrevChapterContent] = React.useState(currentChapter?.content);
  const [localContent, setLocalContent] = React.useState(currentChapter?.content || '');
  const chapterHeadingId = currentChapter ? `editor-chapter-heading-${currentChapter.id}` : undefined;

  const workflowState = React.useMemo(() => deriveProjectWorkflowState({
    loading: chapterLoading,
    chapter: currentChapter,
    packStatus,
    syncState,
  }), [chapterLoading, currentChapter, packStatus, syncState]);

  if (currentChapter?.id !== prevChapterId || currentChapter?.content !== prevChapterContent) {
    setPrevChapterId(currentChapter?.id);
    setPrevChapterContent(currentChapter?.content);
    setLocalContent(currentChapter?.content || '');
  }

  // 2. 300ms 异步防抖提交至父级受控状态，消除打字 Input Lag
  React.useEffect(() => {
    if (!currentChapter) return;
    const timer = setTimeout(() => {
      if (localContent !== (currentChapter.content || '')) {
        onUpdateContent(localContent);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [localContent, onUpdateContent, currentChapter]);

  const primaryActionLabel = workflowState.primaryAction === 'review' ? '审核资料包'
    : workflowState.primaryAction === 'sync' ? '接入本章上下文'
        : workflowState.primaryAction === 'planning' || workflowState.primaryAction === 'generate-plan' ? '生成分镜'
        : workflowState.primaryAction === 'drafting' || workflowState.primaryAction === 'generate-prose' ? '生成一章预览'
          : workflowState.primaryAction === 'complete-chapter' ? '完成本章'
            : workflowState.primaryAction === 'audit' ? '审计正文'
            : workflowState.primaryAction === 'polish' || workflowState.primaryAction === 'resolve-issues' ? '处理审阅问题'
              : workflowState.primaryAction === 'next_chapter' || workflowState.primaryAction === 'create-next-chapter' ? '创建下一章'
                : workflowState.primaryAction === 'confirm-facts' ? '确认事实'
              : null;

  const runPrimaryAction = () => {
    switch (workflowState.primaryAction) {
      case 'review':
      case 'sync':
        if (!packId) return;
        writeContinuationSyncIntent({ intentId: '', createdAt: 0, novelId: novel.id, packId });
        onNavigate?.('world');
        return;
      case 'planning':
      case 'generate-plan':
        setAgentTab('planning');
        setIsAgentSidebarOpen(true);
        void onGenerateBeats();
        return;
      case 'drafting':
      case 'generate-prose':
        setAgentTab('production');
        setIsAgentSidebarOpen(true);
        return;
      case 'audit':
        void onRunAudit();
        return;
      case 'resolve-issues':
        setAgentTab('quality');
        setIsAgentSidebarOpen(true);
        return;
      case 'complete-chapter':
        void onCompleteChapter?.();
        return;
      case 'polish':
        void runCopilotAction('run-polish');
        return;
      case 'next_chapter':
      case 'create-next-chapter':
        void onAddChapter();
        return;
      case 'confirm-facts':
        void onConfirmFacts?.();
        return;
      default:
        return;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 xl:px-8 py-5 scroll-smooth flex flex-col relative">
      <div className="w-full self-stretch min-w-0 flex-1 flex flex-col relative transition-all duration-500 gap-4">
        {chapterLoading ? (
          <div className="min-h-[55vh] flex items-center justify-center text-sm text-theme-muted" role="status">
            <Loader2 size={20} className="mr-2 animate-spin" aria-hidden="true" />
            正在加载完整章节…
          </div>
        ) : currentChapter ? (
          <div className="w-full min-w-0 grid grid-cols-1 gap-6 items-start">
            {/* 左侧主创作栏 (Main Stage Column) */}
            <div className="min-w-0 flex flex-col gap-6">
              {/* 1. 简洁精美的章节头部 (Elegant Chapter Header) */}
              <div className="w-full min-w-0 flex flex-col gap-2 pb-5 border-b border-theme-border/40">
                <p className="text-[11px] uppercase tracking-[0.22em] text-theme-muted font-bold">创作舞台</p>
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                  <div className="min-w-0">
                    <h3 id={chapterHeadingId} className="text-2xl font-serif font-bold text-theme-text tracking-tight">
                      {currentChapter.title || '未命名章节'}
                    </h3>
                    <p className="text-sm text-theme-muted mt-1 max-w-xl leading-relaxed">
                      {isChapterEmpty
                        ? '先选一种起手方式，然后在下面主编辑器手写正文。'
                        : '主正文编辑器已经就绪。阶段动作会随当前章节状态自动更新。'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">字数 {currentChapter.wordCount || 0}</span>
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">能力卡 {mountedSkillsCount}</span>
                  </div>
                </div>
              </div>

              {/* 2. 主编辑器写作纸张区 (Paper-Clean Elegant Main Editor Area) */}
              <div className="w-full min-w-0 border border-theme-border/40 bg-theme-sidebar/10 rounded-2xl overflow-hidden transition-all duration-300">
                <div className="px-5 py-3 border-b border-theme-border/30 bg-theme-sidebar/20 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-theme-muted font-bold">正文草稿</p>
                    {generationStatus ? (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-theme-accent/5 px-2.5 py-0.5 text-[10px] font-bold text-theme-accent">
                        <Loader2 size={10} className={isGeneratingContent ? 'animate-spin' : ''} />
                        {generationStatus}
                      </p>
                    ) : null}
                  </div>
                </div>

                {primaryActionLabel && (
                  <div className="px-5 py-3 border-b border-theme-border/30 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={runPrimaryAction}
                      disabled={(workflowState.primaryAction === 'audit' && (isGeneratingCritique || isChapterEmpty))
                        || (workflowState.primaryAction === 'resolve-issues' && (isGeneratingCritique || isChapterEmpty))
                        || ((workflowState.primaryAction === 'planning' || workflowState.primaryAction === 'generate-plan') && isGeneratingBeats)
                        || ((workflowState.primaryAction === 'polish' || workflowState.primaryAction === 'resolve-issues') && isGeneratingContent)
                        || ((workflowState.primaryAction === 'complete-chapter' || workflowState.primaryAction === 'confirm-facts') && isCompletingChapter)
                        || ((workflowState.primaryAction === 'review' || workflowState.primaryAction === 'sync') && !packId)}
                      className="px-3.5 py-2 rounded-xl bg-theme-accent text-white hover:opacity-95 transition-opacity text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {workflowState.primaryAction === 'planning' ? <Radar size={13} />
                        : workflowState.primaryAction === 'drafting' ? <Bot size={13} />
                          : workflowState.primaryAction === 'audit' ? <MessageSquareWarning size={13} />
                            : workflowState.primaryAction === 'polish' ? <Sparkles size={13} />
                              : workflowState.primaryAction === 'next_chapter' ? <Plus size={13} />
                                : <RefreshCw size={13} />}
                      <span>{primaryActionLabel}</span>
                    </button>
                    {(workflowState.primaryAction === 'audit' || workflowState.primaryAction === 'resolve-issues') && isChapterEmpty ? (
                      <span className="text-xs text-theme-muted">正文为空，暂不能审计。</span>
                    ) : null}
                  </div>
                )}

                {auditUnknownFeedback ? (
                  <details className="mx-5 mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <summary className="cursor-pointer font-semibold">审计状态未知/未写入审稿意见</summary>
                    <p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px]">{auditUnknownFeedback}</p>
                    <button
                      type="button"
                      onClick={onRunAudit}
                      disabled={isGeneratingCritique || isChapterEmpty}
                      className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/40 px-2 py-1 text-[11px] font-semibold hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      <RefreshCw size={11} aria-hidden="true" />
                      重试审计
                    </button>
                  </details>
                ) : null}

                <textarea
                  ref={contentRef}
                  aria-labelledby={chapterHeadingId}
                  value={localContent}
                  onChange={(e) => {
                    setLocalContent(e.target.value);
                    onQueueContentWrite(e.target.value);
                  }}
                  readOnly={false}
                  placeholder="在这里开始书写这一章……"
                  className={cn(
                    "w-full max-w-[70ch] mx-auto bg-transparent resize-none writing-surface text-theme-text placeholder:text-theme-muted/40 transition-all font-serif p-6 md:p-10 focus-visible:outline-none focus-visible:ring-0 block text-lg leading-relaxed tracking-wide",
                    isChapterEmpty ? "min-h-[55vh]" : "min-h-[70vh]"
                  )}
                  style={{ lineHeight: '1.85' }}
                />
              </div>

            </div>

          </div>
        ) : (
          <div id="editor-empty-state" className="flex-1 flex flex-col items-center justify-center text-theme-muted opacity-100 min-h-[60vh] bg-theme-sidebar rounded-3xl shadow-sm border border-theme-border m-4 md:m-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-theme-sidebar/50 to-theme-border/20 z-0" />
            <div className="z-10 flex flex-col items-center">
              <div className="w-24 h-24 bg-theme-accent/10 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <FileText size={40} className="text-theme-accent" />
              </div>
              <h3 className="text-3xl font-serif text-theme-text mb-3 font-black tracking-tight">准备开始创作</h3>
              <p className="mb-10 font-sans text-base text-theme-muted max-w-md text-center leading-relaxed">当前作品还没有任何章节，请点击下方按钮新建第一章，或者唤起智能管家协助构思。</p>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <button
                  onClick={onAddFirstChapter}
                  className="px-8 py-4 bg-theme-accent text-white hover:bg-theme-accent/90 rounded-2xl flex items-center gap-3 transition-[transform,background-color,box-shadow] duration-200 hover:scale-105 font-bold shadow-lg text-lg"
                >
                  <Plus size={22} />
                  新建章节并写作
                </button>
                <button
                  onClick={() => setIsAgentSidebarOpen(true)}
                  className="px-8 py-4 bg-theme-sidebar border-2 border-theme-accent/20 hover:border-theme-accent text-theme-accent hover:bg-theme-accent/5 rounded-2xl flex items-center gap-3 transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-1 font-bold shadow-md text-lg"
                >
                  <Bot size={22} />
                  唤起 AI 智能管家
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
});
