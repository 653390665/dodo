import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChapterVersion } from '../../../shared/types';
import { listChapterVersions } from '../chapter-client';
import { subscribeToChanges } from '../db-transport';

export function useChapterVersions(currentChapterId?: string) {
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const requestSequenceRef = useRef(0);

  const refreshVersions = useCallback(async () => {
    const chapterId = currentChapterId;
    const requestSequence = ++requestSequenceRef.current;
    if (!chapterId) {
      setVersions([]);
      return;
    }
    try {
      const nextVersions = await listChapterVersions(chapterId);
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
    const unsubscribe = subscribeToChanges(() => { void refreshVersions(); });
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
