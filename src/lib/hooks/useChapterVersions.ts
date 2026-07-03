import { useEffect, useState } from 'react';

import type { ChapterVersion } from '../../../shared/types';
import { listChapterVersions } from '../chapter-client';
import { subscribeToChanges } from '../db-transport';

export function useChapterVersions(currentChapterId?: string) {
  const [versions, setVersions] = useState<ChapterVersion[]>([]);

  useEffect(() => {
    if (!currentChapterId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state when chapter cleared
      setVersions([]);
      return;
    }

    const fetchVersions = async () => {
      setVersions(await listChapterVersions(currentChapterId));
    };

    fetchVersions();
    return subscribeToChanges(fetchVersions);
  }, [currentChapterId]);

  return {
    versions,
  };
}
