import type { IdeaFragment } from '../../shared/types';
import { call, callForGeneration } from './db-transport';

export async function listIdeaFragments(novelId?: string): Promise<IdeaFragment[]> { return call('listIdeaFragments', novelId); }
export async function createIdeaFragment(f: IdeaFragment): Promise<void> { return call('createIdeaFragment', f); }
export async function updateIdeaFragment(id: string, data: Partial<IdeaFragment>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('updateIdeaFragment', id, data)
    : callForGeneration(databaseGeneration, 'updateIdeaFragment', id, data);
}
export async function deleteIdeaFragment(id: string): Promise<void> { return call('deleteIdeaFragment', id); }
