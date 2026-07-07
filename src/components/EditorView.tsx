import React, { useState, useEffect, useRef } from 'react';

import { Novel, CopilotActionKey, AssistantLaunchContext, ContinuationEditorLaunchState, Chapter, ChapterMetadata, ViewType } from '../../shared/types';
import { cn } from '../lib/utils';
import type { AgentContext } from '../lib/agents';
import { Download, Loader2, Sparkles } from 'lucide-react';
import { ChapterSidebar } from './ChapterSidebar';
import { EditorHeader } from './EditorHeader';
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
    cancelPendingContentSync,
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
    cancelPendingContentSync,
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

  const handleSelectChapter = React.useCallback((chapter: ChapterMetadata) => {
    setCurrentChapter(chapter as unknown as Chapter);
  }, [setCurrentChapter]);

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
      void handlePolishChapterFromAudit();
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
        setCurrentChapter(matched as unknown as Chapter);
        hasSyncedTargetChapterRef.current = true;
      }
    }
  }, [launchState?.targetChapterId, chapters, setCurrentChapter]);

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

        {currentChapter && isChapterEmpty && showEmptyChapterGuide && (
          <div className="mx-6 mt-4 relative rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-theme-accent/5 p-4 text-left shadow-sm backdrop-blur-md animate-fade-in">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-2.5">
                <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 font-sans">
                    空章节指引
                  </h4>
                  <p className="text-xs text-theme-text/85 leading-relaxed font-sans">
                    当前章节暂无正文。您可以：(1) 直接在编辑器中起笔或输入文字；(2) 打开右侧【智能助理】下的【分镜规划】或【扩写生成】进行 AI 智能辅助创作。
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  localStorage.setItem('inkflow_editor_empty_chapter_guide_closed', 'true');
                  setShowEmptyChapterGuide(false);
                }}
                className="text-theme-muted hover:text-theme-text transition-colors text-xs p-1 font-bold font-mono"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {currentChapter && (currentChapter.wordCount || 0) > 100 && showHasContentGuide && (
          <div className="mx-6 mt-4 relative rounded-lg border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-theme-accent/5 p-4 text-left shadow-sm backdrop-blur-md animate-fade-in">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-2.5">
                <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-600 dark:text-amber-400 font-sans">
                    章节打磨与审计指引
                  </h4>
                  <p className="text-xs text-theme-text/85 leading-relaxed font-sans">
                    本章正文已具雏形！您可以：(1) 打开右侧【智能助理】的【审稿】面板对本章进行一致性和节奏审计，找出 AI 味；(2) 在右侧【大纲与设定】面板中提取或补充人物/地点设定，确保设定长效一致；(3) 回到【立项驾驶舱】总览小说大局。
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  localStorage.setItem('inkflow_editor_has_content_guide_closed', 'true');
                  setShowHasContentGuide(false);
                }}
                className="text-theme-muted hover:text-theme-text transition-colors text-xs p-1 font-bold font-mono"
                aria-label="关闭提示"
              >
                ✕
              </button>
            </div>
          </div>
        )}

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

        <div className="h-9 bg-theme-sidebar border-t border-theme-border px-4 flex items-center justify-between shrink-0 text-[11px] text-theme-muted overflow-hidden">
          <div className="flex items-center gap-3 min-w-0 overflow-hidden">
            {launchState?.approvedPackId && (
              <span className="inline-flex items-center rounded-full bg-theme-accent/10 px-2 py-1 text-[10px] font-bold text-theme-accent">
                当前模式：资料包续写
              </span>
            )}
            <span className="font-medium tabular-nums">字数 {currentChapter?.wordCount || 0}</span>
            <span className="hidden sm:inline tabular-nums">更新 {currentChapter ? statusTimeFormatter.format(new Date(currentChapter.updatedAt)) : '-'}</span>
            <span className="hidden lg:inline">预计 token <span className="text-theme-text font-semibold tabular-nums">~2.4k</span></span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-600 shadow-[0_0_5px_rgba(22,163,74,0.3)]" />
              <span className="hidden sm:inline">{isSyncing ? '保存中…' : '本地已保存'}</span>
            </div>
            <div className="hidden sm:block h-3 w-px bg-theme-border/50" />
            <button
              onClick={async () => {
                if (!novel?.id) return;
                const format = confirm('导出为 EPUB？（确定=EPUB，取消=TXT）') ? 'epub' : 'txt';
                try {
                  const res = await fetch('/api/export', {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ novelId: novel.id, format }),
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(err.error || `HTTP ${res.status}`);
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${novel.title}.${format}`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  alert('导出失败: ' + (e instanceof Error ? e.message : String(e)));
                }
              }}
              className="flex items-center gap-1 text-[11px] font-medium text-theme-accent hover:opacity-80 transition-opacity"
            >
              <Download size={12} aria-hidden="true" /> 导出
            </button>
          </div>
        </div>

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
            setCurrentChapter={setCurrentChapter}
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
