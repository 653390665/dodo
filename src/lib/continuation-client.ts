import type { ContinuationConflictResolution, ContinuationPack, Novel } from '../../shared/types';
import { call } from './db-transport';

export async function listContinuationPacks(novelId: string): Promise<ContinuationPack[]> {
  return call('listContinuationPacks', novelId);
}

export async function updateContinuationPack(id: string, data: Partial<ContinuationPack>): Promise<boolean> {
  return call('updateContinuationPack', id, data);
}

export async function deleteContinuationPack(id: string): Promise<boolean> {
  return call('deleteContinuationPack', id);
}

export async function approveContinuationImport(payload: {
  packId: string;
  mode: 'existing' | 'new';
  existingNovelId?: string;
  newNovel?: { title: string; summary: string };
  conflictResolutions: ContinuationConflictResolution[];
}): Promise<{ novel: Novel; pack: ContinuationPack }> {
  const response = await fetch('/api/continuation-packs/approve-import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as {
    novel?: Novel;
    pack?: ContinuationPack;
    error?: string;
  };
  if (!response.ok || !data.novel || !data.pack) {
    throw new Error(data.error || '确认续写资料导入失败');
  }
  return { novel: data.novel, pack: data.pack };
}
