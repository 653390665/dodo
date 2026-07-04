import { type Dispatch, type SetStateAction } from 'react';
import type { Novel, Chapter } from '../../../../shared/types';
import { updateNovel } from '../../novel-client';

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
      const response = await fetch('/api/generate-outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: planningPromptSurface,
          title: novel.title,
          worldRules: novel.worldRules,
          seedOutline: globalOutline,
          expectedWordCount,
          chapterOrder: currentChapter ? currentChapter.order : 1,
          ...(selectedContinuationPackId ? { continuationPackId: selectedContinuationPackId } : {}),
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (requestSeqRef.current !== currentSeq) return;

      if (data.outline) {
        setGlobalOutline(data.outline);
        await updateNovel(novel.id, { globalOutline: data.outline });
      } else if (data.error) {
        throw new Error(data.error);
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
