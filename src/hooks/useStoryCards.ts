import { useState, useEffect, useRef, useCallback } from 'react';
import { generateStoryCards, checkStoryCardJob, cancelStoryCardJob } from '../lib/prompt-client';
import type { StoryIdeaCard, StoryPlanningInput } from '../../shared/types';
import type { ContentSource } from '../components/SourceBadge';

export interface StoryCardsState {
  cards: StoryIdeaCard[];
  source: ContentSource | null;
  /** True while the initial HTTP request is in-flight (fallback hasn't arrived yet). */
  isWaiting: boolean;
  /** True while a model job is still running in the background. */
  isModelPending: boolean;
  warnings: string[];
}

interface UseStoryCardsOptions {
  planning: StoryPlanningInput;
  chatContext: string;
}

/**
 * Encapsulates the fallback + replacement lifecycle for story cards:
 *   1. POST /api/story-cards → fallback (or model) arrives within ~2s
 *   2. If fallback + jobId → poll GET /api/story-cards/jobs/:jobId every 5s
 *   3. On model complete → replace cards, update source badge
 *   4. On model fail → keep fallback, show error
 *   5. Cleanup poller on unmount
 */
export function useStoryCards({ planning, chatContext }: UseStoryCardsOptions) {
  const [state, setState] = useState<StoryCardsState>({
    cards: [],
    source: null,
    isWaiting: false,
    isModelPending: false,
    warnings: [],
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const chatContextRef = useRef(chatContext);

  // Sync chatContext inside an effect to prevent React 19 concurrent render-phase side effects
  useEffect(() => {
    chatContextRef.current = chatContext;
  }, [chatContext]);

  // Cleanup poller on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (activeJobIdRef.current) void cancelStoryCardJob(activeJobIdRef.current).catch(() => {});
    };
  }, []);

  const clearPoller = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    activeJobIdRef.current = null;
  }, []);

  const submit = useCallback(
    async (ideaSeed: string) => {
      if (activeJobIdRef.current) {
        void cancelStoryCardJob(activeJobIdRef.current).catch(() => {});
      }
      clearPoller();

      setState((prev) => ({
        ...prev,
        isWaiting: true,
        isModelPending: false,
        warnings: [],
      }));

      try {
        const { cards, source, jobId, warnings: w } = await generateStoryCards({
          ideaSeed,
          chatContext: chatContextRef.current,
          planning,
        });

        const isFallback = source === 'fallback';
        const hasModelJob = isFallback && !!jobId;

        setState({
          cards,
          source: (source as ContentSource) || null,
          isWaiting: false,
          isModelPending: hasModelJob,
          warnings: w || [],
        });

        // Update chat context for conversation continuity
        chatContextRef.current = chatContextRef.current + '\n' + ideaSeed;

        // Start polling if we have a background model job
        if (hasModelJob && jobId) {
          activeJobIdRef.current = jobId;
          pollRef.current = setInterval(async () => {
            try {
              const job = await checkStoryCardJob(jobId);
              if (job.status === 'completed' && job.cards?.length) {
                setState((prev) => ({
                  ...prev,
                  cards: job.cards!,
                  source: 'model',
                  isModelPending: false,
                  warnings: ['模型版已返回，已自动替换本地保底草案。'],
                }));
                clearPoller();
              }
              if (job.status === 'failed') {
                setState((prev) => ({
                  ...prev,
                  isModelPending: false,
                  warnings: [`模型版生成失败：${job.error || '未知错误'}`],
                }));
                clearPoller();
              }
            } catch {
              // Polling error — stop polling but keep current cards
              setState((prev) => ({ ...prev, isModelPending: false }));
              clearPoller();
            }
          }, 5000);
        }
        return true;
      } catch (err) {
        setState((prev) => ({
          ...prev,
          isWaiting: false,
          isModelPending: false,
          warnings: [err instanceof Error ? err.message : '生成故事卡失败'],
        }));
        return false;
      }
    },
    [planning, clearPoller],
  );

  return { ...state, submit };
}
