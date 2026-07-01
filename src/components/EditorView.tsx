import React, { useState, useEffect, useRef } from 'react';

import { Novel, CopilotActionKey, AssistantLaunchContext, AgentTab, ContinuationPack, ContinuationEditorLaunchState } from '../../shared/types';
import { cn } from '../lib/utils';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from './ui/AlertDialog';
import { listContinuationPacks } from '../lib/continuation-client';
import { getPreferredContinuationPackId, sortContinuationPacksByRecency } from '../lib/continuation-pack-selection';
import { subscribeToChanges } from '../lib/db-transport';
import type { AgentContext } from '../lib/agents';
import { Download, Loader2 } from 'lucide-react';
import { ChapterSidebar } from './ChapterSidebar';
import { EditorHeader } from './EditorHeader';
import { AgentWorkspace } from './AgentWorkspace';
import { WritingSurface } from './WritingSurface';
import { useEditorData } from '../lib/hooks/useEditorData';
import { useChapterProductionFlow } from '../lib/hooks/useChapterProductionFlow';
import { useEditorGenerationFlow } from '../lib/hooks/useEditorGenerationFlow';
import { useEditorIntelligenceContext } from '../lib/hooks/useEditorIntelligenceContext';
import { useEntitySniffing } from '../lib/hooks/useEntitySniffing';
import { useChapterVersions } from '../lib/hooks/useChapterVersions';
import { useEditorPersistence } from '../lib/hooks/useEditorPersistence';
import { useSkillLoadoutManager } from '../lib/hooks/useSkillLoadoutManager';
import { useChapterUndo } from '../lib/hooks/useChapterUndo';

interface EditorViewProps {
  novel: Novel;
  launchState?: ContinuationEditorLaunchState | null;
  onBack: () => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
}

export function EditorView({ novel, launchState = null, onBack, onOpenAssistant }: EditorViewProps) {
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

  const isGeneratingContentRef = useRef(false);

  const {
    pushToUndoHistory,
    resetUndoHistory,
  } = useChapterUndo({
    currentContent: currentChapter?.content || '',
    isContentLockedRef: isGeneratingContentRef,
    onUndoRedo: (content) => handleUpdateContent(content, true),
  });

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

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedVolumes, setExpandedVolumes] = useState<string[]>(['正文卷']);
  const [isAgentSidebarOpen, setIsAgentSidebarOpen] = useState(false);
  const [continuationPacks, setContinuationPacks] = useState<ContinuationPack[]>([]);
  const [selectedContinuationPackId, setSelectedContinuationPackId] = useState('');
  const [agentTab, setAgentTab] = useState<AgentTab>('context');
  const [bibleSearch, setBibleSearch] = useState('');
  const [globalOutline, setGlobalOutline] = useState(novel.globalOutline || '');
  const [expectedWordCount, setExpectedWordCount] = useState<number | ''>('');
  const [userIntent, setUserIntent] = useState('');
  const hasConsumedContinuationPackSelectionRef = useRef(false);
  const hasConsumedContinuationLaunchUiRef = useRef(false);

  const buildAssistantLaunchContext = (): AssistantLaunchContext => {
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
  };

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

  const [isFullscreen, setIsFullscreen] = useState(false);

  const isChapterEmpty = !currentChapter?.content || currentChapter.content.trim() === '';

  const contentRef = useRef<HTMLTextAreaElement>(null);

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

  const [activeEntityNames, setActiveEntityNames] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!currentChapter || !currentChapter.content) {
        setActiveEntityNames([]);
        return;
      }

      const fullText = currentChapter.content;
      let textToScan = fullText;
      const textarea = contentRef.current;
      if (textarea) {
        const cursor = textarea.selectionStart || 0;
        const minIdx = Math.max(0, cursor - 1500);
        const maxIdx = Math.min(fullText.length, cursor + 500);
        textToScan = fullText.substring(minIdx, maxIdx);
      }

      const matched: string[] = [];

      characters.forEach((c) => {
        if (c.name && textToScan.includes(c.name)) {
          matched.push(c.name);
        }
      });
      locations.forEach((l) => {
        if (l.name && textToScan.includes(l.name)) {
          matched.push(l.name);
        }
      });
      items.forEach((i) => {
        if (i.name && textToScan.includes(i.name)) {
          matched.push(i.name);
        }
      });
      factions.forEach((f) => {
        if (f.name && textToScan.includes(f.name)) {
          matched.push(f.name);
        }
      });

      setActiveEntityNames(matched);
    }, 400);

    return () => clearTimeout(timer);
  }, [currentChapter, characters, locations, items, factions]);
  const { versions } = useChapterVersions(currentChapter?.id);

  // Reset undo history when chapter changes
  useEffect(() => {
    if (currentChapter) {
      resetUndoHistory(currentChapter.content);
    }
  }, [currentChapter, currentChapter?.id, resetUndoHistory]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset sidebar on novel change
    setIsAgentSidebarOpen(false);
  }, [novel?.id]);

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
  }, [isAgentSidebarOpen]);

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

  const [chapterToDeleteId, setChapterToDeleteId] = React.useState<string | null>(null);
  const [versionToRestore, setVersionToRestore] = React.useState<any | null>(null);

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

  useEffect(() => {
    hasConsumedContinuationPackSelectionRef.current = false;
    hasConsumedContinuationLaunchUiRef.current = false;
  }, [launchState?.launchToken, novel.id]);

  useEffect(() => {
    const refreshContinuationPacks = async () => {
      const packs = sortContinuationPacksByRecency(await listContinuationPacks(novel.id));
      setContinuationPacks(packs);
      setSelectedContinuationPackId((current) => {
        if (
          !hasConsumedContinuationPackSelectionRef.current &&
          launchState?.approvedPackId &&
          packs.some((pack) => pack.id === launchState.approvedPackId)
        ) {
          hasConsumedContinuationPackSelectionRef.current = true;
          return launchState.approvedPackId;
        }
        return getPreferredContinuationPackId(packs, current);
      });
    };

    void refreshContinuationPacks();
    return subscribeToChanges(() => {
      void refreshContinuationPacks();
    });
  }, [launchState?.approvedPackId, launchState?.launchToken, novel.id]);

  useEffect(() => {
    if (!launchState || hasConsumedContinuationLaunchUiRef.current) return;
    if (isEditorDataLoading) return;

    const isCockpitAction = launchState.source === 'cockpit-planning' || launchState.source === 'cockpit-production';
    if (!launchState.approvedPackId && !isCockpitAction) return;

    hasConsumedContinuationLaunchUiRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time state sync on launch
    setIsAgentSidebarOpen(true);
    
    if (launchState.source === 'cockpit-production') {
      setAgentTab('production');
    } else if (launchState.source === 'cockpit-planning') {
      setAgentTab('planning');
    } else {
      setAgentTab(launchState.source === 'world-overview' ? 'production' : 'planning');
    }

    // Pre-fill creation intent from continuation task
    if (launchState.prefillIntent) {
      setUserIntent(launchState.prefillIntent);
    }

    // Auto-create first chapter if none exists
    if (chapters.length === 0) {
      void handleAddFirstChapter();
    }
  }, [chapters.length, handleAddFirstChapter, isEditorDataLoading, launchState, launchState?.approvedPackId, launchState?.launchToken, launchState?.prefillIntent, launchState?.source, setAgentTab]);

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
  });

  const runCopilotAction = async (actionKey: CopilotActionKey) => {
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
  };

  const handleStartProductionRun = async () => {
    setAgentTab('production');
    setIsAgentSidebarOpen(true);
    await startProductionRun();
  };

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

  const buildAgentContext = (): AgentContext => agentContext;

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

  const handleCreateChapter = () => handleAddFirstChapter();

  useEffect(() => {
    return () => {
      stopGenerationFlow();
      stopProductionFlow();
    };
  }, [stopGenerationFlow, stopProductionFlow]);

  const toggleVolume = (vName: string) => {
    setExpandedVolumes(prev =>
      prev.includes(vName) ? prev.filter(v => v !== vName) : [...prev, vName]
    );
  };

  return (
    <div className={cn(
      "h-full flex overflow-hidden transition-all duration-700 relative",
      isFullscreen ? "fixed inset-0 z-[100] bg-parchment" : "bg-theme-sidebar"
    )}>
      {isEditorDataLoading && (
        <div className="absolute top-4 right-4 z-50">
          <Loader2 className="animate-spin text-theme-accent opacity-50" size={20} />
        </div>
      )}
      {/* Chapter List Sidebar */}
      <ChapterSidebar
        novel={novel}
        chapters={chapters}
        currentChapter={currentChapter}
        onSelectChapter={setCurrentChapter}
        onAddChapter={handleAddChapter}
        onDeleteChapter={setChapterToDeleteId}
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
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          isAgentSidebarOpen={isAgentSidebarOpen}
          onToggleAgentSidebar={() => setIsAgentSidebarOpen(!isAgentSidebarOpen)}
          isEditorDataLoading={isEditorDataLoading}
          isAnyGenerating={isAnyGenerating}
          isSyncing={isSyncing}
          syncSuccess={syncSuccess}
          mountedSkills={mountedSkills}
          onVolumeNameChange={handleVolumeNameChange}
          onTitleChange={handleTitleChange}
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
              <Download size={12} /> 导出
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
            onClick={() => setIsAgentSidebarOpen(false)}
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
            bibleSearch={bibleSearch}
            setBibleSearch={setBibleSearch}
            characters={characters}
            locations={locations}
            items={items}
            factions={factions}
            librarySkills={librarySkills}
            skillUsageRecords={skillUsageRecords}
            mountedSkillLoadout={mountedSkillLoadout}
            onAssignSkill={assignSkillToSlot}
            onRemoveSkill={removeSkillFromSlot}
            projectPreferenceProfile={projectPreferenceProfile || { contract: {}, tags: [], weights: { styleWeight: 1, characterWeight: 1, worldWeight: 1, plotWeight: 1, pacingWeight: 1 }, acceptedDimensions: [], rejectedDimensions: [], notes: [], evidenceCount: 0 }}
            onPreferenceProfileChange={persistProjectPreferenceProfile}
            versions={versions}
            onSaveVersion={handleSaveVersion}
            onRestoreVersion={setVersionToRestore}
            isSniffing={isSniffing}
            sniffedEntities={sniffedEntities}
            onSniffEntities={handleSniffEntities}
            onAddSniffedEntity={handleAddSniffedEntity}
            addingEntityNames={addingEntityNames}
            relationships={relationships}
            isDocked={true}
            activeEntityNames={activeEntityNames}
          />
        </>
      )}
      <AlertDialog open={Boolean(chapterToDeleteId)} onOpenChange={(open) => !open && setChapterToDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要删除这一章吗？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将永久删除本章的所有正文、分镜 beats 和历史版本，且不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (chapterToDeleteId) {
                  handleDeleteChapter(chapterToDeleteId);
                  setChapterToDeleteId(null);
                }
              }}
              className="bg-red-600 hover:bg-red-700 text-white font-bold"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(versionToRestore)} onOpenChange={(open) => !open && setVersionToRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定要回滚到此版本吗？</AlertDialogTitle>
            <AlertDialogDescription>
              这将覆盖您当前编辑器的正文内容。建议您在回滚前确保已保存好当前草稿。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (versionToRestore) {
                  handleRestoreVersion(versionToRestore);
                  setVersionToRestore(null);
                }
              }}
              className="bg-theme-accent text-theme-bg font-bold hover:bg-theme-accent/90"
            >
              确认回滚
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
