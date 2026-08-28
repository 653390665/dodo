import { type Dispatch, type SetStateAction } from 'react';
import type { Novel, Chapter } from '../../../../shared/types';
import { createOutline } from '../../outline-client';
import { startWorldJob } from '../../world-job-client';
import { toast } from '../../toast';
import { createAiActionError, createAiActionRunning, createAiActionSuccess, idleAiAction, type AiActionState } from '../../generation-action-state';

interface UseOutlineGenerationArgs {
  novel: Novel;
  globalOutline: string;
  expectedWordCount: number | '';
  currentChapter: Chapter | null;
  selectedContinuationPackId: string;
  planningPromptSurface: string;
  requestSeqRef: { current: number };
  abortControllerRef: { current: AbortController | null };
  setIsGeneratingOutline: (val: boolean) => void;
  setOutlineError?: (message: string | null) => void;
  setAiActionState?: Dispatch<SetStateAction<AiActionState>>;
  setGlobalOutline: Dispatch<SetStateAction<string>>;
  flushPendingEditorWrites: () => Promise<void>;
}

export interface OutlineGenerationOptions {
  techniqueId?: string;
  outlineSourceSelection?: {
    continuationPackId: string;
    primaryDocumentId: string;
    referenceDocumentIds: string[];
  };
}

function describeOutlineFailure(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '未知错误');
  if (/OUTLINE_TIMEOUT|timed out|timeout|超时/i.test(raw)) return '生成超时，请缩短资料或稍后重试';
  if (/context|too long|token|budget|上下文|过长|413/i.test(raw)) return '输入资料过长，请缩短大纲或资料后重试';
  if (/save|保存|不存在|未生效/i.test(raw)) return `保存失败：${raw}`;
  if (/api key|key not configured|配置|401|403/i.test(raw)) return '模型配置不可用，请检查 API Key、模型和 Base URL';
  return raw;
}

export function useOutlineGeneration({
  novel,
  globalOutline,
  expectedWordCount,
  currentChapter,
  selectedContinuationPackId,
  planningPromptSurface,
  requestSeqRef,
  abortControllerRef,
  setIsGeneratingOutline,
  setOutlineError,
  setAiActionState: providedSetAiActionState,
  flushPendingEditorWrites,
}: UseOutlineGenerationArgs) {
  const setAiActionState = providedSetAiActionState ?? (() => undefined);
  const setAiActionStateForRequest = (requestSeq: number, state: SetStateAction<AiActionState>) => {
    if (requestSeqRef.current === requestSeq) setAiActionState(state);
  };
  const handleGenerateOutline = async (
    outlineOverride?: string,
    options?: OutlineGenerationOptions,
  ) => {
    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    setIsGeneratingOutline(true);
    setOutlineError?.(null);
    setAiActionState(createAiActionRunning('outline'));
    try {
      await flushPendingEditorWrites();
      if (requestSeqRef.current !== currentSeq) return;

      const { result: data, databaseGeneration } = await startWorldJob<{ outline: string }>('/api/generate-outline', {
          novelId: novel.id,
          surface: planningPromptSurface,
          title: novel.title,
          worldRules: novel.worldRules,
          seedOutline: outlineOverride ?? globalOutline,
          expectedWordCount,
          chapterOrder: currentChapter ? currentChapter.order : 1,
          ...(selectedContinuationPackId && !options?.outlineSourceSelection
            ? { continuationPackId: selectedContinuationPackId }
            : {}),
          ...(options?.techniqueId ? { techniqueId: options.techniqueId } : {}),
          ...(options?.outlineSourceSelection
            ? { outlineSourceSelection: options.outlineSourceSelection }
            : {}),
        }, {}, controller.signal);
      if (requestSeqRef.current !== currentSeq) return;

      if (data.outline) {
        const candidate = await createOutline(novel.id, {
          level: 'master',
          scope: {},
          content: data.outline,
          source: 'ai-proposal',
          databaseGeneration,
        });
        if (requestSeqRef.current !== currentSeq || controller.signal.aborted) return;
        setAiActionStateForRequest(currentSeq, (state) => createAiActionSuccess(state, '全书大纲候选已生成，可预览后采纳。'));
        return {
          candidateId: candidate.id,
          content: data.outline,
          databaseGeneration,
        };
      } else {
        throw new Error('大纲生成结果为空');
      }
    } catch (error) {
      if (requestSeqRef.current !== currentSeq) return;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        setAiActionStateForRequest(currentSeq, idleAiAction());
        return;
      }
      const message = describeOutlineFailure(error);
      setAiActionStateForRequest(currentSeq, (state) => createAiActionError(state, `大纲生成失败：${message}。原大纲未被修改，可重试。`));
      setOutlineError?.(`大纲生成失败：${message}。原大纲未被修改，可重试。`);
      toast(`大纲生成失败：${message}`, 'error');
    } finally {
      if (requestSeqRef.current === currentSeq) {
        setIsGeneratingOutline(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    }
  };

  return { handleGenerateOutline };
}
