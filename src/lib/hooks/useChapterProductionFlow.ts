import { useRef, useState } from 'react';

import type { Chapter, ChapterProductionRun } from '../../../shared/types';
import { applyChapterProductionRun, startChapterProductionRunStream, type ProductionRunSSEEvent } from '../production-client';

interface UseChapterProductionFlowArgs {
  novelId: string;
  currentChapterId?: string;
  continuationPackId?: string;
  cancelPendingContentSync?: () => void;
  refreshChapters: () => Promise<Chapter[]>;
  setCurrentChapter: React.Dispatch<React.SetStateAction<Chapter | null>>;
  activeEntityNames?: string[];
}

export function useChapterProductionFlow({
  novelId,
  currentChapterId,
  continuationPackId,
  cancelPendingContentSync,
  refreshChapters,
  setCurrentChapter,
  activeEntityNames,
}: UseChapterProductionFlowArgs) {
  const [productionIntent, setProductionIntent] = useState('');
  const [activeProductionRun, setActiveProductionRun] = useState<ChapterProductionRun | null>(null);
  const [isProductionRunning, setIsProductionRunning] = useState(false);
  const [isApplyingProductionRun, setIsApplyingProductionRun] = useState(false);
  const [productionError, setProductionError] = useState<string | null>(null);
  const [productionBeatsSource, setProductionBeatsSource] = useState<'fallback' | 'model' | null>(null);
  const [productionDraftSource, setProductionDraftSource] = useState<'fallback' | 'model' | null>(null);
  const [productionAuditSource, setProductionAuditSource] = useState<'fallback' | 'model' | null>(null);
  const [productionStatusMessage, setProductionStatusMessage] = useState<string | null>(null);

  const productionAbortRef = useRef<AbortController | null>(null);
  const productionDraftSourceRef = useRef<'fallback' | 'model' | null>(null);
  const productionCompletedRef = useRef(false);
  const productionHasUsableDraftRef = useRef(false);

  const stopProductionFlow = () => {
    if (productionAbortRef.current) {
      productionAbortRef.current.abort();
      productionAbortRef.current = null;
    }
    setIsProductionRunning(false);
    setProductionStatusMessage(null);
  };

  const handleStartProductionRun = async () => {
    if (productionAbortRef.current) {
      productionAbortRef.current.abort();
    }
    const controller = new AbortController();
    productionAbortRef.current = controller;

    setIsProductionRunning(true);
    setProductionError(null);
    setProductionBeatsSource(null);
    setProductionDraftSource(null);
    productionDraftSourceRef.current = null;
    setProductionAuditSource(null);
    setProductionStatusMessage('正在连接...');
    productionCompletedRef.current = false;
    productionHasUsableDraftRef.current = false;

    setActiveProductionRun({
      id: '',
      novelId,
      status: 'running',
      userIntent: productionIntent,
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    try {
      setProductionStatusMessage('正在准备草稿...');
      const payload = {
        novelId,
        targetChapterId: currentChapterId,
        userIntent: productionIntent,
        continuationPackId: continuationPackId || undefined,
        activeEntityNames,
      };
      await startChapterProductionRunStream(
        payload,
        (event: ProductionRunSSEEvent) => {
          if (productionAbortRef.current !== controller) return;
          switch (event.type) {
            case 'run_created':
              break;
            case 'status':
              setProductionStatusMessage(event.message);
              break;
            case 'fallback_beats':
              setActiveProductionRun((prev) => prev ? { ...prev, sceneBeats: event.content } : prev);
              setProductionBeatsSource('fallback');
              break;
            case 'fallback_draft_token':
              productionHasUsableDraftRef.current = true;
              setActiveProductionRun((prev) => prev ? { ...prev, draftContent: (prev.draftContent || '') + event.content } : prev);
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
            case 'model_draft_token':
              setProductionDraftSource('model');
              productionDraftSourceRef.current = 'model';
              setActiveProductionRun((prev) => prev ? { ...prev, draftContent: (prev.draftContent || '') + event.content } : prev);
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
      if (productionAbortRef.current !== controller) {
        return;
      }
      if (error instanceof Error && error.name === 'AbortError') return;
      setProductionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (productionAbortRef.current === controller) {
        if (!productionCompletedRef.current) {
          if (productionHasUsableDraftRef.current) {
            setActiveProductionRun((prev) =>
              prev && prev.status === 'running'
                ? {
                    ...prev,
                    status: 'review_required',
                    errorMessage: undefined,
                  }
                : prev,
            );
            setProductionError(null);
          } else {
            const message = '生产连接已中断，请直接再次点击"开始生产一章"重试。';
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
        }
        setIsProductionRunning(false);
        setProductionStatusMessage(null);
        productionDraftSourceRef.current = null;
        productionCompletedRef.current = false;
        productionHasUsableDraftRef.current = false;
        productionAbortRef.current = null;
      }
    }
  };

  const handleApplyProductionRun = async (runOverride?: ChapterProductionRun) => {
    const runToApply = runOverride || activeProductionRun;
    if (!runToApply) return;
    setIsApplyingProductionRun(true);
    setProductionError(null);
    cancelPendingContentSync?.();
    try {
      const result = await applyChapterProductionRun(runToApply.id);
      const freshChapters = await refreshChapters();
      setCurrentChapter(
        freshChapters.find((chapter) => chapter.id === result.chapterId) || freshChapters[0] || null,
      );
      setActiveProductionRun({
        ...runToApply,
        status: 'applied',
        targetChapterId: result.chapterId,
      });
    } catch (error) {
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
  };
}
