import React from 'react';import Bot from 'lucide-react/dist/esm/icons/bot.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Wand2 from 'lucide-react/dist/esm/icons/wand-sparkles.js';
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered.js';
import MessageSquareWarning from 'lucide-react/dist/esm/icons/message-square-warning.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Feather from 'lucide-react/dist/esm/icons/feather.js';
import ReactMarkdown from 'react-markdown';
import type { AgentTab, Chapter, ChapterProductionRun, ContinuationPack, Novel } from '../types';
import { ProductionRunReview } from './ProductionRunReview';
import { cn } from '../lib/utils';

type ProductionAgentTab = Extract<AgentTab, 'production' | 'outline' | 'planning' | 'quality'>;

interface AgentWorkspaceProductionPanelProps {
  agentTab: ProductionAgentTab;
  novel: Novel;
  chapters: Chapter[];
  currentChapter: Chapter | null;
  setCurrentChapter: (chapter: Chapter) => void;
  activeProductionRun: ChapterProductionRun | null;
  productionIntent: string;
  setProductionIntent: (intent: string) => void;
  isProductionRunning: boolean;
  isApplyingProductionRun: boolean;
  productionError: string | null;
  productionBeatsSource?: 'fallback' | 'model' | null;
  productionDraftSource?: 'fallback' | 'model' | null;
  productionAuditSource?: 'fallback' | 'model' | null;
  productionStatusMessage?: string | null;
  approvedContinuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
  setSelectedContinuationPackId: (packId: string) => void;
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
}

const DRAFT_PROMPT_SURFACE = 'workspace-draft';
const PLANNING_PROMPT_SURFACE = 'workspace-beats';
const POLISH_PROMPT_SURFACE = 'chapter-polish';
const REVIEW_PROMPT_SURFACE = 'chapter-review';

export function AgentWorkspaceProductionPanel({
  agentTab,
  novel,
  chapters,
  currentChapter,
  setCurrentChapter,
  activeProductionRun,
  productionIntent,
  setProductionIntent,
  isProductionRunning,
  isApplyingProductionRun,
  productionError,
  productionBeatsSource,
  productionDraftSource,
  productionAuditSource,
  productionStatusMessage,
  approvedContinuationPacks,
  selectedContinuationPackId,
  setSelectedContinuationPackId,
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
}: AgentWorkspaceProductionPanelProps) {
  const selectedContinuationPack = approvedContinuationPacks.find((pack) => pack.id === selectedContinuationPackId) || null;

  if (agentTab === 'production') {
    return (
      <div className="space-y-4">
        <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-theme-accent" />
            <h3 className="text-xs font-bold text-theme-text">续写资料包</h3>
          </div>
          {approvedContinuationPacks.length > 0 ? (
            <>
              <select
                value={selectedContinuationPackId}
                onChange={(e) => setSelectedContinuationPackId(e.target.value)}
                className="w-full rounded-xl border border-theme-border bg-white px-3 py-2 text-sm text-theme-text outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
              >
                <option value="">不使用资料包，仅按当前作品上下文续写</option>
                {approvedContinuationPacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.title}
                  </option>
                ))}
              </select>
              {selectedContinuationPack ? (
                <div className="rounded-xl border border-theme-border bg-theme-sidebar/20 px-3 py-3 text-xs text-theme-muted space-y-1.5">
                  <div>
                    <span className="font-bold text-theme-text">续写任务：</span>
                    {selectedContinuationPack.continuationTask || '未指定'}
                  </div>
                  <div>
                    <span className="font-bold text-theme-text">资料缺口：</span>
                    {selectedContinuationPack.continuationGaps?.length || 0} 项
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-theme-border bg-theme-sidebar/20 px-3 py-3 text-xs text-theme-muted">
              当前没有已批准的资料包。先去“世界设定集 → 资料续写”上传并确认资料包，再回来接入续写。
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
          onApply={() => void onApplyProductionRun()}
        />
      </div>
    );
  }

  if (agentTab === 'outline') {
    return (
      <div className="space-y-6">
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
            data-prompt-surface={DRAFT_PROMPT_SURFACE}
            value={globalOutline}
            onChange={(e) => onGlobalOutlineChange(e.target.value)}
            placeholder="在此规划整本小说的核心冲突与路线图；也可以输入初始创意，点击“智能排盘”由 AI 为您生成卷轴级大纲..."
            className="w-full h-40 bg-white border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/40 resize-none shadow-sm font-serif leading-relaxed transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
          />
        </div>

        <div className="space-y-3">
          <h3 className="text-[10px] font-bold text-theme-muted uppercase tracking-wider px-1">章节快速导航</h3>
          <div className="space-y-1.5 pb-8">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                onClick={() => setCurrentChapter(chapter)}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-[background-color,border-color,box-shadow,color] duration-200 flex flex-col gap-1',
                  currentChapter?.id === chapter.id
                    ? 'bg-theme-accent/5 border-theme-accent shadow-sm'
                    : 'bg-white border-theme-border/40 hover:border-theme-accent/20',
                )}
              >
                <div className="flex justify-between items-center">
                  <span className={cn('text-xs font-bold', currentChapter?.id === chapter.id ? 'text-theme-accent' : 'text-theme-text')}>
                    第 {index + 1} 章: {chapter.title}
                  </span>
                  <span className="text-[9px] text-theme-muted">{chapter.wordCount} 字</span>
                </div>
                {chapter.sceneBeats ? (
                  <p className="text-[9px] text-theme-muted line-clamp-1 opacity-70">
                    {chapter.sceneBeats.substring(0, 50)}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (agentTab === 'planning') {
    return (
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-theme-border shadow-sm">
            <h3 className="text-xs font-bold text-theme-text mb-2 flex items-center gap-2">
              <ListOrdered size={14} className="text-theme-accent" />
              创作意图
            </h3>
            <textarea
              data-prompt-surface={PLANNING_PROMPT_SURFACE}
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

          {currentChapter ? (
            <div className="space-y-3">
              <div
                className={cn(
                  'bg-white p-5 rounded-2xl border border-theme-border/40 shadow-sm relative overflow-hidden group',
                  !currentChapter.sceneBeats && 'opacity-50',
                )}
              >
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
                  data-prompt-surface={PLANNING_PROMPT_SURFACE}
                  value={currentChapter.sceneBeats || ''}
                  onChange={(e) => onUpdateChapterBeats(e.target.value)}
                  placeholder="点击上方按钮生成分镜，或在此手动规划情节重点..."
                  className="w-full h-64 bg-theme-sidebar/10 border-none p-0 text-sm text-theme-text placeholder:text-theme-muted/40 resize-none scrollbar-none font-serif leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-accent/20 rounded-lg"
                />
              </div>

              {isGeneratingContent ? (
                <div className="flex items-center justify-center p-4 bg-theme-sidebar/20 rounded-xl border border-theme-border/30 text-xs text-theme-muted gap-2">
                  <Loader2 size={14} className="animate-spin" /> Writer Agent 正在执笔中...
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
            data-prompt-surface={POLISH_PROMPT_SURFACE}
            onClick={onPolishChapterFromAudit}
            disabled={isGeneratingContent || !currentChapter?.critique || !currentChapter?.content}
            className="w-full py-2.5 bg-theme-sidebar text-theme-text rounded-xl text-sm font-bold shadow-sm border border-theme-border hover:bg-theme-border/50 disabled:opacity-50 transition-[background-color,border-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2"
          >
            {isGeneratingContent ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
            {isGeneratingContent ? '精修中…' : '按审计精修正文'}
          </button>
        </div>
      </div>

      {currentChapter?.critique ? (
        <div className="prose prose-sm prose-slate prose-p:leading-relaxed max-w-none bg-red-50/50 p-5 rounded-2xl border border-red-100 shadow-sm">
          <div data-prompt-surface={REVIEW_PROMPT_SURFACE}>
            <ReactMarkdown>{currentChapter.critique}</ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
}
