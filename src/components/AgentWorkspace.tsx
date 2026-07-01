import React, { useRef } from 'react';
import { Activity, Bot, Brain, Eye, Globe, History, Lightbulb, ListOrdered, MessageSquareWarning, Sparkles, Wand2, X } from 'lucide-react';

import {
  Novel, Chapter, Character, Item, Location, ChapterVersion,
  Skill, SkillUsageRecord, MountedSkillLoadoutItem, ProjectPreferenceProfile, ContinuationPack,
  ChapterProductionRun, AgentTab, CopilotSuggestion, CopilotActionKey, SniffedEntities, EntityRelationship, Faction
} from '../../shared/types';
import { cn } from '../lib/utils';
import { IdeaFragmentBoard } from './IdeaFragmentBoard';
import { ForeshadowingPanel } from './ForeshadowingPanel';
import { PacingDashboard } from './PacingDashboard';
import { AgentWorkspaceProductionPanel } from './AgentWorkspaceProductionPanel';
import { AgentWorkspaceKnowledgePanel } from './AgentWorkspaceKnowledgePanel';
import { AgentWorkspaceTracePanel } from './AgentWorkspaceTracePanel';
import { AgentWorkspaceVersionsPanel } from './AgentWorkspaceVersionsPanel';
import { CopilotHomePanel } from './copilot/CopilotHomePanel';
import { RelationshipGraph } from './RelationshipGraph';

function isProductionAgentTab(tab: AgentTab): tab is Extract<AgentTab, 'production' | 'outline' | 'planning' | 'quality'> {
  return tab === 'production' || tab === 'outline' || tab === 'planning' || tab === 'quality';
}

function isKnowledgeAgentTab(tab: AgentTab): tab is Extract<AgentTab, 'bible' | 'skills'> {
  return tab === 'bible' || tab === 'skills';
}

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
  bibleSearch: string;
  setBibleSearch: (search: string) => void;
  characters: Character[];
  locations: Location[];
  items: Item[];
  factions: Faction[];
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
  relationships: EntityRelationship[];
  isDocked?: boolean;
  activeEntityNames?: string[];
}

export function AgentWorkspace({
  novel,
  chapters,
  currentChapter,
  setCurrentChapter,
  isAgentSidebarOpen: _isAgentSidebarOpen,
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
  relationships,
  isDocked = false,
  activeEntityNames = [],
  factions,
}: AgentWorkspaceProps) {
  const tabBarRef = useRef<HTMLDivElement>(null);

  const filteredRelationships = React.useMemo(() => {
    if (!relationships || !activeEntityNames || activeEntityNames.length === 0) return [];

    const activeCharIds = characters.filter(c => activeEntityNames.includes(c.name)).map(c => c.id);
    const activeLocIds = locations.filter(l => activeEntityNames.includes(l.name)).map(l => l.id);
    const activeItemIds = items.filter(i => activeEntityNames.includes(i.name)).map(i => i.id);
    const activeFactionIds = factions.filter(f => activeEntityNames.includes(f.name)).map(f => f.id);

    return relationships.filter((rel) => {
      const isSourceActive =
        (rel.sourceType === 'character' && activeCharIds.includes(rel.sourceId)) ||
        (rel.sourceType === 'location' && activeLocIds.includes(rel.sourceId)) ||
        (rel.sourceType === 'item' && activeItemIds.includes(rel.sourceId)) ||
        (rel.sourceType === 'faction' && activeFactionIds.includes(rel.sourceId));

      const isTargetActive =
        (rel.targetType === 'character' && activeCharIds.includes(rel.targetId)) ||
        (rel.targetType === 'location' && activeLocIds.includes(rel.targetId)) ||
        (rel.targetType === 'item' && activeItemIds.includes(rel.targetId)) ||
        (rel.targetType === 'faction' && activeFactionIds.includes(rel.targetId));

      return isSourceActive || isTargetActive;
    });
  }, [relationships, activeEntityNames, characters, locations, items, factions]);

  const matchedEntities = React.useMemo(() => {
    if (!activeEntityNames || activeEntityNames.length === 0) return [];
    const list: Array<{ id: string; name: string; typeLabel: string; description: string }> = [];

    characters.forEach(c => {
      if (activeEntityNames.includes(c.name)) {
        list.push({ id: c.id, name: c.name, typeLabel: '角色', description: c.summary || c.bio || '' });
      }
    });
    locations.forEach(l => {
      if (activeEntityNames.includes(l.name)) {
        list.push({ id: l.id, name: l.name, typeLabel: '地点', description: l.description || '' });
      }
    });
    items.forEach(i => {
      if (activeEntityNames.includes(i.name)) {
        list.push({ id: i.id, name: i.name, typeLabel: '道具', description: i.description || '' });
      }
    });
    factions.forEach(f => {
      if (activeEntityNames.includes(f.name)) {
        list.push({ id: f.id, name: f.name, typeLabel: '势力', description: f.description || '' });
      }
    });

    return list;
  }, [activeEntityNames, characters, locations, items, factions]);

  return (
    <div
      className={cn(
        "flex flex-col border-theme-border bg-theme-sidebar shrink-0 overflow-hidden relative",
        isDocked
          ? "md:w-[360px] md:h-full md:border-l md:relative max-md:absolute max-md:inset-y-3 max-md:right-3 max-md:w-[min(360px,calc(100%-1.5rem))] max-md:rounded-3xl max-md:border max-md:z-30 max-md:bg-theme-sidebar/95 max-md:shadow-2xl max-md:backdrop-blur-sm"
          : "absolute inset-y-3 right-3 w-[min(400px,calc(100%-1.5rem))] rounded-3xl border bg-theme-sidebar/95 z-30 backdrop-blur-sm shadow-2xl"
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border bg-theme-sidebar/90 shrink-0">
        <div>
          <div className="text-xs font-bold text-theme-text">智能管家工作台</div>
          <div className="text-[10px] text-theme-muted mt-1">需要时展开，用完即可随手收回。</div>
        </div>
        <button
          type="button"
          onClick={() => setIsAgentSidebarOpen(false)}
          aria-label="收起智能管家"
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-theme-border bg-theme-sidebar text-theme-text text-[11px] font-bold hover:bg-theme-sidebar/40 transition-colors"
        >
          <X size={12} />
          收起
        </button>
      </div>

      {/* Tabs — grouped by writing phase */}
      <div
        ref={tabBarRef}
        onWheel={(e) => {
          if (!tabBarRef.current) return;
          const el = tabBarRef.current;
          const canScroll = el.scrollWidth > el.clientWidth;
          if (!canScroll) return;
          e.preventDefault();
          el.scrollLeft += e.deltaY;
        }}
        className="flex overflow-x-auto no-scrollbar p-3 gap-1 border-b border-theme-border bg-transparent sticky top-0 z-10 shrink-0 items-center">
        <span className="text-[9px] font-bold text-theme-muted/40 uppercase tracking-wider px-2 shrink-0">当前</span>
        <button onClick={() => setAgentTab('context')} className={cn("flex-none whitespace-nowrap py-1.5 px-2.5 rounded-full text-[11px] font-medium transition-[background-color,color,box-shadow] duration-200 flex items-center justify-center gap-1", agentTab === 'context' ? "bg-theme-text text-white" : "text-theme-muted hover:bg-theme-sidebar hover:text-theme-text")}>
          <Brain size={11} /> 创作情报
        </button>
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
        {agentTab === 'context' && (
          <div key="context" className="space-y-4 pb-8 text-left">
             {/* 1. 当前分镜 Beats */}
             <div className="bg-theme-sidebar/40 p-4 rounded-xl border border-theme-border/40 shadow-sm text-left">
                <div className="text-xs font-bold text-theme-text mb-2 flex items-center gap-1.5 justify-start">
                   <Activity size={12} className="text-theme-accent" />
                   当前章分镜 Beats
                </div>
                {currentChapter?.sceneBeats ? (
                   <div className="text-[11px] text-theme-muted/90 leading-relaxed whitespace-pre-wrap font-serif">
                      {currentChapter.sceneBeats}
                   </div>
                ) : (
                   <div className="text-[11px] text-theme-muted/50 italic">
                      暂无本章分镜。可前往「大纲」或「分镜」生成。
                   </div>
                )}
             </div>

             {/* 2. 当前场景图谱 */}
             <div className="bg-theme-sidebar/40 p-4 rounded-xl border border-theme-border/40 shadow-sm space-y-2 text-left">
                <div className="text-xs font-bold text-theme-text flex items-center justify-between">
                   <div className="flex items-center gap-1.5 justify-start">
                      <Globe size={12} className="text-theme-accent" />
                      当前场景上下文图谱
                   </div>
                   <div className="text-[9px] bg-theme-border/30 text-theme-muted px-1.5 py-0.5 rounded font-mono">
                      匹配实体: {activeEntityNames?.length || 0}
                   </div>
                </div>

                <RelationshipGraph
                   relationships={filteredRelationships}
                   characters={characters}
                   locations={locations}
                   items={items}
                   factions={factions}
                   onSelectEntity={() => {}}
                   activeEntityNames={activeEntityNames}
                />
             </div>

             {/* 3. 出场实体卡片 */}
             <div className="space-y-2 text-left">
                <div className="text-xs font-bold text-theme-text flex items-center gap-1.5 justify-start">
                   <Bot size={12} className="text-theme-accent" />
                   出场设定详情
                </div>
                <div className="grid grid-cols-1 gap-2">
                   {matchedEntities.map(ent => (
                      <div key={ent.id} className="bg-theme-sidebar p-3 rounded-xl border border-theme-border/30 text-left">
                         <div className="flex items-center gap-2 mb-1 justify-start">
                            <span className="text-xs font-bold text-theme-text">{ent.name}</span>
                            <span className="text-[9px] px-1.5 py-0.2 bg-theme-border/40 text-theme-muted rounded">
                               {ent.typeLabel}
                            </span>
                         </div>
                         {ent.description && (
                            <p className="text-[11px] text-theme-muted leading-relaxed line-clamp-3">
                               {ent.description}
                            </p>
                         )}
                      </div>
                   ))}
                   {matchedEntities.length === 0 && (
                      <div className="text-center py-4 text-[11px] text-theme-muted/50 border border-dashed border-theme-border/50 rounded-xl">
                         正文中未检测到已登记的设定实体。在左侧键入人名/地名即可自动识别。
                      </div>
                   )}
                </div>
             </div>

             {/* 4. 技能与伏笔参考 */}
             <div className="grid grid-cols-2 gap-2 text-left">
                <div className="bg-theme-sidebar/40 p-3 rounded-xl border border-theme-border/40 shadow-sm text-left">
                   <div className="text-[10px] font-bold text-theme-text mb-1.5">已挂载技能 ({mountedSkillLoadout.length})</div>
                   <div className="space-y-1">
                      {mountedSkillLoadout.map((item, idx) => {
                         const skillName = librarySkills.find(s => s.id === item.skillId)?.name || item.skillId;
                         return (
                            <div key={idx} className="text-[10px] text-theme-muted truncate">
                               • {skillName}
                            </div>
                         );
                      })}
                      {mountedSkillLoadout.length === 0 && (
                         <div className="text-[10px] text-theme-muted/40 italic">未装备技能</div>
                      )}
                   </div>
                </div>

                <div className="bg-theme-sidebar/40 p-3 rounded-xl border border-theme-border/40 shadow-sm text-left">
                   <div className="text-[10px] font-bold text-theme-text mb-1.5">字数篇幅提示</div>
                   <div className="text-[10px] text-theme-muted leading-relaxed">
                      {currentChapter && currentChapter.content && currentChapter.content.length > 2000 ? (
                         <span className="text-yellow-600 font-medium">⚠️ 本章篇幅较长，建议适时收尾并开启新章。</span>
                      ) : (
                         <span className="text-green-600 font-medium">✅ 本章篇幅适中，适合继续创作。</span>
                      )}
                   </div>
                </div>
             </div>
          </div>
        )}
        {agentTab === 'copilot-home' && (
            <div
              key="copilot-home"
            >
              {copilotSuggestion ? (
                <CopilotHomePanel
                  suggestion={copilotSuggestion}
                  onAction={(key) => void runCopilotAction(key)}
                />
              ) : (
                <div className="text-center py-12 text-theme-muted text-xs">
                  暂无智能建议
                </div>
              )}
            </div>
          )}
          {isProductionAgentTab(agentTab) && (
            <div
              key={agentTab}
            >
              <AgentWorkspaceProductionPanel
                agentTab={agentTab}
                novel={novel}
                chapters={chapters}
                currentChapter={currentChapter}
                setCurrentChapter={setCurrentChapter}
                activeProductionRun={activeProductionRun}
                productionIntent={productionIntent}
                setProductionIntent={setProductionIntent}
                isProductionRunning={isProductionRunning}
                isApplyingProductionRun={isApplyingProductionRun}
                productionError={productionError}
                productionBeatsSource={productionBeatsSource}
                productionDraftSource={productionDraftSource}
                productionAuditSource={productionAuditSource}
                productionStatusMessage={productionStatusMessage}
                continuationPacks={continuationPacks}
                selectedContinuationPackId={selectedContinuationPackId}
                setSelectedContinuationPackId={setSelectedContinuationPackId}
                onStartProductionRun={onStartProductionRun}
                onApplyProductionRun={onApplyProductionRun}
                expectedWordCount={expectedWordCount}
                setExpectedWordCount={setExpectedWordCount}
                onGenerateOutline={onGenerateOutline}
                isGeneratingOutline={isGeneratingOutline}
                globalOutline={globalOutline}
                onGlobalOutlineChange={onGlobalOutlineChange}
                onGenerateBeats={onGenerateBeats}
                isGeneratingBeats={isGeneratingBeats}
                userIntent={userIntent}
                setUserIntent={setUserIntent}
                isGeneratingContent={isGeneratingContent}
                generationStatus={generationStatus}
                onGenerateContent={async () => {
                  setIsAgentSidebarOpen(false);
                  requestAnimationFrame(() => {
                    document.querySelector<HTMLTextAreaElement>('.writing-surface')?.focus();
                  });
                  await onGenerateContent();
                }}
                onRewriteSelectedText={onRewriteSelectedText}
                onUpdateChapterBeats={onUpdateChapterBeats}
                onRunAudit={onRunAudit}
                isGeneratingCritique={isGeneratingCritique}
                onPolishChapterFromAudit={onPolishChapterFromAudit}
                onCreateChapter={onCreateChapter}
              />
            </div>
          )}
          {agentTab === 'ideas' && (
            <div key="ideas">
              <IdeaFragmentBoard novelId={novel.id} compact />
            </div>
          )}
          {agentTab === 'foreshadowing' && (
            <div key="foreshadowing">
              <ForeshadowingPanel novelId={novel.id} currentChapterId={currentChapter?.id} />
            </div>
          )}
          {agentTab === 'pacing' && (
            <div key="pacing">
              <PacingDashboard novelId={novel.id} />
            </div>
          )}
          {isKnowledgeAgentTab(agentTab) && (
            <div
              key={agentTab}
            >
              <AgentWorkspaceKnowledgePanel
                agentTab={agentTab}
                novel={novel}
                currentChapter={currentChapter}
                bibleSearch={bibleSearch}
                setBibleSearch={setBibleSearch}
                characters={characters}
                locations={locations}
                items={items}
                continuationPacks={continuationPacks}
                selectedContinuationPackId={selectedContinuationPackId}
                librarySkills={librarySkills}
                skillUsageRecords={skillUsageRecords}
                mountedSkillLoadout={mountedSkillLoadout}
                onAssignSkill={onAssignSkill}
                onRemoveSkill={onRemoveSkill}
                projectPreferenceProfile={projectPreferenceProfile}
                onPreferenceProfileChange={onPreferenceProfileChange}
              />
            </div>
          )}
          {agentTab === 'versions' && (
            <div
              key="versions"
            >
              <AgentWorkspaceVersionsPanel
                currentChapter={currentChapter}
                versions={versions}
                onSaveVersion={onSaveVersion}
                onRestoreVersion={onRestoreVersion}
              />
            </div>
          )}
          {agentTab === 'trace' && (
            <div
              key="trace"
            >
              <AgentWorkspaceTracePanel
                currentChapter={currentChapter}
                isSniffing={isSniffing}
                sniffedEntities={sniffedEntities}
                onSniffEntities={onSniffEntities}
                onAddSniffedEntity={onAddSniffedEntity}
                addingEntityNames={addingEntityNames}
              />
            </div>
          )}
      </div>
    </div>
  );
}
