import type { ChapterProductionRun } from '../../shared/types';
import { call } from './db-transport';

export async function listChapterProductionRuns(novelId: string): Promise<ChapterProductionRun[]> { return call('listChapterProductionRuns', novelId); }
export async function getChapterProductionRun(id: string): Promise<ChapterProductionRun | undefined> { return call('getChapterProductionRun', id); }
