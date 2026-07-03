import type { IdeaFragment, Foreshadowing } from '../../../shared/types';
import { getDb } from '../db-instance.js';
import { rowToIdeaFragment, ideaFragmentToRow, rowToForeshadowing, foreshadowingToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';

const ideaFragmentCrud = createCrudHelpers<IdeaFragment, ReturnType<typeof ideaFragmentToRow>>({
  tableName: 'idea_fragments',
  rowToEntity: rowToIdeaFragment,
  entityToRow: ideaFragmentToRow,
  insertColumns: ['id', 'novel_id', 'content', 'type', 'status', 'ai_expansion', 'target_chapter_id', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'content', 'type', 'status', 'ai_expansion', 'target_chapter_id', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at DESC'
});

export function listIdeaFragments(novelId?: string): IdeaFragment[] {
  if (novelId) {
    return getDb().prepare('SELECT * FROM idea_fragments WHERE novel_id = ? OR novel_id IS NULL ORDER BY created_at DESC').all(novelId).map(rowToIdeaFragment);
  }
  return ideaFragmentCrud.list();
}

export function createIdeaFragment(f: IdeaFragment): void {
  ideaFragmentCrud.create(f);
}

export function updateIdeaFragment(id: string, data: Partial<IdeaFragment>): void {
  ideaFragmentCrud.update(id, data);
}

export function deleteIdeaFragment(id: string): void {
  ideaFragmentCrud.delete(id);
}

const foreshadowingCrud = createCrudHelpers<Foreshadowing, ReturnType<typeof foreshadowingToRow>>({
  tableName: 'foreshadowings',
  rowToEntity: rowToForeshadowing,
  entityToRow: foreshadowingToRow,
  insertColumns: ['id', 'novel_id', 'title', 'description', 'status', 'planted_chapter_id', 'payoff_chapter_id', 'related_character_ids', 'notes', 'created_at', 'updated_at'],
  updateColumns: ['title', 'description', 'status', 'planted_chapter_id', 'payoff_chapter_id', 'related_character_ids', 'notes', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'created_at ASC'
});

export function listForeshadowings(novelId: string): Foreshadowing[] {
  return foreshadowingCrud.list(novelId);
}

export function getForeshadowing(id: string): Foreshadowing | undefined {
  return foreshadowingCrud.get(id);
}

export function createForeshadowing(f: Foreshadowing): void {
  foreshadowingCrud.create(f);
}

export function updateForeshadowing(id: string, data: Partial<Foreshadowing>): void {
  foreshadowingCrud.update(id, data);
}

export function deleteForeshadowing(id: string): void {
  foreshadowingCrud.delete(id);
}
