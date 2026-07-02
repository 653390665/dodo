import type { ChapterProductionRun } from '../../../shared/types';
import { rowToChapterProductionRun, chapterProductionRunToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';

const chapterProductionRunCrud = createCrudHelpers<ChapterProductionRun, ReturnType<typeof chapterProductionRunToRow>>({
  tableName: 'chapter_production_runs',
  rowToEntity: rowToChapterProductionRun,
  entityToRow: chapterProductionRunToRow,
  insertColumns: ['id', 'novel_id', 'target_chapter_id', 'status', 'user_intent', 'scene_beats', 'draft_content', 'style_audit', 'continuity_report', 'error_message', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'target_chapter_id', 'status', 'user_intent', 'scene_beats', 'draft_content', 'style_audit', 'continuity_report', 'error_message', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at DESC'
});

export function listChapterProductionRuns(novelId: string): ChapterProductionRun[] {
  return chapterProductionRunCrud.list(novelId);
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
