import { type Dispatch, type SetStateAction } from 'react';
import type { Novel, Chapter } from '../../../../shared/types';
import { updateNovel } from '../../novel-client';
import { startWorldJob } from '../../world-job-client';

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
  setGlobalOutline: Dispatch<SetStateAction<string>>;
  flushPendingEditorWrites: () => Promise<void>;
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
  setGlobalOutline,
  flushPendingEditorWrites,
}: UseOutlineGenerationArgs) {
  const handleGenerateOutline = async () => {
    const currentSeq = ++requestSeqRef.current;
    const controller = new AbortController();

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = controller;

    setIsGeneratingOutline(true);
    try {
      await flushPendingEditorWrites();
      if (requestSeqRef.current !== currentSeq) return;

      const { result: data, databaseGeneration } = await startWorldJob<{ outline: string }>('/api/generate-outline', {
          novelId: novel.id,
          surface: planningPromptSurface,
          title: novel.title,
          worldRules: novel.worldRules,
          seedOutline: globalOutline,
          expectedWordCount,
          chapterOrder: currentChapter ? currentChapter.order : 1,
          ...(selectedContinuationPackId ? { continuationPackId: selectedContinuationPackId } : {}),
        }, {}, controller.signal);
      if (requestSeqRef.current !== currentSeq) return;

      if (data.outline) {
        const updated = await updateNovel(novel.id, { globalOutline: data.outline }, databaseGeneration);
        if (requestSeqRef.current !== currentSeq) return;
        if (!updated) throw new Error('作品已不存在，大纲未保存。');
        setGlobalOutline(data.outline);
      } else {
        throw new Error('大纲生成结果为空');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      alert('大纲生成失败');
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
