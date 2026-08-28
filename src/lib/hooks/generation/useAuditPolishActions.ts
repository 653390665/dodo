import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Novel, Chapter, ChapterWorkflowMeta, Skill, WritingStyleCandidate, WritingStyleResolution } from '../../../../shared/types';
import type { AgentContext } from '../../agents';
import { buildContextPrompt } from '../../agents';
import { updateChapter } from '../../chapter-client';
import { readSseStream } from '../../sse-client';
import { getDatabaseGenerationSnapshot, requireResponseDatabaseGeneration } from '../../db-transport';
import { recordProductEvent } from '../../product-events-client';
import { computeChapterWorkflowHash } from '../../../../shared/lib/chapter-workflow';
import { deriveChapterReviewState, deriveReviewGate, structuredAuditToReviewIssues } from '../../../../shared/lib/review-issues';
import { DEFAULT_SEMANTIC_REVIEW } from '../../../../shared/lib/quality-contract';
import { extractStructuredAudit, parseStructuredAuditResponse } from '../../../../shared/lib/audit-structured';
import { semanticReviewFromStructuredAudit, validateCandidateDraftQuality } from '../../../../shared/lib/draft-quality';
import {
  createAiActionError,
  createAiActionRunning,
  createAiActionSuccess,
  idleAiAction,
  type AiActionState,
  type AiContentCandidate,
} from '../../generation-action-state';
import {
  applyPatchWindow,
  extractPolishTargetsFromCritique,
  removeRepeatedQuotedBlocks,
  selectRewriteTargetsForPatch,
  validatePolishCandidate,
} from '../../chapter-polish.js';

interface UseAuditPolishActionsArgs {
  novel: Novel;
  currentChapter: Chapter | null;
  /** Compatibility only; the server resolves stage skills from the novel loadout. */
  mountedSkills?: Skill[];
  selectedContinuationPackId?: string;
  writingStyleFingerprint?: string;
  sessionCardIds?: string[];
  onStyleConfirmationRequired?: (data: { resolution?: WritingStyleResolution; candidates?: WritingStyleCandidate[]; retry?: (fingerprint: string) => Promise<void> }) => void;
  contentRef: RefObject<HTMLTextAreaElement | null>;
  polishPromptSurface: string;
  requestSeqRef: { current: number };
  abortControllerRef: { current: AbortController | null };
  latestChapterIdRef: { current: string | null };
  setIsGeneratingContent: (val: boolean) => void;
  setIsGeneratingCritique: (val: boolean) => void;
  setIsGeneratingBeats?: (val: boolean) => void;
  setIsGeneratingOutline?: (val: boolean) => void;
  setGenerationStatus: (val: string | null) => void;
  setAuditStatus: (val: string | null) => void;
  setAuditUnknownFeedback: (val: string | null) => void;
  setAiActionState?: Dispatch<SetStateAction<AiActionState>>;
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>;
  buildAgentContext: () => AgentContext;
  handleUpdateContent: (newContent: string, isProgrammatic?: boolean, skipPersist?: boolean) => void;
  getCurrentFitScore: () => number;
  recordSkillUsage: (
    userAction: 'accepted' | 'revised' | 'rejected',
    options?: { fitScore?: number; auditScore?: number; notes?: string; skillIds?: string[]; databaseGeneration?: number },
  ) => Promise<void>;
  formatAiFailure: (error: unknown, actionLabel: string) => string;
  flushPendingEditorWrites: () => Promise<void>;
  setCandidate?: (candidate: AiContentCandidate | null) => void;
  aiContentCandidate?: AiContentCandidate | null;
  getCandidate?: () => AiContentCandidate | null;
  setRetryContext?: (context: { operation: 'rewrite' | 'polish'; input?: { start: number; end: number; instruction: string; fingerprint?: string }; fingerprint?: string } | null) => void;
}

export interface ContextRewriteCandidateInput {
  targetText: string;
  beforeContext: string;
  afterContext: string;
  auditIssue: string;
  sceneBeats?: string;
  databaseGeneration: number;
  selectionStart: number;
  selectionEnd: number;
}

export function useAuditPolishActions({
  novel,
  currentChapter,
  selectedContinuationPackId = '',
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
  setAuditUnknownFeedback,
  setAiActionState: providedSetAiActionState,
  setCurrentChapter,
  buildAgentContext,
  handleUpdateContent,
  getCurrentFitScore,
  recordSkillUsage,
  formatAiFailure,
  flushPendingEditorWrites,
  setCandidate,
  aiContentCandidate,
  getCandidate,
  setRetryContext,
}: UseAuditPolishActionsArgs) {
  const setAiActionState = providedSetAiActionState ?? (() => undefined);

  interface AuditRequestOptions {
    reviewIssueIds?: string[];
    reviewScope?: 'affected' | 'full';
    reviewContentHash?: string;
    baseWorkflowMeta?: ChapterWorkflowMeta;
    styleConfirmationFingerprint?: string;
  }

  const isRequestCurrent = (startingChapterId: string | undefined, currentSeq: number) =>
    latestChapterIdRef.current === startingChapterId && requestSeqRef.current === currentSeq;

  const setAiActionStateForRequest = (
    startingChapterId: string | undefined,
    requestSeq: number,
    state: SetStateAction<AiActionState>,
  ) => {
    if (isRequestCurrent(startingChapterId, requestSeq)) setAiActionState(state);
  };

  const handleStyleConfirmationResponse = async (response: Response, retry?: (fingerprint: string) => Promise<void>): Promise<boolean> => {
    if (response.status !== 409) return false;
    const data = await response.json().catch(() => null);
    if (data?.code !== 'STYLE_CONFIRMATION_REQUIRED') return false;
    onStyleConfirmationRequired?.({ ...data, retry });
    return true;
  };

  const restorePreviewIfCurrent = (
    baseline: string,
    startingChapterId: string | undefined,
    currentSeq: number,
  ) => {
    if (!isRequestCurrent(startingChapterId, currentSeq)) return;
    // AI results are kept in memory, but retain this guard for legacy callers
    // that may have rendered a stream into the editor. Never restore over a
    // newer author edit that arrived while the request was running.
    const currentContent = contentRef.current?.value;
    if (currentContent === undefined || currentContent === baseline) {
      handleUpdateContent(baseline, false, true);
    }
  };

  const handleRunAudit = async (options: AuditRequestOptions = {}) => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter) return;
    const candidateSnapshot = getCandidate?.() ?? aiContentCandidate;
    const candidateForAudit = candidateSnapshot
      && candidateSnapshot.chapterId === currentChapter.id
      ? candidateSnapshot
      : null;
    const startedAt = Date.now();

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;
    let auditJobId: string | null = null;
    let auditDatabaseGeneration: number | null = null;
    let auditJobCompleted = false;
    let cancelRequested = false;
    const cancelAuditJob = () => {
      if (!auditJobId || cancelRequested) return;
      cancelRequested = true;
      if (auditDatabaseGeneration === null) return;
      try {
        const cancelResult = fetch(`/api/audit/jobs/${encodeURIComponent(auditJobId)}/cancel?databaseGeneration=${auditDatabaseGeneration}`, { method: 'POST' });
        if (cancelResult && typeof cancelResult.catch === 'function') {
          void cancelResult.catch(() => undefined);
        }
      } catch {
        // Cancellation is best-effort and must not interrupt the audit flow.
      }
    };
    controller.signal.addEventListener('abort', cancelAuditJob, { once: true });

    setIsGeneratingCritique(true);
    setIsGeneratingContent(false);
    setIsGeneratingBeats?.(false);
    setIsGeneratingOutline?.(false);
    setGenerationStatus(null);
    setAuditUnknownFeedback(null);
    setAuditStatus('正在整理正文与分镜，提交总编审读…');
    setAiActionState(createAiActionRunning('audit'));
    try {
      await flushPendingEditorWrites();
      const auditLatestContent = candidateForAudit?.content ?? contentRef.current?.value ?? currentChapter.content;
      const auditBaselineContent = contentRef.current?.value ?? currentChapter.content;
      const contextStr = buildContextPrompt(buildAgentContext());
      const requestDatabaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      const response = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: polishPromptSurface,
          draftContent: auditLatestContent,
          sceneBeats: currentChapter.sceneBeats,
          contextStr,
          novelId: novel.id,
          chapterId: currentChapter.id,
          databaseGeneration: requestDatabaseGeneration,
          chapterOrder: currentChapter ? currentChapter.order : 1,
          continuationPackId: selectedContinuationPackId || undefined,
          sessionCardIds: sessionCardIds?.length ? sessionCardIds : undefined,
          styleConfirmationFingerprint: options.styleConfirmationFingerprint || writingStyleFingerprint || undefined,
          reviewIssueIds: options.reviewIssueIds?.length ? options.reviewIssueIds : undefined,
          reviewScope: options.reviewScope,
          reviewContentHash: options.reviewContentHash,
        }),
        signal: controller.signal,
      });

      if (!isRequestCurrent(startingChapterId, currentSeq)) return;

      if (await handleStyleConfirmationResponse(response, (fingerprint) => handleRunAudit({ ...options, styleConfirmationFingerprint: fingerprint }))) {
        setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
        return;
      }
      const initData = await response.json();

      if (initData && initData.quotaExceeded) {
        throw new Error('QUOTA_LIMIT_EXCEEDED');
      }

      if (initData.error) throw new Error(initData.error);
      auditJobId = initData.jobId;
      auditDatabaseGeneration = initData.databaseGeneration;
      if (!auditJobId || !Number.isInteger(auditDatabaseGeneration)) throw new Error('Failed to initiate audit job');
      const databaseGeneration = auditDatabaseGeneration as number;
      if (databaseGeneration !== requestDatabaseGeneration) throw new Error('数据库已在审稿启动期间切换');

      let jobResult: Record<string, unknown> | null = null;
      while (true) {
        if (controller.signal.aborted) throw new Error('AbortError');
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            controller.signal.removeEventListener('abort', onAbort);
            resolve();
          }, 1500);
          const onAbort = () => {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', onAbort);
            reject(controller.signal.reason || new DOMException('Aborted', 'AbortError'));
          };
          if (controller.signal.aborted) onAbort();
          else controller.signal.addEventListener('abort', onAbort, { once: true });
        });

        const jobResponse = await fetch(`/api/audit/jobs/${auditJobId}?databaseGeneration=${databaseGeneration}`, {
          signal: controller.signal,
        });
        if (!jobResponse.ok) {
          throw new Error(`Failed to check audit status: ${jobResponse.status}`);
        }
        const job = await jobResponse.json();

        if (job.status === 'completed') {
          auditJobCompleted = true;
          jobResult = job.result;
          break;
        } else if (job.status === 'failed') {
          throw new Error('智能审稿服务异常或超时，请重试。');
        } else {
          const percent = job.progress || 0;
          setAuditStatus(`[${percent}%] ${job.stageText || '总编正在逐段扫描机械感、节奏和人设一致性…'}`);
        }
      }

      if (!jobResult) throw new Error('AI Audit returned no result');

      if (jobResult.status === 'unknown') {
        const category = typeof jobResult.errorCategory === 'string' ? jobResult.errorCategory : 'invalid_json';
        const diagnostic = typeof jobResult.diagnostic === 'string' ? jobResult.diagnostic : '审稿结果未确认';
        setAuditUnknownFeedback(`审稿结果未确认（${category}）：${diagnostic}`);
        const unknownError = new Error('审计结果未确认，正文未修改，请重试。');
        unknownError.name = 'AuditUnknownError';
        throw unknownError;
      }

      const numericAuditScore = typeof jobResult.score === 'number'
        ? jobResult.score
        : Number(String(jobResult.feedback || '').match(/(\d{2,3})\s*分/)?.[1] || 0) || undefined;

      const feedbackStr = typeof jobResult.feedback === 'string' ? jobResult.feedback : '';
      const auditStatus = jobResult.status === 'fail' ? 'fail' : 'pass';

      if (!isRequestCurrent(startingChapterId, currentSeq)) return;
      const reviewedAt = Date.now();
      const contentHash = computeChapterWorkflowHash(auditLatestContent, currentChapter.sceneBeats);
      const structuredAudit = jobResult.structured && typeof jobResult.structured === 'object'
        ? parseStructuredAuditResponse(JSON.stringify(jobResult.structured))
        : extractStructuredAudit(feedbackStr);
      const semanticReview = semanticReviewFromStructuredAudit(structuredAudit);
      const workflowMeta: ChapterWorkflowMeta = {
        ...(options.baseWorkflowMeta || candidateForAudit?.workflowMeta || currentChapter.workflowMeta || { version: 1 as const }),
        version: 1 as const,
        lastAudit: { status: auditStatus as 'pass' | 'fail', contentHash, completedAt: reviewedAt, source: 'model' as const },
      };
      const previousReviewState = workflowMeta.reviewState;
      const structuredReviewState = structuredAudit ? (() => {
        const issues = structuredAuditToReviewIssues(structuredAudit, contentHash);
        return {
          schemaVersion: 1 as const,
          contentHash,
          gate: deriveReviewGate(issues, auditStatus),
          lastReviewedAt: reviewedAt,
          issues,
          semanticReview,
        };
      })() : undefined;
      const freshReviewState = structuredReviewState || deriveChapterReviewState({
          ...currentChapter,
          content: auditLatestContent,
          critique: feedbackStr,
          workflowMeta: { ...workflowMeta, reviewState: undefined },
        }, contentHash);
      if (freshReviewState && options.reviewScope === 'affected' && previousReviewState) {
        const selectedIds = new Set(options.reviewIssueIds || []);
        const retainedIssues = previousReviewState.issues
          .filter((issue) => !selectedIds.has(issue.id))
          .map((issue) => ({ ...issue, contentHash, updatedAt: reviewedAt }));
        const issues = [...retainedIssues, ...freshReviewState.issues];
        workflowMeta.reviewState = {
          ...freshReviewState,
          issues,
          gate: deriveReviewGate(issues, auditStatus),
          lastRecheckHash: contentHash,
        };
      } else {
        workflowMeta.reviewState = freshReviewState;
      }
      // A polish candidate carries the exact review issues it remediated. A
      // follow-up audit must update its evidence without rebuilding those
      // issues from the unchanged chapter snapshot, otherwise previewed
      // issues regress to open before the candidate can be accepted.
      if (candidateForAudit?.operation === 'polish' && candidateForAudit.reviewIssueIds?.length && candidateForAudit.workflowMeta?.reviewState) {
        const candidateReviewState = candidateForAudit.workflowMeta.reviewState;
        const candidateIssues = candidateReviewState.issues.map((issue) => ({
          ...issue,
          contentHash,
          updatedAt: reviewedAt,
        }));
        workflowMeta.reviewState = {
          ...candidateReviewState,
          contentHash,
          lastReviewedAt: reviewedAt,
          lastRecheckHash: contentHash,
          semanticReview,
          issues: candidateIssues,
          gate: deriveReviewGate(candidateIssues, auditStatus),
        };
      }
      const latestContentBeforeSave = contentRef.current?.value ?? currentChapter.content;
      if (latestContentBeforeSave !== auditBaselineContent) {
        throw new Error('AUDIT_CONTENT_STALE');
      }
      if (candidateForAudit && candidateForAudit.baselineContent !== auditBaselineContent) {
        throw new Error('AUDIT_CANDIDATE_STALE');
      }
      if (candidateForAudit) {
        const nextQuality = {
          ...(candidateForAudit.quality || validateCandidateDraftQuality(auditLatestContent, auditBaselineContent)),
          semanticReview,
        };
        setCandidate?.({
          ...candidateForAudit,
          auditFeedback: feedbackStr,
          workflowMeta,
          quality: nextQuality,
        });
      } else {
        const saved = await updateChapter(currentChapter.id, { critique: feedbackStr, workflowMeta }, databaseGeneration);
        if (!saved) throw new Error('章节已不存在，审稿结果未保存。');
        if (!isRequestCurrent(startingChapterId, currentSeq)) return;
        setCurrentChapter((prev) => (prev?.id === currentChapter.id ? { ...prev, critique: feedbackStr, workflowMeta } : prev));
      }
      try {
        await recordSkillUsage('revised', {
          fitScore: getCurrentFitScore(),
          auditScore: numericAuditScore,
          notes: 'run-audit-success',
          databaseGeneration,
        });
      } catch {
        // Auxiliary telemetry must not roll back committed critique.
      }
      void recordProductEvent({
        eventName: 'audit', stage: 'audit', result: 'success',
        qualityStatus: auditStatus,
        durationMs: Date.now() - startedAt, novelId: novel.id,
        chapterId: currentChapter.id, objectId: auditJobId || undefined,
      }).catch(() => undefined);
      setAuditStatus(null);
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionSuccess(state, candidateForAudit ? '候选审稿完成，已更新质量证据，正文尚未修改。' : '审稿完成，审稿意见已保存。'));
    } catch (error) {
      if (!isRequestCurrent(startingChapterId, currentSeq)) return;
      if (error instanceof Error && error.name === 'AbortError') {
        setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
        void recordProductEvent({
          eventName: 'audit', stage: 'audit', result: 'unknown',
          durationMs: Date.now() - startedAt, errorCode: 'OPERATION_CANCELLED',
          novelId: novel.id, chapterId: currentChapter.id, objectId: auditJobId || undefined,
        }).catch(() => undefined);
        return;
      }
      if (error instanceof Error && error.name === 'AuditUnknownError') {
        void recordProductEvent({
          eventName: 'audit', stage: 'audit', result: 'success',
          qualityStatus: 'unknown',
          durationMs: Date.now() - startedAt, errorCode: 'AUDIT_UNPARSEABLE',
          novelId: novel.id, chapterId: currentChapter.id, objectId: auditJobId || undefined,
        }).catch(() => undefined);
        setAuditStatus(null);
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '审稿结果无法解析，正文未被修改。'));
        return;
      }
      void recordProductEvent({
        eventName: 'audit', stage: 'audit', result: 'failure',
        durationMs: Date.now() - startedAt,
        errorCode: error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED' ? 'QUOTA_LIMIT_EXCEEDED' : 'AUDIT_FAILED',
        novelId: novel.id, chapterId: currentChapter.id, objectId: auditJobId || undefined,
      }).catch(() => undefined);
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') {
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '审稿暂不可用，请检查当前能力额度后重试。'));
        return;
      }
      setAuditStatus(null);
      const message = formatAiFailure(error, '审稿');
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, message));
    } finally {
      controller.signal.removeEventListener('abort', cancelAuditJob);
      if (!auditJobCompleted) cancelAuditJob();
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingCritique(false);
        setAuditStatus(null);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  const handleRewriteSelectedText = async (retryInput?: { start: number; end: number; instruction: string; fingerprint?: string }) => {
    const startingChapterId = currentChapter?.id;
    if (!contentRef.current || !currentChapter) return;

    const currentSeq = ++requestSeqRef.current;
    const start = retryInput?.start ?? contentRef.current.selectionStart;
    const end = retryInput?.end ?? contentRef.current.selectionEnd;
    if (start === end) {
      alert('请先在右侧区域选中一段您需要改写的文字，然后再点击此按钮。');
      return;
    }
    const instruction = retryInput?.instruction ?? prompt('请输入改写要求（如：更加通俗易懂，或者更有文学色彩），留空则由 AI 自动润色：');
    if (instruction === null) return;
    setRetryContext?.({ operation: 'rewrite', input: { start, end, instruction, fingerprint: retryInput?.fingerprint } });

    setIsGeneratingContent(true);
    setIsGeneratingCritique(false);
    setIsGeneratingBeats?.(false);
    setIsGeneratingOutline?.(false);
    setAuditStatus(null);
    setAiActionState(createAiActionRunning('rewrite'));
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    let baselineContent = currentChapter.content;

    try {
      await flushPendingEditorWrites();
      baselineContent = contentRef.current?.value ?? currentChapter.content;
      const requestDatabaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: baselineContent.substring(start, end),
          instruction,
          contextStr: buildContextPrompt(buildAgentContext()),
          novelId: novel.id,
          chapterId: currentChapter.id,
          databaseGeneration: requestDatabaseGeneration,
          continuationPackId: selectedContinuationPackId || undefined,
          sessionCardIds: sessionCardIds?.length ? sessionCardIds : undefined,
          styleConfirmationFingerprint: retryInput?.fingerprint || writingStyleFingerprint || undefined,
        }),
        signal: controller.signal,
      });

      if (!isRequestCurrent(startingChapterId, currentSeq)) return;

      if (await handleStyleConfirmationResponse(response, (fingerprint) => handleRewriteSelectedText({ start, end, instruction, fingerprint }))) {
        setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
        return;
      }
      if (response.status === 403) {
        const data = await response.json().catch(() => ({}));
        if (data && data.quotaExceeded) {
          throw new Error('QUOTA_LIMIT_EXCEEDED');
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Rewrite failed.');
      }
      const databaseGeneration = requireResponseDatabaseGeneration(response);
      if (databaseGeneration !== requestDatabaseGeneration) throw new Error('数据库已在改写启动期间切换');

      const streamResult = await readSseStream(response, () => {
        // Keep streamed rewrite output in memory; the editor body changes only on accept.
      });

      if (!streamResult.done) {
        restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '改写流未正常结束，原文已恢复。'));
        return;
      }

      const rewritten = streamResult.text;
      const newText = baselineContent.substring(0, start) + rewritten + baselineContent.substring(end);

      if (!rewritten.trim()) {
        restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '改写结果为空，原文已恢复。'));
        return;
      }

      const latestContentBeforeCandidate = contentRef.current?.value ?? currentChapter.content;
      if (latestContentBeforeCandidate !== baselineContent) {
        throw new Error('REWRITE_CONTENT_STALE');
      }

      const rewriteQuality = validateCandidateDraftQuality(newText, baselineContent);
      if (!rewriteQuality.ok) {
        throw new Error(`改写候选未通过质量门禁：${rewriteQuality.violations.join('；')}`);
      }

      setCandidate?.({
        id: `${currentChapter.id}:${currentSeq}:rewrite`, operation: 'rewrite', novelId: novel.id,
        chapterId: currentChapter.id, databaseGeneration, createdAt: Date.now(), baselineHash: computeChapterWorkflowHash(baselineContent, currentChapter.sceneBeats),
        baselineContent, content: newText, selectionStart: start, selectionEnd: end, instruction, quality: rewriteQuality, source: 'model',
      });
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionSuccess(state, '选中改写候选已生成，接受后写入正文。'));
    } catch (error) {
      if (!isRequestCurrent(startingChapterId, currentSeq)) return;
      if (error instanceof Error && error.name === 'AbortError') {
        restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
        setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
        return;
      }
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') {
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '改写暂不可用，请检查当前能力额度后重试。'));
        return;
      }
      restorePreviewIfCurrent(baselineContent, startingChapterId, currentSeq);
      const message = formatAiFailure(error, '改写');
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, message));
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        setGenerationStatus(null);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  const handleContextRewriteCandidate = async (input: ContextRewriteCandidateInput) => {
    const startingChapterId = currentChapter?.id;
    if (!currentChapter || !contentRef.current || input.selectionEnd <= input.selectionStart) return;
    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    setIsGeneratingContent(true);
    setAiActionState(createAiActionRunning('rewrite'));
    try {
      await flushPendingEditorWrites();
      const baselineContent = contentRef.current?.value ?? currentChapter.content;
      const targetText = baselineContent.slice(input.selectionStart, input.selectionEnd);
      if (!targetText) throw new Error('精修目标窗口已变化，请重新运行诊断。');
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'surgical-patch', text: targetText, beforeContext: input.beforeContext, afterContext: input.afterContext,
          auditIssue: input.auditIssue, instruction: '只修复结构证据窗口，保持人物、事实、关系、设定和事件后果不变。',
          contextStr: buildContextPrompt(buildAgentContext()), sceneBeats: input.sceneBeats || currentChapter.sceneBeats || '',
          novelId: novel.id, chapterId: currentChapter.id, databaseGeneration: input.databaseGeneration,
          continuationPackId: selectedContinuationPackId || undefined,
          sessionCardIds: sessionCardIds?.length ? sessionCardIds : undefined,
          styleConfirmationFingerprint: writingStyleFingerprint || undefined,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `精修失败：HTTP ${response.status}`);
      const responseGeneration = requireResponseDatabaseGeneration(response);
      if (responseGeneration !== input.databaseGeneration) throw new Error('数据库已切换，候选已失效。');
      const streamResult = await readSseStream(response, () => undefined);
      if (!streamResult.done || !streamResult.text.trim()) throw new Error('精修结果为空或未正常结束。');
      if (!isRequestCurrent(startingChapterId, currentSeq)) return;
      const content = `${baselineContent.slice(0, input.selectionStart)}${streamResult.text}${baselineContent.slice(input.selectionEnd)}`;
      const quality = validateCandidateDraftQuality(content, baselineContent);
      if (!quality.ok) throw new Error(`精修候选未通过质量门禁：${quality.violations.join('；')}`);
      setCandidate?.({
        id: `${currentChapter.id}:${currentSeq}:context-rewrite`, operation: 'rewrite', novelId: novel.id, chapterId: currentChapter.id,
        databaseGeneration: input.databaseGeneration, createdAt: Date.now(), baselineHash: computeChapterWorkflowHash(baselineContent, currentChapter.sceneBeats),
        baselineContent, content, selectionStart: input.selectionStart, selectionEnd: input.selectionEnd,
        instruction: input.auditIssue, quality, source: 'model',
      });
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionSuccess(state, '上下文精修候选已生成，接受后写入正文。'));
    } catch (error) {
      if (isRequestCurrent(startingChapterId, currentSeq) && !(error instanceof Error && error.name === 'AbortError')) {
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, formatAiFailure(error, '上下文精修')));
      }
      throw error;
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
      }
    }
  };

  const handlePolishChapterFromAudit = async (
    fingerprintOverride?: string,
    reviewOptions?: { issueIds?: string[]; recheck?: boolean; previewOnly?: boolean },
  ) => {
    setRetryContext?.({ operation: 'polish', fingerprint: fingerprintOverride });
    const startingChapterId = currentChapter?.id;
    const candidateSnapshot = getCandidate?.() ?? aiContentCandidate;
    const candidateForPolish = currentChapter && candidateSnapshot
      && candidateSnapshot.chapterId === currentChapter.id
      ? candidateSnapshot
      : null;
    const auditFeedback = candidateForPolish?.auditFeedback || currentChapter?.critique || '';
    if (!currentChapter?.content || !auditFeedback) {
      alert('请先生成正文并完成一次 AI 审计，再执行精修。');
      return;
    }
    const startedAt = Date.now();

    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    setIsGeneratingContent(true);
    setIsGeneratingCritique(false);
    setIsGeneratingBeats?.(false);
    setIsGeneratingOutline?.(false);
    setAuditStatus(null);
    setGenerationStatus('正在按审计意见定位坏段落…');
    setAiActionState(createAiActionRunning('polish'));
    let baseline = candidateForPolish?.content || currentChapter.content;
    try {
      await flushPendingEditorWrites();
      const currentEditorContent = contentRef.current?.value ?? currentChapter.content;
      if (candidateForPolish && currentEditorContent !== candidateForPolish.baselineContent) {
        throw new Error('POLISH_CONTENT_STALE');
      }
      baseline = candidateForPolish?.content || currentEditorContent;
      const databaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      const { duplicateTargets, rewriteTargets } = extractPolishTargetsFromCritique(auditFeedback);

      let candidate = baseline;
      let changed = false;

      if (duplicateTargets.length > 0) {
        const deduped = removeRepeatedQuotedBlocks(candidate, duplicateTargets);
        candidate = deduped.content;
        changed = changed || deduped.removedCount > 0;
      }

      setGenerationStatus('已清理重复段，正在逐段精修关键问题…');

      const actionableTargets = selectRewriteTargetsForPatch(candidate, rewriteTargets, 3, auditFeedback);

      if (duplicateTargets.length === 0 && actionableTargets.length === 0) {
        void recordProductEvent({
          eventName: 'polish', stage: 'polish', result: 'failure',
          durationMs: Date.now() - startedAt, errorCode: 'NO_ACTIONABLE_TARGET',
          novelId: novel.id, chapterId: currentChapter.id,
        }).catch(() => undefined);
        setGenerationStatus(null);
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '本轮审计没有定位到可自动精修的明确片段。'));
        return;
      }

      for (const { snippet } of actionableTargets) {
        if (!isRequestCurrent(startingChapterId, currentSeq)) return;

        const targetWindow = selectRewriteTargetsForPatch(candidate, [snippet], 1, auditFeedback)[0]?.window;
        if (!targetWindow) continue;

        const response = await fetch('/api/rewrite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'surgical-patch',
            text: targetWindow.targetText,
            beforeContext: targetWindow.beforeContext,
            afterContext: targetWindow.afterContext,
            auditIssue: snippet,
            instruction: '只修这个局部问题，保持全章剧情顺序和悬念落点不变。',
            contextStr: buildContextPrompt(buildAgentContext()),
            auditFeedback,
            sceneBeats: currentChapter.sceneBeats || '',
            novelId: novel.id,
            chapterId: currentChapter.id,
            databaseGeneration,
            continuationPackId: selectedContinuationPackId || undefined,
            sessionCardIds: sessionCardIds?.length ? sessionCardIds : undefined,
            styleConfirmationFingerprint: fingerprintOverride || writingStyleFingerprint || undefined,
          }),
          signal: controller.signal,
        });

        if (!isRequestCurrent(startingChapterId, currentSeq)) return;

        if (await handleStyleConfirmationResponse(response, async (fingerprint) => {
          await handlePolishChapterFromAudit(fingerprint, reviewOptions);
        })) {
          setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
          return;
        }
        if (response.status === 403) {
          const data = await response.json().catch(() => ({}));
          if (data && data.quotaExceeded) {
            throw new Error('QUOTA_LIMIT_EXCEEDED');
          }
        }

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        const responseGeneration = requireResponseDatabaseGeneration(response);
        if (responseGeneration !== databaseGeneration) {
          throw new Error('数据库已在精修期间切换');
        }

        const streamResult = await readSseStream(response, () => undefined);

        if (!streamResult.done) {
          restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
          throw new Error('精修流未正常结束');
        }

        const rewrittenText = streamResult.text.trim();
        if (!rewrittenText) continue;
        candidate = applyPatchWindow(candidate, targetWindow, rewrittenText);
        changed = changed || candidate !== baseline;

        if (!isRequestCurrent(startingChapterId, currentSeq)) return;
      }

      if (changed) {
        const latestContentBeforeCandidate = contentRef.current?.value ?? currentChapter.content;
        if (latestContentBeforeCandidate !== baseline) {
          throw new Error('POLISH_CONTENT_STALE');
        }
        const guard = validatePolishCandidate(baseline, candidate);
        if (!guard.ok) {
          void recordProductEvent({
            eventName: 'polish', stage: 'polish', result: 'failure',
            durationMs: Date.now() - startedAt, errorCode: 'VALIDATION_REJECTED',
            novelId: novel.id, chapterId: currentChapter.id,
          }).catch(() => undefined);
          restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
          setGenerationStatus(null);
          setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, `精修结果未通过安全校验：${guard.reason}`));
          return;
        }

        if (!isRequestCurrent(startingChapterId, currentSeq)) return;

        const polishQuality = validateCandidateDraftQuality(candidate, baseline);
        if (!polishQuality.ok) {
          restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
          setGenerationStatus(null);
          setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, `精修候选未通过质量门禁：${polishQuality.violations.join('；')}`));
          return;
        }

        if (reviewOptions?.previewOnly) {
          setGenerationStatus(null);
          setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionSuccess(state, '修正预览已生成，正文尚未修改。'));
          return candidate;
        }

        const outputHash = computeChapterWorkflowHash(candidate, currentChapter.sceneBeats);
        const existingReviewState = candidateForPolish?.workflowMeta?.reviewState || currentChapter.workflowMeta?.reviewState;
        const reviewState = existingReviewState ? {
          ...existingReviewState,
          contentHash: outputHash,
          issues: existingReviewState.issues,
          gate: 'review-required' as const,
          semanticReview: DEFAULT_SEMANTIC_REVIEW,
          lastRecheckHash: outputHash,
        } : undefined;
        const appliedIssueIds = new Set(
          reviewOptions?.issueIds?.length
            ? reviewOptions.issueIds
            : (reviewState?.issues || [])
              .filter((issue) => actionableTargets.some((target) => target.snippet === issue.snippet))
              .map((issue) => issue.id),
        );
        const nextWorkflowMeta: ChapterWorkflowMeta = {
          ...(candidateForPolish?.workflowMeta || currentChapter.workflowMeta || { version: 1 as const }),
          version: 1,
          reviewState: reviewState ? {
            ...reviewState,
            issues: reviewState.issues.map((issue) => appliedIssueIds.has(issue.id)
              ? { ...issue, status: 'previewed' as const, resolvedAt: undefined, updatedAt: Date.now() }
              : issue),
          } : undefined,
          lastPolish: {
            inputHash: computeChapterWorkflowHash(baseline, currentChapter.sceneBeats),
            outputHash,
            completedAt: Date.now(),
          },
        };

        setCandidate?.({
          id: `${currentChapter.id}:${currentSeq}:polish`, operation: 'polish', novelId: novel.id,
          chapterId: currentChapter.id, databaseGeneration, createdAt: Date.now(), baselineHash: computeChapterWorkflowHash(baseline, currentChapter.sceneBeats),
          baselineContent: baseline, content: candidate, reviewIssueIds: [...appliedIssueIds],
          reviewRecheck: reviewOptions?.previewOnly ? false : reviewOptions?.recheck !== false,
          auditFeedback, workflowMeta: nextWorkflowMeta, quality: polishQuality, source: 'model',
        });

        void recordProductEvent({
          eventName: 'polish', stage: 'polish', result: 'success',
          durationMs: Date.now() - startedAt, novelId: novel.id, chapterId: currentChapter.id,
        }).catch(() => undefined);
        setGenerationStatus('精修候选已生成，请接受后保存。');
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionSuccess(state, '精修候选已生成，接受后写入正文。'));
        return candidate;
      } else {
        void recordProductEvent({
          eventName: 'polish', stage: 'polish', result: 'failure',
          durationMs: Date.now() - startedAt, errorCode: 'NO_CHANGES',
          novelId: novel.id, chapterId: currentChapter.id,
        }).catch(() => undefined);
        setGenerationStatus(null);
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '精修没有产生有效变化，请调整审稿意见后重试。'));
      }
    } catch (error) {
      if (!isRequestCurrent(startingChapterId, currentSeq)) return;
      if (error instanceof Error && error.name === 'AbortError') {
        restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
        setAiActionStateForRequest(startingChapterId, currentSeq, idleAiAction());
        void recordProductEvent({
          eventName: 'polish', stage: 'polish', result: 'unknown',
          durationMs: Date.now() - startedAt, errorCode: 'OPERATION_CANCELLED',
          novelId: novel.id, chapterId: currentChapter.id,
        }).catch(() => undefined);
        return;
      }
      void recordProductEvent({
        eventName: 'polish', stage: 'polish', result: 'failure',
        durationMs: Date.now() - startedAt,
        errorCode: error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED' ? 'QUOTA_LIMIT_EXCEEDED' : 'POLISH_FAILED',
        novelId: novel.id, chapterId: currentChapter.id,
      }).catch(() => undefined);
      if (error instanceof Error && error.message === 'QUOTA_LIMIT_EXCEEDED') {
        setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, '精修暂不可用，请检查当前能力额度后重试。'));
        return;
      }
      restorePreviewIfCurrent(baseline, startingChapterId, currentSeq);
      const message = formatAiFailure(error, '精修');
      setAiActionStateForRequest(startingChapterId, currentSeq, (state) => createAiActionError(state, message));
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingContent(false);
        setGenerationStatus(null);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  return {
    handleRunAudit,
    handleRewriteSelectedText,
    handlePolishChapterFromAudit,
    handleContextRewriteCandidate,
  };
}
