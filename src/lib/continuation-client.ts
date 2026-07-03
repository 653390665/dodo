import type { ContinuationPack } from '../../shared/types';
import { call } from './db-transport';

export async function listContinuationPacks(novelId: string): Promise<ContinuationPack[]> {
  return call('listContinuationPacks', novelId);
}

export async function updateContinuationPack(id: string, data: Partial<ContinuationPack>): Promise<void> {
  return call('updateContinuationPack', id, data);
}

export async function deleteContinuationPack(id: string): Promise<void> {
  return call('deleteContinuationPack', id);
}
