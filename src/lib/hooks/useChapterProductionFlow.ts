import { useRef, useState } from 'react';

import type { Chapter, ChapterProductionRun } from '../../types';
import { listChapterProductionRuns } from '../chapter-production-db-client';
import { applyChapterProductionRun, startChapterProductionRun } from '../production-client';

interface UseChapterProductionFlowArgs {
  novelId: string;
  currentChapterId?: string;
  continuationPackId?: string;
  cancelPendingContentSync?: () => void;
  refreshChapters: () => Promise<Chapter[]>;
  setCurrentChapter: React.Dispatch<React.SetStateAction<Chapter | null>>;
}

async function waitForReviewableProductionRun({
  novelId,
  targetChapterId,
  startedAt,
  signal,
}: {
  novelId: string;
  targetChapterId?: string;
  startedAt: number;
  signal: AbortSignal;
}): Promise<ChapterProductionRun> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (signal.aborted) {
      throw new DOMException('Production run aborted', 'AbortError');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    const runs = await listChapterProductionRuns(novelId);
    const latest = runs
      .filter((run) => run.createdAt >= startedAt - 1000)
      .filter((run) => !targetChapterId || run.targetChapterId === targetChapterId)
      .filter((run) => run.status === 'review_required' || Boolean(run.draftContent.trim()))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (latest) {
      return latest.status === 'review_required'
        ? latest
        : { ...latest, status: 'review_required', errorMessage: undefined };
    }
  }
  throw new Error('Production run did not become reviewable in time');
}

export function useChapterProductionFlow({
  novelId,
  currentChapterId,
  continuationPackId,
  cancelPendingContentSync,
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
    const startedAt = Date.now();

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
      };
      const run = await Promise.race([
        startChapterProductionRun(payload, controller.signal),
        waitForReviewableProductionRun({
          novelId,
          targetChapterId: currentChapterId,
          startedAt,
          signal: controller.signal,
        }),
      ]);
      if (productionAbortRef.current !== controller) {
        return;
      }
      productionCompletedRef.current = true;
      productionHasUsableDraftRef.current = Boolean(run.draftContent.trim());
      setActiveProductionRun(run);
      setProductionBeatsSource('fallback');
      setProductionDraftSource('fallback');
      productionDraftSourceRef.current = 'fallback';
      setProductionAuditSource('fallback');
      setProductionError(null);
      setProductionStatusMessage(null);
      setIsProductionRunning(false);
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
