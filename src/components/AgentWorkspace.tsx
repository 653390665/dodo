import React, { useRef } from 'react';import X from 'lucide-react/dist/esm/icons/x.js';
import Bot from 'lucide-react/dist/esm/icons/bot.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import Globe from 'lucide-react/dist/esm/icons/globe.js';
import Wand2 from 'lucide-react/dist/esm/icons/wand-sparkles.js';
import ListOrdered from 'lucide-react/dist/esm/icons/list-ordered.js';
import Brain from 'lucide-react/dist/esm/icons/brain.js';
import MessageSquareWarning from 'lucide-react/dist/esm/icons/message-square-warning.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb.js';
import {
  Novel, Chapter, Character, Item, Location, ChapterVersion,
  Skill, SkillUsageRecord, MountedSkillLoadoutItem, ProjectPreferenceProfile, ContinuationPack,
  ChapterProductionRun, AgentTab, CopilotSuggestion, CopilotActionKey, SniffedEntities
} from '../types';
import { cn } from '../lib/utils';
import { IdeaFragmentBoard } from './IdeaFragmentBoard';
import { ForeshadowingPanel } from './ForeshadowingPanel';
import { PacingDashboard } from './PacingDashboard';
import { AgentWorkspaceProductionPanel } from './AgentWorkspaceProductionPanel';
import { AgentWorkspaceKnowledgePanel } from './AgentWorkspaceKnowledgePanel';
import { AgentWorkspaceTracePanel } from './AgentWorkspaceTracePanel';
import { AgentWorkspaceVersionsPanel } from './AgentWorkspaceVersionsPanel';
import { CopilotHomePanel } from './copilot/CopilotHomePanel';

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
}: AgentWorkspaceProps) {
  const tabBarRef = useRef<HTMLDivElement>(null);

  return (
    <div
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
        {agentTab === 'copilot-home' && (
            <div
              key="copilot-home"
            >
              <CopilotHomePanel
                suggestion={copilotSuggestion}
                onAction={(key) => void runCopilotAction(key)}
              />
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
