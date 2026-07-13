import React, { useState, useEffect, useRef } from 'react';

import { Novel, CopilotActionKey, AssistantLaunchContext, ContinuationEditorLaunchState, ChapterMetadata, ViewType } from '../../shared/types';
import { cn } from '../lib/utils';
import type { AgentContext } from '../lib/agents';
import { Loader2 } from 'lucide-react';
import { metadataToChapter } from '../lib/chapter-utils';
import { ChapterSidebar } from './ChapterSidebar';
import { EditorHeader } from './EditorHeader';
import { EditorGuideBanners } from './EditorGuideBanners';
import { EditorStatusBar } from './EditorStatusBar';
import { AgentWorkspace } from './AgentWorkspace';
import { WritingSurface } from './WritingSurface';
import { EditorModals, EditorModalsHandle } from './EditorModals';
import { useEditorData } from '../lib/hooks/useEditorData';
import { useChapterProductionFlow } from '../lib/hooks/useChapterProductionFlow';
import { useEditorGenerationFlow } from '../lib/hooks/useEditorGenerationFlow';
import { useEditorRecommendationCards } from '../lib/hooks/useEditorRecommendationCards';
import { useEditorIntelligenceContext } from '../lib/hooks/useEditorIntelligenceContext';
import { useEntitySniffing } from '../lib/hooks/useEntitySniffing';
import { useChapterVersions } from '../lib/hooks/useChapterVersions';
import { useEditorPersistence } from '../lib/hooks/useEditorPersistence';
import { useSkillLoadoutManager } from '../lib/hooks/useSkillLoadoutManager';
import { useChapterUndo } from '../lib/hooks/useChapterUndo';
import { useEditorUiState } from '../lib/hooks/useEditorUiState';
import { useEditorContinuationPacks } from '../lib/hooks/useEditorContinuationPacks';
import { toast } from '../lib/toast';


interface EditorViewProps {
  novel: Novel;
  launchState?: ContinuationEditorLaunchState | null;
  onBack: () => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
  onNavigate?: (view: ViewType) => void;
}

export function EditorView({ novel, launchState = null, onBack, onOpenAssistant, onNavigate }: EditorViewProps) {
  // --- 1. Basic State & Ref Hooks (Declared at the very top) ---
  const {
    isFullscreen,
    isSidebarOpen,
    expandedVolumes,
    setExpandedVolumes,
    isAgentSidebarOpen,
    setIsAgentSidebarOpen,
    agentTab,
    setAgentTab,
    toggleSidebar: handleToggleSidebar,
    toggleFullscreen: handleToggleFullscreen,
    toggleAgentSidebar: handleToggleAgentSidebar,
    toggleVolume,
  } = useEditorUiState(novel.id);

  const {
    continuationPacks,
    selectedContinuationPackId,
    setSelectedContinuationPackId,
  } = useEditorContinuationPacks(novel.id, launchState);

  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [expectedWordCount, setExpectedWordCount] = useState<number | ''>('');
  const [userIntent, setUserIntent] = useState('');

  const [showEmptyChapterGuide, setShowEmptyChapterGuide] = useState(() => {
    return localStorage.getItem('inkflow_editor_empty_chapter_guide_closed') !== 'true';
  });

  const [showHasContentGuide, setShowHasContentGuide] = useState(() => {
    return localStorage.getItem('inkflow_editor_has_content_guide_closed') !== 'true';
  });

  const modalsRef = useRef<EditorModalsHandle>(null);
  const isGeneratingContentRef = useRef(false);
  const hasConsumedContinuationLaunchUiRef = useRef(false);
  const hasSyncedTargetChapterRef = useRef(false);
  const prevTargetChapterIdRef = useRef<string | undefined>(undefined);
  const autoPolishAfterAuditRef = useRef(false);
  const recordSkillUsageRef = useRef<((
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[] },
  ) => Promise<void>) | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const statusTimeFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }),
    []
  );


  // --- 2. Custom Hooks (Invoked in correct dependency order) ---
  const {
    chapters, setChapters,
    currentChapter, setCurrentChapter,
    characters,
    locations,
    items,
    factions,
    powerLevels,
    timelineEvents,
    librarySkills,
    skillUsageRecords,
    mountedSkillLoadout, setMountedSkillLoadout,
    relationships,
    projectPreferenceProfile, setProjectPreferenceProfile,
    isLoading: isEditorDataLoading,
  } = useEditorData(novel.id);

  const handleUpdateContentRef = React.useRef<((newContent: string, isProgrammatic?: boolean) => void) | null>(null);

  const handleUndoRedo = React.useCallback((content: string) => {
    handleUpdateContentRef.current?.(content, true);
  }, []);

  const {
    pushToUndoHistory,
    resetUndoHistory,
  } = useChapterUndo({
    currentContent: currentChapter?.content || '',
    isContentLockedRef: isGeneratingContentRef,
    onUndoRedo: handleUndoRedo,
  });

  const {
    skippedAssetIds,
    stackedDeconstructionCardIds,
    handleStackDeconstructionCard,
    handleUnstackDeconstructionCard,
    handleSkipAsset,
  } = useEditorRecommendationCards({ recordSkillUsageRef });

  const {
    isSniffing,
    sniffedEntities,
    addingEntityNames,
    handleSniffEntities,
    handleAddSniffedEntity,
  } = useEntitySniffing({
    novelId: novel.id,
    currentChapter,
    characters,
    locations,
    items,
  });

  const { versions } = useChapterVersions(currentChapter?.id);

  const {
    isSyncing,
    syncSuccess,
    persistSkillLoadout,
    persistProjectPreferenceProfile,
    handleSaveVersion,
    handleRestoreVersion,
    handleUpdateContent,
    handleUpdateChapterBeats,
    handleUpdateGlobalOutline,
    handleAddChapter,
    handleAddFirstChapter,
    handleDeleteChapter,
    handleVolumeNameChange,
    handleTitleChange,
    flushPendingEditorWrites,
    refreshChapters,
  } = useEditorPersistence({
    novel,
    chapters,
    currentChapter,
    isContentLockedRef: isGeneratingContentRef,
    contentRef,
    setChapters,
    setCurrentChapter,
    setMountedSkillLoadout,
    setProjectPreferenceProfile,
    setGlobalOutline,
    setExpandedVolumes,
    pushToUndoHistory,
  });

  React.useEffect(() => {
    handleUpdateContentRef.current = handleUpdateContent;
  }, [handleUpdateContent]);

  const {
    productionIntent,
    setProductionIntent,
    activeProductionRun,
    isProductionRunning,
    isApplyingProductionRun,
    productionError,
    productionBeatsSource,
    productionDraftSource,
    productionAuditSource,
    productionStatusMessage,
    handleStartProductionRun: startProductionRun,
    handleApplyProductionRun,
    stopProductionFlow,
  } = useChapterProductionFlow({
    novelId: novel.id,
    currentChapterId: currentChapter?.id,
    continuationPackId: selectedContinuationPackId || undefined,
    flushPendingEditorWrites,
    refreshChapters,
    setCurrentChapter,
    activeEntityNames: sniffedEntities?.activeExisting || undefined,
  });

  const {
    mountedSkills,
    agentContext,
    copilotSuggestion,
    getCurrentFitScore,
  } = useEditorIntelligenceContext({
    novel,
    chapters,
    currentChapter,
    characters,
    locations,
    items,
    factions,
    powerLevels,
    timelineEvents,
    librarySkills,
    mountedSkillLoadout,
    continuationPacks,
    selectedContinuationPackId,
    sniffedEntities,
    userIntent,
    agentTab,
    stackedDeconstructionCardIds,
  });

  const buildAgentContext = React.useCallback((): AgentContext => agentContext, [agentContext]);

  const {
    recordSkillUsage,
    assignSkillToSlot,
    removeSkillFromSlot,
  } = useSkillLoadoutManager({
    novelId: novel.id,
    currentChapterId: currentChapter?.id,
    mountedSkills,
    mountedSkillLoadout,
    librarySkills,
    persistSkillLoadout,
    getCurrentFitScore,
  });

  const formatAiFailure = (error: unknown, actionLabel: string) => {
    const raw = error instanceof Error ? error.message : String(error);
    if (
      raw.includes('502') ||
      raw.includes('503') ||
      raw.includes('504') ||
      raw.includes('Bad Gateway') ||
      raw.includes('timed out') ||
      raw.includes('fetch failed') ||
      raw.includes('UND_ERR_SOCKET')
    ) {
      return `${actionLabel}失败：上游模型服务当前不稳定或响应过慢。你的配置没有丢，可以稍后重试，或先缩短上下文再生成。`;
    }
    return `${actionLabel}失败：${raw}`;
  };

  const {
    isGeneratingContent,
    isGeneratingOutline,
    isGeneratingBeats,
    isGeneratingCritique,
    generationStatus,
    auditStatus,
    handleRunAudit,
    handleGenerateBeats,
    handleRewriteSelectedText,
    handleGenerateOutline,
    handleGenerateContent,
    handlePolishChapterFromAudit,
    stopGenerationFlow,
  } = useEditorGenerationFlow({
    novel,
    currentChapter,
    mountedSkills,
    userIntent,
    globalOutline,
    expectedWordCount,
    contentRef,
    selectedContinuationPackId,
    buildAgentContext,
    handleUpdateContent,
    pushToUndoHistory,
    setCurrentChapter,
    setGlobalOutline,
    setUserIntent,
    getCurrentFitScore,
    recordSkillUsage,
    formatAiFailure,
  });

  // eslint-disable-next-line react-hooks/refs -- syncing value to ref for use in callbacks
  isGeneratingContentRef.current = isGeneratingContent;

  const isAnyGenerating =
    isGeneratingContent || isGeneratingBeats || isGeneratingCritique || isSniffing || isGeneratingOutline;

  const isChapterEmpty = !currentChapter?.content || currentChapter.content.trim() === '';

  // --- 3. Helper & Callback Functions (Fully declared before referencing) ---

  const buildAssistantLaunchContext = React.useCallback((): AssistantLaunchContext => {
    const selectionStart = contentRef.current?.selectionStart ?? 0;
    const selectionEnd = contentRef.current?.selectionEnd ?? 0;
    const selectedText =
      contentRef.current && currentChapter
        ? currentChapter.content.substring(selectionStart, selectionEnd).trim()
        : '';

    return {
      source: 'workspace',
      novelId: novel.id,
      novelTitle: novel.title,
      novelSummary: novel.summary,
      chapterId: currentChapter?.id,
      chapterTitle: currentChapter?.title || '未命名章节',
      sceneBeats: currentChapter?.sceneBeats || '',
      currentExcerpt: currentChapter?.content?.slice(-240) || '',
      selectedText,
      selectionStart,
      selectionEnd,
      intent:
        selectedText
          ? '围绕这段已选内容，给出可直接用于当前章节的扩写、冲突升级或改写建议。'
          : `围绕当前章节「${currentChapter?.title || '未命名章节'}」给出下一步创作建议。`,
    };
  }, [novel.id, novel.title, novel.summary, currentChapter]);

  const handleSelectChapter = React.useCallback(async (chapter: ChapterMetadata) => {
    try {
      await flushPendingEditorWrites();
      setCurrentChapter(metadataToChapter(chapter));
    } catch (error) {
      console.error('[EditorView] Failed to save before switching chapters:', error);
      toast('尚有内容保存失败，请重试后再切换章节', 'error');
    }
  }, [flushPendingEditorWrites, setCurrentChapter]);

  const runCopilotAction = React.useCallback(async (actionKey: CopilotActionKey) => {
    switch (actionKey) {
      case 'fill-setup':
      case 'open-bible':
        setAgentTab('bible');
        setIsAgentSidebarOpen(true);
        return;
      case 'generate-beats':
        setAgentTab('planning');
        setIsAgentSidebarOpen(true);
        await handleGenerateBeats();
        return;
      case 'generate-draft':
        setAgentTab('planning');
        setIsAgentSidebarOpen(true);
        await handleGenerateContent();
        return;
      case 'run-audit':
      case 'open-quality':
        setAgentTab('quality');
        setIsAgentSidebarOpen(true);
        if (actionKey === 'run-audit') {
          await handleRunAudit();
        }
        return;
      case 'run-polish':
        setAgentTab('quality');
        setIsAgentSidebarOpen(true);
        await handlePolishChapterFromAudit();
        return;
      case 'sync-memory':
        setAgentTab('trace');
        setIsAgentSidebarOpen(true);
        await handleSniffEntities();
        return;
      case 'open-skills':
        setAgentTab('skills');
        setIsAgentSidebarOpen(true);
        return;
      case 'open-planning':
        setAgentTab('planning');
        setIsAgentSidebarOpen(true);
        return;
      default:
        return;
    }
  }, [setAgentTab, setIsAgentSidebarOpen, handleGenerateBeats, handleGenerateContent, handleRunAudit, handlePolishChapterFromAudit, handleSniffEntities]);

  const handleStartProductionRun = React.useCallback(async () => {
    setAgentTab('production');
    setIsAgentSidebarOpen(true);
    await startProductionRun();
  }, [setAgentTab, setIsAgentSidebarOpen, startProductionRun]);

  const handleCreateChapter = React.useCallback(async () => {
    await handleAddFirstChapter();
  }, [handleAddFirstChapter]);

  // --- 4. Side Effects (useEffect) ---

  // Reset undo history when chapter changes
  useEffect(() => {
    if (currentChapter) {
      resetUndoHistory(currentChapter.content);
    }
  }, [currentChapter, currentChapter?.id, resetUndoHistory]);

  useEffect(() => {
    window.inkflow?.setTitle(novel?.title || '');
  }, [novel?.title]);

  useEffect(() => {
    if (!isAgentSidebarOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAgentSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAgentSidebarOpen, setIsAgentSidebarOpen]);

  useEffect(() => {
    hasConsumedContinuationLaunchUiRef.current = false;
    autoPolishAfterAuditRef.current = false;
  }, [launchState?.launchToken, novel.id]);


  useEffect(() => {
    if (!launchState || hasConsumedContinuationLaunchUiRef.current) return;
    if (isEditorDataLoading) return;

    // Ensure target chapter is synchronized and full content is loaded before executing cockpit action
    if (launchState.targetChapterId) {
      if (!currentChapter || currentChapter.id !== launchState.targetChapterId || currentChapter.content === undefined) {
        return;
      }
    }

    const isCockpitAction =
      launchState.source === 'cockpit-planning' ||
      launchState.source === 'cockpit-production' ||
      launchState.source === 'cockpit-audit' ||
      launchState.source === 'cockpit-polish' ||
      launchState.source === 'cockpit-resume';
    if (!launchState.approvedPackId && !isCockpitAction) return;

    hasConsumedContinuationLaunchUiRef.current = true;

    /* eslint-disable react-hooks/set-state-in-effect */
    // Only open assistant sidebar for planning, production, quality, or legacy launch events
    if (launchState.source === 'cockpit-production') {
      setIsAgentSidebarOpen(true);
      setAgentTab('production');
    } else if (launchState.source === 'cockpit-planning') {
      setIsAgentSidebarOpen(true);
      setAgentTab('planning');
    } else if (launchState.source === 'cockpit-audit') {
      setIsAgentSidebarOpen(true);
      setAgentTab('quality');
      void handleRunAudit();
    } else if (launchState.source === 'cockpit-polish') {
      setIsAgentSidebarOpen(true);
      setAgentTab('quality');
      if (currentChapter?.critique) {
        void handlePolishChapterFromAudit();
      } else {
        autoPolishAfterAuditRef.current = true;
        void handleRunAudit();
      }
    } else if (launchState.source !== 'cockpit-resume') {
      setIsAgentSidebarOpen(true);
      setAgentTab(launchState.source === 'world-overview' ? 'production' : 'planning');
    }

    // Pre-fill creation intent from continuation task
    if (launchState.prefillIntent) {
      setUserIntent(launchState.prefillIntent);
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    // Auto-create first chapter if none exists
    if (chapters.length === 0) {
      void handleAddFirstChapter();
    }
  }, [chapters.length, handleAddFirstChapter, isEditorDataLoading, launchState, launchState?.approvedPackId, launchState?.launchToken, launchState?.prefillIntent, launchState?.source, setAgentTab, setIsAgentSidebarOpen, handleRunAudit, handlePolishChapterFromAudit, currentChapter]);

  // Synchronize target chapter ID from cockpit / launch state
  useEffect(() => {
    if (launchState?.targetChapterId !== prevTargetChapterIdRef.current) {
      hasSyncedTargetChapterRef.current = false;
      prevTargetChapterIdRef.current = launchState?.targetChapterId;
    }

    if (hasSyncedTargetChapterRef.current) return;

    if (launchState?.targetChapterId && chapters.length > 0) {
      const matched = chapters.find(c => c.id === launchState.targetChapterId);
      if (matched) {
        setCurrentChapter(metadataToChapter(matched));
        hasSyncedTargetChapterRef.current = true;
      }
    }
  }, [launchState?.targetChapterId, chapters, setCurrentChapter]);

  // Auto-polish once the AI audit completes if requested by cockpit-polish launch
  useEffect(() => {
    if (autoPolishAfterAuditRef.current && !isGeneratingCritique && currentChapter?.critique) {
      autoPolishAfterAuditRef.current = false;
      void handlePolishChapterFromAudit();
    }
  }, [isGeneratingCritique, currentChapter?.critique, handlePolishChapterFromAudit]);

  useEffect(() => {
    recordSkillUsageRef.current = recordSkillUsage;
  }, [recordSkillUsage]);

  useEffect(() => {
    return () => {
      stopGenerationFlow();
      stopProductionFlow();
    };
  }, [stopGenerationFlow, stopProductionFlow]);

  return (
    <div className={cn(
      "h-full flex overflow-hidden transition-all duration-700 relative",
      isFullscreen ? "fixed inset-0 z-[100] bg-parchment" : "bg-theme-sidebar"
    )}>
      {isEditorDataLoading && (
        <div className="absolute top-4 right-4 z-50">
          <Loader2 className="animate-spin text-theme-accent opacity-50" size={20} aria-hidden="true" />
        </div>
      )}
      {/* Chapter List Sidebar */}
      <ChapterSidebar
        novel={novel}
        chapters={chapters}
        currentChapter={currentChapter}
        onSelectChapter={handleSelectChapter}
        onAddChapter={handleAddChapter}
        onDeleteChapter={(id) => modalsRef.current?.confirmDeleteChapter(id)}
        isSidebarOpen={isSidebarOpen}
        isFullscreen={isFullscreen}
        onBack={onBack}
        expandedVolumes={expandedVolumes}
        onToggleVolume={toggleVolume}
      />

      {/* Editor Content Area */}
      <div className={cn(
        "flex-1 flex flex-col relative overflow-hidden transition-colors duration-500",
        isFullscreen ? "bg-parchment" : "bg-paper"
      )}>
        {/* Editor Toolbar */}
        <EditorHeader
          currentChapter={currentChapter}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          isAgentSidebarOpen={isAgentSidebarOpen}
          onToggleAgentSidebar={handleToggleAgentSidebar}
          isEditorDataLoading={isEditorDataLoading}
          isAnyGenerating={isAnyGenerating}
          isSyncing={isSyncing}
          syncSuccess={syncSuccess}
          mountedSkills={mountedSkills}
          onVolumeNameChange={handleVolumeNameChange}
          onTitleChange={handleTitleChange}
        />

        <EditorGuideBanners
          currentChapter={currentChapter}
          isChapterEmpty={isChapterEmpty}
          showEmptyChapterGuide={showEmptyChapterGuide}
          showHasContentGuide={showHasContentGuide}
          onCloseEmptyGuide={() => {
            localStorage.setItem('inkflow_editor_empty_chapter_guide_closed', 'true');
            setShowEmptyChapterGuide(false);
          }}
          onCloseContentGuide={() => {
            localStorage.setItem('inkflow_editor_has_content_guide_closed', 'true');
            setShowHasContentGuide(false);
          }}
        />

        {/* Writing Surface */}
        <WritingSurface
          novel={novel}
          currentChapter={currentChapter}
          isGeneratingBeats={isGeneratingBeats}
          isGeneratingCritique={isGeneratingCritique}
          isGeneratingContent={isGeneratingContent}
          generationStatus={generationStatus}
          auditStatus={auditStatus}
          isChapterEmpty={isChapterEmpty}
          mountedSkillsCount={mountedSkills.length}
          mountedSkills={mountedSkills}
          sniffedEntities={sniffedEntities}
          copilotSuggestion={copilotSuggestion}
          runCopilotAction={runCopilotAction}
          contentRef={contentRef}
          onGenerateBeats={handleGenerateBeats}
          onRunAudit={handleRunAudit}
          onUpdateContent={handleUpdateContent}
          onOpenAssistant={onOpenAssistant}
          buildAssistantLaunchContext={buildAssistantLaunchContext}
          onAddFirstChapter={handleAddFirstChapter}
          setAgentTab={setAgentTab}
          setIsAgentSidebarOpen={setIsAgentSidebarOpen}
          onNavigate={onNavigate}
          characters={characters}
          locations={locations}
          items={items}
        />

        <EditorStatusBar
          currentChapter={currentChapter}
          statusTimeFormatter={statusTimeFormatter}
          isSyncing={isSyncing}
          launchState={launchState}
          novelId={novel.id}
          novelTitle={novel.title}
        />

      </div>

      {/* Agent Sidebar - Docked (WritingContextRail) */}
      {!isFullscreen && isAgentSidebarOpen && (
        <>
          <button
            type="button"
            aria-label="关闭智能管家"
            onClick={handleToggleAgentSidebar}
            className="absolute inset-0 z-20 bg-black/10 backdrop-blur-[1px] md:hidden"
          />
          <AgentWorkspace
            novel={novel}
            chapters={chapters}
            currentChapter={currentChapter}
            onSelectChapter={handleSelectChapter}
            isAgentSidebarOpen={isAgentSidebarOpen}
            setIsAgentSidebarOpen={setIsAgentSidebarOpen}
            agentTab={agentTab}
            setAgentTab={setAgentTab}
            copilotSuggestion={copilotSuggestion}
            runCopilotAction={runCopilotAction}
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
            onStartProductionRun={handleStartProductionRun}
            onApplyProductionRun={handleApplyProductionRun}
            expectedWordCount={expectedWordCount}
            setExpectedWordCount={setExpectedWordCount}
            onGenerateOutline={handleGenerateOutline}
            isGeneratingOutline={isGeneratingOutline}
            globalOutline={globalOutline}
            onGlobalOutlineChange={handleUpdateGlobalOutline}
            onGenerateBeats={handleGenerateBeats}
            isGeneratingBeats={isGeneratingBeats}
            userIntent={userIntent}
            setUserIntent={setUserIntent}
            isGeneratingContent={isGeneratingContent}
            generationStatus={generationStatus}
            onGenerateContent={handleGenerateContent}
            onRewriteSelectedText={handleRewriteSelectedText}
            onUpdateChapterBeats={handleUpdateChapterBeats}
            onRunAudit={handleRunAudit}
            isGeneratingCritique={isGeneratingCritique}
            onPolishChapterFromAudit={handlePolishChapterFromAudit}
            onCreateChapter={handleCreateChapter}
            characters={characters}
            locations={locations}
            items={items}
            factions={factions}
            librarySkills={librarySkills}
            skillUsageRecords={skillUsageRecords}
            mountedSkillLoadout={mountedSkillLoadout}
            onAssignSkill={assignSkillToSlot}
            onRemoveSkill={removeSkillFromSlot}
            skippedAssetIds={skippedAssetIds}
            stackedDeconstructionCardIds={stackedDeconstructionCardIds}
            onStackDeconstructionCard={handleStackDeconstructionCard}
            onUnstackDeconstructionCard={handleUnstackDeconstructionCard}
            onSkipAsset={handleSkipAsset}
            projectPreferenceProfile={projectPreferenceProfile || { contract: {}, tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0 }}
            onPreferenceProfileChange={persistProjectPreferenceProfile}
            versions={versions}
            onSaveVersion={handleSaveVersion}
            onRestoreVersion={(version) => modalsRef.current?.confirmRestoreVersion(version)}
            isSniffing={isSniffing}
            sniffedEntities={sniffedEntities}
            onSniffEntities={handleSniffEntities}
            onAddSniffedEntity={handleAddSniffedEntity}
            addingEntityNames={addingEntityNames}
            relationships={relationships}
            isDocked={true}
            contentRef={contentRef}
          />
        </>
      )}
      <EditorModals
        ref={modalsRef}
        onDeleteChapter={handleDeleteChapter}
        onRestoreVersion={handleRestoreVersion}
      />
    </div>
  );
}
