import type { Chapter, ChapterVersion, ChapterMetadata, ChapterWorkflowMeta } from '../../../shared/types';
import { rowToChapter, chapterToRow, rowToChapterVersion, chapterVersionToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';
import { getDb, notify, runInTransaction } from '../db-instance.js';
import { computeChapterWorkflowHash } from '../../../shared/lib/chapter-workflow.js';
import { evaluateDraftAcceptance } from '../../../shared/lib/draft-quality.js';
import type { DraftAcceptanceSource } from '../../../shared/lib/quality-contract.js';

const chapterCrud = createCrudHelpers<Chapter, ReturnType<typeof chapterToRow>>({
  tableName: 'chapters',
  rowToEntity: rowToChapter,
  entityToRow: chapterToRow,
  insertColumns: ['id', 'novel_id', 'volume_name', 'title', 'content', '"order"', 'word_count', 'scene_beats', 'critique', 'workflow_meta', 'created_at', 'updated_at'],
  updateColumns: ['volume_name', 'title', 'content', '"order"', 'word_count', 'scene_beats', 'critique', 'workflow_meta', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: '"order" ASC'
});

export function listChapters(novelId: string): Chapter[] {
  return chapterCrud.list(novelId);
}

export function listChaptersMetadata(novelId: string): ChapterMetadata[] {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = db.prepare('SELECT id, novel_id, volume_name, title, "order", word_count, workflow_meta, created_at, updated_at FROM chapters WHERE novel_id = ? ORDER BY "order" ASC').all(novelId) as any[];

  return rows.map(row => ({
    id: row.id,
    novelId: row.novel_id,
    volumeName: row.volume_name || undefined,
    title: row.title,
    order: row.order,
    wordCount: row.word_count,
    workflowMeta: (() => { try { return row.workflow_meta ? JSON.parse(row.workflow_meta) : undefined; } catch { return undefined; } })(), createdAt: row.created_at,
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

export interface ChapterContentCandidateAcceptance {
  chapterId: string;
  novelId: string;
  baselineHash: string;
  content: string;
  wordCount: number;
  operation?: 'draft' | 'polish' | 'rewrite';
  source?: DraftAcceptanceSource;
  workflowMeta?: ChapterWorkflowMeta;
  version: ChapterVersion;
}

/**
 * Atomically persist the pre-change version and the accepted candidate.
 * The baseline hash prevents a stale preview from overwriting author edits.
 */
export function acceptChapterContentCandidate(input: ChapterContentCandidateAcceptance): boolean {
  const accepted = runInTransaction(() => {
    const existing = chapterCrud.get(input.chapterId);
    if (!existing || existing.novelId !== input.novelId) throw new Error('CHAPTER_CANDIDATE_SCOPE_MISMATCH');
    if (input.version.chapterId !== input.chapterId || input.version.content !== existing.content) {
      throw new Error('CHAPTER_CANDIDATE_SCOPE_MISMATCH');
    }
    const currentHash = computeChapterWorkflowHash(existing.content, existing.sceneBeats);
    if (currentHash !== input.baselineHash) throw new Error('CHAPTER_CANDIDATE_STALE');
    const evaluation = evaluateDraftAcceptance(input.content, {
      source: input.source || 'unknown',
      operation: input.operation || 'rewrite',
      baseline: existing.content,
      semanticReview: input.workflowMeta?.reviewState?.semanticReview,
    });
    if (!evaluation.accepted) {
      throw new Error(`CHAPTER_CANDIDATE_QUALITY_FAILED:${evaluation.reasons.join('；')}`);
    }

    const now = Date.now();
    const contentWordCount = input.content.replace(/\s/g, '').length;
    const baselineWordCount = existing.content.replace(/\s/g, '').length;
    const updated: Chapter = {
      ...existing,
      content: input.content,
      wordCount: contentWordCount,
      ...(input.workflowMeta ? { workflowMeta: input.workflowMeta } : {}),
      updatedAt: now,
    };
    const db = getDb();
    db.prepare(`
      INSERT INTO chapter_versions (id, chapter_id, content, word_count, author, created_at)
      VALUES (@id, @chapter_id, @content, @word_count, @author, @created_at)
    `).run(chapterVersionToRow({
      ...input.version,
      wordCount: baselineWordCount,
    }));
    const row = chapterToRow(updated);
    const result = db.prepare(`
      UPDATE chapters
      SET volume_name=@volume_name, title=@title, content=@content, "order"=@order,
          word_count=@word_count, scene_beats=@scene_beats, critique=@critique,
          workflow_meta=@workflow_meta, updated_at=@updated_at
      WHERE id=@id
    `).run(row);
    if (result.changes === 0) throw new Error('CHAPTER_CANDIDATE_SCOPE_MISMATCH');
    return true;
  });
  if (accepted) notify();
  return accepted;
}
