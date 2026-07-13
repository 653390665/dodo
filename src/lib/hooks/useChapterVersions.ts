import { useEffect, useRef, useState } from 'react';

import type { ChapterVersion } from '../../../shared/types';
import { listChapterVersions } from '../chapter-client';
import { subscribeToChanges } from '../db-transport';

export function useChapterVersions(currentChapterId?: string) {
  const [versions, setVersions] = useState<ChapterVersion[]>([]);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const effectSeq = ++requestSeqRef.current;
    let disposed = false;

    // Never leave versions from the previous chapter visible while the next
    // chapter request is in flight.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset stale chapter-owned data synchronously
    setVersions([]);

    if (!currentChapterId) {
      return () => {
        disposed = true;
        requestSeqRef.current += 1;
      };
    }

    const fetchVersions = async () => {
      const requestSeq = ++requestSeqRef.current;
      try {
        const nextVersions = await listChapterVersions(currentChapterId);
        if (
          disposed
          || effectSeq > requestSeq
          || requestSeq !== requestSeqRef.current
        ) {
          return;
        }

        // The server should already scope this query, but keep the ownership
        // check at the state boundary so a malformed or stale response cannot
        // expose another chapter's versions to the restore UI.
        setVersions(nextVersions.filter((version) => version.chapterId === currentChapterId));
      } catch (error) {
        if (!disposed && requestSeq === requestSeqRef.current) {
          console.warn('[useChapterVersions] Failed to load chapter versions:', error);
          setVersions([]);
        }
      }
    };

    void fetchVersions();
    const unsubscribe = subscribeToChanges(() => {
      void fetchVersions();
    });

    return () => {
      disposed = true;
      requestSeqRef.current += 1;
      unsubscribe();
    };
  }, [currentChapterId]);

  return {
    versions,
  };
}
