import type { Novel } from '../../shared/types';
import { call, callForGeneration } from './db-transport';

export async function listNovels(): Promise<Novel[]> { return call('listNovels'); }
export async function getNovel(id: string): Promise<Novel | undefined> { return call('getNovel', id); }
export async function createNovel(novel: Novel): Promise<void> { return call('createNovel', novel); }
export async function createNovelWithChapter(novel: Novel, chapter: import('../../shared/types').Chapter): Promise<void> {
  return call('createNovelWithChapter', novel, chapter);
}
export async function updateNovel(id: string, data: Partial<Novel>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('updateNovel', id, data)
    : callForGeneration(databaseGeneration, 'updateNovel', id, data);
}
export async function deleteNovel(id: string): Promise<void> { return call('deleteNovel', id); }
