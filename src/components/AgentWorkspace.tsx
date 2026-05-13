import React from 'react';
import {
  X, Bot, Sparkles, Globe, Wand2, ListOrdered, Brain,
  MessageSquareWarning, Activity, Eye, History, Lightbulb,
  FileText, Loader2, Feather, Search, Save, Radar, Plus, CheckCircle2, AlertCircle,
  BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Novel, Chapter, Character, Item, Location, ChapterVersion,
  Skill, SkillUsageRecord, MountedSkillLoadoutItem, ProjectPreferenceProfile,
  ChapterProductionRun, AgentTab, CopilotSuggestion, CopilotActionKey, SniffedEntities
} from '../types';
import { cn } from '../lib/utils';
import ReactMarkdown from 'react-markdown';
import { IdeaFragmentBoard } from './IdeaFragmentBoard';
import { ForeshadowingPanel } from './ForeshadowingPanel';
import { PacingDashboard } from './PacingDashboard';
import { ProductionRunReview } from './ProductionRunReview';
import { SkillLoadoutBoard } from './skills/SkillLoadoutBoard';
import { ProjectPreferencePanel } from './skills/ProjectPreferencePanel';
import { CopilotHomePanel } from './copilot/CopilotHomePanel';

interface AgentWorkspaceProps {
  novel: Novel;
  chapters: Chapter[];
  currentChapter: Chapter | null;
  setCurrentChapter: (chapter: Chapter) => void;
  isAgentSidebarOpen: boolean;
  setIsAgentSidebarOpen: (open: boolean) => void;
  agentTab: AgentTab;
  setAgentTab: (tab: AgentTab) => void;
  copilotSuggestion: CopilotSuggestion | null;
  runCopilotAction: (key: CopilotActionKey) => Promise<void>;
  activeProductionRun: ChapterProductionRun | null;
  productionIntent: string;
  setProductionIntent: (intent: string) => void;
  isProductionRunning: boolean;
  isApplyingProductionRun: boolean;
  productionError: string | null;
  onStartProductionRun: () => Promise<void>;
  onApplyProductionRun: () => Promise<void>;
  expectedWordCount: number | '';
  setExpectedWordCount: (count: number | '') => void;
  onGenerateOutline: () => Promise<void>;
  isGeneratingOutline: boolean;
  globalOutline: string;
  onGlobalOutlineChange: (outline: string) => void;
  onGenerateBeats: () => Promise<void>;
  isGeneratingBeats: boolean;
  userIntent: string;
  setUserIntent: (intent: string) => void;
  isGeneratingContent: boolean;
  onGenerateContent: () => Promise<void>;
  onRewriteSelectedText: () => Promise<void>;
  onUpdateChapterBeats: (beats: string) => void;
  onRunAudit: () => Promise<void>;
  isGeneratingCritique: boolean;
  onPolishChapterFromAudit: () => Promise<void>;
  bibleSearch: string;
  setBibleSearch: (search: string) => void;
  characters: Character[];
  locations: Location[];
  items: Item[];
  librarySkills: Skill[];
  skillUsageRecords: SkillUsageRecord[];
  mountedSkillLoadout: MountedSkillLoadoutItem[];
  onAssignSkill: (slot: number, skillId: string) => Promise<void>;
  onRemoveSkill: (slot: number) => Promise<void>;
  projectPreferenceProfile: ProjectPreferenceProfile;
  onPreferenceProfileChange: (profile: ProjectPreferenceProfile) => Promise<void>;
  versions: ChapterVersion[];
  onSaveVersion: (author: 'user' | 'writer-agent') => Promise<void>;
  onRestoreVersion: (version: ChapterVersion) => void;
  isSniffing: boolean;
  sniffedEntities: SniffedEntities | null;
  onSniffEntities: () => Promise<void>;
  onAddSniffedEntity: (ent: { name: string, type: string, context: string }) => Promise<void>;
  addingEntityNames: string[];
}

export function AgentWorkspace({
  novel,
  chapters,
  currentChapter,
  setCurrentChapter,
  isAgentSidebarOpen,
  setIsAgentSidebarOpen,
  agentTab,
  setAgentTab,
  copilotSuggestion,
  runCopilotAction,
  activeProductionRun,
  productionIntent,
  setProductionIntent,
  isProductionRunning,
  isApplyingProductionRun,
  productionError,
  onStartProductionRun,
  onApplyProductionRun,
  expectedWordCount,
  setExpectedWordCount,
  onGenerateOutline,
  isGeneratingOutline,
  globalOutline,
  onGlobalOutlineChange,
  onGenerateBeats,
  isGeneratingBeats,
  userIntent,
  setUserIntent,
  isGeneratingContent,
  onGenerateContent,
  onRewriteSelectedText,
  onUpdateChapterBeats,
  onRunAudit,
  isGeneratingCritique,
  onPolishChapterFromAudit,
  bibleSearch,
  setBibleSearch,
  characters,
  locations,
  items,
  librarySkills,
  skillUsageRecords,
  mountedSkillLoadout,
  onAssignSkill,
  onRemoveSkill,
  projectPreferenceProfile,
  onPreferenceProfileChange,
  versions,
  onSaveVersion,
  onRestoreVersion,
  isSniffing,
  sniffedEntities,
  onSniffEntities,
  onAddSniffedEntity,
  addingEntityNames,
}: AgentWorkspaceProps) {
  const draftPromptSurface = 'workspace-draft';
  const planningPromptSurface = 'workspace-beats';
  const polishPromptSurface = 'chapter-polish';
  const reviewPromptSurface = 'chapter-review';

  return (
    <motion.div
      initial={{ x: 420, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 420, opacity: 0 }}
      transition={{ type: "tween", duration: 0.24 }}
      className="absolute inset-y-3 right-3 w-[min(400px,calc(100%-1.5rem))] rounded-3xl border border-theme-border bg-white/95 overflow-hidden z-30 backdrop-blur-sm shadow-2xl flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border bg-white/90 shrink-0">
        <div>
          <div className="text-xs font-bold text-theme-text">智能管家工作台</div>
          <div className="text-[10px] text-theme-muted mt-1">需要时展开，用完即可随手收回。</div>
        </div>
        <button
          type="button"
          onClick={() => setIsAgentSidebarOpen(false)}
          aria-label="收起智能管家"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-theme-border bg-white text-theme-text text-[11px] font-bold hover:bg-theme-sidebar/40 transition-colors"
        >
          <X size={12} />
          收起
        </button>
      </div>

      {/* Tabs — grouped by writing phase */}
      <div className="flex overflow-x-auto no-scrollbar p-3 gap-1 border-b border-theme-border bg-transparent sticky top-0 z-10 shrink-0 items-center">
        <span className="text-[9px] font-bold text-theme-muted/40 uppercase tracking-wider px-2 shrink-0">当前</span>
        <button onClick={() => setAgentTab('copilot-home')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'copilot-home' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Bot size={11} /> 智能建议
        </button>
        <button onClick={() => setAgentTab('production')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'production' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Sparkles size={11} /> 自动生产
        </button>
        <button onClick={() => setAgentTab('bible')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'bible' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Globe size={11} /> 查设定
        </button>
        <button onClick={() => setAgentTab('skills')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'skills' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Wand2 size={11} /> 技能装备
        </button>
        <div className="w-px h-4 bg-theme-border/40 mx-1 shrink-0" />
        <span className="text-[9px] font-bold text-theme-muted/40 uppercase tracking-wider px-2 shrink-0">写前准备</span>
        <button onClick={() => setAgentTab('outline')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'outline' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <ListOrdered size={11} /> 大纲
        </button>
        <button onClick={() => setAgentTab('planning')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'planning' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Brain size={11} /> 分镜
        </button>
        <div className="w-px h-4 bg-theme-border/40 mx-1 shrink-0" />
        <span className="text-[9px] font-bold text-theme-muted/40 uppercase tracking-wider px-2 shrink-0">写后诊断</span>
        <button onClick={() => setAgentTab('quality')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'quality' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <MessageSquareWarning size={11} /> 审计
        </button>
        <button onClick={() => setAgentTab('pacing')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'pacing' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Activity size={11} /> 节奏
        </button>
        <button onClick={() => setAgentTab('foreshadowing')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'foreshadowing' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Eye size={11} /> 伏笔
        </button>
        <div className="w-px h-4 bg-theme-border/40 mx-1 shrink-0" />
        <span className="text-[9px] font-bold text-theme-muted/40 uppercase tracking-wider px-2 shrink-0">更多</span>
        <button onClick={() => setAgentTab('trace')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'trace' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <History size={11} /> 追踪
        </button>
        <button onClick={() => setAgentTab('ideas')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'ideas' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Lightbulb size={11} /> 创意
        </button>
        <button onClick={() => setAgentTab('versions')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'versions' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <History size={11} /> 版本
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 scroll-smooth">
        <AnimatePresence mode="sync">
          {agentTab === 'copilot-home' && (
            <motion.div
              key="copilot-home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <CopilotHomePanel
                suggestion={copilotSuggestion}
                onAction={(key) => void runCopilotAction(key)}
              />
            </motion.div>
          )}
          {agentTab === 'production' && (
            <motion.div
              key="production"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ProductionRunReview
                run={activeProductionRun}
                userIntent={productionIntent}
                running={isProductionRunning}
                applying={isApplyingProductionRun}
                error={productionError}
                novelId={novel.id}
                onIntentChange={setProductionIntent}
                onStart={() => void onStartProductionRun()}
                onApply={() => void onApplyProductionRun()}
              />
            </motion.div>
          )}
          {agentTab === 'ideas' && (
            <motion.div key="ideas" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <IdeaFragmentBoard novelId={novel.id} compact />
            </motion.div>
          )}
          {agentTab === 'foreshadowing' && (
            <motion.div key="foreshadowing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <ForeshadowingPanel novelId={novel.id} currentChapterId={currentChapter?.id} />
            </motion.div>
          )}
          {agentTab === 'pacing' && (
            <motion.div key="pacing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <PacingDashboard novelId={novel.id} />
            </motion.div>
          )}
          {agentTab === 'outline' && (
            <motion.div
              key="outline"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
                    <FileText size={14} className="text-theme-accent" />
                    全局大纲 (Global Outline)
                  </h3>
                </div>

                <div className="flex gap-2 mb-3">
                  <div className="flex-1 relative">
                    <input
                      type="number"
                      placeholder="预计总字数 (如: 1000000)"
                      value={expectedWordCount}
                      onChange={(e) => setExpectedWordCount(parseInt(e.target.value) || '')}
                      className="w-full text-[10px] p-2 bg-white border border-theme-border rounded-lg pl-2 pr-6 transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
                    />
                    <span className="absolute right-2 top-[7px] text-[10px] text-theme-muted">字</span>
                  </div>
                  <button
                    onClick={onGenerateOutline}
                    disabled={!expectedWordCount || isGeneratingOutline}
                    className="px-3 py-1.5 bg-theme-accent text-white text-[10px] font-bold rounded-lg hover:bg-theme-accent/90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200 flex items-center gap-1.5"
                  >
                    {isGeneratingOutline ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI 智能排盘
                  </button>
                </div>

                <textarea
                  data-prompt-surface={draftPromptSurface}
                  value={globalOutline}
                  onChange={(e) => onGlobalOutlineChange(e.target.value)}
                  placeholder="在此规划整本小说的核心冲突与路线图；也可以输入初始创意，点击“智能排盘”由 AI 为您生成卷轴级大纲..."
                  className="w-full h-40 bg-white border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/40 resize-none shadow-sm font-serif leading-relaxed transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
                />
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">章节快速导航</h3>
                <div className="space-y-1.5 pb-8">
                  {chapters.map((chap, idx) => (
                    <button
                      key={chap.id}
                      onClick={() => setCurrentChapter(chap)}
                      className={cn(
                        "w-full text-left p-3 rounded-xl border transition-[background-color,border-color,box-shadow,color] duration-200 flex flex-col gap-1",
                        currentChapter?.id === chap.id
                          ? "bg-theme-accent/5 border-theme-accent shadow-sm"
                          : "bg-white border-theme-border/40 hover:border-theme-accent/20"
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <span className={cn("text-xs font-bold", currentChapter?.id === chap.id ? "text-theme-accent" : "text-theme-text")}>
                          第 {idx + 1} 章: {chap.title}
                        </span>
                        <span className="text-[9px] text-theme-muted">{chap.wordCount} 字</span>
                      </div>
                      {chap.sceneBeats && (
                        <p className="text-[9px] text-theme-muted line-clamp-1 opacity-70">
                          {chap.sceneBeats.substring(0, 50)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
          {agentTab === 'planning' && (
            <motion.div
              key="planning"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                  <h3 className="text-xs font-bold text-theme-text mb-2 flex items-center gap-2">
                    <ListOrdered size={14} className="text-theme-accent" />
                    创作意图
                  </h3>
                  <textarea
                    data-prompt-surface={planningPromptSurface}
                    value={userIntent}
                    onChange={(e) => setUserIntent(e.target.value)}
                    placeholder="描述这一章你想写什么，比如：主角在酒馆偶遇了女二..."
                    className="w-full h-24 bg-white border border-theme-border rounded-xl p-3 text-sm text-theme-text placeholder:text-theme-muted/60 resize-none shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
                  />
                  <button
                    onClick={onGenerateBeats}
                    disabled={isGeneratingBeats || !currentChapter}
                    className="w-full mt-3 py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isGeneratingBeats ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {isGeneratingBeats ? '规划中...' : '生成场景分镜'}
                  </button>
                </div>

                {currentChapter && (
                  <div className="space-y-3">
                    <div className={cn(
                      "bg-white p-5 rounded-2xl border border-theme-border/40 shadow-sm relative overflow-hidden group",
                      !currentChapter.sceneBeats && "opacity-50"
                    )}>
                      <div className="flex justify-between items-center mb-2">
                        <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">当前场景分镜规划</h3>
                        <div className="flex gap-2">
                          <button
                            onClick={onGenerateContent}
                            disabled={isGeneratingContent || !currentChapter.sceneBeats}
                            className="flex items-center gap-1.5 px-3 py-1 bg-theme-accent text-white rounded-lg text-[10px] font-bold shadow-sm hover:opacity-90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200"
                          >
                            {isGeneratingContent ? <Loader2 size={10} className="animate-spin" /> : <Feather size={10} />}
                            AI 扩写正文
                          </button>
                          <button
                            onClick={onRewriteSelectedText}
                            disabled={isGeneratingContent}
                            className="flex items-center gap-1.5 px-3 py-1 bg-theme-sidebar text-theme-text rounded-lg text-[10px] font-bold shadow-sm border border-theme-border hover:bg-theme-border/50 disabled:opacity-50 transition-[background-color,border-color,opacity,box-shadow] duration-200"
                          >
                            <Sparkles size={10} />
                            选中改写
                          </button>
                        </div>
                      </div>
                      <textarea
                        data-prompt-surface={planningPromptSurface}
                        value={currentChapter.sceneBeats || ''}
                        onChange={(e) => onUpdateChapterBeats(e.target.value)}
                        placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."
                        className="w-full h-64 bg-theme-sidebar/10 border-none p-0 text-sm text-theme-text placeholder:text-theme-muted/40 resize-none scrollbar-none font-serif leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/20 rounded-lg"
                      />
                    </div>

                    {isGeneratingContent && (
                      <div className="flex items-center justify-center p-4 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 text-xs text-theme-muted gap-2">
                        <Loader2 size={14} className="animate-spin" /> Writer Agent 正在执笔中...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {agentTab === 'quality' && (
            <motion.div
              key="quality"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
               <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm flex flex-col items-center justify-center text-center">
                  <Bot size={32} className="text-theme-accent mb-3 opacity-80" />
                  <h3 className="text-sm font-bold text-theme-text mb-1">AI 批判性阅读</h3>
                  <p className="text-xs text-theme-muted mb-4 max-w-[200px]">审查当前章节的逻辑漏洞、人物OOC及节奏问题。</p>
                  <div className="w-full space-y-2">
                    <button
                      onClick={onRunAudit}
                      disabled={isGeneratingCritique || !currentChapter}
                      className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isGeneratingCritique ? <Loader2 size={16} className="animate-spin" /> : <MessageSquareWarning size={16} />}
                      {isGeneratingCritique ? '审计中...\n(这可能需要1分钟)' : 'AI 审计'}
                    </button>
                    <button
                      data-prompt-surface={polishPromptSurface}
                      onClick={onPolishChapterFromAudit}
                      disabled={isGeneratingContent || !currentChapter?.critique || !currentChapter?.content}
                      className="w-full py-2.5 bg-theme-sidebar text-theme-text rounded-xl text-sm font-bold shadow-sm border border-theme-border hover:bg-theme-border/50 disabled:opacity-50 transition-[background-color,border-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2"
                    >
                      {isGeneratingContent ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                      {isGeneratingContent ? '精修中…' : '按审计精修正文'}
                    </button>
                  </div>
               </div>

               {currentChapter?.critique && (
                  <div className="prose prose-sm prose-slate prose-p:leading-relaxed max-w-none bg-red-50/50 p-5 rounded-2xl border border-red-100 shadow-sm">
                    <div data-prompt-surface={reviewPromptSurface}>
                      <ReactMarkdown>{currentChapter.critique}</ReactMarkdown>
                    </div>
                  </div>
                )}
            </motion.div>
          )}
          {agentTab === 'bible' && (
            <motion.div
              key="bible"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
               <div className="sticky top-0 bg-white/50 backdrop-blur z-10 pb-2">
                 <div className="relative">
                   <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-muted" size={14} />
                   <input
                     type="text"
                     placeholder="检索角色、地点、道具..."
                     value={bibleSearch}
                     onChange={e => setBibleSearch(e.target.value)}
                     className="w-full pl-9 pr-4 py-2 bg-white border border-theme-border rounded-xl text-sm placeholder:text-theme-muted/50 shadow-sm transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
                   />
                 </div>
               </div>
               <div className="space-y-3 pb-8">
                 {/* Characters */}
                 {characters.filter(c => c.name.includes(bibleSearch) || c.summary.includes(bibleSearch)).map(char => (
                   <div key={char.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                     <div className="flex items-center gap-2 mb-1.5">
                       <div className="text-sm font-bold text-theme-text">{char.name}</div>
                       <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">角色 - {char.role}</div>
                     </div>
                     <div className="text-xs font-semibold text-theme-accent mb-2">{char.summary}</div>
                     {char.bio && <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{char.bio}</div>}
                   </div>
                 ))}
                 {/* Locations */}
                 {locations.filter(l => l.name.includes(bibleSearch) || l.description.includes(bibleSearch)).map(loc => (
                   <div key={loc.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                     <div className="flex items-center gap-2 mb-1.5">
                       <div className="text-sm font-bold text-theme-text">{loc.name}</div>
                       <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">地点</div>
                     </div>
                     <div className="text-xs font-semibold text-theme-accent mb-2">{loc.region}</div>
                     {loc.description && <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{loc.description}</div>}
                   </div>
                 ))}
                 {/* Items */}
                 {items.filter(i => i.name.includes(bibleSearch) || i.description.includes(bibleSearch)).map(item => (
                   <div key={item.id} className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm transition-hover hover:border-theme-accent/50">
                     <div className="flex items-center gap-2 mb-1.5">
                       <div className="text-sm font-bold text-theme-text">{item.name}</div>
                       <div className="text-[10px] bg-theme-sidebar px-1.5 py-0.5 rounded text-theme-muted font-medium tracking-wide">道具</div>
                     </div>
                     <div className="text-xs font-semibold text-theme-accent mb-2">{item.type}</div>
                     {item.description && <div className="text-xs text-theme-muted/80 leading-relaxed whitespace-pre-wrap">{item.description}</div>}
                   </div>
                 ))}
                 {(characters.length === 0 && locations.length === 0 && items.length === 0) && (
                   <div className="text-center text-xs text-theme-muted opacity-60 p-4 border border-dashed border-theme-border rounded-xl">
                     暂无设定数据，请前往书库添加
                   </div>
                 )}
               </div>
            </motion.div>
          )}
          {agentTab === 'skills' && (
            <motion.div
              key="skills"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="h-full min-h-0 flex flex-col gap-4"
            >
              <div className="shrink-0">
                <ProjectPreferencePanel profile={projectPreferenceProfile} />
              </div>
              <div className="flex-1 min-h-0">
                <SkillLoadoutBoard
                  novel={{ ...novel, projectPreferenceProfile }}
                  currentChapter={currentChapter}
                  skills={librarySkills}
                  usageRecords={skillUsageRecords}
                  loadout={mountedSkillLoadout}
                  onAssignSkill={onAssignSkill}
                  onRemoveSkill={onRemoveSkill}
                  onPreferenceProfileChange={onPreferenceProfileChange}
                />
              </div>
            </motion.div>
          )}
          {agentTab === 'versions' && (
            <motion.div
              key="versions"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
               <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="text-xs font-bold text-theme-text">章节时光机 (Time Machine)</h3>
                    <button
                      onClick={() => onSaveVersion('user')}
                      disabled={!currentChapter || !currentChapter.content}
                      className="text-[10px] bg-theme-text text-white px-2 py-1 rounded shadow-sm hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1"
                    >
                      <Save size={10} /> 存为快照
                    </button>
                  </div>
                  <p className="text-[10px] text-theme-muted">记录每一次重大的 AI 扩写或用户保存。</p>
               </div>

               <div className="space-y-3 pb-8">
                 {versions.slice().sort((a, b) => b.createdAt - a.createdAt).map(version => (
                   <div
                     key={version.id}
                     className="bg-white p-4 rounded-xl border border-theme-border/40 shadow-sm relative group overflow-hidden"
                   >
                     <div className="flex justify-between items-start mb-2">
                       <div>
                         <div className="text-[10px] font-bold text-theme-accent uppercase">
                           {version.author === 'writer-agent' ? '🤖 AI 辅笔' : '👤 手动存档'}
                         </div>
                         <div className="text-[9px] text-theme-muted">
                           {new Date(version.createdAt).toLocaleString()}
                         </div>
                       </div>
                       <button
                         onClick={() => onRestoreVersion(version)}
                         className="px-2 py-1 bg-theme-bg text-theme-text text-[9px] font-bold rounded border border-theme-border hover:bg-theme-sidebar transition-colors"
                       >
                         还原此版本
                       </button>
                     </div>
                     <div className="text-[10px] text-theme-muted line-clamp-3 leading-relaxed bg-theme-sidebar/10 p-2 rounded italic">
                       {version.content.substring(0, 150)}...
                     </div>
                     <div className="mt-2 text-[9px] font-medium text-theme-muted/60">
                       字数: {version.wordCount}
                     </div>
                   </div>
                 ))}

                 {versions.length === 0 && (
                    <div className="text-center py-12 text-xs text-theme-muted opacity-50">
                       暂无历史版本记录
                    </div>
                 )}
               </div>
            </motion.div>
          )}
          {agentTab === 'trace' && (
            <motion.div
              key="trace"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
               <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xs font-bold text-theme-text flex items-center gap-2">
                       <Search size={14} className="text-theme-accent" />
                       本章设定嗅探器 (Entity Sniper)
                    </h3>
                  </div>
                  <p className="text-[10px] text-theme-muted leading-relaxed mb-4">
                    扫描本章分镜与正文，自动抓取出场人物、地点与道具，并与设定库进行比对。
                  </p>

                  <button
                    onClick={onSniffEntities}
                    disabled={!currentChapter || isSniffing}
                    className="w-full py-2 bg-theme-accent text-white rounded-xl text-[10px] font-bold shadow-sm hover:bg-theme-accent/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSniffing ? <Loader2 size={14} className="animate-spin" /> : <Radar size={14} />}
                    {isSniffing ? '正在全息扫描...' : '立即嗅探本章实体'}
                  </button>
               </div>

               {sniffedEntities && (
                 <div className="space-y-4 pb-8">
                   {/* Active Existing Entities */}
                   <div className="bg-white rounded-xl border border-theme-border p-4 shadow-sm">
                     <h4 className="text-[10px] font-bold text-theme-text flex items-center gap-1.5 mb-3">
                       <CheckCircle2 size={12} className="text-emerald-500" />
                       已入库活跃实体 ({sniffedEntities.activeExisting.length})
                     </h4>
                     {sniffedEntities.activeExisting.length === 0 ? (
                       <div className="text-[9px] text-theme-muted italic">本章未提及存量设定。</div>
                     ) : (
                       <div className="flex flex-wrap gap-1.5">
                         {sniffedEntities.activeExisting.map((name: string, i: number) => (
                           <span key={i} className="text-[9px] px-2 py-1 bg-theme-sidebar border border-theme-border rounded hover:bg-theme-border/30 cursor-default transition-colors">
                             {name}
                           </span>
                         ))}
                       </div>
                     )}
                     <p className="text-[8px] text-theme-muted mt-3">
                       * 这些对象将被自动注入到本章的生成上下文（Pruning）。
                     </p>
                   </div>

                   {/* New Suspicious Entities */}
                   <div className="bg-white rounded-xl border border-theme-border p-4 shadow-sm">
                     <h4 className="text-[10px] font-bold text-theme-text flex items-center gap-1.5 mb-3">
                       <AlertCircle size={12} className="text-amber-500" />
                       未记录野生实体 ({sniffedEntities.newEntities.length})
                     </h4>
                     {sniffedEntities.newEntities.length === 0 ? (
                       <div className="text-[9px] text-theme-muted italic">未发现新增“野生”设定。</div>
                     ) : (
                       <div className="space-y-2.5">
                         {sniffedEntities.newEntities.map((ent: any, i: number) => (
                           <div key={i} className="flex flex-col gap-1.5 p-2.5 bg-amber-50/50 border border-amber-100 rounded-lg group">
                             <div className="flex justify-between items-center">
                               <span className="text-[10px] font-bold text-amber-900">{ent.name}</span>
                               <span className="text-[8px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded uppercase font-bold tracking-wider">
                                 {ent.type}
                               </span>
                             </div>
                             <p className="text-[9px] text-amber-800/80 leading-relaxed">
                               上下文：{ent.context}
                             </p>
                             <div className="mt-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                               <button
                                 onClick={() => onAddSniffedEntity(ent)}
                                 disabled={addingEntityNames.includes(ent.name)}
                                 className="text-[10px] flex items-center gap-1 px-2 py-1 bg-white border border-amber-200 text-amber-700 hover:bg-amber-100 rounded shadow-sm font-bold disabled:opacity-50 transition-colors"
                               >
                                 {addingEntityNames.includes(ent.name) ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                                 {addingEntityNames.includes(ent.name) ? '正在生成词条...' : '添加到 World Bible'}
                               </button>
                             </div>
                           </div>
                         ))}
                       </div>
                     )}
                   </div>
                 </div>
               )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
