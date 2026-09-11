import type { ChapterProductionRun } from '../../shared/types';
import { call } from './db-transport';

export async function listChapterProductionRuns(novelId: string): Promise<ChapterProductionRun[]> {
  return call('listChapterProductionRuns', novelId);
}
export async function getChapterProductionRun(
  id: string
): Promise<ChapterProductionRun | undefined> {
  return call('getChapterProductionRun', id);
}

export interface ChapterProductionRunBadge {
  id: string;
  status: string;
  targetChapterId: string | null;
}

/** Lightweight badge projection (review_required runs only, no draft content). */
export async function listChapterProductionRunBadges(
  novelId: string
): Promise<ChapterProductionRunBadge[]> {
  return call('listChapterProductionRunBadges', novelId);
}
