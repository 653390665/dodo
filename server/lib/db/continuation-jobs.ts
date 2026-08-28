import type { ContinuationExtractionJob } from '../../../shared/types';
import { getDb, notify, runInTransaction } from '../db-instance.js';
import { continuationExtractionJobToRow, rowToContinuationExtractionJob } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';

const crud = createCrudHelpers<ContinuationExtractionJob, ReturnType<typeof continuationExtractionJobToRow>>({
  tableName: 'continuation_extraction_jobs', rowToEntity: rowToContinuationExtractionJob, entityToRow: continuationExtractionJobToRow,
  insertColumns: ['id','pack_id','novel_id','status','progress','stage_text','batch_cursor','total_batches','result_json','checkpoint_json','error_code','error_message','database_generation','created_at','updated_at'],
  updateColumns: ['status','progress','stage_text','batch_cursor','total_batches','result_json','checkpoint_json','error_code','error_message','database_generation','updated_at'],
  listFilterKey: 'pack_id', listOrderBy: 'updated_at DESC',
});

export const createContinuationExtractionJob = (job: ContinuationExtractionJob): void => crud.create(job);
export const getContinuationExtractionJob = (id: string): ContinuationExtractionJob | undefined => crud.get(id);
export const updateContinuationExtractionJob = (id: string, data: Partial<ContinuationExtractionJob>): boolean => crud.update(id, data);
export const listContinuationExtractionJobsByPack = (packId: string): ContinuationExtractionJob[] => crud.list(packId);

export function markRunningInterrupted(): number {
  return runInTransaction(() => getDb().prepare("UPDATE continuation_extraction_jobs SET status = 'interrupted', updated_at = ? WHERE status IN ('running', 'queued')").run(Date.now()).changes);
}

export function pruneStaleContinuationExtractionJobs(cutoffUpdatedAt: number): number {
  return runInTransaction(() => {
    const changes = getDb()
      .prepare("DELETE FROM continuation_extraction_jobs WHERE updated_at < ? AND status IN ('completed', 'failed', 'interrupted', 'cancelled')")
      .run(cutoffUpdatedAt).changes;
    if (changes > 0) notify();
    return changes;
  });
}
