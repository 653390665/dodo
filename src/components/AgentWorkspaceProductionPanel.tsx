import React from 'react';

import ReactMarkdown from 'react-markdown';
import { Bot, Feather, FileText, ListOrdered, Loader2, MessageSquareWarning, Plus, Sparkles, Wand2 } from 'lucide-react';
import type { AgentTab, Chapter, ChapterProductionRun, ContinuationPack, Novel, Skill, MountedSkillLoadoutItem, EntityRelationship, Character, Location, Item, Faction } from '../../shared/types';
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
  continuationPacks: ContinuationPack[];
  selectedContinuationPackId: string;
  setSelectedContinuationPackId: (packId: string) => void;
  onStartProductionRun: () => Promise<void>;
  onApplyProductionRun: (runOverride?: ChapterProductionRun) => Promise<void>;
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
  generationStatus: string | null;
  onGenerateContent: () => Promise<void>;
  onRewriteSelectedText: () => Promise<void>;
  onUpdateChapterBeats: (beats: string) => void;
  onRunAudit: () => Promise<void>;
  isGeneratingCritique: boolean;
  onPolishChapterFromAudit: () => Promise<void>;
  onCreateChapter?: () => Promise<void>;
  mountedSkillLoadout?: MountedSkillLoadoutItem[];
  librarySkills?: Skill[];
  relationships?: EntityRelationship[];
  characters?: Character[];
  locations?: Location[];
  items?: Item[];
  factions?: Faction[];
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
  continuationPacks,
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
  generationStatus,
  onGenerateContent,
  onRewriteSelectedText,
  onUpdateChapterBeats,
  onRunAudit,
  isGeneratingCritique,
  onPolishChapterFromAudit,
  onCreateChapter,
  mountedSkillLoadout,
  librarySkills: _librarySkills,
  relationships,
  characters,
  locations,
  items,
  factions,
}: AgentWorkspaceProductionPanelProps) {
  const selectedContinuationPack = continuationPacks.find((pack) => pack.id === selectedContinuationPackId) || null;
  const packTimeFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [],
  );

  const activeSkillsCount = React.useMemo(() => {
    if (mountedSkillLoadout) {
      return mountedSkillLoadout.filter(slot => slot.skillId).length;
    }
    return novel.mountedSkillIds?.length || 0;
  }, [mountedSkillLoadout, novel.mountedSkillIds]);

  const bibleEntitiesCount = React.useMemo(() => {
    return (
      (characters?.length || 0) +
      (locations?.length || 0) +
      (items?.length || 0) +
      (factions?.length || 0) +
      (relationships?.length || 0)
    );
  }, [characters, locations, items, factions, relationships]);

  const renderContextReceipt = () => {
    return (
      <div className="bg-theme-sidebar/40 rounded-xl border border-theme-border/60 p-3.5 space-y-2 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-theme-muted uppercase tracking-wider">
            生成上下文凭证 (Context Receipt)
          </span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold scale-90 origin-right">
            已就绪
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-theme-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-theme-accent" />
            <span className="truncate">
              目标章节: <strong className="text-theme-text">{currentChapter?.title || '未选择'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-theme-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="truncate">
              资料包: <strong className="text-theme-text">{selectedContinuationPack?.title || '未绑定'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-theme-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span className="truncate">
              装配技能: <strong className="text-theme-text">{activeSkillsCount}/3 个</strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-theme-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
            <span className="truncate">
              世界观条目: <strong className="text-theme-text">{bibleEntitiesCount} 条</strong>
            </span>
          </div>
        </div>
      </div>
    );
  };

  if (agentTab === 'production') {
    return (
      <div className="space-y-4">
        {renderContextReceipt()}
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-theme-accent" />
            <h3 className="text-xs font-bold text-theme-text">续写资料包</h3>
          </div>
          {continuationPacks.length > 0 ? (
            <>
              <select
                value={selectedContinuationPackId}
                onChange={(e) => setSelectedContinuationPackId(e.target.value)}
                className="w-full rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2 text-sm text-theme-text outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
              >
                <option value="">不使用资料包，仅按当前作品上下文续写</option>
                {continuationPacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.title} {pack.status === 'approved' ? '· 已确认' : '· 待审核'}
                  </option>
                ))}
              </select>
              {selectedContinuationPack ? (
                <div className="rounded-2xl border border-theme-border bg-theme-sidebar/20 px-3 py-3 text-xs text-theme-muted space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-[11px] font-bold text-theme-text">{selectedContinuationPack.title}</div>
                      <div className="text-[10px] text-theme-muted">
                        {selectedContinuationPack.status === 'approved'
                          ? '已确认资料包会直接接入自动生产上下文。'
                          : '当前接入的是待审核资料包，也会进入自动生产上下文，但内容还没有经过最终确认。'}
                      </div>
                    </div>
                    <div className="rounded-full bg-theme-sidebar px-2 py-1 text-[10px] font-medium text-theme-muted border border-theme-border">
                      更新于 {packTimeFormatter.format(new Date(selectedContinuationPack.updatedAt))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className={cn(
                      'rounded-full px-2.5 py-1 text-[10px] font-medium border',
                      selectedContinuationPack.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200',
                    )}>
                      {selectedContinuationPack.status === 'approved' ? '已确认资料包' : '待审核资料包'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                      <div className="text-[10px] text-theme-muted">续写任务</div>
                      <div className="mt-1 text-theme-text font-bold leading-relaxed">
                        {selectedContinuationPack.continuationTask || '未指定'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                      <div className="text-[10px] text-theme-muted">当前剧情锚点</div>
                      <div className="mt-1 text-theme-text font-bold leading-relaxed">
                        {selectedContinuationPack.plotState.latestScene || '未提供最近场景'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                      硬设定 {selectedContinuationPack.canonFacts.length}
                    </span>
                    <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                      人物状态 {selectedContinuationPack.characterStates.length}
                    </span>
                    <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                      审读问题 {selectedContinuationPack.readingQuestions?.length || 0}
                    </span>
                    <span className="rounded-full bg-theme-sidebar px-2.5 py-1 text-[10px] font-medium text-theme-text border border-theme-border">
                      续写缺口 {selectedContinuationPack.continuationGaps?.length || 0}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                      <div className="text-[10px] text-theme-muted">即时冲突</div>
                      <div className="mt-1 text-theme-text leading-relaxed">
                        {selectedContinuationPack.plotState.immediateConflict || '未指定'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-theme-border bg-theme-sidebar px-3 py-2">
                      <div className="text-[10px] text-theme-muted">下一步建议</div>
                      <div className="mt-1 text-theme-text leading-relaxed">
                        {selectedContinuationPack.plotState.nextLikelyMove || '未指定'}
                      </div>
                    </div>
                  </div>

                  {selectedContinuationPack.continuationGaps?.length ? (
                    <div className="rounded-xl border border-dashed border-theme-border bg-theme-sidebar/70 px-3 py-2">
                      <div className="text-[10px] font-bold text-theme-text">最值得先补的资料缺口</div>
                      <div className="mt-1.5 space-y-1">
                        {selectedContinuationPack.continuationGaps.slice(0, 2).map((gap) => (
                          <div key={gap.id} className="text-[11px] leading-relaxed text-theme-muted">
                            <span className="font-bold text-theme-text">{gap.description}</span>
                            {gap.suggestedDirection ? ` · ${gap.suggestedDirection}` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-theme-border bg-theme-sidebar/20 px-3 py-3 text-xs text-theme-muted">
              当前还没有资料包。先去“世界设定集 → 资料续写”上传资料包，再回来接入续写。
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
          onApply={(runOverride) => void onApplyProductionRun(runOverride)}
        />
      </div>
    );
  }

  if (agentTab === 'outline') {
    return (
      <div className="space-y-6">
        <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
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
                className="w-full text-[10px] p-2 bg-theme-sidebar border border-theme-border rounded-lg pl-2 pr-6 transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
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
            className="w-full h-40 bg-theme-sidebar border border-theme-border rounded-xl p-3 text-xs text-theme-text placeholder:text-theme-muted/40 resize-none shadow-sm font-serif leading-relaxed transition-[border-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:border-theme-accent focus-visible:ring-2 focus-visible:ring-theme-accent/20"
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
                    : 'bg-theme-sidebar border-theme-border/40 hover:border-theme-accent/20',
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
        {renderContextReceipt()}
        <div className="space-y-4">
          <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm">
            <h3 className="text-xs font-bold text-theme-text mb-2 flex items-center gap-2">
              <ListOrdered size={14} className="text-theme-accent" />
              创作意图
            </h3>
            <textarea
              data-prompt-surface={PLANNING_PROMPT_SURFACE}
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
                <button
                  onClick={onCreateChapter}
                  className="w-full py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> 创建第一章并开始分镜
                </button>
              </div>
            ) : (
              <button
                onClick={onGenerateBeats}
                disabled={isGeneratingBeats}
                className="w-full mt-3 py-2.5 bg-theme-accent text-white rounded-xl text-sm font-bold shadow-sm hover:opacity-90 transition-[background-color,opacity,box-shadow] duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isGeneratingBeats ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {isGeneratingBeats ? '规划中...' : '生成场景分镜'}
              </button>
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
                      onClick={onGenerateContent}
                      disabled={isGeneratingContent || !currentChapter.sceneBeats}
                      className="flex items-center gap-1.5 px-3 py-1 bg-theme-accent text-white rounded-lg text-[10px] font-bold shadow-sm hover:opacity-90 disabled:opacity-50 transition-[background-color,opacity,box-shadow] duration-200"
                    >
                      {isGeneratingContent ? <Loader2 size={10} className="animate-spin" /> : <Feather size={10} />}
                      {isGeneratingContent ? '扩写中…' : 'AI 扩写正文'}
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

  return (
    <div className="space-y-6">
      <div className="bg-theme-sidebar p-4 rounded-xl border border-theme-border shadow-sm flex flex-col items-center justify-center text-center">
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
