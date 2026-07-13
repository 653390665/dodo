import type { Chapter, ChapterVersion, ChapterMetadata } from '../../../shared/types';
import { rowToChapter, chapterToRow, rowToChapterVersion, chapterVersionToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';
import { getDb } from '../db-instance.js';

const chapterCrud = createCrudHelpers<Chapter, ReturnType<typeof chapterToRow>>({
  tableName: 'chapters',
  rowToEntity: rowToChapter,
  entityToRow: chapterToRow,
  insertColumns: ['id', 'novel_id', 'volume_name', 'title', 'content', '"order"', 'word_count', 'scene_beats', 'critique', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'volume_name', 'title', 'content', '"order"', 'word_count', 'scene_beats', 'critique', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: '"order" ASC'
});

export function listChapters(novelId: string): Chapter[] {
  return chapterCrud.list(novelId);
}

export function listChaptersMetadata(novelId: string): ChapterMetadata[] {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = db.prepare('SELECT id, novel_id, volume_name, title, "order", word_count, created_at, updated_at FROM chapters WHERE novel_id = ? ORDER BY "order" ASC').all(novelId) as any[];

  return rows.map(row => ({
    id: row.id,
    novelId: row.novel_id,
    volumeName: row.volume_name || undefined,
    title: row.title,
    order: row.order,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function getChapter(id: string): Chapter | undefined {
  return chapterCrud.get(id);
}

export function createChapter(chapter: Chapter): void {
  chapterCrud.create(chapter);
}

export function updateChapter(id: string, data: Partial<Chapter>): boolean {
  return chapterCrud.update(id, data);
}

export function deleteChapter(id: string): boolean {
  return chapterCrud.delete(id);
}

const chapterVersionCrud = createCrudHelpers<ChapterVersion, ReturnType<typeof chapterVersionToRow>>({
  tableName: 'chapter_versions',
  rowToEntity: rowToChapterVersion,
  entityToRow: chapterVersionToRow,
  insertColumns: ['id', 'chapter_id', 'content', 'word_count', 'author', 'created_at'],
  updateColumns: [],
  listFilterKey: 'chapter_id',
  listOrderBy: 'created_at DESC'
});

export function listChapterVersions(chapterId: string): ChapterVersion[] {
  return chapterVersionCrud.list(chapterId);
}

export function createChapterVersion(cv: ChapterVersion): void {
  chapterVersionCrud.create(cv);
}
