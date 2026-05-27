import { useRef, useState } from 'react';

import type { Chapter, ChapterProductionRun } from '../../types';
import { applyChapterProductionRun, startChapterProductionRunStream, type ProductionRunSSEEvent } from '../production-client';

interface UseChapterProductionFlowArgs {
  novelId: string;
  currentChapterId?: string;
  continuationPackId?: string;
  refreshChapters: () => Promise<Chapter[]>;
  setCurrentChapter: React.Dispatch<React.SetStateAction<Chapter | null>>;
}

export function useChapterProductionFlow({
  novelId,
  currentChapterId,
  continuationPackId,
  refreshChapters,
  setCurrentChapter,
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
      await startChapterProductionRunStream(
        {
          novelId,
          targetChapterId: currentChapterId,
          userIntent: productionIntent,
          continuationPackId: continuationPackId || undefined,
        },
        (event: ProductionRunSSEEvent) => {
          switch (event.type) {
            case 'run_created':
              setActiveProductionRun((prev) => (prev ? { ...prev, id: event.runId } : null));
              break;
            case 'status':
              setProductionStatusMessage(event.message);
              break;
            case 'fallback_beats':
              setActiveProductionRun((prev) => (prev ? { ...prev, sceneBeats: event.content } : null));
              setProductionBeatsSource('fallback');
              break;
            case 'fallback_draft_token':
              setActiveProductionRun((prev) => (prev ? { ...prev, draftContent: (prev.draftContent || '') + event.content } : null));
              setProductionDraftSource('fallback');
              productionDraftSourceRef.current = 'fallback';
              break;
            case 'fallback_audit':
              setActiveProductionRun((prev) => (prev ? { ...prev, styleAudit: event.content } : null));
              setProductionAuditSource('fallback');
              break;
            case 'fallback_continuity':
              setActiveProductionRun((prev) => (prev ? { ...prev, continuityReport: event.report } : null));
              break;
            case 'model_beats':
              setActiveProductionRun((prev) => (prev ? { ...prev, sceneBeats: event.content } : null));
              setProductionBeatsSource('model');
              break;
            case 'model_draft_token':
              setActiveProductionRun((prev) => {
                if (!prev) return null;
                const isFirstModelToken = productionDraftSourceRef.current !== 'model';
                return {
                  ...prev,
                  draftContent: isFirstModelToken ? event.content : (prev.draftContent || '') + event.content,
                };
              });
              setProductionDraftSource('model');
              productionDraftSourceRef.current = 'model';
              break;
            case 'model_audit':
              setActiveProductionRun((prev) => (prev ? { ...prev, styleAudit: event.content } : null));
              setProductionAuditSource('model');
              break;
            case 'model_continuity':
              setActiveProductionRun((prev) => (prev ? { ...prev, continuityReport: event.report } : null));
              break;
            case 'done':
              productionCompletedRef.current = true;
              setActiveProductionRun(event.run);
              setProductionStatusMessage(null);
              setIsProductionRunning(false);
              break;
            case 'error':
              productionCompletedRef.current = true;
              setProductionError(event.message);
              setActiveProductionRun((prev) =>
                prev
                  ? {
                      ...prev,
                      status: 'failed',
                      errorMessage: event.message,
                    }
                  : prev,
              );
              setIsProductionRunning(false);
              break;
            default:
              break;
          }
        },
        controller.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setProductionError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!productionCompletedRef.current) {
        const message = '生产连接已中断，请直接再次点击“开始生产一章”重试。';
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
      if (productionAbortRef.current === controller) {
        productionAbortRef.current = null;
      }
    }
  };

  const handleApplyProductionRun = async () => {
    if (!activeProductionRun) return;
    setIsApplyingProductionRun(true);
    setProductionError(null);
    try {
      const result = await applyChapterProductionRun(activeProductionRun.id);
      const freshChapters = await refreshChapters();
      setCurrentChapter(
        freshChapters.find((chapter) => chapter.id === result.chapterId) || freshChapters[0] || null,
      );
      setActiveProductionRun({
        ...activeProductionRun,
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
