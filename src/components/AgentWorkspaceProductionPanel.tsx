import React from 'react';

import type { AgentTab, Chapter, ChapterProductionRun, ContinuationPack, Novel, Skill, MountedSkillLoadoutItem, EntityRelationship, Character, Location, Item, Faction } from '../../shared/types';
import { ContextReceipt } from './book-factory/ContextReceipt';
import { ProductionTab } from './book-factory/ProductionTab';
import { OutlineTab } from './book-factory/OutlineTab';
import { PlanningTab } from './book-factory/PlanningTab';
import { QualityTab } from './book-factory/QualityTab';

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
  onSwitchTab?: (tab: AgentTab) => void;
}
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
  onSwitchTab,
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
      <ContextReceipt
        currentChapter={currentChapter}
        selectedContinuationPack={selectedContinuationPack}
        activeSkillsCount={activeSkillsCount}
        bibleEntitiesCount={bibleEntitiesCount}
      />
    );
  };

  if (agentTab === 'production') {
    return (
      <ProductionTab
        novel={novel}
        continuationPacks={continuationPacks}
        selectedContinuationPackId={selectedContinuationPackId}
        setSelectedContinuationPackId={setSelectedContinuationPackId}
        selectedContinuationPack={selectedContinuationPack}
        activeProductionRun={activeProductionRun}
        productionIntent={productionIntent}
        isProductionRunning={isProductionRunning}
        isApplyingProductionRun={isApplyingProductionRun}
        productionError={productionError}
        productionBeatsSource={productionBeatsSource}
        productionDraftSource={productionDraftSource}
        productionAuditSource={productionAuditSource}
        productionStatusMessage={productionStatusMessage}
        setProductionIntent={setProductionIntent}
        onStartProductionRun={onStartProductionRun}
        onApplyProductionRun={onApplyProductionRun}
        packTimeFormatter={packTimeFormatter}
        renderContextReceipt={renderContextReceipt}
      />
    );
  }

  if (agentTab === 'outline') {
    return (
      <OutlineTab
        expectedWordCount={expectedWordCount}
        setExpectedWordCount={setExpectedWordCount}
        onGenerateOutline={onGenerateOutline}
        isGeneratingOutline={isGeneratingOutline}
        globalOutline={globalOutline}
        onGlobalOutlineChange={onGlobalOutlineChange}
        chapters={chapters}
        currentChapter={currentChapter}
        setCurrentChapter={setCurrentChapter}
      />
    );
  }

  if (agentTab === 'planning') {
    return (
      <PlanningTab
        renderContextReceipt={renderContextReceipt}
        userIntent={userIntent}
        setUserIntent={setUserIntent}
        currentChapter={currentChapter}
        onCreateChapter={onCreateChapter}
        onGenerateBeats={onGenerateBeats}
        isGeneratingBeats={isGeneratingBeats}
        onGenerateContent={onGenerateContent}
        isGeneratingContent={isGeneratingContent}
        onRewriteSelectedText={onRewriteSelectedText}
        onUpdateChapterBeats={onUpdateChapterBeats}
        generationStatus={generationStatus}
      />
    );
  }

  return (
    <QualityTab
      currentChapter={currentChapter}
      onRunAudit={onRunAudit}
      isGeneratingCritique={isGeneratingCritique}
      onPolishChapterFromAudit={onPolishChapterFromAudit}
      isGeneratingContent={isGeneratingContent}
      onSwitchTab={onSwitchTab}
    />
  );
}
