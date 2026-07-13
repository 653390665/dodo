import type { Chapter, ChapterVersion, ChapterMetadata } from '../../shared/types';
import { call } from './db-transport';

export async function listChapters(novelId: string): Promise<Chapter[]> { return call('listChapters', novelId); }
export async function listChaptersMetadata(novelId: string): Promise<ChapterMetadata[]> { return call('listChaptersMetadata', novelId); }
export async function getChapter(id: string): Promise<Chapter | undefined> { return call('getChapter', id); }
export async function createChapter(chapter: Chapter): Promise<void> { return call('createChapter', chapter); }
export async function updateChapter(id: string, data: Partial<Chapter>): Promise<boolean> { return call('updateChapter', id, data); }
export async function deleteChapter(id: string): Promise<boolean> { return call('deleteChapter', id); }

export async function listChapterVersions(chapterId: string): Promise<ChapterVersion[]> { return call('listChapterVersions', chapterId); }
export async function createChapterVersion(cv: ChapterVersion): Promise<void> {
  await call('createChapterVersion', cv);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('inkflow:chapter-version-created', {
      detail: { chapterId: cv.chapterId },
    }));
  }
}
