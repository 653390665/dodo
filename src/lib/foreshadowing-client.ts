import type { Foreshadowing } from '../../shared/types';
import { call } from './db-transport';

export async function listForeshadowings(novelId: string): Promise<Foreshadowing[]> { return call('listForeshadowings', novelId); }
export async function createForeshadowing(f: Foreshadowing): Promise<void> { return call('createForeshadowing', f); }
export async function updateForeshadowing(id: string, data: Partial<Foreshadowing>): Promise<void> { return call('updateForeshadowing', id, data); }
export async function deleteForeshadowing(id: string): Promise<void> { return call('deleteForeshadowing', id); }
