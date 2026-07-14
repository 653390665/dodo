import type { ContinuationPack } from '../../../shared/types';
import { mapContinuationPackRow, continuationPackToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';

const continuationPackCrud = createCrudHelpers<ContinuationPack, ReturnType<typeof continuationPackToRow>>({
  tableName: 'continuation_packs',
  rowToEntity: mapContinuationPackRow,
  entityToRow: continuationPackToRow,
  insertColumns: ['id', 'novel_id', 'title', 'status', 'source_documents', 'canon_facts', 'character_states', 'plot_state', 'style_profile', 'contradictions', 'continuation_task', 'source_map', 'reading_questions', 'continuation_gaps', 'source_badge', 'created_at', 'updated_at'],
  updateColumns: ['title', 'status', 'source_documents', 'canon_facts', 'character_states', 'plot_state', 'style_profile', 'contradictions', 'continuation_task', 'source_map', 'reading_questions', 'continuation_gaps', 'source_badge', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'updated_at DESC'
});

export function listContinuationPacks(novelId: string): ContinuationPack[] {
  return continuationPackCrud.list(novelId);
}

export function getContinuationPack(id: string): ContinuationPack | undefined {
  return continuationPackCrud.get(id);
}

export function createContinuationPack(pack: ContinuationPack): void {
  continuationPackCrud.create(pack);
}

export function updateContinuationPack(id: string, data: Partial<ContinuationPack>): boolean {
  return continuationPackCrud.update(id, data);
}

export function deleteContinuationPack(id: string): boolean {
  return continuationPackCrud.delete(id);
}
