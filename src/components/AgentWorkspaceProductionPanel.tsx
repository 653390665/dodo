import React from 'react';

import type {
  AgentTab,
  Chapter,
  ChapterMetadata,
  ChapterProductionRun,
  ContinuationPack,
  Novel,
  Skill,
  MountedSkillLoadoutItem,
  EntityRelationship,
  Character,
  Location,
  Item,
  Faction,
  ProjectPreferenceProfile,
  ReviewIssue,
} from '../../shared/types';
import type { PromptAssetActionKind } from '../../shared/types/prompt-assets-governed';
import { ContextReceipt } from './book-factory/ContextReceipt';
import { ProductionTab } from './book-factory/ProductionTab';
import { OutlineTab } from './book-factory/OutlineTab';
import { PlanningTab } from './book-factory/PlanningTab';
import { QualityTab } from './book-factory/QualityTab';
import { getProjectCapabilityCardCount } from '../lib/capability-card-count';
import { resolveCapabilityDisplayName } from '../lib/capability-stage-cards';
import type {
  WritingStyleCandidate,
  WritingStyleMode,
  WritingStyleResolution,
} from '../lib/writing-style-client';

type ProductionAgentTab = Extract<AgentTab, 'production' | 'outline' | 'planning' | 'quality'>;

interface AgentWorkspaceProductionPanelProps {
  agentTab: ProductionAgentTab;
  novel: Novel;
  chapters: ChapterMetadata[];
  currentChapter: Chapter | null;
  onSelectChapter: (chapter: ChapterMetadata) => void | Promise<void>;
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
  onStopProductionRun?: () => void;
  onApplyProductionRun: (runOverride?: ChapterProductionRun) => Promise<void>;
  onOpenBibleAssistant?: (prompt: string) => void;
  expectedWordCount: number | '';
  setExpectedWordCount: (count: number | '') => void;
  projectTechniqueId?: string;
  onGenerateOutline: (outline?: string, options?: {
    techniqueId?: string;
    outlineSourceSelection?: {
      continuationPackId: string;
      primaryDocumentId: string;
      referenceDocumentIds: string[];
    };
  }) => Promise<{ candidateId: string; content: string; databaseGeneration: number } | void>;
  onAdoptOutline: (outline: string) => Promise<boolean>;
  onCanonicalOutlineChange?: (outline: string) => void;
  outlineError?: string | null;
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
  onRunRecommendedAsset?: (assetId: string, actionKind: PromptAssetActionKind) => Promise<void>;
  projectPreferenceProfile?: ProjectPreferenceProfile;
  onPreferenceProfileChange?: (profile: ProjectPreferenceProfile) => Promise<void>;
  skippedAssetIds?: string[];
  stackedDeconstructionCardIds?: string[];
  onStackDeconstructionCard?: (assetId: string) => Promise<void>;
  onUnstackDeconstructionCard?: (assetId: string) => Promise<void>;
  onSkipAsset?: (assetId: string) => Promise<void>;
  writingStyleResolution?: WritingStyleResolution | null;
  writingStyleCandidates?: WritingStyleCandidate[];
  onConfirmWritingStyle?: (mode: WritingStyleMode) => Promise<string | void> | string | void;
  onGenerateWithWritingStyle?: (fingerprint?: string) => Promise<void> | void;
  onOpenWritingStyle?: () => void;
  reviewIssues?: ReviewIssue[];
  onPreviewReviewIssue?: (issueId: string) => void | Promise<void>;
  onFixReviewIssues?: (issueIds: string[], scope?: string) => void | Promise<void>;
  onAcceptReviewIssueRisk?: (issueId: string, reason?: string) => void | Promise<void>;
  onDeferReviewIssue?: (issueId: string) => void | Promise<void>;
}
export function AgentWorkspaceProductionPanel({
  agentTab,
  novel,
  chapters,
  currentChapter,
  onSelectChapter,
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
  onStopProductionRun,
  onApplyProductionRun,
  onOpenBibleAssistant,
  expectedWordCount,
  setExpectedWordCount,
  onGenerateOutline,
  projectTechniqueId,
  onAdoptOutline,
  onCanonicalOutlineChange,
  outlineError,
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
  onRunRecommendedAsset,
  projectPreferenceProfile,
  onPreferenceProfileChange,
  skippedAssetIds,
  stackedDeconstructionCardIds,
  onStackDeconstructionCard,
  onUnstackDeconstructionCard,
  onSkipAsset,
  writingStyleResolution,
  writingStyleCandidates,
  onConfirmWritingStyle,
  onGenerateWithWritingStyle,
  onOpenWritingStyle,
  reviewIssues,
  onPreviewReviewIssue,
  onFixReviewIssues,
  onAcceptReviewIssueRisk,
  onDeferReviewIssue,
}: AgentWorkspaceProductionPanelProps) {
  const selectedContinuationPack =
    continuationPacks.find((pack) => pack.id === selectedContinuationPackId) || null;
  const packTimeFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    []
  );

  const activeSkillsCount = React.useMemo(
    () => getProjectCapabilityCardCount(novel, mountedSkillLoadout),
    [mountedSkillLoadout, novel],
  );

  const capabilityEffectSummary = React.useMemo(() => {
    const capabilityProfile = projectPreferenceProfile?.capabilityProfile || novel.projectPreferenceProfile?.capabilityProfile;
    const resolveName = (id: string | undefined) => id ? resolveCapabilityDisplayName(id, _librarySkills || []) : null;
    const projectCardNames = [
      resolveName(capabilityProfile?.projectSkillDeck.mainCardId),
      ...(capabilityProfile?.projectSkillDeck.supportCardIds || []).map(resolveName),
    ].filter((name): name is string => Boolean(name));
    const favoriteTechniqueNames = (capabilityProfile?.favoriteTechniqueIds || [])
      .map(resolveName)
      .filter((name): name is string => Boolean(name));
    const chapterCardNames = (stackedDeconstructionCardIds || [])
      .map(resolveName)
      .filter((name): name is string => Boolean(name));
    return { projectCardNames, favoriteTechniqueNames, chapterCardNames };
  }, [_librarySkills, novel.projectPreferenceProfile?.capabilityProfile, projectPreferenceProfile?.capabilityProfile, stackedDeconstructionCardIds]);

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
        receipt={
          activeProductionRun?.continuityReport.contextReceipt || {
            actual: false,
            sourceIds: [],
            runtimeSha256: '',
            injectedChars: 0,
            itemCount: 0,
            truncated: false,
          }
        }
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
        onStopProductionRun={onStopProductionRun}
        onApplyProductionRun={onApplyProductionRun}
        onOpenBibleAssistant={onOpenBibleAssistant}
        packTimeFormatter={packTimeFormatter}
        renderContextReceipt={renderContextReceipt}
        capabilityEffectSummary={capabilityEffectSummary}
        onSwitchTab={onSwitchTab}
        writingStyleResolution={writingStyleResolution}
        writingStyleCandidates={writingStyleCandidates}
        onConfirmWritingStyle={onConfirmWritingStyle}
        onGenerateWithWritingStyle={onGenerateWithWritingStyle}
        onOpenWritingStyle={onOpenWritingStyle}
      />
    );
  }

  if (agentTab === 'outline') {
    return (
      <OutlineTab
        novelId={novel.id}
        expectedWordCount={expectedWordCount}
        setExpectedWordCount={setExpectedWordCount}
        onGenerateOutline={onGenerateOutline}
        projectTechniqueId={projectTechniqueId}
        onAdoptOutline={onAdoptOutline}
        onCanonicalOutlineChange={onCanonicalOutlineChange}
        outlineError={outlineError}
        isGeneratingOutline={isGeneratingOutline}
        globalOutline={globalOutline}
        onGlobalOutlineChange={onGlobalOutlineChange}
        chapters={chapters}
        currentChapter={currentChapter}
        onSelectChapter={onSelectChapter}
        selectedContinuationPack={selectedContinuationPack}
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
        novel={novel}
        projectPreferenceProfile={projectPreferenceProfile}
        onPreferenceProfileChange={onPreferenceProfileChange}
        onSwitchTab={onSwitchTab ?? undefined}
      />
    );
  }

  return (
    <QualityTab
      currentChapter={currentChapter}
      novel={novel}
      onRunAudit={onRunAudit}
      isGeneratingCritique={isGeneratingCritique}
      onPolishChapterFromAudit={onPolishChapterFromAudit}
      isGeneratingContent={isGeneratingContent}
      onSwitchTab={onSwitchTab}
      onRunRecommendedAsset={onRunRecommendedAsset}
      skippedAssetIds={skippedAssetIds}
      stackedDeconstructionCardIds={stackedDeconstructionCardIds}
      onStackDeconstructionCard={onStackDeconstructionCard}
      onUnstackDeconstructionCard={onUnstackDeconstructionCard}
      onSkipAsset={onSkipAsset}
      reviewIssues={reviewIssues}
      onPreviewReviewIssue={onPreviewReviewIssue}
      onFixReviewIssues={onFixReviewIssues}
      onAcceptReviewIssueRisk={onAcceptReviewIssueRisk}
      onDeferReviewIssue={onDeferReviewIssue}
      capabilityEffectSummary={capabilityEffectSummary}
    />
  );
}
