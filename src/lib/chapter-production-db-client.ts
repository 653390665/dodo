import type { ChapterProductionRun } from '../types';
import { call } from './db-transport';

export async function listChapterProductionRuns(novelId: string): Promise<ChapterProductionRun[]> { return call('listChapterProductionRuns', novelId); }
export async function getChapterProductionRun(id: string): Promise<ChapterProductionRun | undefined> { return call('getChapterProductionRun', id); }
export async function createChapterProductionRun(run: ChapterProductionRun): Promise<void> { return call('createChapterProductionRun', run); }
export async function updateChapterProductionRun(id: string, data: Partial<ChapterProductionRun>): Promise<void> { return call('updateChapterProductionRun', id, data); }
