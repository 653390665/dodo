import { useEffect, useState } from 'react';

import type { ChapterVersion } from '../../types';
import { listChapterVersions } from '../chapter-client';
import { subscribeToChanges } from '../db-transport';

export function useChapterVersions(currentChapterId?: string) {
  const [versions, setVersions] = useState<ChapterVersion[]>([]);

  useEffect(() => {
    if (!currentChapterId) {
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
