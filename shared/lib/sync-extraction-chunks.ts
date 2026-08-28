import type { SyncExtractionResult } from './sync-extract-prompt';

export const SYNC_EXTRACTION_CHUNK_CHAR_BUDGET = 30_000;
export const SYNC_EXTRACTION_MAX_CHUNKS = 100;

export interface SyncExtractionChunk {
  index: number;
  sourceDocumentId: string;
  filename: string;
  text: string;
}

export class SyncExtractionChunkLimitError extends Error {
  readonly code = 'EXTRACTION_TOO_LARGE';

  constructor(public readonly chunkCount: number) {
    super(`资料过大，需要拆分资料后重试（预计 ${chunkCount} 批，最多 ${SYNC_EXTRACTION_MAX_CHUNKS} 批）`);
    this.name = 'SyncExtractionChunkLimitError';
  }
}

export function buildSyncExtractionChunks(
  documents: Array<{ id?: string; filename: string; text: string }>,
  budget = SYNC_EXTRACTION_CHUNK_CHAR_BUDGET,
  maxChunks = SYNC_EXTRACTION_MAX_CHUNKS,
): SyncExtractionChunk[] {
  if (!Number.isInteger(budget) || budget < 1) throw new Error('EXTRACTION_INVALID_CHUNK_BUDGET');
  const chunks: SyncExtractionChunk[] = [];
  for (const document of documents) {
    const text = document.text.trim();
    if (!text) continue;
    for (let offset = 0; offset < text.length; offset += budget) {
      chunks.push({
        index: chunks.length,
        sourceDocumentId: document.id || document.filename,
        filename: document.filename,
        text: text.slice(offset, offset + budget),
      });
      if (chunks.length > maxChunks) throw new SyncExtractionChunkLimitError(chunks.length);
    }
  }
  return chunks;
}

function normalizeName(value: string): string {
  return value.trim().normalize('NFC').toLowerCase();
}

function mergeEntityArray<T>(items: T[], getKey: (item: T) => string): T[] {
  const result: T[] = [];
  const byName = new Map<string, T>();
  for (const item of items) {
    const key = normalizeName(getKey(item));
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      const copy = { ...item };
      byName.set(key, copy);
      result.push(copy);
      continue;
    }
    for (const [field, value] of Object.entries(item as Record<string, unknown>)) {
      if (value == null) continue;
      const previous = existing[field as keyof T];
      if (Array.isArray(previous) && Array.isArray(value)) {
        (existing as Record<string, unknown>)[field] = [...new Set([...previous, ...value])];
      } else if ((previous === '' || previous == null) && value !== '') {
        (existing as Record<string, unknown>)[field] = value;
      }
    }
  }
  return result;
}

export function mergeSyncExtractionResults(results: SyncExtractionResult[]): SyncExtractionResult {
  const merged: SyncExtractionResult = {
    characters: mergeEntityArray(results.flatMap(result => result.characters), item => item.name),
    locations: mergeEntityArray(results.flatMap(result => result.locations), item => item.name),
    items: mergeEntityArray(results.flatMap(result => result.items), item => item.name),
    factions: mergeEntityArray(results.flatMap(result => result.factions), item => item.name),
    powerLevels: mergeEntityArray(results.flatMap(result => result.powerLevels), item => item.name),
    timelineEvents: mergeEntityArray(results.flatMap(result => result.timelineEvents), item => item.title),
    relationships: [],
    globalOutline: results.map(result => result.globalOutline.trim()).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join('\n\n'),
    worldRules: results.map(result => result.worldRules.trim()).filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join('\n\n'),
  };
  const seen = new Set<string>();
  for (const result of results) {
    for (const relation of result.relationships) {
      const source = normalizeName(relation.sourceName);
      const target = normalizeName(relation.targetName);
      const key = [relation.sourceType, source, relation.targetType, target, normalizeName(relation.relationshipType)].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      merged.relationships.push({ ...relation });
    }
  }
  return merged;
}
