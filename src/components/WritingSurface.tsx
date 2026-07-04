import React from 'react';
import { Activity, AlertCircle, Bot, Feather, FileText, Globe, Lightbulb, Loader2, MessageSquareWarning, Plus, Radar } from 'lucide-react';

import {
  Novel, Chapter, AssistantLaunchContext, CopilotSuggestion,
  CopilotActionKey, AgentTab
} from '../../shared/types';
import { cn } from '../lib/utils';
import { CopilotStatusBar } from './copilot/CopilotStatusBar';

interface WritingSurfaceProps {
  novel: Novel;
  currentChapter: Chapter | null;

  // States
  isGeneratingBeats: boolean;
  isGeneratingCritique: boolean;
  isGeneratingContent: boolean;
  generationStatus: string | null;
  auditStatus: string | null;
  isChapterEmpty: boolean;
  mountedSkillsCount: number;

  // Copilot
  copilotSuggestion: CopilotSuggestion | null;
  runCopilotAction: (key: CopilotActionKey) => Promise<void>;

  // Refs
  contentRef: React.RefObject<HTMLTextAreaElement | null>;

  // Handlers
  onGenerateBeats: () => Promise<void>;
  onRunAudit: () => Promise<void>;
  onUpdateContent: (content: string) => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
  buildAssistantLaunchContext: () => AssistantLaunchContext;
  onAddFirstChapter: () => Promise<void>;

  // Navigation / UI
  setAgentTab: (tab: AgentTab) => void;
  setIsAgentSidebarOpen: (open: boolean) => void;
}

export function WritingSurface({
  novel,
  currentChapter,
  isGeneratingBeats,
  isGeneratingCritique,
  isGeneratingContent,
  generationStatus,
  auditStatus,
  isChapterEmpty,
  mountedSkillsCount,
  copilotSuggestion,
  runCopilotAction,
  contentRef,
  onGenerateBeats,
  onRunAudit,
  onUpdateContent,
  onOpenAssistant,
  buildAssistantLaunchContext,
  onAddFirstChapter,
  setAgentTab,
  setIsAgentSidebarOpen
}: WritingSurfaceProps) {
  const [prevChapterId, setPrevChapterId] = React.useState(currentChapter?.id);
  const [prevChapterContent, setPrevChapterContent] = React.useState(currentChapter?.content);
  const [localContent, setLocalContent] = React.useState(currentChapter?.content || '');

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

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 xl:px-8 py-5 scroll-smooth flex flex-col relative">
      <div className="w-full self-stretch min-w-0 flex-1 flex flex-col relative transition-all duration-500 gap-4">
        {currentChapter ? (
          <>
            <div className="w-full min-w-0 flex flex-col gap-4">
              <section className="w-full min-w-0 rounded-3xl border border-theme-border bg-theme-sidebar shadow-sm px-5 py-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-theme-muted font-bold">创作舞台</p>
                    <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-2xl font-serif font-semibold text-theme-text">
                          {currentChapter.title || '未命名章节'}
                        </h3>
                        <p className="text-sm text-theme-muted mt-1 max-w-3xl">
                          {isChapterEmpty
                            ? '先选一种起手方式，然后把正文直接写进下面的主编辑器。现在不再保留右侧常驻空白位。'
                            : '正文编辑器已经是主舞台。分镜、审计和智能管家改成覆盖式抽屉，不再挤占写作宽度。'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/50 border border-theme-border text-xs text-theme-muted">字数 {currentChapter.wordCount || 0}</span>
                        <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/50 border border-theme-border text-xs text-theme-muted">技能 {mountedSkillsCount}</span>
                        <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/50 border border-theme-border text-xs text-theme-muted">token ~2.4k</span>
                      </div>
                    </div>
                  </div>

                  <div className="w-full xl:w-[360px] rounded-2xl border border-theme-border bg-theme-sidebar/18 p-4">
                    <div className="flex items-center gap-2 text-theme-text font-medium">
                      <Globe size={16} className="text-theme-accent" />
                      世界观上下文
                    </div>
                    <p className="mt-2 text-sm text-theme-muted line-clamp-4">
                      {novel.worldRules || novel.summary || '当前还没有完整设定，建议先补齐世界观、人物和技能挂载。'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-theme-muted">
                      <span className="px-2 py-1 rounded-full bg-theme-sidebar border border-theme-border">步骤 1 分镜</span>
                      <span className="px-2 py-1 rounded-full bg-theme-sidebar border border-theme-border">步骤 2 正文</span>
                      <span className="px-2 py-1 rounded-full bg-theme-sidebar border border-theme-border">步骤 3 审计</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => contentRef.current?.focus()}
                    className="px-3.5 py-2 rounded-xl bg-theme-text text-white hover:opacity-90 transition-opacity text-sm font-medium flex items-center gap-2"
                  >
                    <Feather size={15} />
                    直接开始写
                  </button>
                  <button
                    onClick={() => {
                      setAgentTab('planning');
                      setIsAgentSidebarOpen(true);
                      void onGenerateBeats();
                    }}
                    disabled={isGeneratingBeats}
                    className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar hover:bg-theme-sidebar/45 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                  >
                    {isGeneratingBeats ? <Loader2 size={15} className="animate-spin text-theme-accent" /> : <Radar size={15} className="text-theme-accent" />}
                    生成分镜
                  </button>
                  <button
                    onClick={() => {
                      setAgentTab('production');
                      setIsAgentSidebarOpen(true);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar hover:bg-theme-sidebar/45 transition-colors text-sm font-medium flex items-center gap-2"
                  >
                    <Bot size={15} className="text-theme-accent" />
                    自动生产一章
                  </button>
                  <button
                    onClick={() => {
                      if (onOpenAssistant) {
                        onOpenAssistant(buildAssistantLaunchContext());
                        return;
                      }
                      setIsAgentSidebarOpen(true);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar hover:bg-theme-sidebar/45 transition-colors text-sm font-medium flex items-center gap-2"
                  >
                    <Lightbulb size={15} className="text-theme-accent" />
                    带上下文打开灵感助手
                  </button>
                  <button
                    onClick={onRunAudit}
                    disabled={isGeneratingCritique || isChapterEmpty}
                    className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar hover:bg-theme-sidebar/45 transition-colors text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                  >
                    {isGeneratingCritique ? <Loader2 size={15} className="animate-spin text-theme-accent" /> : <MessageSquareWarning size={15} className="text-theme-accent" />}
                    审计正文
                  </button>
                </div>
              </section>

              <div className="w-full min-w-0 rounded-3xl border border-theme-border/80 bg-[#fcfbf8] shadow-md overflow-hidden">
                <div className="px-5 py-3 border-b border-theme-border/80 bg-gradient-to-r from-[#fffdf8] to-theme-sidebar/35">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-theme-muted font-bold">正文草稿</p>
                      <p className="text-sm text-theme-text/75 mt-1">这里是主写作区，当前布局不再预留右侧常驻侧栏，整行宽度优先给正文。</p>
                      {generationStatus ? (
                        <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-theme-accent/10 px-3 py-1 text-xs font-bold text-theme-accent">
                          <Loader2 size={12} className={isGeneratingContent ? 'animate-spin' : ''} />
                          {generationStatus}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-theme-muted shrink-0">
                      <span className="px-2 py-1 rounded-full bg-theme-sidebar/60 border border-theme-border">自动保存</span>
                      <span className="px-2 py-1 rounded-full bg-theme-sidebar/60 border border-theme-border">本地草稿</span>
                    </div>
                  </div>
                </div>
                {copilotSuggestion && (
                  <CopilotStatusBar
                    suggestion={copilotSuggestion}
                    onPrimaryAction={(key) => void runCopilotAction(key)}
                    onOpen={() => {
                      setAgentTab('copilot-home');
                      setIsAgentSidebarOpen(true);
                    }}
                  />
                )}
                <textarea
                  ref={contentRef}
                  value={localContent}
                  onChange={(e) => setLocalContent(e.target.value)}
                  readOnly={isGeneratingContent}
                  placeholder="在这里开始书写这一章……"
                  className={cn(
                    "w-full max-w-[72ch] mx-auto bg-[linear-gradient(180deg,rgba(250,247,241,0.92)_0%,rgba(255,255,255,1)_18%)] resize-none writing-surface text-theme-text placeholder:text-slate-400 transition-colors font-serif p-8 md:p-10 focus-visible:ring-0 block",
                    isChapterEmpty ? "min-h-[68vh] lg:min-h-[calc(100vh-12rem)]" : "min-h-[80vh] lg:min-h-[calc(100vh-12rem)]"
                  )}
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4">
                <div className={cn(
                  "rounded-3xl border px-4 py-4",
                  isChapterEmpty
                    ? "border-dashed border-theme-border bg-theme-sidebar/15"
                    : "border-theme-border bg-theme-sidebar"
                )}>
                  <div className="flex items-center gap-2 text-theme-text font-medium">
                    {isChapterEmpty ? <AlertCircle size={16} className="text-theme-accent" /> : <Activity size={16} className="text-theme-accent" />}
                    {isChapterEmpty ? '开始建议' : '写作状态'}
                  </div>
                  <p className="mt-2 text-sm text-theme-muted">
                    {isChapterEmpty
                      ? '建议顺序：先分镜，再落正文；或者直接开写，随后再让 AI 审计。'
                      : '当前章节已进入正文阶段。你可以继续写，或唤醒智能管家检查伏笔、人物一致性和节奏。'}
                  </p>
                  {(generationStatus || auditStatus) && (
                    <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-theme-accent/20 bg-theme-accent/5 px-3 py-1.5 text-xs font-medium text-theme-accent">
                      <Loader2 size={12} className="animate-spin shrink-0" />
                      <span className="truncate">{generationStatus || auditStatus}</span>
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-theme-border bg-theme-sidebar px-4 py-4">
                  <div className="flex items-center gap-2 text-theme-text font-medium">
                    <Bot size={16} className="text-theme-accent" />
                    智能管家入口
                  </div>
                  <p className="mt-2 text-sm text-theme-muted">
                    智能管家现在改成覆盖式抽屉，不再占住右侧常驻空间。需要时再打开，用完就收起。
                  </p>
                  <button
                    onClick={() => setIsAgentSidebarOpen(true)}
                    className="mt-3 px-3.5 py-2 rounded-xl bg-theme-accent text-white hover:bg-theme-accent/90 transition-colors text-sm font-medium inline-flex items-center gap-2"
                  >
                    <Bot size={15} />
                    打开智能管家
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div id="editor-empty-state" className="flex-1 flex flex-col items-center justify-center text-theme-muted opacity-100 min-h-[60vh] bg-theme-sidebar rounded-3xl shadow-sm border border-theme-border m-4 md:m-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-theme-sidebar/50 to-theme-border/20 z-0" />
            <div className="z-10 flex flex-col items-center">
              <div className="w-24 h-24 bg-theme-accent/10 rounded-full flex items-center justify-center mb-6 shadow-inner">
                <FileText size={40} className="text-theme-accent" />
              </div>
              <h3 className="text-3xl font-serif text-theme-text mb-3 font-black tracking-tight">准备开始创作</h3>
              <p className="mb-10 font-sans text-base text-theme-muted max-w-md text-center leading-relaxed">当前作品还没有任何章节，请点击下方按钮一键开始您的第一章，或者唤起智能管家协助构思。</p>
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
}
