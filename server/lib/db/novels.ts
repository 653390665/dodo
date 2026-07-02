import type { Novel } from '../../../shared/types';
import { rowToNovel, novelToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';

const novelCrud = createCrudHelpers<Novel, ReturnType<typeof novelToRow>>({
  tableName: 'novels',
  rowToEntity: rowToNovel,
  entityToRow: novelToRow,
  insertColumns: [
    'id', 'title', 'author_id', 'summary', 'cover_image', 'status', 'world_rules',
    'global_outline', 'mounted_skill_ids', 'mounted_skill_loadout',
    'project_preference_profile', 'created_at', 'updated_at'
  ],
  updateColumns: [
    'title', 'author_id', 'summary', 'cover_image', 'status', 'world_rules',
    'global_outline', 'mounted_skill_ids', 'mounted_skill_loadout',
    'project_preference_profile', 'updated_at'
  ],
  listOrderBy: 'updated_at DESC'
});

export function listNovels(): Novel[] {
  return novelCrud.list();
}

export function getNovel(id: string): Novel | undefined {
  return novelCrud.get(id);
}

export function createNovel(novel: Novel): void {
  novelCrud.create(novel);
}

export function updateNovel(id: string, data: Partial<Novel>): void {
  novelCrud.update(id, data);
}

export function deleteNovel(id: string): void {
  novelCrud.delete(id);
}
