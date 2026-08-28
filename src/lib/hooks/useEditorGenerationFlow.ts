import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import type { AgentContext } from '../agents';
import type { Chapter, ChapterWorkflowMeta, Novel, Skill, WritingStyleCandidate, WritingStyleResolution } from '../../../shared/types';
import { useOutlineGeneration } from './generation/useOutlineGeneration';
import { useDraftGeneration } from './generation/useDraftGeneration';
import { useAuditPolishActions } from './generation/useAuditPolishActions';
import {
  idleAiAction,
  createAiActionError,
  createAiActionSuccess,
  type AiActionState,
  type AiContentCandidate,
} from '../generation-action-state';
import { computeChapterWorkflowHash } from '../../../shared/lib/chapter-workflow';
import { acceptChapterContentCandidate } from '../chapter-client';
import { recordProductEvent } from '../product-events-client';
import { evaluateDraftAcceptance } from '../../../shared/lib/draft-quality';
import { deriveReviewGate } from '../../../shared/lib/review-issues';

interface UseEditorGenerationFlowArgs {
  novel: Novel;
  currentChapter: Chapter | null;
  userIntent: string;
  globalOutline: string;
  expectedWordCount: number | '';
  contentRef: RefObject<HTMLTextAreaElement | null>;
  selectedContinuationPackId: string;
  writingStyleFingerprint?: string;
  sessionCardIds?: string[];
  onStyleConfirmationRequired?: (data: { resolution?: WritingStyleResolution; candidates?: WritingStyleCandidate[] }) => void;
  approvedOutlinePackId: string;
  buildAgentContext: () => AgentContext;
  handleUpdateContent: (newContent: string, isProgrammatic?: boolean) => void;
  pushToUndoHistory: (content: string) => void;
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>;
  setGlobalOutline: Dispatch<SetStateAction<string>>;
  setUserIntent: Dispatch<SetStateAction<string>>;
  getCurrentFitScore: (skillsOverride?: Skill[]) => number;
  recordSkillUsage: (
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[] },
  ) => Promise<void>;
  formatAiFailure: (error: unknown, actionLabel: string) => string;
  flushPendingEditorWrites: () => Promise<void>;
  databaseGeneration?: number | null;
}

const draftPromptSurface = 'workspace-draft';
const planningPromptSurface = 'workspace-beats';
const polishPromptSurface = 'chapter-polish';

export function useEditorGenerationFlow({
  novel,
  currentChapter,
  userIntent,
  globalOutline,
  expectedWordCount,
  contentRef,
  selectedContinuationPackId,
  writingStyleFingerprint,
  sessionCardIds,
  onStyleConfirmationRequired,
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
}: UseEditorGenerationFlowArgs) {
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [outlineError, setOutlineError] = useState<string | null>(null);
  const [isGeneratingBeats, setIsGeneratingBeats] = useState(false);
  const [isGeneratingCritique, setIsGeneratingCritique] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [auditStatus, setAuditStatus] = useState<string | null>(null);
  const [auditUnknownState, setAuditUnknownState] = useState<{ chapterId: string; feedback: string } | null>(null);
  const [aiActionState, setAiActionState] = useState<AiActionState>(idleAiAction);
  const [aiContentCandidate, setAiContentCandidate] = useState<AiContentCandidate | null>(null);
  const [isAcceptingAiCandidate, setIsAcceptingAiCandidate] = useState(false);
  const aiContentCandidateRef = useRef<AiContentCandidate | null>(null);

  useEffect(() => {
    aiContentCandidateRef.current = aiContentCandidate;
  }, [aiContentCandidate]);

  const latestChapterIdRef = useRef<string | null>(currentChapter?.id || null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const generationScopeRef = useRef({ databaseGeneration, novelId: novel.id });
  const retryContextRef = useRef<{ operation: 'rewrite' | 'polish'; input?: { start: number; end: number; instruction: string; fingerprint?: string }; fingerprint?: string } | null>(null);
  const acceptingCandidateRef = useRef(false);
  const pendingAuditRecheckRef = useRef<{ chapterId: string; issueIds: string[]; contentHash: string } | null>(null);
  const auditHandlerRef = useRef<((options?: { reviewIssueIds?: string[]; reviewScope?: 'affected' | 'full'; reviewContentHash?: string; baseWorkflowMeta?: ChapterWorkflowMeta }) => Promise<void>) | null>(null);

  useEffect(() => {
    const nextChapterId = currentChapter?.id || null;
    if (latestChapterIdRef.current !== nextChapterId) {
      requestSeqRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsGeneratingContent(false);
      setIsGeneratingBeats(false);
      setIsGeneratingCritique(false);
      setGenerationStatus(null);
      setAuditStatus(null);
      setAiActionState(idleAiAction());
      setAiContentCandidate(null);
      aiContentCandidateRef.current = null;
      setIsAcceptingAiCandidate(false);
      pendingAuditRecheckRef.current = null;
      retryContextRef.current = null;
    }
    latestChapterIdRef.current = nextChapterId;
  }, [currentChapter?.id]);

  useEffect(() => {
    const previousScope = generationScopeRef.current;
    if (previousScope.databaseGeneration === databaseGeneration && previousScope.novelId === novel.id) return;
    generationScopeRef.current = { databaseGeneration, novelId: novel.id };

    const invalidatedSeq = ++requestSeqRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGeneratingContent(false);
    setIsGeneratingOutline(false);
    setIsGeneratingBeats(false);
    setIsGeneratingCritique(false);
    setGenerationStatus(null);
    setAuditStatus(null);
    setAuditUnknownState(null);
    setAiContentCandidate(null);
    aiContentCandidateRef.current = null;
    setIsAcceptingAiCandidate(false);
    pendingAuditRecheckRef.current = null;
    retryContextRef.current = null;
    queueMicrotask(() => {
      if (requestSeqRef.current !== invalidatedSeq) return;
      setAiActionState(idleAiAction());
    });
  }, [databaseGeneration, novel.id]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setAiContentCandidate(null);
      pendingAuditRecheckRef.current = null;
    };
  }, []);

  const stopGenerationFlow = useCallback(() => {
    requestSeqRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGeneratingContent(false);
    setIsGeneratingBeats(false);
    setIsGeneratingCritique(false);
    setGenerationStatus(null);
    setAuditStatus(null);
    setAuditUnknownState(null);
    setAiActionState(idleAiAction());
    setAiContentCandidate(null);
    setIsAcceptingAiCandidate(false);
    pendingAuditRecheckRef.current = null;
    retryContextRef.current = null;
  }, []);

  const acceptAiContentCandidate = useCallback(async () => {
    if (acceptingCandidateRef.current) return;
    acceptingCandidateRef.current = true;
    setIsAcceptingAiCandidate(true);
    const candidate = aiContentCandidate;
    const chapter = currentChapter;
    let candidateInvalidated = false;
    try {
      if (!candidate || !chapter || candidate.novelId !== novel.id || candidate.chapterId !== chapter.id) {
        candidateInvalidated = true;
        throw new Error('候选已失效，请重新生成。');
      }
      if (databaseGeneration === null || databaseGeneration === undefined || candidate.databaseGeneration !== databaseGeneration) {
        candidateInvalidated = true;
        throw new Error('数据库已切换，候选已失效，请重新生成。');
      }
      const baseline = contentRef.current?.value ?? chapter.content;
      const baselineHash = computeChapterWorkflowHash(baseline, chapter.sceneBeats);
      if (baselineHash !== candidate.baselineHash) {
        candidateInvalidated = true;
        throw new Error('正文已变化，旧候选不能应用，请重新生成。');
      }
      const evaluation = evaluateDraftAcceptance(candidate.content, {
        source: candidate.source || 'unknown',
        operation: candidate.operation,
        baseline: candidate.baselineContent,
        semanticReview: candidate.quality?.semanticReview,
      });
      if (!evaluation.accepted) {
        candidateInvalidated = true;
        throw new Error(`正文候选${evaluation.status === 'review-required' ? '尚未完成审阅' : '未通过质量门禁'}：${evaluation.reasons.join('；')}`);
      }
      const acceptedAt = Date.now();
      const acceptedWorkflowMeta = candidate.workflowMeta && candidate.operation === 'polish' && candidate.reviewIssueIds?.length
        ? {
          ...candidate.workflowMeta,
          reviewState: candidate.workflowMeta.reviewState ? {
            ...candidate.workflowMeta.reviewState,
            issues: candidate.workflowMeta.reviewState.issues.map((issue) => candidate.reviewIssueIds?.includes(issue.id)
              ? { ...issue, status: 'applied' as const, resolvedAt: acceptedAt, updatedAt: acceptedAt }
              : issue),
            gate: deriveReviewGate(candidate.workflowMeta.reviewState.issues.map((issue) => candidate.reviewIssueIds?.includes(issue.id)
              ? { ...issue, status: 'applied' as const, resolvedAt: acceptedAt, updatedAt: acceptedAt }
              : issue), candidate.workflowMeta.reviewState.gate === 'unknown' ? 'unknown' : 'pass'),
          } : undefined,
        }
        : candidate.workflowMeta;
      const saved = await acceptChapterContentCandidate({
        chapterId: chapter.id,
        novelId: novel.id,
        baselineHash: candidate.baselineHash,
        content: candidate.content,
        wordCount: candidate.content.replace(/\s/g, '').length,
        operation: candidate.operation,
        source: candidate.source || 'unknown',
        ...(acceptedWorkflowMeta ? { workflowMeta: acceptedWorkflowMeta } : {}),
        version: {
          id: `${Date.now()}-before-ai-candidate`,
          chapterId: chapter.id,
          content: baseline,
          wordCount: baseline.replace(/\s/g, '').length,
          author: 'editor-agent',
          createdAt: Date.now(),
        },
      }, candidate.databaseGeneration);
      if (!saved) throw new Error('章节已不存在，候选未应用。');
      pushToUndoHistory?.(candidate.content);
      setCurrentChapter((previous) => previous?.id === chapter.id
        ? { ...previous, content: candidate.content, wordCount: candidate.content.replace(/\s/g, '').length, ...(acceptedWorkflowMeta ? { workflowMeta: acceptedWorkflowMeta } : {}) }
        : previous);
      setAiContentCandidate(null);
      setAiActionState((state) => createAiActionSuccess(state, '候选已接受并保存到当前章节。'));
      if (candidate.reviewRecheck && candidate.reviewIssueIds?.length) {
        pendingAuditRecheckRef.current = {
          chapterId: chapter.id,
          issueIds: candidate.reviewIssueIds,
          contentHash: computeChapterWorkflowHash(candidate.content, chapter.sceneBeats),
        };
      }
      void recordProductEvent({
        eventName: 'draft_accept',
        stage: 'drafting',
        result: 'success',
        novelId: novel.id,
        chapterId: chapter.id,
        action: candidate.operation,
      });
    } catch (error) {
      if (candidateInvalidated) setAiContentCandidate(null);
      const message = error instanceof Error ? error.message : '候选保存失败，请重试。';
      setAiActionState((state) => createAiActionError(state, message, Date.now(), false));
      throw error;
    } finally {
      acceptingCandidateRef.current = false;
      setIsAcceptingAiCandidate(false);
    }
  }, [aiContentCandidate, contentRef, currentChapter, databaseGeneration, novel.id, pushToUndoHistory, setCurrentChapter]);

  // 1. 挂载大纲生成子 Hook
  const { handleGenerateOutline } = useOutlineGeneration({
    novel,
    globalOutline,
    expectedWordCount,
    currentChapter,
    selectedContinuationPackId: approvedOutlinePackId,
    planningPromptSurface,
    requestSeqRef,
    abortControllerRef,
    setIsGeneratingOutline,
    setOutlineError,
    setAiActionState,
    setGlobalOutline,
    flushPendingEditorWrites,
  });

  // 2. 挂载正文与分镜生成子 Hook
  const { handleGenerateBeats, handleGenerateContent } = useDraftGeneration({
    novel,
    currentChapter,
    userIntent,
    selectedContinuationPackId,
    writingStyleFingerprint,
    sessionCardIds,
    onStyleConfirmationRequired,
    contentRef,
    draftPromptSurface,
    requestSeqRef,
    abortControllerRef,
    latestChapterIdRef,
    isGeneratingContent,
    setIsGeneratingContent,
    setIsGeneratingBeats,
    setIsGeneratingCritique,
    setAuditStatus,
    setGenerationStatus,
    setAiActionState,
    setUserIntent,
    setCurrentChapter,
    buildAgentContext,
    pushToUndoHistory,
    getCurrentFitScore: () => getCurrentFitScore(),
    recordSkillUsage,
    formatAiFailure,
    flushPendingEditorWrites,
    setCandidate: setAiContentCandidate,
  });

  // 3. 挂载智能审计、精修及手术重写子 Hook
  const { handleRunAudit, handleRewriteSelectedText, handlePolishChapterFromAudit, handleContextRewriteCandidate } = useAuditPolishActions({
    novel,
    currentChapter,
    selectedContinuationPackId,
    writingStyleFingerprint,
    sessionCardIds,
    onStyleConfirmationRequired,
    contentRef,
    polishPromptSurface,
    requestSeqRef,
    abortControllerRef,
    latestChapterIdRef,
    setIsGeneratingContent,
    setIsGeneratingCritique,
    setIsGeneratingBeats,
    setIsGeneratingOutline,
    setGenerationStatus,
    setAuditStatus,
    setAuditUnknownFeedback: (feedback) => setAuditUnknownState(feedback ? { chapterId: currentChapter?.id || '', feedback } : null),
    setAiActionState,
    setCurrentChapter,
    buildAgentContext,
    handleUpdateContent,
    getCurrentFitScore: () => getCurrentFitScore(),
    recordSkillUsage,
    formatAiFailure,
    flushPendingEditorWrites,
    setCandidate: setAiContentCandidate,
    aiContentCandidate,
    getCandidate: () => aiContentCandidateRef.current,
    setRetryContext: (context) => { retryContextRef.current = context; },
  });
  useEffect(() => {
    auditHandlerRef.current = handleRunAudit;
  }, [handleRunAudit]);

  useEffect(() => {
    const pendingAuditRecheck = pendingAuditRecheckRef.current;
    if (!pendingAuditRecheck || pendingAuditRecheck.chapterId !== currentChapter?.id || !currentChapter) return;
    const currentHash = computeChapterWorkflowHash(currentChapter.content, currentChapter.sceneBeats);
    if (currentHash !== pendingAuditRecheck.contentHash) return;
    const recheck = pendingAuditRecheck;
    pendingAuditRecheckRef.current = null;
    void auditHandlerRef.current?.({
      reviewIssueIds: recheck.issueIds,
      reviewScope: 'affected',
      reviewContentHash: recheck.contentHash,
      baseWorkflowMeta: currentChapter.workflowMeta,
    });
  }, [currentChapter]);

  const retryLastAiAction = useCallback(async () => {
    if (aiActionState.status !== 'error' || !aiActionState.retryable) return;
    if (aiActionState.operation === 'draft') await handleGenerateContent();
    else if (aiActionState.operation === 'beats') await handleGenerateBeats();
    else if (aiActionState.operation === 'audit') await handleRunAudit();
    else if (aiActionState.operation === 'polish') await handlePolishChapterFromAudit(retryContextRef.current?.fingerprint);
    else if (aiActionState.operation === 'rewrite') await handleRewriteSelectedText(retryContextRef.current?.input);
    else if (aiActionState.operation === 'outline') await handleGenerateOutline();
  }, [aiActionState, handleGenerateBeats, handleGenerateContent, handleGenerateOutline, handlePolishChapterFromAudit, handleRewriteSelectedText, handleRunAudit]);

  return {
    isGeneratingContent,
    isGeneratingOutline,
    outlineError,
    isGeneratingBeats,
    isGeneratingCritique,
    generationStatus,
    auditStatus,
    auditUnknownFeedback: auditUnknownState && auditUnknownState.chapterId === currentChapter?.id
      ? auditUnknownState.feedback
      : null,
    aiActionState,
    aiContentCandidate,
    isAcceptingAiCandidate,
    acceptAiContentCandidate,
    discardAiContentCandidate: () => setAiContentCandidate(null),
    retryLastAiAction,
    handleRunAudit,
    handleGenerateBeats,
    handleRewriteSelectedText,
    handleGenerateOutline,
    handleGenerateContent,
    handlePolishChapterFromAudit,
    handleContextRewriteCandidate,
    stopGenerationFlow,
  };
}
