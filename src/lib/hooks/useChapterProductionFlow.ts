import { useCallback, useEffect, useRef } from 'react';

import type { Chapter, ChapterMetadata, ChapterProductionRun } from '../../../shared/types';
import { applyChapterProductionRun, startChapterProductionRunStream, type ProductionRunSSEEvent, ProductionStyleConfirmationRequiredError } from '../production-client';
import { getChapter } from '../chapter-client';
import { getDatabaseGenerationSnapshot } from '../db-transport';
import { recordProductEvent } from '../product-events-client';
import { useProductionStore } from '../../stores/production-store';

const nowMs = () => Date.now();

interface UseChapterProductionFlowArgs {
  novelId: string;
  currentChapterId?: string;
  databaseGeneration?: number | null;
  continuationPackId?: string;
  writingStyleFingerprint?: string;
  sessionCardIds?: string[];
  onStyleConfirmationRequired?: (error: ProductionStyleConfirmationRequiredError & {
    retry?: (fingerprint: string) => Promise<void>;
  }) => void;
  flushPendingEditorWrites?: () => Promise<void>;
  refreshChapters: () => Promise<ChapterMetadata[]>;
  setCurrentChapter: React.Dispatch<React.SetStateAction<Chapter | null>>;
  activeEntityNames?: string[];
}

export function useChapterProductionFlow({
  novelId,
  currentChapterId,
  databaseGeneration,
  continuationPackId,
  writingStyleFingerprint,
  sessionCardIds,
  onStyleConfirmationRequired,
  flushPendingEditorWrites,
  refreshChapters,
  setCurrentChapter,
  activeEntityNames,
}: UseChapterProductionFlowArgs) {
  // 005：状态归属 production-store（"hooks 管副作用，store 管状态"）。
  // 本 hook 只保留流程副作用（LLM 流、中断、重试）并继续以原签名对外；
  // 子面板与 006 状态条可改为直接订阅 store，无需再经 props 钻孔。
  const productionIntent = useProductionStore((state) => state.productionIntent);
  const activeProductionRun = useProductionStore((state) => state.activeProductionRun);
  const isProductionRunning = useProductionStore((state) => state.isProductionRunning);
  const isApplyingProductionRun = useProductionStore((state) => state.isApplyingProductionRun);
  const productionError = useProductionStore((state) => state.productionError);
  const productionBeatsSource = useProductionStore((state) => state.productionBeatsSource);
  const productionDraftSource = useProductionStore((state) => state.productionDraftSource);
  const productionAuditSource = useProductionStore((state) => state.productionAuditSource);
  const productionStatusMessage = useProductionStore((state) => state.productionStatusMessage);
  const setProductionIntent = useProductionStore((state) => state.setProductionIntent);
  const setActiveProductionRun = useProductionStore((state) => state.setActiveProductionRun);
  const setIsProductionRunning = useProductionStore((state) => state.setIsProductionRunning);
  const setIsApplyingProductionRun = useProductionStore((state) => state.setIsApplyingProductionRun);
  const setProductionError = useProductionStore((state) => state.setProductionError);
  const setProductionBeatsSource = useProductionStore((state) => state.setProductionBeatsSource);
  const setProductionDraftSource = useProductionStore((state) => state.setProductionDraftSource);
  const setProductionAuditSource = useProductionStore((state) => state.setProductionAuditSource);
  const setProductionStatusMessage = useProductionStore((state) => state.setProductionStatusMessage);
  const resetProductionFlow = useProductionStore((state) => state.resetProductionFlow);

  const productionAbortRef = useRef<AbortController | null>(null);
  const productionDraftSourceRef = useRef<'fallback' | 'model' | null>(null);
  const productionCompletedRef = useRef(false);
  const productionDatabaseGenerationRef = useRef<number | null>(null);
  const fallbackDraftRef = useRef('');
  const modelDraftRef = useRef('');

  const productionScopeRef = useRef({ novelId, chapterId: currentChapterId, databaseGeneration });
  // 005：运行态迁入 store 后跨挂载存续；旧实现里这些标记随组件卸载丢弃。
  // 冷挂载（本实例没有在途流）时清掉遗留标记，避免"卡在生产中"的僵尸状态。
  const coldMountGuardRef = useRef(false);
  useEffect(() => {
    if (coldMountGuardRef.current) return;
    coldMountGuardRef.current = true;
    if (useProductionStore.getState().isProductionRunning && !productionAbortRef.current) {
      resetProductionFlow();
    }
  }, [resetProductionFlow]);
  useEffect(() => {
    const previous = productionScopeRef.current;
    if (previous.novelId === novelId && previous.chapterId === currentChapterId && previous.databaseGeneration === databaseGeneration) return;
    productionScopeRef.current = { novelId, chapterId: currentChapterId, databaseGeneration };
    productionAbortRef.current?.abort();
    productionAbortRef.current = null;
    resetProductionFlow();
    productionDraftSourceRef.current = null;
    productionCompletedRef.current = false;
    productionDatabaseGenerationRef.current = null;
    fallbackDraftRef.current = '';
    modelDraftRef.current = '';
  }, [currentChapterId, databaseGeneration, novelId, resetProductionFlow]);

  const stopProductionFlow = useCallback(() => {
    if (productionAbortRef.current) {
      productionAbortRef.current.abort();
      productionAbortRef.current = null;
    }
    const message = '生产任务已取消，可重新发起。';
    setIsProductionRunning(false);
    setProductionStatusMessage(null);
    setProductionError(message);
    setActiveProductionRun((current) => current?.status === 'running'
      ? { ...current, status: 'failed', errorMessage: message }
      : current);
  }, [setActiveProductionRun, setIsProductionRunning, setProductionError, setProductionStatusMessage]);

  const handleStartProductionRun = async (
    intentOverride?: string,
    fingerprintOverride?: string,
    allowStyleRetry = true,
    preservePreview = false,
  ) => {
    if (productionAbortRef.current) {
      productionAbortRef.current.abort();
    }
    const controller = new AbortController();
    productionAbortRef.current = controller;
    const resolvedIntent = intentOverride ?? productionIntent;
    const startedAt = nowMs();
    setProductionIntent(resolvedIntent);
    void recordProductEvent({
      eventName: 'generation_entry_used',
      stage: 'drafting',
      result: 'success',
      novelId,
      action: 'unified_panel',
    }).catch(() => undefined);

    setIsProductionRunning(true);
    setProductionError(null);
    if (!preservePreview) {
      setProductionBeatsSource(null);
      setProductionDraftSource(null);
      productionDraftSourceRef.current = null;
      setProductionAuditSource(null);
    }
    setProductionStatusMessage('正在连接...');
    productionCompletedRef.current = false;
    if (!preservePreview) {
      fallbackDraftRef.current = '';
      modelDraftRef.current = '';
      const createdAt = nowMs();
      setActiveProductionRun({
        id: '',
        novelId,
        status: 'running',
        userIntent: resolvedIntent,
        sceneBeats: '',
        draftContent: '',
        styleAudit: '',
        continuityReport: {
          score: 70,
          issues: [],
          proposedPatch: {
            characterUpdates: [],
            itemUpdates: [],
            foreshadowingUpdates: [],
            timelineEventsToCreate: [],
            foreshadowingsToCreate: [],
          },
        },
        createdAt,
        updatedAt: createdAt,
      });
    }

    let awaitingStyleConfirmation = false;
    try {
      if (!currentChapterId) {
        throw new Error('请先选择章节，再启动正文生产。');
      }
      // Persist the latest editor/decomposition writes before the server
      // captures the production baseline hash. Otherwise the preview can be
      // born from stale database content and be rejected on apply.
      if (flushPendingEditorWrites) {
        setProductionStatusMessage('正在保存当前编辑...');
        await flushPendingEditorWrites();
      }
      setProductionStatusMessage('正在准备草稿...');
      const databaseGeneration = await getDatabaseGenerationSnapshot(controller.signal);
      productionDatabaseGenerationRef.current = databaseGeneration;
      const payload = {
        novelId,
        chapterId: currentChapterId,
        databaseGeneration,
        targetChapterId: currentChapterId,
        userIntent: resolvedIntent,
        continuationPackId: continuationPackId || undefined,
        writingStyleFingerprint: fingerprintOverride || writingStyleFingerprint || undefined,
        sessionCardIds: sessionCardIds?.length ? sessionCardIds : undefined,
        activeEntityNames,
      };
      await startChapterProductionRunStream(
        payload,
        (event: ProductionRunSSEEvent) => {
          if (productionAbortRef.current !== controller) return;

          switch (event.type) {
            case 'run_created':
              setActiveProductionRun((prev) => prev ? { ...prev, id: event.runId } : prev);
              break;
            case 'status':
              setProductionStatusMessage(event.message);
              break;
            case 'fallback_beats':
              setActiveProductionRun((prev) => prev ? { ...prev, sceneBeats: event.content } : prev);
              setProductionBeatsSource('fallback');
              break;
            case 'fallback_draft_token':
              fallbackDraftRef.current += event.content;
              setActiveProductionRun((prev) => prev ? { ...prev, draftContent: fallbackDraftRef.current } : prev);
              break;
            case 'fallback_draft_done':
              setProductionDraftSource('fallback');
              productionDraftSourceRef.current = 'fallback';
              break;
            case 'fallback_audit':
              setActiveProductionRun((prev) => prev ? { ...prev, styleAudit: event.content } : prev);
              setProductionAuditSource('fallback');
              break;
            case 'model_beats':
              setActiveProductionRun((prev) => prev ? { ...prev, sceneBeats: event.content } : prev);
              setProductionBeatsSource('model');
              break;
            case 'model_draft_start':
              modelDraftRef.current = '';
              setProductionDraftSource('model');
              productionDraftSourceRef.current = 'model';
              setActiveProductionRun((prev) => prev ? { ...prev, draftContent: '' } : prev);
              break;
            case 'model_draft_token':
              setProductionDraftSource('model');
              productionDraftSourceRef.current = 'model';
              modelDraftRef.current += event.content;
              setActiveProductionRun((prev) => prev ? { ...prev, draftContent: modelDraftRef.current } : prev);
              break;
            case 'model_draft_done':
              break;
            case 'model_audit':
              setActiveProductionRun((prev) => prev ? { ...prev, styleAudit: event.content } : prev);
              setProductionAuditSource('model');
              break;
            case 'model_score':
              break;
            case 'done':
              if (!productionCompletedRef.current && event.run.status === 'review_required') {
                const common = {
                  durationMs: nowMs() - startedAt,
                  novelId,
                  chapterId: event.run.targetChapterId,
                  objectId: event.run.id,
                };
                void recordProductEvent({ eventName: 'scene_plan', stage: 'planning', result: 'success', ...common }).catch(() => undefined);
                void recordProductEvent({ eventName: 'draft_preview', stage: 'drafting', result: 'success', ...common }).catch(() => undefined);
                const criticStatus = event.run.continuityReport.auditMeta?.status;
                if (criticStatus === 'pass' || criticStatus === 'fail' || criticStatus === 'unknown') {
                  void recordProductEvent({
                    eventName: 'critic_review', stage: 'audit',
                    result: 'success',
                    qualityStatus: criticStatus,
                    ...common,
                  }).catch(() => undefined);
                }
              }
              productionCompletedRef.current = true;
              setActiveProductionRun(event.run);
              setProductionError(null);
              setProductionStatusMessage(null);
              setIsProductionRunning(false);
              break;
            case 'error':

              setProductionError(event.message);
              break;
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        void recordProductEvent({
          eventName: 'draft_preview', stage: 'drafting', result: 'unknown',
          durationMs: nowMs() - startedAt, errorCode: 'OPERATION_CANCELLED',
          novelId, chapterId: currentChapterId,
        }).catch(() => undefined);
        return;
      }
      if (productionAbortRef.current !== controller) {
        return;
      }
      if (error instanceof ProductionStyleConfirmationRequiredError) {
        awaitingStyleConfirmation = true;
        if (allowStyleRetry) {
          onStyleConfirmationRequired?.(Object.assign(error, {
            retry: (fingerprint: string) => handleStartProductionRun(resolvedIntent, fingerprint, false, true),
          }));
        } else {
          setProductionError(error.message);
        }
        return;
      }

      void recordProductEvent({
        eventName: 'draft_preview', stage: 'drafting', result: 'failure',
        durationMs: nowMs() - startedAt, errorCode: 'PRODUCTION_FAILED',
        novelId, chapterId: currentChapterId,
      }).catch(() => undefined);
      setProductionError(error instanceof Error ? error.message : String(error));
    } finally {

      if (productionAbortRef.current === controller) {
        if (!productionCompletedRef.current && !awaitingStyleConfirmation) {
          const message = '生产流未完整结束，预览不会作为成功正文提交，请重试。';
          setProductionError((current) => current || message);
          setActiveProductionRun((prev) =>
            prev && prev.status === 'running'
              ? {
                  ...prev,
                  status: 'failed',
                  errorMessage: prev.errorMessage || message,
                }
              : prev,
          );
        }
        setIsProductionRunning(false);
        setProductionStatusMessage(null);
        productionDraftSourceRef.current = null;
        productionCompletedRef.current = false;
        fallbackDraftRef.current = '';
        modelDraftRef.current = '';
        productionAbortRef.current = null;
      }
    }
  };

  const handleApplyProductionRun = async (runOverride?: ChapterProductionRun) => {
    const runToApply = runOverride || activeProductionRun;
    if (!runToApply) return;
    setIsApplyingProductionRun(true);
    setProductionError(null);
    try {
      await flushPendingEditorWrites?.();
      const auditStatus = runToApply.continuityReport.auditMeta?.status;
      const targetChapterId = runToApply.targetChapterId || currentChapterId || '';
      // Capture pre-apply emptiness so metrics can attribute "first accept".
      const preChapter = targetChapterId
        ? await getChapter(targetChapterId).catch(() => null)
        : null;
      const chapterWasEmpty = !preChapter?.content?.trim();
      const result = await applyChapterProductionRun(
        runToApply.id,
        {
          novelId,
          chapterId: targetChapterId,
          databaseGeneration: runToApply.continuityReport.databaseGeneration
            ?? productionDatabaseGenerationRef.current
            ?? await getDatabaseGenerationSnapshot(),
        },
        runToApply.reviewVersionId && runToApply.reviewVersionHash
          ? { versionId: runToApply.reviewVersionId, versionHash: runToApply.reviewVersionHash }
        : undefined,
        auditStatus === 'unknown' || auditStatus === 'not_run',
      );
      const freshChapters = await refreshChapters();
      const fullChapter = await getChapter(result.chapterId);
      if (!fullChapter) throw new Error('生产结果章节不存在，未切换编辑器。');
      if (!freshChapters.some((chapter) => chapter.id === fullChapter.id)) {
        throw new Error('生产结果章节未出现在章节列表中。');
      }
      setCurrentChapter(fullChapter);
      setActiveProductionRun({
        ...runToApply,
        status: 'applied',
        targetChapterId: result.chapterId,
      });
      void recordProductEvent({
        eventName: 'draft_accept', stage: 'drafting', result: 'success',
        novelId, chapterId: result.chapterId, objectId: runToApply.id,
      }).catch(() => undefined);
      if (chapterWasEmpty) {
        void recordProductEvent({
          eventName: 'first_chapter_accepted', stage: 'drafting', result: 'success',
          novelId, chapterId: result.chapterId, objectId: runToApply.id,
        }).catch(() => undefined);
      }
    } catch (error) {
      void recordProductEvent({
        eventName: 'draft_accept', stage: 'drafting', result: 'failure',
        errorCode: 'APPLY_FAILED', novelId, chapterId: runToApply.targetChapterId, objectId: runToApply.id,
      }).catch(() => undefined);
      setProductionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsApplyingProductionRun(false);
    }
  };

  return {
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
    handleStartProductionRun,
    handleApplyProductionRun,
    stopProductionFlow,
    writingStyleFingerprint,
    sessionCardIds,
  };
}
