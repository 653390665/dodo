import type { Foreshadowing } from '../../shared/types';
import { call, callForGeneration } from './db-transport';

export async function listForeshadowings(novelId: string): Promise<Foreshadowing[]> { return call('listForeshadowings', novelId); }
export async function createForeshadowing(f: Foreshadowing, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createForeshadowing', f) : callForGeneration(databaseGeneration, 'createForeshadowing', f);
}
export async function createForeshadowingsBatch(items: Foreshadowing[], databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined
    ? call('createForeshadowingsBatch', items)
    : callForGeneration(databaseGeneration, 'createForeshadowingsBatch', items);
}
export async function updateForeshadowing(id: string, data: Partial<Foreshadowing>): Promise<void> { return call('updateForeshadowing', id, data); }
export async function deleteForeshadowing(id: string): Promise<void> { return call('deleteForeshadowing', id); }
