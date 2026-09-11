import { useCallback, useEffect, useRef, useState } from 'react';

import { listChapterVersionMetas, type ChapterVersionMeta } from '../chapter-client';
import { subscribeToChanges } from '../db-transport';

export function useChapterVersions(currentChapterId?: string) {
  const [versions, setVersions] = useState<ChapterVersionMeta[]>([]);
  const requestSequenceRef = useRef(0);

  const refreshVersions = useCallback(async () => {
    const chapterId = currentChapterId;
    const requestSequence = ++requestSequenceRef.current;
    if (!chapterId) {
      setVersions([]);
      return;
    }
    try {
      // 183：列表只拉投影（不含整章 content），正文在回滚时按 id 单条取。
      const nextVersions = await listChapterVersionMetas(chapterId);
      if (requestSequence === requestSequenceRef.current) {
        setVersions(nextVersions);
      }
    } catch (error) {
      if (requestSequence === requestSequenceRef.current) {
        console.error('[useChapterVersions] Failed to load versions:', error);
      }
    }
  }, [currentChapterId]);

  useEffect(() => {
    requestSequenceRef.current += 1;
    if (!currentChapterId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state when chapter cleared
      setVersions([]);
      return;
    }

    // Never render chapter A's versions beneath chapter B while B is loading.
    setVersions([]);
    void refreshVersions();
    const unsubscribe = subscribeToChanges(() => {
      void refreshVersions();
    });
    const handleLocalVersion = (event: Event) => {
      const chapterId = (event as CustomEvent<{ chapterId?: string }>).detail?.chapterId;
      if (chapterId === currentChapterId) void refreshVersions();
    };
    window.addEventListener('inkflow:chapter-version-created', handleLocalVersion);

    return () => {
      requestSequenceRef.current += 1;
      unsubscribe();
      window.removeEventListener('inkflow:chapter-version-created', handleLocalVersion);
    };
  }, [currentChapterId, refreshVersions]);

  return {
    versions,
    refreshVersions,
  };
}
