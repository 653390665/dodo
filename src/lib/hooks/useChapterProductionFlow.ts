import { useCallback, useRef, useState } from 'react';

import type { Chapter, ChapterMetadata, ChapterProductionRun } from '../../../shared/types';
import { applyChapterProductionRun, startChapterProductionRunStream, type ProductionRunSSEEvent } from '../production-client';
import { getChapter } from '../chapter-client';

interface UseChapterProductionFlowArgs {
  novelId: string;
  currentChapterId?: string;
  continuationPackId?: string;
  flushPendingEditorWrites?: () => Promise<void>;
  refreshChapters: () => Promise<ChapterMetadata[]>;
  setCurrentChapter: React.Dispatch<React.SetStateAction<Chapter | null>>;
  activeEntityNames?: string[];
}

export function useChapterProductionFlow({
  novelId,
  currentChapterId,
  continuationPackId,
  flushPendingEditorWrites,
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
  const fallbackDraftRef = useRef('');
  const modelDraftRef = useRef('');

  const stopProductionFlow = useCallback(() => {
    if (productionAbortRef.current) {
      productionAbortRef.current.abort();
      productionAbortRef.current = null;
    }
    setIsProductionRunning(false);
    setProductionStatusMessage(null);
  }, []);

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
    fallbackDraftRef.current = '';
    modelDraftRef.current = '';

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
      const result = await applyChapterProductionRun(runToApply.id);
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
