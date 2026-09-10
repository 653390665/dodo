import type { ChapterProductionRun } from '../../../shared/types';
import { rowToChapterProductionRun, chapterProductionRunToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';
import { getDb } from '../db-instance.js';

const chapterProductionRunCrud = createCrudHelpers<ChapterProductionRun, ReturnType<typeof chapterProductionRunToRow>>({
  tableName: 'chapter_production_runs',
  rowToEntity: rowToChapterProductionRun,
  entityToRow: chapterProductionRunToRow,
  insertColumns: ['id', 'novel_id', 'target_chapter_id', 'status', 'user_intent', 'scene_beats', 'draft_content', 'style_audit', 'continuity_report', 'error_message', 'created_at', 'updated_at'],
  updateColumns: ['target_chapter_id', 'status', 'user_intent', 'scene_beats', 'draft_content', 'style_audit', 'continuity_report', 'error_message', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at DESC'
});

export function listChapterProductionRuns(novelId: string): ChapterProductionRun[] {
  return chapterProductionRunCrud.list(novelId);
}

export interface ChapterProductionRunBadge { id: string; status: string; targetChapterId: string | null; }

/**
 * Lightweight projection for editor badges: only pending-review runs, without
 * the heavy draft/continuity columns. Backed by idx_chapter_production_runs_novel.
 */
export function listChapterProductionRunBadges(novelId: string): ChapterProductionRunBadge[] {
  const rows = getDb().prepare(
    `SELECT id, status, target_chapter_id FROM chapter_production_runs WHERE novel_id = ? AND status = 'review_required' ORDER BY created_at DESC`
  ).all(novelId) as Array<{ id: string; status: string; target_chapter_id: string | null }>;
  return rows.map((r) => ({ id: r.id, status: r.status, targetChapterId: r.target_chapter_id }));
}

/**
 * Ids of applied runs targeting one chapter, newest first. Lets callers run
 * the full draft-content comparison on just these candidates via
 * getChapterProductionRun instead of loading every run's draft for the novel.
 */
export function listAppliedChapterProductionRunIds(novelId: string, targetChapterId: string): string[] {
  const rows = getDb().prepare(
    `SELECT id FROM chapter_production_runs WHERE novel_id = ? AND target_chapter_id = ? AND status = 'applied' ORDER BY created_at DESC`
  ).all(novelId, targetChapterId) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

export function getChapterProductionRun(id: string): ChapterProductionRun | undefined {
  return chapterProductionRunCrud.get(id);
}

export function createChapterProductionRun(run: ChapterProductionRun): void {
  chapterProductionRunCrud.create(run);
}

export function updateChapterProductionRun(id: string, data: Partial<ChapterProductionRun>): void {
  chapterProductionRunCrud.update(id, data);
}
