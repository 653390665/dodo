import type { ContinuationConflictResolution, ContinuationPack, Novel } from '../../shared/types';
import type { SyncExtractionResult } from '../../shared/lib/sync-extract-prompt';
import { call, getDatabaseGenerationSnapshot } from './db-transport';

export async function listContinuationPacks(novelId: string): Promise<ContinuationPack[]> {
  return call('listContinuationPacks', novelId);
}

export async function updateContinuationPack(id: string, data: { continuationTask?: string }): Promise<boolean> {
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

export interface SyncToWorldRequest {
  packId: string;
  novelId: string;
  databaseGeneration: number;
  characters: Array<{ name: string; role: string; summary: string; bio: string; traits: string[] }>;
  locations: Array<{ name: string; region: string; description: string }>;
  items: Array<{ name: string; type: string; description: string }>;
  factions: Array<{ name: string; leader: string; territory: string; description: string }>;
  powerLevels: Array<{ name: string; tier: number; characteristics: string; description: string }>;
  timelineEvents: Array<{ title: string; timestamp: string; description: string; order: number }>;
  relationships: Array<{ sourceName: string; sourceType: string; targetName: string; targetType: string; relationshipType: string; description: string }>;
  globalOutline?: string;
  worldRules?: string;
}

export interface SyncResult {
  created: { characters: number; locations: number; items: number; factions: number; powerLevels: number; timelineEvents: number; relationships: number };
  skipped: { characters: number; locations: number; items: number; factions: number };
}

export async function syncPackToWorld(data: SyncToWorldRequest): Promise<SyncResult> {
  const res = await fetch('/api/continuation-packs/sync-to-world', {
    method: 'POST',
    body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<SyncResult>;
}

export interface ExtractionSnapshot {
  packId: string;
  novelId: string;
  databaseGeneration: number;
  extraction: SyncExtractionResult;
}

export async function extractPackEntities(packId: string, novelId: string, signal?: AbortSignal): Promise<ExtractionSnapshot> {
  const databaseGeneration = await getDatabaseGenerationSnapshot();
  const res = await fetch('/api/continuation-packs/extract-entities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ packId, novelId, databaseGeneration }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<ExtractionSnapshot>;
}
