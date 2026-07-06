import React from 'react';
import { Activity, AlertCircle, Bot, Feather, FileText, Globe, Lightbulb, Loader2, MessageSquareWarning, Plus, Radar } from 'lucide-react';

import {
  Novel, Chapter, AssistantLaunchContext, CopilotSuggestion,
  CopilotActionKey, AgentTab, Skill, SniffedEntities
} from '../../shared/types';
import { cn } from '../lib/utils';
import { CopilotStatusBar } from './copilot/CopilotStatusBar';
import { extractStructuredAudit } from '../../shared/lib/audit-structured';

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

  // Optional telemetry
  sniffedEntities?: SniffedEntities | null;
  mountedSkills?: Skill[];

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

export const WritingSurface = React.memo(function WritingSurface({
  novel: _novel,
  currentChapter,
  isGeneratingBeats,
  isGeneratingCritique,
  isGeneratingContent,
  generationStatus,
  auditStatus,
  isChapterEmpty,
  mountedSkillsCount,
  sniffedEntities = null,
  mountedSkills = [],
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

  // 创作阶段描述
  const phases = React.useMemo(() => [
    {
      id: 1,
      name: '1. 分镜起草 (Beats Draft)',
      desc: '规划场景骨架、动作链与冲突焦点。',
    },
    {
      id: 2,
      name: '2. 初稿扩写 (Text Expansion)',
      desc: '在分镜大纲基础上进行全篇正文自动扩写。',
    },
    {
      id: 3,
      name: '3. 质量审计 (Quality Audit)',
      desc: '深度审计全文，找出逻辑漏洞及 AI 腔。',
    },
    {
      id: 4,
      name: '4. 润色精修 (Polish & Refine)',
      desc: '对照审计缺陷，进行外科手术式针对性润色。',
    },
  ], []);

  // 动态计算当前的创作阶段
  const currentPhaseId = React.useMemo(() => {
    if (!currentChapter) return 1;
    const hasBeats = currentChapter.sceneBeats && currentChapter.sceneBeats.trim() !== '';
    const hasContent = !isChapterEmpty;
    const hasCritique = currentChapter.critique && currentChapter.critique.trim() !== '';

    if (!hasBeats) {
      return 1;
    } else if (!hasContent) {
      return 2;
    } else if (!hasCritique) {
      return 3;
    } else {
      return 4;
    }
  }, [currentChapter, isChapterEmpty]);

  const structuredAudit = React.useMemo(() => {
    return extractStructuredAudit(currentChapter?.critique || '');
  }, [currentChapter?.critique]);

  const fatalIssuesCount = React.useMemo(() => {
    return structuredAudit ? (structuredAudit.fatalIssues?.length || 0) : 0;
  }, [structuredAudit]);

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
          <div className="w-full min-w-0 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 xl:gap-8 items-start">
            {/* 左侧主创作栏 (Main Stage Column) */}
            <div className="min-w-0 flex flex-col gap-6">
              {/* 1. 简洁精美的章节头部 (Elegant Chapter Header) */}
              <div className="w-full min-w-0 flex flex-col gap-2 pb-5 border-b border-theme-border/40">
                <p className="text-[11px] uppercase tracking-[0.22em] text-theme-muted font-bold">创作舞台</p>
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-2xl font-serif font-bold text-theme-text tracking-tight">
                      {currentChapter.title || '未命名章节'}
                    </h3>
                    <p className="text-sm text-theme-muted mt-1 max-w-xl leading-relaxed">
                      {isChapterEmpty
                        ? '先选一种起手方式，然后把正文直接写进下面的主编辑器。'
                        : '主正文编辑器已经就绪。分镜、审计和智能管家采用右侧常驻遥测及呼出式抽屉，让您的创作环境更纯粹安静。'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">字数 {currentChapter.wordCount || 0}</span>
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">技能 {mountedSkillsCount}</span>
                    <span className="px-2.5 py-1 rounded-full bg-theme-sidebar/55 border border-theme-border/50 text-xs text-theme-muted font-medium">章节 token ~2.4k</span>
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
                  <div className="flex items-center gap-1.5 text-[10px] text-theme-muted shrink-0">
                    <span className="px-2 py-0.5 rounded-full bg-theme-sidebar/40 border border-theme-border/40">自动保存</span>
                    <span className="px-2 py-0.5 rounded-full bg-theme-sidebar/40 border border-theme-border/40">本地草稿</span>
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
                    "w-full max-w-[70ch] mx-auto bg-transparent resize-none writing-surface text-theme-text placeholder:text-theme-muted/40 transition-all font-serif p-6 md:p-10 focus-visible:outline-none focus-visible:ring-0 block text-lg leading-relaxed tracking-wide",
                    isChapterEmpty ? "min-h-[55vh]" : "min-h-[70vh]"
                  )}
                  style={{ lineHeight: '1.85' }}
                />
              </div>

              {/* 3. 核心创作操作按钮 (Core Capabilities Panel) */}
              <div className="flex flex-wrap items-center gap-2 pt-4 border-t border-theme-border/40">
                <button
                  onClick={() => contentRef.current?.focus()}
                  className="px-3.5 py-2 rounded-xl bg-theme-text text-white hover:opacity-95 transition-opacity text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  <Feather size={13} />
                  <span>直接开始写</span>
                </button>
                <button
                  onClick={() => {
                    setAgentTab('planning');
                    setIsAgentSidebarOpen(true);
                    void onGenerateBeats();
                  }}
                  disabled={isGeneratingBeats}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 text-theme-text"
                >
                  {isGeneratingBeats ? <Loader2 size={13} className="animate-spin text-theme-accent" /> : <Radar size={13} className="text-theme-accent" />}
                  <span>生成分镜</span>
                </button>
                <button
                  onClick={() => {
                    setAgentTab('production');
                    setIsAgentSidebarOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 text-theme-text"
                >
                  <Bot size={13} className="text-theme-accent" />
                  <span>自动生产一章</span>
                </button>
                <button
                  onClick={() => {
                    if (onOpenAssistant) {
                      onOpenAssistant(buildAssistantLaunchContext());
                      return;
                    }
                    setIsAgentSidebarOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 text-theme-text"
                >
                  <Lightbulb size={13} className="text-theme-accent" />
                  <span>带上下文打开灵感助手</span>
                </button>
                <button
                  onClick={onRunAudit}
                  disabled={isGeneratingCritique || isChapterEmpty}
                  className="px-3.5 py-2 rounded-xl border border-theme-border bg-theme-sidebar/40 hover:bg-theme-sidebar hover:scale-[1.01] active:scale-[0.99] transition-all text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 text-theme-text"
                >
                  {isGeneratingCritique ? <Loader2 size={13} className="animate-spin text-theme-accent" /> : <MessageSquareWarning size={13} className="text-theme-accent" />}
                  <span>审计正文</span>
                </button>
              </div>

              {/* 4. 建议与静默状态反馈框 (Active Guidance Panel) */}
              <div className={cn(
                "rounded-2xl border p-4 transition-all duration-300",
                isChapterEmpty
                  ? "border-dashed border-theme-border bg-theme-sidebar/10"
                  : "border-theme-border bg-theme-sidebar/20"
              )}>
                <div className="flex items-center gap-2 text-theme-text text-xs font-bold uppercase tracking-wider">
                  {isChapterEmpty ? <AlertCircle size={14} className="text-theme-accent animate-pulse" /> : <Activity size={14} className="text-theme-accent" />}
                  <span>{isChapterEmpty ? '建议创作路径' : '写作状态'}</span>
                </div>
                <p className="mt-1.5 text-xs text-theme-muted leading-relaxed">
                  {isChapterEmpty
                    ? '建议顺序：先生成场景分镜框架，再直接扩写出初稿；或自由书写，随后启动一键审计检查。'
                    : '当前章节已进入正文精琢阶段。你可以随心所欲书写，随时检查伏笔、人物一致性和节奏合理度。'}
                </p>
                {(generationStatus || auditStatus) && (
                  <div className="mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-theme-accent/25 bg-theme-accent/5 px-3 py-1 text-[10px] font-bold text-theme-accent">
                    <Loader2 size={11} className="animate-spin shrink-0" />
                    <span className="truncate">{generationStatus || auditStatus}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 右侧常驻 "智能导航与上下文遥测副面板" (Guided Workflow & Context Matrix HUD) */}
            <div className="w-full xl:w-[360px] xl:sticky xl:top-0 rounded-2xl border border-theme-border bg-theme-sidebar/50 backdrop-blur-[2px] p-5 flex flex-col gap-5 shadow-sm hover:border-theme-accent/30 transition-all duration-300">
              {/* 面板头部：遥测状态 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-theme-text uppercase tracking-wider">
                  <Radar size={14} className="text-theme-accent animate-pulse" />
                  <span>智能导航与上下文遥测</span>
                </div>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold tracking-tight">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  LIVE
                </span>
              </div>

              {/* 1. 当前创作阶段垂直指示器 */}
              <div className="flex flex-col gap-3">
                <p className="text-[10px] text-theme-muted uppercase tracking-wider font-bold">当前创作阶段</p>
                <div className="relative pl-1.5 flex flex-col gap-3.5 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-theme-border/40">
                  {phases.map((phase) => {
                    const isCompleted = phase.id < currentPhaseId;
                    const isActive = phase.id === currentPhaseId;
                    const isPending = phase.id > currentPhaseId;

                    return (
                      <div key={phase.id} className="flex items-start gap-3 relative z-10">
                        {/* 状态圆点/图标 */}
                        <div className={cn(
                          "w-3.5 h-3.5 rounded-full flex items-center justify-center border transition-all duration-300 mt-0.5 shrink-0 text-[8px]",
                          isCompleted && "bg-emerald-500 border-emerald-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.3)]",
                          isActive && "bg-theme-sidebar border-theme-accent text-theme-accent ring-2 ring-theme-accent/15 animate-pulse",
                          isPending && "bg-theme-sidebar border-theme-border/80 text-theme-muted"
                        )}>
                          {isCompleted ? (
                            <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <span className="font-bold leading-none">{phase.id}</span>
                          )}
                        </div>

                        {/* 阶段名称与说明 */}
                        <div className="flex-1 min-w-0">
                          <h4 className={cn(
                            "text-xs font-bold transition-colors duration-200",
                            isActive ? "text-theme-accent font-extrabold" : isCompleted ? "text-theme-text/80" : "text-theme-muted"
                          )}>
                            {phase.name}
                          </h4>
                          {isActive && (
                            <p className="text-[10px] text-theme-muted mt-0.5 leading-relaxed">
                              {phase.desc}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. 下一步推荐按钮 */}
              <div className="pt-1">
                {currentPhaseId === 1 && (
                  <button
                    onClick={() => {
                      setAgentTab('planning');
                      setIsAgentSidebarOpen(true);
                      void onGenerateBeats();
                    }}
                    disabled={isGeneratingBeats}
                    className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingBeats ? <Loader2 size={13} className="animate-spin" /> : <Radar size={13} />}
                    <span>{isGeneratingBeats ? '正在构思分镜...' : '一键生成场景分镜'}</span>
                  </button>
                )}
                {currentPhaseId === 2 && (
                  <button
                    onClick={() => void runCopilotAction('generate-draft')}
                    disabled={isGeneratingContent}
                    className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingContent ? <Loader2 size={13} className="animate-spin" /> : <Feather size={13} />}
                    <span>{isGeneratingContent ? '正在扩写初稿...' : '一键自动扩写正文'}</span>
                  </button>
                )}
                {currentPhaseId === 3 && (
                  <button
                    onClick={onRunAudit}
                    disabled={isGeneratingCritique}
                    className="w-full py-2 bg-theme-accent hover:bg-theme-accent/90 text-white rounded-xl text-xs font-bold shadow-sm transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingCritique ? <Loader2 size={13} className="animate-spin" /> : <MessageSquareWarning size={13} />}
                    <span>{isGeneratingCritique ? '正在深度审计...' : '一键启动审稿审计'}</span>
                  </button>
                )}
                {currentPhaseId === 4 && (
                  <button
                    onClick={() => void runCopilotAction('run-polish')}
                    disabled={isGeneratingContent}
                    className="w-full py-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:brightness-105 text-white rounded-xl text-xs font-bold shadow-md transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isGeneratingContent ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
                    <span>{isGeneratingContent ? '正在执行手术精修...' : '一键局部手术精修'}</span>
                  </button>
                )}
              </div>

              <div className="h-px bg-theme-border/40" />

              {/* 3. 常驻核心功能匹配遥测 (Active Context Telemetry) */}
              <div className="flex flex-col gap-3">
                <p className="text-[10px] text-theme-muted uppercase tracking-wider font-bold">核心设定与技能遥测</p>

                <div className="grid grid-cols-1 gap-2.5 text-[11px]">
                  {/* 已配对设定 */}
                  <div className="bg-theme-sidebar/20 rounded-lg p-2.5 border border-theme-border/30">
                    <div className="flex items-center justify-between font-bold mb-1.5">
                      <span className="text-theme-muted flex items-center gap-1">
                        <Globe size={11} className="text-theme-accent" />
                        已配对设定 (Bible Matches)
                      </span>
                      <span className="font-mono text-xs text-theme-accent font-semibold bg-theme-accent/5 px-1.5 py-0.5 rounded">
                        {(sniffedEntities?.activeExisting?.length || 0).toString().padStart(2, '0')}
                      </span>
                    </div>
                    {sniffedEntities?.activeExisting && sniffedEntities.activeExisting.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {sniffedEntities.activeExisting.slice(0, 4).map((name) => (
                          <span key={name} className="px-1.5 py-0.5 rounded bg-theme-accent/5 border border-theme-accent/10 text-[9px] text-theme-text/80 font-medium">
                            {name}
                          </span>
                        ))}
                        {sniffedEntities.activeExisting.length > 4 && (
                          <span className="px-1.5 py-0.5 rounded bg-theme-border/30 text-[9px] text-theme-muted font-bold">
                            +{sniffedEntities.activeExisting.length - 4}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-theme-muted italic">暂无嗅探到的配对设定</p>
                    )}
                  </div>

                  {/* 已生效技能 */}
                  <div className="bg-theme-sidebar/20 rounded-lg p-2.5 border border-theme-border/30">
                    <div className="flex items-center justify-between font-bold mb-1.5">
                      <span className="text-theme-muted flex items-center gap-1">
                        <Bot size={11} className="text-theme-accent" />
                        已生效技能 (Mounted Skills)
                      </span>
                      <span className="font-mono text-xs text-theme-accent font-semibold bg-theme-accent/5 px-1.5 py-0.5 rounded">
                        {(mountedSkills?.length || 0).toString().padStart(2, '0')}
                      </span>
                    </div>
                    {mountedSkills && mountedSkills.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {mountedSkills.slice(0, 3).map((skill) => (
                          <span key={skill.id} className="px-1.5 py-0.5 rounded bg-emerald-500/5 border border-emerald-500/10 text-[9px] text-emerald-600 dark:text-emerald-400 font-medium">
                            {skill.name}
                          </span>
                        ))}
                        {mountedSkills.length > 3 && (
                          <span className="px-1.5 py-0.5 rounded bg-theme-border/30 text-[9px] text-theme-muted font-bold">
                            +{mountedSkills.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-theme-muted italic">暂无活跃的挂载技能卡</p>
                    )}
                  </div>

                  {/* 正文质量风险 */}
                  <div className="bg-theme-sidebar/20 rounded-lg p-2.5 border border-theme-border/30">
                    <div className="flex items-center justify-between font-bold">
                      <span className="text-theme-muted flex items-center gap-1">
                        <AlertCircle size={11} className="text-theme-accent" />
                        正文质量风险 (Quality Risks)
                      </span>
                      {currentChapter?.critique ? (
                        fatalIssuesCount > 0 ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-bold">
                            {fatalIssuesCount} 处瑕疵
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold">
                            质量合格
                          </span>
                        )
                      ) : (
                        <span className="text-[10px] text-theme-muted font-normal italic">未审计</span>
                      )}
                    </div>
                  </div>
                </div>
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
});
