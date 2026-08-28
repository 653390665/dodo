import React, { useState, useEffect, useRef } from 'react';

import { Novel, CopilotActionKey, AssistantLaunchContext, ContinuationEditorLaunchState, ChapterMetadata, ViewType, ReviewIssueStatus } from '../../shared/types';
import type { CapabilityLaunchState, CapabilityUtilityResult, WritingStyleCandidate, WritingStyleMode, WritingStyleResolution } from '../../shared/types';
import type { ProductEventSourceType } from '../../shared/types/product-events';
import { cn } from '../lib/utils';
import { deriveLlmAvailability } from '../lib/llm-availability';
import type { AgentContext } from '../lib/agents';
import { Check, Loader2, X } from 'lucide-react';
import { ChapterSidebar } from './ChapterSidebar';
import { EditorHeader } from './EditorHeader';
import { EditorGuideBanners } from './EditorGuideBanners';
import { EditorStatusBar } from './EditorStatusBar';
import { AgentWorkspace } from './AgentWorkspace';
import { WritingSurface } from './WritingSurface';
import { WritingStyleControl } from './WritingStyleControl';
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
import { buildCreationIntentDraft } from '../lib/continuation-pack';
import { confirmWritingStyle, resolveWritingStyle, WritingStyleRequestError } from '../lib/writing-style-client';
import { recordProductEvent } from '../lib/product-events-client';
import { getTrustedSessionCardIds, type GovernanceStage } from '../lib/capability-governance';
import { executeCapability } from '../lib/capability-client';
import { resolveEditorCapabilityLaunch } from '../lib/capability-launch';
import { buildChapterCapabilityWorkflowMeta, getChapterOverlayCapacity } from '../lib/chapter-capability-state';
import { buildCapabilityPreviewApplication } from '../lib/capability-preview-apply';
import { getProjectCapabilityCardCount } from '../lib/capability-card-count';
import { buildEffectiveCapabilitySummary } from '../lib/capability-stage-cards';
import { createChapterVersion, getChapter as getChapterById, updateChapter } from '../lib/chapter-client';
import { getCatalogCapabilityManifest } from '../../shared/lib/capability-manifest-catalog';
import { CURATED_PRODUCT_SKILLS } from '../../shared/lib/public-skill-catalog';
import { computeChapterWorkflowHash } from '../../shared/lib/chapter-workflow';
import { deriveChapterReviewState, deriveReviewGate } from '../../shared/lib/review-issues';
import { DRAFT_QUALITY_SEMANTIC_LABELS } from '../../shared/lib/quality-contract';
import { MIN_COMPLETE_CHAPTER_CHARS } from '../../shared/lib/draft-quality';
import type { AiContentCandidate } from '../lib/generation-action-state';

type CandidateQualityStatus = 'eligible' | 'blocked' | 'review-required' | 'fallback';

function getCandidateQualityState(candidate: AiContentCandidate): {
  status: CandidateQualityStatus;
  label: string;
  detail: string;
} {
  const quality = candidate.quality;
  const source = candidate.source;
  if (source === 'fallback') return { status: 'fallback', label: '保底结果', detail: '当前结果来自保底流程，不能冒充模型审阅结果。' };
  if (!quality) return { status: 'review-required', label: '待复核', detail: '尚未取得完整质量报告，暂不能写入。' };
  if (!quality.ok || quality.mechanicalReview?.status === 'needs-action') return { status: 'blocked', label: '质量阻断', detail: '存在硬性或机械质量问题，需精修后重新审阅。' };
  if (candidate.operation === 'rewrite' && candidate.content.replace(/\s/g, '').length < MIN_COMPLETE_CHAPTER_CHARS) return { status: 'eligible', label: '可写入片段', detail: '局部改写通过确定性检查，可写入选区；整章质量仍需单独审阅。' };
  if (quality.semanticReview.status !== 'pass') return { status: 'review-required', label: '待复核', detail: quality.semanticReview.status === 'needs-action' ? '语义审阅发现问题，需处理后重新审阅。' : '语义审阅尚未完成，暂不能确认写入。' };
  return { status: 'eligible', label: '可写入', detail: '硬性、机械和语义审阅均已通过。' };
}
import { normalizeProjectPreferenceProfile } from '../../shared/lib/project-preference-profile';
import { completeChapter, acceptChapterRisk } from '../lib/chapter-completion-client';
import type { ChapterCompletionResult } from '../../shared/lib/chapter-completion';
import type { ChapterFactCandidate } from '../../shared/types/chapter-facts';
import { applyChapterFactCandidate, previewChapterFactCandidate } from '../lib/chapter-fact-client';
import { ChapterCompletionReview } from './ChapterCompletionReview';
import { ChapterFactCandidateReview } from './ChapterFactCandidateReview';

interface EditorViewProps {
  novel: Novel;
  initialChapterId?: string;
  launchState?: ContinuationEditorLaunchState | null;
  onLaunchConsumed?: (launchToken: number) => void;
  capabilityLaunchState?: CapabilityLaunchState | null;
  onCapabilityLaunchConsumed?: (launchToken: number) => void;
  onBack: () => void;
  onOpenAssistant?: (context: AssistantLaunchContext) => void;
  onOpenBibleAssistant?: (prompt: string) => void;
  onChapterContextChange?: (context: { chapterId?: string; writingStyleFingerprint?: string }) => void;
  onNavigate?: (view: ViewType, context?: { targetChapterId?: string; stage?: GovernanceStage }) => void;
}

type CapabilityUtilityRunRequest = {
  assetId: string;
  targetChapterId: string;
  action: CapabilityLaunchState['action'];
  runToken: string;
};

export function EditorView({ novel, initialChapterId, launchState = null, onLaunchConsumed, capabilityLaunchState = null, onCapabilityLaunchConsumed, onBack, onOpenBibleAssistant, onChapterContextChange, onNavigate }: EditorViewProps) {
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
  const [projectTechniqueId, setProjectTechniqueId] = useState<string | null>(null);

  const {
    continuationPacks,
    selectedContinuationPackId,
    setSelectedContinuationPackId,
  } = useEditorContinuationPacks(novel.id, launchState);

  const approvedOutlinePackId = React.useMemo(() => {
    if (!selectedContinuationPackId) return '';
    const pack = continuationPacks.find((p) => p.id === selectedContinuationPackId);
    if (pack?.status === 'approved') return selectedContinuationPackId;
    return '';
  }, [continuationPacks, selectedContinuationPackId]);

  const activeWorkflowPack = React.useMemo(() => {
    if (!launchState?.approvedPackId) return null;
    return continuationPacks.find((pack) => pack.id === launchState.approvedPackId) || null;
  }, [continuationPacks, launchState]);

  const launchProductionIntent = React.useMemo(() => {
    if (!launchState || (launchState.source !== 'world-overview' && launchState.source !== 'continuation-import')) return '';
    const selectedPack = continuationPacks.find((pack) => pack.id === launchState.approvedPackId);
    if (!selectedPack || selectedContinuationPackId !== launchState.approvedPackId) return '';
    return launchState.prefillIntent?.trim() || buildCreationIntentDraft(selectedPack);
  }, [continuationPacks, launchState, selectedContinuationPackId]);

  const [expectedWordCount, setExpectedWordCount] = useState<number | ''>('');
  const [userIntent, setUserIntent] = useState('');
  const [connectionState, setConnectionState] = useState<'missing' | 'unknown' | 'connected'>('unknown');
  const [embeddingStatus, setEmbeddingStatus] = useState<'ready' | 'initializing' | 'fallback' | 'unavailable' | 'unknown'>('unknown');
  const [writingStyleResolution, setWritingStyleResolution] = useState<WritingStyleResolution | null>(null);
  const [writingStyleCandidates, setWritingStyleCandidates] = useState<WritingStyleCandidate[]>([]);
  const [writingStyleError, setWritingStyleError] = useState<string | null>(null);
  const [capabilityUtilityResult, setCapabilityUtilityResult] = useState<CapabilityUtilityResult | null>(null);
  const [capabilityUtilityError, setCapabilityUtilityError] = useState<string | null>(null);
  const [isCapabilityUtilityRunning, setIsCapabilityUtilityRunning] = useState(false);
  const [capabilityUtilityRunningAssetId, setCapabilityUtilityRunningAssetId] = useState<string | null>(null);
  const [capabilityUtilityRetry, setCapabilityUtilityRetry] = useState<CapabilityUtilityRunRequest | null>(null);
  const [capabilityUtilitySelection, setCapabilityUtilitySelection] = useState<{ start: number; end: number } | undefined>();
  const [capabilityUtilitySuccess, setCapabilityUtilitySuccess] = useState<string | null>(null);
  const [completionResult, setCompletionResult] = useState<ChapterCompletionResult | null>(null);
  const [completionFactCandidate, setCompletionFactCandidate] = useState<ChapterFactCandidate | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionChapterId, setCompletionChapterId] = useState<string | null>(null);
  const [isCompletingChapter, setIsCompletingChapter] = useState(false);
  const [isConfirmingFacts, setIsConfirmingFacts] = useState(false);
  const completionRequestInFlightRef = useRef(false);
  const factConfirmationInFlightRef = useRef(false);
  const writingStyleRequestSeqRef = useRef(0);
  const confirmedWritingStyleFingerprintRef = useRef<string | null>(null);
  const requiredWritingStyleFingerprintsRef = useRef(new Set<string>());

  const [showEmptyChapterGuide, setShowEmptyChapterGuide] = useState(() => {
    return localStorage.getItem(`inkflow_editor_empty_chapter_guide_closed:${novel.id}`) !== 'true';
  });

  const [showHasContentGuide, setShowHasContentGuide] = useState(() => {
    return localStorage.getItem(`inkflow_editor_has_content_guide_closed:${novel.id}`) !== 'true';
  });

  const modalsRef = useRef<EditorModalsHandle>(null);
  const isGeneratingContentRef = useRef(false);
  const hasConsumedContinuationLaunchUiRef = useRef(false);
  const hasSyncedTargetChapterRef = useRef(false);
  const autoStartedProductionLaunchTokenRef = useRef<number | null>(null);
  const prevTargetChapterIdRef = useRef<string | undefined>(undefined);
  const autoPolishAfterAuditRef = useRef<{ chapterId: string; launchToken: number; previousAuditCompletedAt: number } | null>(null);
  const autoPolishAuditStartedRef = useRef(false);
  const restoredLaunchSessionCardsRef = useRef<number | null>(null);
  const consumedCapabilityLaunchTokenRef = useRef<number | null>(null);
  const capabilityUtilityRequestRef = useRef<{ requestId: string; controller: AbortController } | null>(null);
  const capabilityUtilityContextVersionRef = useRef(0);
  const capabilityUtilityContextKeyRef = useRef<string | null>(null);
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
    currentChapter, setCurrentChapter, selectChapter, chapterLoading,
    characters,
    locations,
    items,
    factions,
    powerLevels,
    timelineEvents,
    foreshadowings,
    librarySkills,
    skillUsageRecords,
    mountedSkillLoadout, setMountedSkillLoadout, pendingSkillIds, setPendingSkillIds,
    relationships,
    projectPreferenceProfile, setProjectPreferenceProfile,
    globalOutline, setGlobalOutline,
    databaseGeneration,
    isLoading: isEditorDataLoading,
  } = useEditorData(novel.id, initialChapterId);

  const requireEditorDatabaseGeneration = React.useCallback(() => {
    if (databaseGeneration === null) throw new Error('数据库代次不可用，已阻止当前编辑器操作');
    return databaseGeneration;
  }, [databaseGeneration]);

  useEffect(() => {
    if (!novel.projectPreferenceProfile) return;
    setProjectPreferenceProfile(normalizeProjectPreferenceProfile(novel.projectPreferenceProfile));
  }, [novel.projectPreferenceProfile, setProjectPreferenceProfile]);

  const persistChapterCapabilityState = React.useCallback(async (state: {
    techniqueIds: string[];
    overlayCardIds: string[];
  }) => {
    if (!currentChapter) throw new Error('当前章节不存在');
    const chapterId = currentChapter.id;
    const writeGeneration = requireEditorDatabaseGeneration();
    const previous = currentChapter.workflowMeta?.capabilityState;
    const techniqueVersions = Object.fromEntries(state.techniqueIds.flatMap((id) => {
      const version = getCatalogCapabilityManifest(id)?.version ?? previous?.techniqueVersions?.[id];
      return version === undefined ? [] : [[id, version]];
    }));
    const overlayVersions = Object.fromEntries(state.overlayCardIds.flatMap((id) => {
      const skill = librarySkills.find((entry) => entry.id === id || entry.parentSkillId === id);
      const version = skill?.version ?? getCatalogCapabilityManifest(id)?.version ?? previous?.overlayVersions?.[id];
      return version === undefined ? [] : [[id, version]];
    }));
    const workflowMeta = buildChapterCapabilityWorkflowMeta(currentChapter.workflowMeta, {
      ...state,
      novelId: novel.id,
      databaseGeneration: writeGeneration,
      techniqueVersions,
      overlayVersions,
    });
    const saved = await updateChapter(chapterId, { workflowMeta }, writeGeneration);
    if (!saved) throw new Error('章节能力配置保存失败');
    setCurrentChapter((entry) => entry?.id === chapterId ? { ...entry, workflowMeta } : entry);
    setChapters((entries) => entries.map((entry) => entry.id === chapterId ? { ...entry, workflowMeta } : entry));
  }, [currentChapter, librarySkills, novel.id, requireEditorDatabaseGeneration, setChapters, setCurrentChapter]);
  const persistChapterOverlayIds = React.useCallback((overlayCardIds: string[]) => persistChapterCapabilityState({
    techniqueIds: currentChapter?.workflowMeta?.capabilityState?.techniqueIds || [],
    overlayCardIds,
  }), [currentChapter?.workflowMeta?.capabilityState?.techniqueIds, persistChapterCapabilityState]);
  const handleWorkspaceNavigate = React.useCallback(
    (view: ViewType) => onNavigate?.(view, { targetChapterId: currentChapter?.id }),
    [currentChapter?.id, onNavigate],
  );
  const handleOpenPolishCards = React.useCallback(() => {
    onNavigate?.('skills', { targetChapterId: currentChapter?.id, stage: 'style-polish' });
  }, [currentChapter?.id, onNavigate]);

  const hasWorldBibleData = Boolean(globalOutline.trim()) || [
    characters,
    locations,
    items,
    factions,
    powerLevels,
    timelineEvents,
    relationships,
  ].some((entries) => entries.length > 0);
  const worldBibleState: 'missing' | 'unknown' | 'ready' = isEditorDataLoading
    ? 'unknown'
    : hasWorldBibleData ? 'ready' : 'missing';

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
    removeStackedDeconstructionCard,
    handleSkipAsset,
    isSessionStateLoaded,
  } = useEditorRecommendationCards({
    novelId: novel.id,
    chapterId: currentChapter?.id,
    recordSkillUsageRef,
    initialStackedIds: currentChapter?.workflowMeta?.capabilityState?.overlayCardIds,
    maxStackedCards: getChapterOverlayCapacity(projectPreferenceProfile),
    onStackedIdsChange: persistChapterOverlayIds,
  });

  const writingStyleSessionCardIds = React.useMemo(
    () => [...new Set(stackedDeconstructionCardIds)].slice(0, 6),
    [stackedDeconstructionCardIds],
  );
  const writingStyleFingerprint = writingStyleResolution?.confirmed
    ? writingStyleResolution.fingerprint
    : undefined;
  const writingStyleSessionCardSignature = writingStyleSessionCardIds.join('\u0000');
  const previousWritingStyleSessionCardSignatureRef = React.useRef<string | null>(null);
  useEffect(() => {
    onChapterContextChange?.({
      chapterId: currentChapter?.id,
      writingStyleFingerprint,
    });
  }, [currentChapter?.id, onChapterContextChange, writingStyleFingerprint]);
  useEffect(() => {
    if (!isSessionStateLoaded) return;
    const previous = previousWritingStyleSessionCardSignatureRef.current;
    previousWritingStyleSessionCardSignatureRef.current = writingStyleSessionCardSignature;
    if (previous === null || previous === writingStyleSessionCardSignature) return;
    if (!writingStyleResolution?.confirmed) return;
    confirmedWritingStyleFingerprintRef.current = null;
    queueMicrotask(() => {
      setWritingStyleResolution(null);
      setWritingStyleError('本章使用卡已变化，请重新确认本次写法。');
    });
  }, [isSessionStateLoaded, writingStyleResolution?.confirmed, writingStyleSessionCardSignature]);
  const pendingWritingStyleActionRef = React.useRef<((fingerprint: string) => Promise<void>) | null>(null);
  const applyWritingStyleRequirement = React.useCallback((data: {
    resolution?: WritingStyleResolution;
    candidates?: WritingStyleCandidate[];
    retry?: (fingerprint: string) => Promise<void>;
  }) => {
    if (data.resolution) setWritingStyleResolution(data.resolution);
    if (data.candidates) setWritingStyleCandidates(data.candidates);
    pendingWritingStyleActionRef.current = data.retry || null;
    setWritingStyleError(null);
    if (data.resolution) {
      void recordProductEvent({
        eventName: 'writing_style_required', stage: 'drafting', result: 'success',
        novelId: novel.id, chapterId: currentChapter?.id, objectId: data.resolution.fingerprint,
      });
    }
  }, [currentChapter?.id, novel.id]);
  const handleConfirmWritingStyle = React.useCallback(async (mode: WritingStyleMode) => {
    if (!currentChapter) throw new Error('当前章节不存在');
    const startedAt = Date.now();
    const writeGeneration = requireEditorDatabaseGeneration();
    const response = await confirmWritingStyle(novel.id, {
      chapterId: currentChapter.id,
      databaseGeneration: writeGeneration,
      mode,
      continuationPackId: selectedContinuationPackId || undefined,
      sessionCardIds: writingStyleSessionCardIds.length ? writingStyleSessionCardIds : undefined,
    });
    if (!response.resolution) throw new Error('写法确认响应不完整');
    setWritingStyleResolution(response.resolution);
    setWritingStyleCandidates(response.candidates || []);
    setWritingStyleError(null);
    setProjectPreferenceProfile((current) => current ? {
      ...current,
      writingStyleConfirmation: {
        mode: response.resolution!.mode,
        fingerprint: response.resolution!.fingerprint,
        confirmedAt: Date.now(),
      },
    } : current);
    confirmedWritingStyleFingerprintRef.current = response.resolution.fingerprint;
    void recordProductEvent({
      eventName: 'writing_style_confirmed', stage: 'drafting', result: 'success',
      durationMs: Date.now() - startedAt, novelId: novel.id, chapterId: currentChapter?.id,
      objectId: response.resolution.fingerprint,
    });
    return response.resolution.fingerprint;
  }, [currentChapter, novel.id, requireEditorDatabaseGeneration, selectedContinuationPackId, writingStyleSessionCardIds, setProjectPreferenceProfile]);

  useEffect(() => {
    confirmedWritingStyleFingerprintRef.current = null;
    requiredWritingStyleFingerprintsRef.current.clear();
  }, [novel.id]);

  useEffect(() => {
    if (isEditorDataLoading || !isSessionStateLoaded || !currentChapter) return;
    const requestSeq = ++writingStyleRequestSeqRef.current;
    void Promise.resolve().then(() => resolveWritingStyle(novel.id, {
      chapterId: currentChapter.id,
      databaseGeneration: requireEditorDatabaseGeneration(),
      continuationPackId: selectedContinuationPackId || undefined,
      sessionCardIds: writingStyleSessionCardIds.length ? writingStyleSessionCardIds : undefined,
    })).then((response) => {
      if (requestSeq !== writingStyleRequestSeqRef.current || !response.resolution) return;
      setWritingStyleError(null);
      const previousFingerprint = confirmedWritingStyleFingerprintRef.current;
      if (previousFingerprint && previousFingerprint !== response.resolution.fingerprint && !response.resolution.confirmed) {
        void recordProductEvent({
          eventName: 'writing_style_stale', stage: 'drafting', result: 'success',
          novelId: novel.id, chapterId: currentChapter?.id, objectId: response.resolution.fingerprint,
        });
      }
      confirmedWritingStyleFingerprintRef.current = response.resolution.confirmed
        ? response.resolution.fingerprint
        : null;
      if (!response.resolution.confirmed && !requiredWritingStyleFingerprintsRef.current.has(response.resolution.fingerprint)) {
        requiredWritingStyleFingerprintsRef.current.add(response.resolution.fingerprint);
        void recordProductEvent({
          eventName: 'writing_style_required', stage: 'drafting', result: 'success',
          novelId: novel.id, chapterId: currentChapter?.id, objectId: response.resolution.fingerprint,
        });
      }
      setWritingStyleResolution(response.resolution);
      setWritingStyleCandidates(response.candidates || []);
    }).catch((error) => {
      if (requestSeq !== writingStyleRequestSeqRef.current) return;
      if (error instanceof WritingStyleRequestError && error.sessionCardId && [
        'UNKNOWN_SESSION_CARD', 'UNKNOWN_SESSION_CARD_TYPE', 'SESSION_CARD_NOT_RUNTIME_READY',
        'SESSION_CARD_UNAUTHORIZED', 'SESSION_CARD_FORBIDDEN',
      ].includes(error.code)) {
        removeStackedDeconstructionCard(error.sessionCardId);
        toast('一张失效拆书卡已移除，请重新确认写法', 'info');
      }
      setWritingStyleResolution(null);
      setWritingStyleCandidates([]);
      setWritingStyleError(error instanceof Error ? error.message : '写法解析失败');
    });
  }, [
    isEditorDataLoading,
    isSessionStateLoaded,
    currentChapter,
    mountedSkillLoadout,
    novel.id,
    projectPreferenceProfile?.contract?.styleAnchors,
    selectedContinuationPackId,
    writingStyleSessionCardIds,
    removeStackedDeconstructionCard,
    requireEditorDatabaseGeneration,
  ]);

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
    syncFailed,
    persistSkillLoadout,
    persistProjectPreferenceProfile,
    handleSaveVersion,
    handleRestoreVersion,
    handleUpdateContent,
    queueContentWrite,
    handleUpdateChapterBeats,
    handleUpdateGlobalOutline,
    adoptGlobalOutline,
    handleAddChapter,
    handleAddFirstChapter,
    handleDeleteChapter,
    handleVolumeNameChange,
    handleTitleChange,
    flushPendingEditorWrites,
    refreshChapters,
  } = useEditorPersistence({
    novel,
    databaseGeneration,
    chapters,
    currentChapter,
    isContentLockedRef: isGeneratingContentRef,
    contentRef,
    setChapters,
    setCurrentChapter,
    selectChapter,
    setMountedSkillLoadout,
    setProjectPreferenceProfile,
    setGlobalOutline,
    setExpandedVolumes,
    pushToUndoHistory,
  });

  React.useEffect(() => {
    handleUpdateContentRef.current = handleUpdateContent;
  }, [handleUpdateContent]);

  const buildCapabilityUtilityEventMetadata = React.useCallback((result: CapabilityUtilityResult) => {
    const sourceType: ProductEventSourceType = getCatalogCapabilityManifest(result.capabilityId)?.sourceType || 'unknown';
    const sessionKind = result.kind === 'transform-preview' ? 'capability-preview' : 'capability-diagnostic';
    const sessionId = `${sessionKind}:${novel.id}:${currentChapter?.id || 'unknown'}:${result.capabilityId}:${result.baselineHash}`;
    return { action: result.kind, sessionId, sourceType };
  }, [currentChapter?.id, novel.id]);

  const handleApplyCapabilityPreview = React.useCallback(async () => {
    if (!currentChapter || capabilityUtilityResult?.kind !== 'transform-preview') return;
    const eventMetadata = buildCapabilityUtilityEventMetadata(capabilityUtilityResult);
    const application = buildCapabilityPreviewApplication({
      content: currentChapter.content || '',
      sceneBeats: currentChapter.sceneBeats,
      selection: capabilityUtilitySelection,
      baselineHash: capabilityUtilityResult.baselineHash,
      preview: capabilityUtilityResult.preview,
    });
    if (!application.ok) {
      const message = application.code === 'CAPABILITY_PREVIEW_NO_CHANGES'
        ? '本次精修没有产生可应用变化'
        : application.code === 'CAPABILITY_PREVIEW_EMPTY_CHAPTER'
          ? '精修预览为空，不能覆盖整章正文'
          : application.code === 'CAPABILITY_PREVIEW_QUALITY_GATE_FAILED'
            ? `精修预览未通过质量门禁${application.violations?.length ? `：${application.violations.join('；')}` : ''}`
          : '正文或分镜已变化，旧预览不能应用，请重新运行';
      setCapabilityUtilityError(message);
      void recordProductEvent({
        eventName: 'capability_stale', stage: 'polish', result: 'failure',
        errorCode: application.code, novelId: novel.id, chapterId: currentChapter.id,
        objectId: capabilityUtilityResult.capabilityId,
        ...eventMetadata,
        eventId: `event:capability-stale:${eventMetadata.sessionId}`,
      });
      return;
    }
    try {
      const writeGeneration = requireEditorDatabaseGeneration();
      await createChapterVersion({
        id: `${Date.now()}-capability-preview`,
        chapterId: currentChapter.id,
        content: currentChapter.content || '',
        wordCount: (currentChapter.content || '').replace(/\s/g, '').length,
        author: 'editor-agent',
        createdAt: Date.now(),
      }, writeGeneration);
      handleUpdateContent(application.nextContent, true);
      await flushPendingEditorWrites();
      void recordProductEvent({
        eventName: 'capability_apply', stage: 'polish', result: 'success',
        novelId: novel.id, chapterId: currentChapter.id, objectId: capabilityUtilityResult.capabilityId,
        ...eventMetadata,
        eventId: `event:capability-apply:${eventMetadata.sessionId}`,
      });
      setCapabilityUtilityResult(null);
      setCapabilityUtilitySelection(undefined);
      setCapabilityUtilityError(null);
      setCapabilityUtilitySuccess('精修已应用，已保存应用前版本。');
      toast('预览已应用，并已保存应用前版本', 'success');
    } catch (error) {
      setCapabilityUtilityError(error instanceof Error ? error.message : '预览应用失败');
    }
  }, [buildCapabilityUtilityEventMetadata, capabilityUtilityResult, capabilityUtilitySelection, currentChapter, flushPendingEditorWrites, handleUpdateContent, novel.id, requireEditorDatabaseGeneration]);

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
    databaseGeneration,
    continuationPackId: selectedContinuationPackId || undefined,
    writingStyleFingerprint,
    sessionCardIds: writingStyleSessionCardIds,
    onStyleConfirmationRequired: (error) => applyWritingStyleRequirement(error),
    flushPendingEditorWrites,
    refreshChapters,
    setCurrentChapter,
    activeEntityNames: sniffedEntities?.activeExisting || undefined,
  });

  const liveNovel = React.useMemo(
    () => ({ ...novel, globalOutline, projectPreferenceProfile }),
    [novel, globalOutline, projectPreferenceProfile],
  );
  const mountedSkillsCount = React.useMemo(
    () => getProjectCapabilityCardCount(liveNovel, mountedSkillLoadout),
    [liveNovel, mountedSkillLoadout],
  );
  const effectiveCapabilitySummary = React.useMemo(
    () => projectPreferenceProfile
      ? buildEffectiveCapabilitySummary({
        projectPreferenceProfile,
        currentChapter,
        librarySkills,
      })
      : null,
    [currentChapter, librarySkills, projectPreferenceProfile],
  );

  const {
    mountedSkills,
    agentContext,
    copilotSuggestion,
    getCurrentFitScore,
  } = useEditorIntelligenceContext({
    novel: liveNovel,
    chapters,
    currentChapter,
    characters,
    locations,
    items,
    factions,
    powerLevels,
    timelineEvents,
    foreshadowings,
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
    outlineError,
    isGeneratingBeats,
    isGeneratingCritique,
    generationStatus,
    auditStatus,
    auditUnknownFeedback,
    handleRunAudit,
    handleGenerateBeats,
    handleRewriteSelectedText,
    handleContextRewriteCandidate,
    handleGenerateOutline,
    handleGenerateContent,
    handlePolishChapterFromAudit,
    stopGenerationFlow,
    aiActionState,
    aiContentCandidate,
    isAcceptingAiCandidate,
    acceptAiContentCandidate,
    discardAiContentCandidate,
    retryLastAiAction,
  } = useEditorGenerationFlow({
    novel: liveNovel,
    currentChapter,
    userIntent,
    globalOutline,
    expectedWordCount,
    contentRef,
    selectedContinuationPackId,
    writingStyleFingerprint,
    sessionCardIds: writingStyleSessionCardIds,
    onStyleConfirmationRequired: applyWritingStyleRequirement,
    approvedOutlinePackId,
    buildAgentContext,
    handleUpdateContent,
    pushToUndoHistory,
    setCurrentChapter,
    setGlobalOutline,
    setUserIntent,
    getCurrentFitScore,
    recordSkillUsage,
    formatAiFailure,
    flushPendingEditorWrites,
    databaseGeneration,
  });

  const handleContextRewriteFromCapability = React.useCallback(async () => {
    if (!currentChapter || capabilityUtilityResult?.kind !== 'transform-preview' || capabilityUtilityResult.contextRewrite?.status !== 'required' || !capabilityUtilityResult.structureSignals?.length) return;
    const signal = capabilityUtilityResult.structureSignals.find((entry) => entry.priority === 'P1') || capabilityUtilityResult.structureSignals[0];
    const content = contentRef.current?.value ?? currentChapter.content;
    const selectionOffset = capabilityUtilitySelection?.start ?? 0;
    const relativeStart = signal.range?.start ?? 0;
    const relativeEnd = signal.range?.end ?? relativeStart + signal.snippet.length;
    const start = Math.max(0, Math.min(selectionOffset + relativeStart, content.length));
    const end = Math.max(start + 1, Math.min(selectionOffset + relativeEnd, start + 600, content.length));
    try {
      await handleContextRewriteCandidate({ targetText: content.slice(start, end), beforeContext: content.slice(Math.max(0, start - 300), start), afterContext: content.slice(end, Math.min(content.length, end + 300)), auditIssue: signal.suggestion || signal.signal || '结构同构', sceneBeats: currentChapter.sceneBeats, databaseGeneration: requireEditorDatabaseGeneration(), selectionStart: start, selectionEnd: end });
    } catch (error) {
      setCapabilityUtilityError(error instanceof Error ? error.message : '上下文精修失败，可重试');
    }
  }, [capabilityUtilityResult, capabilityUtilitySelection, contentRef, currentChapter, handleContextRewriteCandidate, requireEditorDatabaseGeneration]);

  const updateReviewIssueStatus = React.useCallback(async (issueId: string, status: ReviewIssueStatus, reason?: string) => {
    if (!currentChapter) return;
    const writeGeneration = requireEditorDatabaseGeneration();
    const content = contentRef.current?.value ?? currentChapter.content;
    const contentHash = computeChapterWorkflowHash(content, currentChapter.sceneBeats);
    const baseState = deriveChapterReviewState(currentChapter, contentHash);
    if (!baseState) return;
    const now = Date.now();
    const issues = baseState.issues.map((issue) => issue.id === issueId
      ? {
        ...issue,
        status,
        updatedAt: now,
        ...(reason ? { decisionReason: reason } : {}),
        ...(status === 'accepted-risk' || status === 'applied' ? { resolvedAt: now } : {}),
      }
      : issue);
    const reviewState = {
      ...baseState,
      contentHash,
      issues,
      gate: deriveReviewGate(issues, status === 'accepted-risk' ? 'pass' : baseState.gate === 'unknown' ? 'unknown' : 'pass'),
      ...(reason ? { decisionReason: reason } : {}),
    };
    const workflowMeta = { ...(currentChapter.workflowMeta || { version: 1 as const }), version: 1 as const, reviewState };
    const saved = await updateChapter(currentChapter.id, { workflowMeta }, writeGeneration);
    if (!saved) throw new Error('审查问题状态保存失败');
    setCurrentChapter((entry) => entry?.id === currentChapter.id ? { ...entry, workflowMeta } : entry);
    setChapters((entries) => entries.map((entry) => entry.id === currentChapter.id ? { ...entry, workflowMeta } : entry));
  }, [currentChapter, requireEditorDatabaseGeneration, setChapters, setCurrentChapter]);
  const handlePreviewReviewIssue = React.useCallback(async (issueId: string) => {
    if (!currentChapter) return;
    const preview = await handlePolishChapterFromAudit(undefined, { issueIds: [issueId], previewOnly: true });
    if (typeof preview !== 'string' || !preview.trim()) return;
    const baselineContent = contentRef.current?.value ?? currentChapter.content;
    const baselineHash = computeChapterWorkflowHash(baselineContent, currentChapter.sceneBeats);
    const issue = currentChapter.workflowMeta?.reviewState?.issues.find((entry) => entry.id === issueId);
    setCapabilityUtilitySelection(undefined);
    setCapabilityUtilityError(null);
    setCapabilityUtilityResult({
      kind: 'transform-preview',
      capabilityId: issue?.recommendedCapabilityIds[0] || 'review-remediation',
      preview,
      baselineHash,
      contextReceipt: {
        actual: true,
        sourceIds: [currentChapter.id],
        runtimeSha256: baselineHash,
        injectedChars: baselineContent.length,
        itemCount: 1,
        truncated: false,
      },
      readOnly: true,
    });
    await updateReviewIssueStatus(issueId, 'previewed');
    toast('修正预览已生成；接受前不会修改正文。', 'info');
  }, [currentChapter, handlePolishChapterFromAudit, updateReviewIssueStatus]);
  const handleFixReviewIssues = React.useCallback(async (issueIds: string[]) => {
    await handlePolishChapterFromAudit(undefined, { issueIds, recheck: true });
  }, [handlePolishChapterFromAudit]);
  const handleAcceptReviewIssueRisk = React.useCallback(async (issueId: string, reason?: string) => {
    await updateReviewIssueStatus(issueId, 'accepted-risk', reason || '作者明确接受该风险');
  }, [updateReviewIssueStatus]);

  const handleCompleteChapter = React.useCallback(async (retryUnavailable = false) => {
    if (!currentChapter || completionRequestInFlightRef.current) return;
    completionRequestInFlightRef.current = true;
    setCompletionChapterId(currentChapter.id);
    setIsCompletingChapter(true);
    setCompletionError(null);
    try {
      await flushPendingEditorWrites();
      const writeGeneration = requireEditorDatabaseGeneration();
      const result = await completeChapter(currentChapter.id, { novelId: novel.id, databaseGeneration: writeGeneration, retryUnavailable });
      setCompletionResult(result);
      setCompletionFactCandidate(null);
      const workflowMeta = {
        ...(currentChapter.workflowMeta || { version: 1 as const }),
        version: 1 as const,
        completionGate: result.gate.completionGate,
        completionContentHash: result.gate.contentHash,
      };
      delete workflowMeta.factCandidateId;
      delete workflowMeta.factCandidateRunId;
      if (result.factCandidateId && result.factCandidateRunId) {
        workflowMeta.factCandidateId = result.factCandidateId;
        workflowMeta.factCandidateRunId = result.factCandidateRunId;
      }
      setCurrentChapter((entry) => entry?.id === currentChapter.id ? { ...entry, workflowMeta } : entry);
      setChapters((entries) => entries.map((entry) => entry.id === currentChapter.id ? { ...entry, workflowMeta } : entry));
      try {
        const refreshedChapter = await getChapterById(currentChapter.id);
        if (refreshedChapter) {
          setCurrentChapter((entry) => entry?.id === currentChapter.id ? refreshedChapter : entry);
          setChapters((entries) => entries.map((entry) => entry.id === currentChapter.id
            ? { ...entry, workflowMeta: refreshedChapter.workflowMeta, wordCount: refreshedChapter.wordCount, updatedAt: refreshedChapter.updatedAt }
            : entry));
        }
      } catch {
        setCompletionError('本章已完成，但最新审阅详情加载失败，请稍后重试。');
      }
      if (result.factCandidateRunId) {
        try {
          setCompletionFactCandidate(await previewChapterFactCandidate(result.factCandidateRunId, { novelId: novel.id, databaseGeneration: writeGeneration }));
        } catch (error) {
          const message = error instanceof Error ? error.message : '事实候选加载失败';
          setCompletionError(`本章已完成，但${message}`);
          toast(`本章已完成，但${message}`, 'error');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '章节完成失败';
      setCompletionError(message);
      toast(message, 'error');
    } finally {
      completionRequestInFlightRef.current = false;
      setIsCompletingChapter(false);
    }
  }, [currentChapter, flushPendingEditorWrites, novel.id, requireEditorDatabaseGeneration, setChapters, setCurrentChapter]);

  const handleOpenCompletionFacts = React.useCallback(async () => {
    const runId = currentChapter?.workflowMeta?.factCandidateRunId;
    if (!currentChapter || !runId || completionRequestInFlightRef.current) return;
    completionRequestInFlightRef.current = true;
    setCompletionChapterId(currentChapter.id);
    setIsCompletingChapter(true);
    setCompletionError(null);
    try {
      const databaseGeneration = requireEditorDatabaseGeneration();
      setCompletionFactCandidate(await previewChapterFactCandidate(runId, { novelId: novel.id, databaseGeneration }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '事实候选加载失败';
      setCompletionError(message);
      toast(message, 'error');
    } finally {
      completionRequestInFlightRef.current = false;
      setIsCompletingChapter(false);
    }
  }, [currentChapter, novel.id, requireEditorDatabaseGeneration]);

  const handleConfirmCompletionFacts = React.useCallback(async (selection: { factDecisions: Record<string, 'accepted' | 'pending' | 'rejected'> }) => {
    if (!currentChapter || !completionFactCandidate || factConfirmationInFlightRef.current) return;
    factConfirmationInFlightRef.current = true;
    setCompletionChapterId(currentChapter.id);
    setIsConfirmingFacts(true);
    setCompletionError(null);
    try {
      const databaseGeneration = requireEditorDatabaseGeneration();
      const result = await applyChapterFactCandidate({
        novelId: novel.id,
        runId: completionFactCandidate.runId,
        databaseGeneration,
        candidateId: completionFactCandidate.id,
        manuscriptContentHash: completionFactCandidate.manuscript.contentHash,
        storyMemoryFingerprint: completionFactCandidate.storyMemoryFingerprint,
        factDecisions: selection.factDecisions,
      });
      const hasPending = Object.values(result.factStatuses).some((status) => status === 'pending');
      let nextCandidate: ChapterFactCandidate | null = null;
      if (hasPending) {
        try {
          nextCandidate = await previewChapterFactCandidate(completionFactCandidate.runId, { novelId: novel.id, databaseGeneration });
        } catch (error) {
          setCompletionFactCandidate(null);
          await selectChapter(currentChapter.id);
          const message = error instanceof Error ? error.message : '事实候选刷新失败';
          setCompletionError(`事实决定已保存，但${message}`);
          toast(`事实决定已保存，但${message}`, 'error');
          return;
        }
      }
      setCompletionFactCandidate(nextCandidate);
      setCurrentChapter((entry) => {
        if (!entry || entry.id !== currentChapter.id) return entry;
        const workflowMeta = { ...(entry.workflowMeta || { version: 1 as const }) };
        delete workflowMeta.factCandidateId;
        delete workflowMeta.factCandidateRunId;
        if (nextCandidate) {
          workflowMeta.factCandidateId = nextCandidate.id;
          workflowMeta.factCandidateRunId = nextCandidate.runId;
        }
        return { ...entry, workflowMeta };
      });
      setChapters((entries) => entries.map((entry) => {
        if (entry.id !== currentChapter.id) return entry;
        const workflowMeta = { ...(entry.workflowMeta || { version: 1 as const }) };
        delete workflowMeta.factCandidateId;
        delete workflowMeta.factCandidateRunId;
        if (nextCandidate) {
          workflowMeta.factCandidateId = nextCandidate.id;
          workflowMeta.factCandidateRunId = nextCandidate.runId;
        }
        return { ...entry, workflowMeta };
      }));
      toast(hasPending ? '已保存事实决定，仍有待确认项。' : '章节事实已确认。', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '事实确认失败';
      setCompletionError(message);
      toast(message, 'error');
    } finally {
      factConfirmationInFlightRef.current = false;
      setIsConfirmingFacts(false);
    }
  }, [completionFactCandidate, currentChapter, novel.id, requireEditorDatabaseGeneration, selectChapter, setChapters, setCurrentChapter]);

  const handleAcceptCompletionRisk = React.useCallback(async (): Promise<boolean> => {
    if (!currentChapter || !completionResult || completionRequestInFlightRef.current) return false;
    completionRequestInFlightRef.current = true;
    setCompletionChapterId(currentChapter.id);
    setIsCompletingChapter(true);
    setCompletionError(null);
    try {
      const writeGeneration = requireEditorDatabaseGeneration();
      const result = await acceptChapterRisk(currentChapter.id, {
        novelId: novel.id,
        databaseGeneration: writeGeneration,
        unresolvedIssueIds: completionResult.gate.deterministicIssues,
        unknownChecks: completionResult.gate.unknownChecks,
        contentHash: completionResult.gate.contentHash,
        planHash: completionResult.gate.planHash,
      });
      setCompletionResult(result);
      const workflowMeta = {
        ...(currentChapter.workflowMeta || { version: 1 as const }), version: 1 as const,
        completionGate: result.gate.completionGate, completionContentHash: result.gate.contentHash, completionDecisionAt: Date.now(),
      };
      setCurrentChapter((entry) => entry?.id === currentChapter.id ? { ...entry, workflowMeta } : entry);
      setChapters((entries) => entries.map((entry) => entry.id === currentChapter.id ? { ...entry, workflowMeta } : entry));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '风险确认失败';
      setCompletionError(message);
      toast(message, 'error');
      return false;
    } finally {
      completionRequestInFlightRef.current = false;
      setIsCompletingChapter(false);
    }
  }, [completionResult, currentChapter, novel.id, requireEditorDatabaseGeneration, setChapters, setCurrentChapter]);
  const handleDeferReviewIssue = React.useCallback(async (issueId: string) => {
    await updateReviewIssueStatus(issueId, 'deferred');
  }, [updateReviewIssueStatus]);

  const handleWritingStyleGenerate = React.useCallback(async (fingerprint?: string) => {
    const pending = pendingWritingStyleActionRef.current;
    pendingWritingStyleActionRef.current = null;
    if (pending) {
      if (typeof fingerprint !== 'string' || !fingerprint) return;
      await pending(fingerprint);
      return;
    }
    await handleGenerateContent(fingerprint);
  }, [handleGenerateContent]);

  // eslint-disable-next-line react-hooks/refs -- syncing value to ref for use in callbacks
  isGeneratingContentRef.current = isGeneratingContent;

  const isAnyGenerating =
    isGeneratingContent || isGeneratingBeats || isGeneratingCritique || isSniffing || isGeneratingOutline;

  const isChapterEmpty = !currentChapter?.content || currentChapter.content.trim() === '';
  const capabilityResultSourceLabels = React.useMemo(() => {
    const activeCapabilityId = capabilityUtilityResult?.capabilityId || capabilityUtilityRunningAssetId;
    const currentLibrarySkillName = activeCapabilityId
      ? librarySkills.find((skill) => skill.id === activeCapabilityId || skill.parentSkillId === activeCapabilityId)?.name
      : undefined;
    const currentCardTitle = activeCapabilityId
      ? CURATED_PRODUCT_SKILLS.find((skill) => skill.id === activeCapabilityId)?.title
      : undefined;
    const receiptSources = capabilityUtilityResult?.contextReceipt?.sources
      ?.map((source) => source.label)
      .filter((label): label is string => Boolean(label.trim())) || [];
    const receiptWithCard = [...new Set([currentLibrarySkillName, currentCardTitle, ...receiptSources].filter((label): label is string => Boolean(label?.trim())))];
    if (receiptWithCard.length > 0) return receiptWithCard;
    return writingStyleResolution?.sources
      .map((source) => source.label)
      .filter((label): label is string => Boolean(label?.trim())) || [];
  }, [capabilityUtilityResult, capabilityUtilityRunningAssetId, librarySkills, writingStyleResolution?.sources]);
  const capabilityUtilityPanelTitle = React.useMemo(() => {
    if (isCapabilityUtilityRunning) return '正在运行能力卡...';
    if (capabilityUtilityError) {
      if (capabilityUtilityRetry?.action === 'run-diagnostic') return '审稿卡执行失败';
      const activeCapabilityId = capabilityUtilityRetry?.assetId || capabilityUtilityRunningAssetId || capabilityUtilityResult?.capabilityId;
      return activeCapabilityId && getCatalogCapabilityManifest(activeCapabilityId)?.output === 'transform-preview'
        ? '精修卡执行失败'
        : '能力卡执行失败';
    }
    return capabilityUtilityResult?.kind === 'diagnostic' ? '审稿卡诊断报告' : '精修卡修改预览';
  }, [capabilityUtilityError, capabilityUtilityResult, capabilityUtilityRetry, capabilityUtilityRunningAssetId, isCapabilityUtilityRunning]);

  // --- 3. Helper & Callback Functions (Fully declared before referencing) ---

  const handleSelectChapter = React.useCallback(async (chapter: ChapterMetadata) => {
    autoPolishAfterAuditRef.current = null;
    autoPolishAuditStartedRef.current = false;
    try {
      await flushPendingEditorWrites();
      const loaded = await selectChapter(chapter.id);
      if (!loaded) toast('章节已不存在或无法加载', 'error');
    } catch (error) {
      console.error('[EditorView] Failed to save before switching chapters:', error);
      toast('尚有内容保存失败，请重试后再切换章节', 'error');
    }
  }, [flushPendingEditorWrites, selectChapter]);

  const handleManualAudit = React.useCallback(async () => {
    autoPolishAfterAuditRef.current = null;
    autoPolishAuditStartedRef.current = false;
    await handleRunAudit();
  }, [handleRunAudit]);

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
          await handleManualAudit();
        }
        return;
      case 'run-polish':
        autoPolishAfterAuditRef.current = null;
        autoPolishAuditStartedRef.current = false;
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
  }, [setAgentTab, setIsAgentSidebarOpen, handleGenerateBeats, handleGenerateContent, handleManualAudit, handlePolishChapterFromAudit, handleSniffEntities]);

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
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setConnectionState(deriveLlmAvailability(data));
        setEmbeddingStatus(data.embeddingStatus?.status || 'unknown');
      })
      .catch((error) => {
        if (!(error instanceof Error && error.name === 'AbortError')) setConnectionState('unknown');
      });
    return () => controller.abort();
  }, []);

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
    autoPolishAfterAuditRef.current = null;
    autoPolishAuditStartedRef.current = false;
    autoStartedProductionLaunchTokenRef.current = null;
    restoredLaunchSessionCardsRef.current = null;
  }, [novel.id]);

  useEffect(() => {
    if (launchState?.launchToken == null) return;
    hasConsumedContinuationLaunchUiRef.current = false;
    autoPolishAfterAuditRef.current = null;
    autoPolishAuditStartedRef.current = false;
    autoStartedProductionLaunchTokenRef.current = null;
    restoredLaunchSessionCardsRef.current = null;
  }, [launchState?.launchToken]);

  useEffect(() => {
    consumedCapabilityLaunchTokenRef.current = null;
  }, [capabilityLaunchState?.launchToken, novel.id]);

  const runCapabilityUtility = React.useCallback((
    run: CapabilityUtilityRunRequest,
    selection?: { start: number; end: number },
    onSettled?: () => void,
  ) => {
    setCapabilityUtilitySelection(selection);
    setCapabilityUtilityResult(null);
    setCapabilityUtilityError(null);
    setCapabilityUtilitySuccess(null);
    setCapabilityUtilityRetry(null);
    setCapabilityUtilityRunningAssetId(run.assetId);
    setIsCapabilityUtilityRunning(true);
    const requestId = `${run.runToken}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const controller = new AbortController();
    capabilityUtilityRequestRef.current?.controller.abort(new Error('能力执行已被新的请求替换'));
    capabilityUtilityRequestRef.current = { requestId, controller };
    const isCurrentRequest = () => capabilityUtilityRequestRef.current?.requestId === requestId;
    void Promise.resolve()
      .then(() => executeCapability(novel.id, run.assetId, {
        chapterId: run.targetChapterId,
        databaseGeneration: requireEditorDatabaseGeneration(),
        stage: 'critic',
        ...(selection ? { selection } : {}),
      }, controller.signal))
      .then((result) => {
        if (!isCurrentRequest()) return;
        setCapabilityUtilityResult(result);
        setCapabilityUtilityRetry(null);
        if (result.kind === 'diagnostic') {
          const sourceType = getCatalogCapabilityManifest(run.assetId)?.sourceType || 'unknown';
          void recordProductEvent({
            eventName: 'diagnostic_run', stage: 'audit', result: 'success',
            novelId: novel.id, chapterId: run.targetChapterId, objectId: run.assetId,
            action: result.kind,
            sessionId: `chapter:${novel.id}:${run.targetChapterId || 'unknown'}`,
            eventId: `event:diagnostic:${run.runToken}:${run.assetId}`,
            sourceType,
          });
        } else {
          const sourceType = getCatalogCapabilityManifest(run.assetId)?.sourceType || 'unknown';
          const previewSessionId = `capability-preview:${novel.id}:${run.targetChapterId || 'unknown'}:${run.assetId}:${result.baselineHash}`;
          void recordProductEvent({
            eventName: 'capability_preview', stage: 'polish', result: 'success',
            novelId: novel.id, chapterId: run.targetChapterId, objectId: run.assetId,
            action: result.kind,
            sessionId: previewSessionId,
            eventId: `event:capability-preview:${previewSessionId}`,
            sourceType,
          });
        }
      })
      .catch((error) => {
        if (isCurrentRequest() && !controller.signal.aborted) {
          setCapabilityUtilityError(error instanceof Error ? error.message : '能力执行失败');
          setCapabilityUtilityRetry(run);
          const sourceType = getCatalogCapabilityManifest(run.assetId)?.sourceType || 'unknown';
          const sessionId = `capability-run:${novel.id}:${run.targetChapterId || 'unknown'}:${run.assetId}:${run.runToken}`;
          void recordProductEvent({
            eventName: 'capability_preview', stage: 'polish', result: 'failure',
            errorCode: 'CAPABILITY_UTILITY_EXECUTION_FAILED',
            novelId: novel.id, chapterId: run.targetChapterId, objectId: run.assetId,
            action: run.action,
            sessionId,
            eventId: `event:capability-preview-failure:${sessionId}`,
            sourceType,
          });
        }
      })
      .finally(() => {
        if (isCurrentRequest()) {
          setIsCapabilityUtilityRunning(false);
          capabilityUtilityRequestRef.current = null;
          onSettled?.();
        }
      });
  }, [novel.id, requireEditorDatabaseGeneration]);

  useEffect(() => {
    const contextVersion = ++capabilityUtilityContextVersionRef.current;
    const contextKey = `${novel.id}:${currentChapter?.id || ''}`;
    const clearCapabilityUtilityState = () => {
      capabilityUtilityRequestRef.current?.controller.abort(new Error('章节上下文已变化，能力执行已取消'));
      capabilityUtilityRequestRef.current = null;
      setIsCapabilityUtilityRunning(false);
      setCapabilityUtilityRunningAssetId(null);
      setCapabilityUtilityResult(null);
      setCapabilityUtilityError(null);
      setCapabilityUtilityRetry(null);
      setCapabilityUtilitySelection(undefined);
      setCapabilityUtilitySuccess(null);
    };

    if (capabilityUtilityContextKeyRef.current && capabilityUtilityContextKeyRef.current !== contextKey) {
      clearCapabilityUtilityState();
    }
    capabilityUtilityContextKeyRef.current = contextKey;

    return () => {
      // React StrictMode simulates an unmount/remount in development. Defer
      // cancellation so that simulated cleanup is ignored when the same
      // context is immediately mounted again, while real unmounts still abort.
      queueMicrotask(() => {
        // The ref read is intentionally deferred to distinguish StrictMode's
        // simulated cleanup from a real context change.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- compare the latest context generation after the deferred cleanup
        if (capabilityUtilityContextVersionRef.current === contextVersion) clearCapabilityUtilityState();
      });
    };
  }, [currentChapter?.id, novel.id]);

  useEffect(() => {
    if (
      !capabilityLaunchState
      || consumedCapabilityLaunchTokenRef.current === capabilityLaunchState.launchToken
      || isEditorDataLoading
      || chapterLoading
    ) return;
    const resolved = resolveEditorCapabilityLaunch(capabilityLaunchState, {
      novelId: novel.id,
      chapterId: currentChapter?.id,
    });
    consumedCapabilityLaunchTokenRef.current = capabilityLaunchState.launchToken;
    if (!resolved.ok) {
      toast(resolved.code === 'CAPABILITY_NOVEL_MISMATCH' ? '该能力不属于当前作品' : '目标章节已变化，请重新运行能力', 'error');
      onCapabilityLaunchConsumed?.(capabilityLaunchState.launchToken);
      return;
    }

    if (resolved.action === 'use-project-technique') {
      // External capability launches are consumed after editor data is ready.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProjectTechniqueId(resolved.projectTechniqueId || resolved.assetId);
      setIsAgentSidebarOpen(true);
      setAgentTab('outline');
      onCapabilityLaunchConsumed?.(capabilityLaunchState.launchToken);
      return;
    }

    if (resolved.action === 'use-technique') {
      const state = currentChapter?.workflowMeta?.capabilityState;
      const techniqueIds = [...new Set([...(state?.techniqueIds || []), resolved.assetId])];
      const isPolishRule = getCatalogCapabilityManifest(resolved.assetId)?.output === 'transform-preview';
      void persistChapterCapabilityState({
        techniqueIds,
        overlayCardIds: state?.overlayCardIds || [],
      }).then(() => {
        setWritingStyleResolution(null);
        toast(isPolishRule ? '已加入本章精修规则，请重新确认本次写法' : '已加入本章技法，请重新确认本次写法', 'success');
        void recordProductEvent({
          eventName: 'technique_used', stage: 'drafting', result: 'success',
          novelId: novel.id, chapterId: currentChapter?.id, objectId: resolved.assetId,
        });
      }).catch((error) => {
        const fallbackMessage = isPolishRule ? '本章精修规则保存失败，请重试' : '本章技法保存失败，请重试';
        toast(error instanceof Error && error.message !== '章节能力配置保存失败' ? error.message : fallbackMessage, 'error');
      }).finally(() => onCapabilityLaunchConsumed?.(capabilityLaunchState.launchToken));
      return;
    }

    if (resolved.action === 'use-overlay' || resolved.action === 'add-to-stack') {
      const linkedSkill = librarySkills.find((skill) => skill.id === resolved.assetId || skill.parentSkillId === resolved.assetId);
      const launchCardIds = resolved.sessionCardIds?.length
        ? [...resolved.sessionCardIds]
        : [resolved.assetId, linkedSkill?.id || ''];
      const ids = getTrustedSessionCardIds(launchCardIds, librarySkills);
      if (!ids.length) {
        toast('这张本章使用卡已失效或未获得授权，未加入本章', 'error');
        onCapabilityLaunchConsumed?.(capabilityLaunchState.launchToken);
        return;
      }
      void handleStackDeconstructionCard(ids[0]).then(() => {
        const rawSourceType = linkedSkill?.sourceType ?? getCatalogCapabilityManifest(resolved.assetId)?.sourceType;
        const sourceType = rawSourceType === 'built-in' || rawSourceType === 'plaza' || rawSourceType === 'licensed' || rawSourceType === 'book-extracted'
          ? rawSourceType
          : 'unknown';
        void recordProductEvent({
          eventName: 'chapter_overlay_used', stage: 'drafting', result: 'success',
          novelId: novel.id, chapterId: currentChapter?.id, objectId: ids[0],
          action: resolved.action,
          sessionId: `chapter:${novel.id}:${currentChapter?.id || resolved.targetChapterId || 'unknown'}`,
          eventId: `event:chapter-overlay:${capabilityLaunchState.launchToken}:${ids[0]}`,
          sourceType,
        });
      }).finally(() => onCapabilityLaunchConsumed?.(capabilityLaunchState.launchToken));
      return;
    }

    const textarea = contentRef.current;
    const selection = textarea && textarea.selectionEnd > textarea.selectionStart
      ? { start: textarea.selectionStart, end: textarea.selectionEnd }
      : undefined;
    return runCapabilityUtility({
      assetId: resolved.assetId,
      targetChapterId: resolved.targetChapterId,
      action: resolved.action,
      runToken: String(capabilityLaunchState.launchToken),
    }, selection, () => onCapabilityLaunchConsumed?.(capabilityLaunchState.launchToken));
  }, [
    capabilityLaunchState,
    chapterLoading,
    currentChapter?.id,
    currentChapter?.workflowMeta?.capabilityState,
    handleStackDeconstructionCard,
    isEditorDataLoading,
    librarySkills,
    novel.id,
    onCapabilityLaunchConsumed,
    persistChapterCapabilityState,
    runCapabilityUtility,
    setAgentTab,
    setIsAgentSidebarOpen,
  ]);

  useEffect(() => {
    if (!launchState || launchState.source !== 'capability-overlay' || launchState.novelId !== novel.id || isEditorDataLoading || chapterLoading || !currentChapter) return;
    if (restoredLaunchSessionCardsRef.current === launchState.launchToken) return;
    restoredLaunchSessionCardsRef.current = launchState.launchToken;
    const ids = getTrustedSessionCardIds([...new Set((launchState.sessionCardIds || []).filter(Boolean))].slice(0, 6), librarySkills);
    ids.forEach((id) => { void handleStackDeconstructionCard(id); });
    if (ids.length) void recordProductEvent({ eventName: 'deconstruction_card_restore', stage: 'drafting', result: 'success', novelId: novel.id, chapterId: currentChapter.id, objectId: ids.join(',') });
    onLaunchConsumed?.(launchState.launchToken);
  }, [chapterLoading, currentChapter, handleStackDeconstructionCard, isEditorDataLoading, launchState, librarySkills, novel.id, onLaunchConsumed]);


  useEffect(() => {
    if (!launchState || hasConsumedContinuationLaunchUiRef.current) return;
    if (isEditorDataLoading || chapterLoading) return;

    // Ensure target chapter is synchronized and full content is loaded before executing cockpit action
    if (launchState.targetChapterId) {
      if (!currentChapter || currentChapter.id !== launchState.targetChapterId) {
        return;
      }
    }

    const isCockpitAction =
      launchState.source === 'cockpit-planning' ||
      launchState.source === 'cockpit-production' ||
      launchState.source === 'cockpit-audit' ||
      launchState.source === 'cockpit-polish' ||
      launchState.source === 'cockpit-complete-chapter' ||
      launchState.source === 'cockpit-resolve-issues' ||
      launchState.source === 'cockpit-confirm-facts' ||
      launchState.source === 'cockpit-resume' ||
      launchState.source === 'cockpit-next-chapter';
    if (!launchState.approvedPackId && !isCockpitAction) return;

    hasConsumedContinuationLaunchUiRef.current = true;

    /* eslint-disable react-hooks/set-state-in-effect */
    // Only open assistant sidebar for planning, production, quality, or legacy launch events
    if (launchState.source === 'cockpit-next-chapter') {
      void handleAddChapter();
    } else if (launchState.source === 'cockpit-production') {
      setIsAgentSidebarOpen(true);
      setAgentTab('production');
    } else if (launchState.source === 'cockpit-planning') {
      setIsAgentSidebarOpen(true);
      setAgentTab('planning');
    } else if (launchState.source === 'cockpit-complete-chapter') {
      void handleCompleteChapter();
    } else if (launchState.source === 'cockpit-resolve-issues') {
      setIsAgentSidebarOpen(true);
      setAgentTab('quality');
    } else if (launchState.source === 'cockpit-confirm-facts') {
      void handleOpenCompletionFacts();
    } else if (launchState.source === 'cockpit-audit') {
      setIsAgentSidebarOpen(true);
      setAgentTab('quality');
      void handleRunAudit();
    } else if (launchState.source === 'cockpit-polish') {
      setIsAgentSidebarOpen(true);
      setAgentTab('quality');
      autoPolishAfterAuditRef.current = {
        chapterId: currentChapter?.id || launchState.targetChapterId || '',
        launchToken: launchState.launchToken,
        previousAuditCompletedAt: currentChapter?.workflowMeta?.lastAudit?.completedAt || 0,
      };
      autoPolishAuditStartedRef.current = true;
      void handleRunAudit();
    } else if (launchState.source !== 'cockpit-resume') {
      setIsAgentSidebarOpen(true);
      setAgentTab(launchState.source === 'world-overview' ? 'production' : 'planning');
    }

    // Pre-fill creation intent from continuation task
    if (launchState.prefillIntent) {
      setUserIntent(launchState.prefillIntent);
      setProductionIntent(launchState.prefillIntent);
    }
    if (launchState.source !== 'world-overview' && launchState.source !== 'continuation-import') {
      onLaunchConsumed?.(launchState.launchToken);
    }
    /* eslint-enable react-hooks/set-state-in-effect */

    // Auto-create first chapter if none exists
    if (chapters.length === 0) {
      void handleAddFirstChapter();
    }
  }, [chapters.length, chapterLoading, handleAddChapter, handleAddFirstChapter, handleCompleteChapter, handleOpenCompletionFacts, isEditorDataLoading, launchState, launchState?.approvedPackId, launchState?.launchToken, launchState?.prefillIntent, launchState?.source, onLaunchConsumed, setAgentTab, setIsAgentSidebarOpen, setProductionIntent, handleRunAudit, handlePolishChapterFromAudit, currentChapter]);

  useEffect(() => {
    if (
      !launchState
      || (launchState.source !== 'world-overview' && launchState.source !== 'continuation-import')
      || !launchState.approvedPackId
      || autoStartedProductionLaunchTokenRef.current === launchState.launchToken
      || isEditorDataLoading
      || chapterLoading
      || chapters.length === 0
      || !currentChapter
      || selectedContinuationPackId !== launchState.approvedPackId
      || !launchProductionIntent
    ) return;

    autoStartedProductionLaunchTokenRef.current = launchState.launchToken;
    setUserIntent(launchProductionIntent);
    setProductionIntent(launchProductionIntent);
    setIsAgentSidebarOpen(true);
    setAgentTab('production');
    void startProductionRun(launchProductionIntent);
    onLaunchConsumed?.(launchState.launchToken);
  }, [chapterLoading, chapters.length, currentChapter, isEditorDataLoading, launchProductionIntent, launchState, launchState?.approvedPackId, launchState?.launchToken, launchState?.source, onLaunchConsumed, selectedContinuationPackId, setAgentTab, setIsAgentSidebarOpen, setProductionIntent, startProductionRun]);

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
        void selectChapter(matched.id).then((loaded) => {
          if (loaded) hasSyncedTargetChapterRef.current = true;
        }).catch((error) => {
          console.error('[EditorView] Failed to load launch target chapter:', error);
          toast('目标章节加载失败，请重试', 'error');
        });
      }
    }
  }, [launchState?.targetChapterId, chapters, selectChapter]);

  // Auto-polish once the AI audit completes if requested by cockpit-polish launch
  useEffect(() => {
    const pending = autoPolishAfterAuditRef.current;
    if (!pending || !currentChapter || pending.chapterId !== currentChapter.id) return;
    if (launchState?.launchToken != null && pending.launchToken !== launchState.launchToken) {
      autoPolishAfterAuditRef.current = null;
      autoPolishAuditStartedRef.current = false;
      return;
    }
    if (isGeneratingCritique) {
      autoPolishAuditStartedRef.current = true;
      return;
    }
    if (!autoPolishAuditStartedRef.current) return;
    const completedAt = currentChapter.workflowMeta?.lastAudit?.completedAt || 0;
    if (currentChapter.critique && completedAt > pending.previousAuditCompletedAt) {
      autoPolishAfterAuditRef.current = null;
      autoPolishAuditStartedRef.current = false;
      void handlePolishChapterFromAudit();
      return;
    }
    autoPolishAfterAuditRef.current = null;
    autoPolishAuditStartedRef.current = false;
  }, [currentChapter, currentChapter?.id, currentChapter?.critique, currentChapter?.workflowMeta?.lastAudit?.completedAt, isGeneratingCritique, handlePolishChapterFromAudit, launchState?.launchToken]);

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
      {(isEditorDataLoading || chapterLoading) && (
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
          syncFailed={syncFailed}
          connectionState={connectionState}
          worldBibleState={worldBibleState}
          mountedSkills={mountedSkills}
          effectiveCapabilitySummary={effectiveCapabilitySummary}
          onVolumeNameChange={handleVolumeNameChange}
          onTitleChange={handleTitleChange}
        />

        <EditorGuideBanners
          currentChapter={currentChapter}
          isChapterEmpty={isChapterEmpty}
          showEmptyChapterGuide={showEmptyChapterGuide}
          showHasContentGuide={showHasContentGuide}
          onCloseEmptyGuide={() => {
            localStorage.setItem(`inkflow_editor_empty_chapter_guide_closed:${novel.id}`, 'true');
            setShowEmptyChapterGuide(false);
          }}
          onCloseContentGuide={() => {
            localStorage.setItem(`inkflow_editor_has_content_guide_closed:${novel.id}`, 'true');
            setShowHasContentGuide(false);
          }}
          onRestoreEmptyGuide={() => {
            localStorage.removeItem(`inkflow_editor_empty_chapter_guide_closed:${novel.id}`);
            setShowEmptyChapterGuide(true);
          }}
          onRestoreContentGuide={() => {
            localStorage.removeItem(`inkflow_editor_has_content_guide_closed:${novel.id}`);
            setShowHasContentGuide(true);
          }}
          packStatus={activeWorkflowPack?.status || 'none'}
          syncState={activeWorkflowPack?.syncState?.status || 'unknown'}
        />

        {(isCapabilityUtilityRunning || capabilityUtilityResult || capabilityUtilityError) && (
          <section aria-label="能力执行结果" className="mx-3 mb-2 border-y border-theme-border bg-theme-sidebar/70 px-3 py-3 sm:mx-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-theme-text">
                  {capabilityUtilityPanelTitle}
                </div>
                {capabilityResultSourceLabels.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]" aria-label="本次能力来源">
                    <span className="text-theme-muted">本次能力来源</span>
                    {capabilityResultSourceLabels.slice(0, 4).map((label) => (
                      <span key={label} className="rounded border border-theme-border bg-theme-bg px-1.5 py-0.5 text-theme-text">
                        {label}
                      </span>
                    ))}
                    {capabilityResultSourceLabels.length > 4 ? <span className="text-theme-muted">+{capabilityResultSourceLabels.length - 4}</span> : null}
                  </div>
                )}
                {capabilityUtilityError && <p role="alert" className="mt-1 text-xs text-red-600">{capabilityUtilityError}</p>}
                {capabilityUtilityResult?.kind === 'diagnostic' && (
                  capabilityUtilityResult.report.issueCount === 0
                    ? <p className="mt-2 text-xs text-theme-muted">本次诊断未发现明确问题，正文未被修改。</p>
                    : <ul className="mt-2 max-h-40 space-y-2 overflow-auto text-xs leading-5 text-theme-text">
                      {capabilityUtilityResult.report.issues.map((issue, index) => (
                        <li key={`${issue.category}-${issue.line}-${index}`} className="rounded border border-theme-border/60 p-2">
                          <div className="font-bold">{issue.category}{issue.line > 0 ? ` · 第 ${issue.line} 行` : ''}</div>
                          {issue.snippet && <div className="mt-1 text-theme-muted">“{issue.snippet}”</div>}
                          {issue.suggestion && <div className="mt-1">建议：{issue.suggestion}</div>}
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-theme-muted">
                            <span>下一步：按建议修改正文，或运行精修卡生成预览，确认后再应用。</span>
                            <button type="button" onClick={handleOpenPolishCards} className="inline-flex h-7 items-center border border-theme-border px-2 text-[11px] font-bold text-theme-text hover:border-theme-accent" title="打开精修卡">
                              打开精修卡
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                )}
                {capabilityUtilityResult?.kind === 'transform-preview' && (
                  <>
                    {capabilityUtilityResult.contextRewrite?.status === 'required' && (
                      <button type="button" onClick={() => void handleContextRewriteFromCapability()} disabled={isCapabilityUtilityRunning || isGeneratingContent} className="mt-2 inline-flex h-8 items-center border border-theme-accent px-2 text-xs font-bold text-theme-accent disabled:cursor-not-allowed disabled:opacity-50" title="生成上下文精修候选">
                        生成上下文精修候选
                      </button>
                    )}
                    {capabilityUtilityResult.quality ? (
                      <div className={`mt-2 rounded border px-2 py-1 text-[11px] ${capabilityUtilityResult.quality.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                        {capabilityUtilityResult.quality.ok ? '质量门禁通过，可确认写入。' : `质量门禁阻断：${capabilityUtilityResult.quality.violations.join('；')}`}
                      </div>
                    ) : null}
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-theme-text">{capabilityUtilityResult.preview}</pre>
                  </>
                )}
              </div>
              {!isCapabilityUtilityRunning && (
                <div className="flex shrink-0 items-center gap-2">
                  {capabilityUtilityError && capabilityUtilityRetry && (
                    <button
                      type="button"
                      onClick={() => {
                        const retry = capabilityUtilityRetry;
                        const selection = capabilityUtilitySelection;
                        void runCapabilityUtility({
                          ...retry,
                          runToken: `${retry.runToken}:retry:${Date.now()}`,
                        }, selection);
                      }}
                      className="inline-flex h-8 items-center justify-center border border-theme-accent px-2 text-xs font-bold text-theme-accent"
                      title="重新运行能力卡"
                    >
                      重新运行能力卡
                    </button>
                  )}
                  {capabilityUtilityError && capabilityUtilityRetry && onNavigate && (
                    <button
                      type="button"
                      onClick={() => onNavigate('skills', { targetChapterId: capabilityUtilityRetry.targetChapterId, stage: 'style-polish' })}
                      className="inline-flex h-8 items-center justify-center border border-theme-border px-2 text-xs font-bold text-theme-text hover:border-theme-accent"
                      title="返回作品能力中心"
                    >
                      返回作品能力中心
                    </button>
                  )}
                  {capabilityUtilityResult?.kind === 'transform-preview' && (
                    <button type="button" onClick={() => void handleApplyCapabilityPreview()} disabled={capabilityUtilityResult.quality?.ok === false} className="inline-flex h-8 items-center justify-center gap-1 border border-theme-accent px-2 text-xs font-bold text-theme-accent disabled:cursor-not-allowed disabled:opacity-50" title="应用精修预览">
                      <Check size={15} aria-hidden="true" />
                      <span>应用精修预览</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (capabilityUtilityResult) {
                        const eventMetadata = buildCapabilityUtilityEventMetadata(capabilityUtilityResult);
                        void recordProductEvent({
                          eventName: 'capability_cancel', stage: 'polish', result: 'success',
                          novelId: novel.id, chapterId: currentChapter?.id, objectId: capabilityUtilityResult.capabilityId,
                          ...eventMetadata,
                          eventId: `event:capability-cancel:${eventMetadata.sessionId}`,
                        });
                      }
                      setCapabilityUtilityResult(null);
                      setCapabilityUtilityError(null);
                      setCapabilityUtilityRunningAssetId(null);
                      setCapabilityUtilityRetry(null);
                      setCapabilityUtilitySelection(undefined);
                      setCapabilityUtilitySuccess(null);
                    }}
                    className="inline-flex size-8 items-center justify-center border border-theme-border text-theme-muted"
                    title="关闭能力结果"
                  >
                    <X size={15} aria-hidden="true" />
                    <span className="sr-only">关闭能力结果</span>
                  </button>
                </div>
              )}
            </div>
          </section>
        )}
        {capabilityUtilitySuccess && (
          <section aria-label="能力应用结果" className="mx-3 mb-2 flex flex-wrap items-center gap-2 border-y border-theme-border bg-theme-sidebar/70 px-3 py-2 text-xs text-theme-text sm:mx-5">
            <span className="font-bold">精修已应用</span>
            <span className="text-theme-muted">已保存应用前版本，可从章节版本记录回退。</span>
            {onNavigate && currentChapter?.id ? (
              <button
                type="button"
                onClick={() => onNavigate('skills', { targetChapterId: currentChapter.id, stage: 'style-polish' })}
                className="inline-flex h-7 items-center justify-center border border-theme-border px-2 text-[11px] font-bold text-theme-text hover:border-theme-accent"
              >
                调整精修卡
              </button>
            ) : null}
          </section>
        )}

        {/* Writing Surface */}
        {aiActionState.status !== 'idle' && (
          <section
            aria-live="polite"
            aria-label="AI 操作状态"
            className={cn(
              'mx-3 mb-2 flex flex-wrap items-center gap-2 border px-3 py-2 text-xs sm:mx-5',
              aiActionState.status === 'running' && 'border-theme-accent/30 bg-theme-accent/5 text-theme-text',
              aiActionState.status === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-800',
              aiActionState.status === 'error' && 'border-red-300 bg-red-50 text-red-800',
            )}
          >
            <span className="font-bold">
              {aiActionState.status === 'running' ? 'AI 处理中' : aiActionState.status === 'success' ? 'AI 已完成' : 'AI 操作失败'}
            </span>
            <span className="min-w-0 flex-1 break-words">{aiActionState.message}</span>
            {aiActionState.status === 'running' ? (
              <button
                type="button"
                aria-label="取消 AI 操作"
                onClick={stopGenerationFlow}
                className="inline-flex h-7 items-center border border-theme-border px-2 text-[11px] font-bold hover:bg-theme-border/30"
              >
                取消
              </button>
            ) : null}
            {typeof aiActionState.elapsedMs === 'number' && aiActionState.status !== 'running' ? (
              <span className="text-[10px] opacity-70">耗时 {(aiActionState.elapsedMs / 1000).toFixed(1)}s</span>
            ) : null}
            {aiActionState.status === 'error' && aiActionState.retryable ? (
              <button
                type="button"
                onClick={() => void retryLastAiAction()}
                className="inline-flex h-7 items-center border border-red-400 px-2 text-[11px] font-bold hover:bg-red-100"
              >
                重试
              </button>
            ) : null}
          </section>
        )}
        {writingStyleResolution ? (
          <div className="px-3 pb-1 sm:px-5 sm:pb-2">
            <WritingStyleControl
              resolution={writingStyleResolution}
              candidates={writingStyleCandidates}
              confirmed={writingStyleResolution.confirmed}
              disabled={isGeneratingContent || !currentChapter?.sceneBeats}
              onConfirm={handleConfirmWritingStyle}
              onGenerate={handleWritingStyleGenerate}
              onOpenWritingStyle={() => { setAgentTab('skills'); setIsAgentSidebarOpen(true); }}
              onManageSkills={() => handleWorkspaceNavigate('skills')}
            />
          </div>
        ) : writingStyleError ? (
          <div role="status" className="mx-3 mb-2 border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:mx-5">
            {writingStyleError}
          </div>
        ) : null}
        {aiContentCandidate && aiContentCandidate.chapterId === currentChapter?.id && !isAgentSidebarOpen ? (
          <section aria-label="AI 正文候选" className="mx-3 mb-2 flex flex-wrap items-center gap-2 border border-theme-accent/40 bg-theme-accent/5 px-3 py-2 text-xs sm:mx-5">
            {(() => {
              const qualityState = getCandidateQualityState(aiContentCandidate);
              const canAccept = qualityState.status === 'eligible';
              return (
                <>
            <span className="font-bold">AI {aiContentCandidate.operation === 'draft' ? '正文扩写' : aiContentCandidate.operation === 'rewrite' ? '选中改写' : '审稿精修'}候选</span>
            <span className="min-w-0 flex-1 text-theme-muted">正文尚未修改，接受后才会保存。</span>
            <span className={qualityState.status === 'eligible' ? 'rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700' : qualityState.status === 'fallback' ? 'rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700' : 'rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700'} role="status">{qualityState.label}</span>
            <span className="basis-full text-[10px] text-theme-muted">{qualityState.detail}</span>
            {aiContentCandidate.quality?.semanticReview.status === 'unknown' ? (
              <span className="basis-full text-[10px] text-amber-700" role="status">
                硬性格式检查已通过；人物、世界规则和章节目标仍需语义审阅。
              </span>
            ) : null}
            {aiContentCandidate.quality && aiContentCandidate.quality.findings.some((finding) => finding.severity === 'P2') ? (
              <span className="basis-full text-[10px] text-amber-700" role="status">
                还有 {aiContentCandidate.quality.findings.filter((finding) => finding.severity === 'P2').length} 项文风建议，可在审稿后精修。
              </span>
            ) : null}
            {aiContentCandidate.quality?.mechanicalReview?.status === 'needs-action' ? (
              <span className="basis-full text-[10px] text-red-700" role="alert">
                机械审查 {aiContentCandidate.quality.mechanicalReview.score.toFixed(1)}/{aiContentCandidate.quality.mechanicalReview.threshold}：{aiContentCandidate.quality.mechanicalReview.summary}，需精修后才能写入。
              </span>
            ) : null}
            {aiContentCandidate.quality?.semanticReview ? (
              <details className="basis-full rounded border border-theme-border/70 bg-theme-sidebar/50 px-2 py-1">
                <summary className="cursor-pointer text-[10px] font-semibold text-theme-text">
                  语义审阅：{aiContentCandidate.quality.semanticReview.status === 'pass' ? '已通过' : aiContentCandidate.quality.semanticReview.status === 'needs-action' ? '需要处理' : '尚未运行'}
                </summary>
                <ul className="mt-1 grid gap-1 text-[10px] text-theme-muted sm:grid-cols-2">
                  {aiContentCandidate.quality.semanticReview.checks.map((check) => (
                    <li key={check.id} className={check.status === 'needs-action' ? 'text-amber-700' : undefined}>
                      <div>{DRAFT_QUALITY_SEMANTIC_LABELS[check.id]}：{check.status === 'pass' ? '通过' : check.status === 'needs-action' ? '需处理' : '未知'}。{check.reason}</div>
                      {check.evidence?.map((evidence) => (
                        <div key={`${check.id}:${evidence.quote}`} className="mt-1 border-l-2 border-theme-border pl-2 text-[10px] text-theme-muted">
                          “{evidence.quote}”{evidence.location ? `（${evidence.location}）` : ''}：{evidence.explanation} 建议：{evidence.suggestedFix}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {aiContentCandidate.quality?.findings.length ? (
              <details className="basis-full rounded border border-theme-border/70 bg-theme-sidebar/50 px-2 py-1">
                <summary className="cursor-pointer text-[10px] font-semibold text-theme-text">硬性检查证据（{aiContentCandidate.quality.findings.length}）</summary>
                <ul className="mt-1 grid gap-1 text-[10px] text-theme-muted">
                  {aiContentCandidate.quality.findings.map((finding) => (
                    <li key={finding.code}>
                      <div>[{finding.severity}] {finding.message}</div>
                      {finding.evidence?.map((evidence, index) => (
                        <div key={`${finding.code}:${index}`} className="mt-1 border-l-2 border-theme-border pl-2 text-theme-muted">
                          {evidence.line ? `第 ${evidence.line} 行：` : ''}“{evidence.snippet}”{evidence.suggestion ? ` 建议：${evidence.suggestion}` : ''}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            <button type="button" disabled={isAcceptingAiCandidate || !canAccept} className="inline-flex h-7 items-center gap-1 border border-theme-accent px-2 font-bold text-theme-text hover:bg-theme-accent/10 disabled:opacity-50" onClick={() => void acceptAiContentCandidate().catch((error) => toast(error instanceof Error ? error.message : '候选已失效，请重新生成。', 'error'))}>
              <Check size={14} aria-hidden="true" />接受并写入
            </button>
            {!canAccept ? <button type="button" disabled={isAcceptingAiCandidate} onClick={handleOpenPolishCards} className="inline-flex h-7 items-center border border-theme-accent px-2 text-theme-accent hover:bg-theme-accent/10 disabled:opacity-50">{qualityState.status === 'fallback' ? '重新审阅' : '前往精修'}</button> : null}
            <button type="button" disabled={isAcceptingAiCandidate} className="inline-flex h-7 items-center gap-1 border border-theme-border px-2 text-theme-muted hover:bg-theme-border/30 disabled:opacity-50" onClick={discardAiContentCandidate}>
              <X size={14} aria-hidden="true" />放弃预览
            </button>
            <details className="basis-full rounded-lg border border-theme-border/70 bg-theme-sidebar/60">
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-semibold text-theme-text">查看候选正文预览</summary>
              <div role="region" aria-label="AI 正文候选预览" className="grid max-h-64 gap-2 overflow-y-auto border-t border-theme-border/60 p-2 text-[11px] leading-5 md:grid-cols-2">
                <div className="min-w-0"><div className="mb-1 font-bold text-theme-muted">当前正文（未修改）</div><pre className="whitespace-pre-wrap break-words font-sans text-theme-muted">{aiContentCandidate.baselineContent}</pre></div>
                <div className="min-w-0"><div className="mb-1 font-bold text-theme-text">候选正文</div><pre className="whitespace-pre-wrap break-words font-sans text-theme-text">{aiContentCandidate.content}</pre></div>
              </div>
            </details>
                </>
              );
            })()}
          </section>
        ) : null}
        <WritingSurface
          novel={novel}
          currentChapter={currentChapter}
          chapterLoading={chapterLoading}
          isGeneratingBeats={isGeneratingBeats}
          isGeneratingCritique={isGeneratingCritique}
          isGeneratingContent={isGeneratingContent}
          isCompletingChapter={isCompletingChapter}
          generationStatus={generationStatus}
          auditStatus={auditStatus}
          auditUnknownFeedback={auditUnknownFeedback}
          isChapterEmpty={isChapterEmpty}
          mountedSkillsCount={mountedSkillsCount}
          runCopilotAction={runCopilotAction}
          contentRef={contentRef}
          onGenerateBeats={handleGenerateBeats}
          onRunAudit={handleManualAudit}
          onCompleteChapter={handleCompleteChapter}
          onConfirmFacts={handleOpenCompletionFacts}
          onUpdateContent={handleUpdateContent}
          onQueueContentWrite={queueContentWrite}
          onAddFirstChapter={handleAddFirstChapter}
          onAddChapter={handleAddChapter}
          setAgentTab={setAgentTab}
          setIsAgentSidebarOpen={setIsAgentSidebarOpen}
          onNavigate={handleWorkspaceNavigate}
          packStatus={activeWorkflowPack?.status || 'none'}
          syncState={activeWorkflowPack?.syncState?.status || 'unknown'}
          packId={activeWorkflowPack?.id}
        />

        {completionResult && completionChapterId === currentChapter?.id ? (
          <ChapterCompletionReview
            result={completionResult}
            onReturnToEditing={() => setCompletionResult(null)}
            onRetryUnavailable={() => void handleCompleteChapter(true)}
            onAcceptRisk={handleAcceptCompletionRisk}
            onPreviewRevision={(issueId) => void handlePreviewReviewIssue(issueId)}
            reviewIssues={currentChapter?.workflowMeta?.reviewState?.issues}
          />
        ) : null}

        {completionFactCandidate && completionChapterId === currentChapter?.id ? (
          <div className="mx-3 mb-3 sm:mx-5">
            <ChapterFactCandidateReview
              candidate={completionFactCandidate}
              canConfirm={currentChapter?.workflowMeta?.completionGate === 'ready' || currentChapter?.workflowMeta?.completionGate === 'accepted-risk'}
              submitting={isConfirmingFacts}
              onConfirm={(selection) => void handleConfirmCompletionFacts(selection)}
            />
          </div>
        ) : null}

        {completionError && completionChapterId === currentChapter?.id ? <div role="alert" className="mx-3 mb-3 border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 sm:mx-5">{completionError}</div> : null}

        <EditorStatusBar
          currentChapter={currentChapter}
          statusTimeFormatter={statusTimeFormatter}
          isSyncing={isSyncing}
          syncSuccess={syncSuccess}
          syncFailed={syncFailed}
          saveStatus={(isEditorDataLoading || chapterLoading) ? 'loading' : syncFailed ? 'failed' : isSyncing ? 'pending' : syncSuccess ? 'saved' : 'unknown'}
          launchState={launchState}
          novelId={novel.id}
          novelTitle={novel.title}
          embeddingStatus={embeddingStatus}
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
            projectTechniqueId={projectTechniqueId || undefined}
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
            onStopProductionRun={stopProductionFlow}
            onApplyProductionRun={handleApplyProductionRun}
            onOpenBibleAssistant={onOpenBibleAssistant}
            expectedWordCount={expectedWordCount}
            setExpectedWordCount={setExpectedWordCount}
            onGenerateOutline={handleGenerateOutline}
            onAdoptOutline={adoptGlobalOutline}
            onCanonicalOutlineChange={setGlobalOutline}
            outlineError={outlineError}
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
            onRunAudit={handleManualAudit}
            isGeneratingCritique={isGeneratingCritique}
            onPolishChapterFromAudit={async () => {
              await handlePolishChapterFromAudit();
            }}
            onCreateChapter={handleCreateChapter}
            characters={characters}
            locations={locations}
            items={items}
            factions={factions}
            librarySkills={librarySkills}
            skillUsageRecords={skillUsageRecords}
            mountedSkillLoadout={mountedSkillLoadout}
            pendingSkillIds={pendingSkillIds}
            onResolvePendingSkill={(skillId, slot) => {
              if (!librarySkills.some((skill) => skill.id === skillId)) {
                toast('该历史能力卡已不存在，仍保留为待整理状态', 'error');
                return;
              }
              void assignSkillToSlot(slot, skillId)
                .then(() => setPendingSkillIds((ids) => ids.filter((id) => id !== skillId)))
                .catch(() => toast('能力卡配置失败，请重试', 'error'));
            }}
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
            onNavigate={handleWorkspaceNavigate}
            writingStyleResolution={writingStyleResolution}
            writingStyleCandidates={writingStyleCandidates}
            onConfirmWritingStyle={handleConfirmWritingStyle}
            onGenerateWithWritingStyle={(fingerprint) => startProductionRun(undefined, fingerprint)}
            onOpenWritingStyle={() => { setAgentTab('skills'); setIsAgentSidebarOpen(true); }}
            reviewIssues={currentChapter?.workflowMeta?.reviewState?.issues}
            onPreviewReviewIssue={handlePreviewReviewIssue}
            onFixReviewIssues={handleFixReviewIssues}
            onAcceptReviewIssueRisk={handleAcceptReviewIssueRisk}
            onDeferReviewIssue={handleDeferReviewIssue}
            aiContentCandidate={aiContentCandidate}
            isAcceptingAiContentCandidate={isAcceptingAiCandidate}
            onAcceptAiContentCandidate={acceptAiContentCandidate}
            onDiscardAiContentCandidate={discardAiContentCandidate}
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
