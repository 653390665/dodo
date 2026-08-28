import type { Chapter, ChapterVersion, ChapterMetadata, ChapterWorkflowMeta } from '../../shared/types';
import type { DraftAcceptanceSource } from '../../shared/lib/quality-contract';
import { call, callForGeneration } from './db-transport';

export async function listChapters(novelId: string): Promise<Chapter[]> { return call('listChapters', novelId); }
export async function listChaptersMetadata(novelId: string): Promise<ChapterMetadata[]> { return call('listChaptersMetadata', novelId); }
export async function getChapter(id: string): Promise<Chapter | undefined> { return call('getChapter', id); }
export async function createChapter(chapter: Chapter, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined
    ? call('createChapter', chapter)
    : callForGeneration(databaseGeneration, 'createChapter', chapter);
}
export async function updateChapter(id: string, data: Partial<Chapter>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('updateChapter', id, data)
    : callForGeneration(databaseGeneration, 'updateChapter', id, data);
}
export async function deleteChapter(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('deleteChapter', id)
    : callForGeneration(databaseGeneration, 'deleteChapter', id);
}

export async function listChapterVersions(chapterId: string): Promise<ChapterVersion[]> { return call('listChapterVersions', chapterId); }
export async function createChapterVersion(cv: ChapterVersion, databaseGeneration?: number): Promise<void> {
  if (databaseGeneration === undefined) await call('createChapterVersion', cv);
  else await callForGeneration(databaseGeneration, 'createChapterVersion', cv);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inkflow:chapter-version-created', {
      detail: { chapterId: cv.chapterId },
    }));
  }
}

export async function acceptChapterContentCandidate(input: {
  chapterId: string;
  novelId: string;
  baselineHash: string;
  content: string;
  wordCount: number;
  operation?: 'draft' | 'polish' | 'rewrite';
  source?: DraftAcceptanceSource;
  workflowMeta?: ChapterWorkflowMeta;
  version: ChapterVersion;
}, databaseGeneration: number): Promise<boolean> {
  return callForGeneration(databaseGeneration, 'acceptChapterContentCandidate', input);
}
