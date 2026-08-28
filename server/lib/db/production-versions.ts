import type { ChapterProductionRunVersion } from '../../../shared/types';
import { createCrudHelpers } from '../db-crud.js';
import { chapterProductionRunVersionToRow, rowToChapterProductionRunVersion } from '../db-mappers.js';
import { getDb } from '../db-instance.js';

const crud = createCrudHelpers<ChapterProductionRunVersion, ReturnType<typeof chapterProductionRunVersionToRow>>({
  tableName: 'chapter_production_run_versions', rowToEntity: rowToChapterProductionRunVersion, entityToRow: chapterProductionRunVersionToRow,
  insertColumns: ['id','run_id','novel_id','target_chapter_id','source','scene_beats','draft_content','style_audit','continuity_report','content_hash','created_at'],
  updateColumns: ['target_chapter_id','source','scene_beats','draft_content','style_audit','continuity_report','content_hash'],
});
export const createChapterProductionRunVersion = (version: ChapterProductionRunVersion): void => crud.create(version);
export const getChapterProductionRunVersion = (id: string): ChapterProductionRunVersion | undefined => crud.get(id);
export function listChapterProductionRunVersions(runId: string): ChapterProductionRunVersion[] {
  return (getDb().prepare('SELECT * FROM chapter_production_run_versions WHERE run_id = ? ORDER BY created_at DESC, rowid DESC').all(runId) as unknown[]).map(rowToChapterProductionRunVersion);
}
