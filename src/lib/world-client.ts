import type { Character, Location, Item, Faction, PowerLevel, TimelineEvent } from '../../shared/types';
import type { EntityRelationship } from '../../shared/types';
export type { EntityRelationship };
import { call, callForGeneration } from './db-transport';

export async function importWorldExtraction(payload: Record<string, unknown>): Promise<void> {
  const response = await fetch('/api/world/import-extraction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || '设定导入失败');
}

export async function listCharacters(novelId: string): Promise<Character[]> { return call('listCharacters', novelId); }
export async function createCharacter(c: Character, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createCharacter', c) : callForGeneration(databaseGeneration, 'createCharacter', c);
}
export async function updateCharacter(id: string, data: Partial<Character>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('updateCharacter', id, data)
    : callForGeneration(databaseGeneration, 'updateCharacter', id, data);
}
export async function deleteCharacter(id: string): Promise<boolean> { return call('deleteCharacter', id); }

export async function listLocations(novelId: string): Promise<Location[]> { return call('listLocations', novelId); }
export async function createLocation(loc: Location, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createLocation', loc) : callForGeneration(databaseGeneration, 'createLocation', loc);
}
export async function updateLocation(id: string, data: Partial<Location>): Promise<boolean> { return call('updateLocation', id, data); }
export async function deleteLocation(id: string): Promise<boolean> { return call('deleteLocation', id); }

export async function listItems(novelId: string): Promise<Item[]> { return call('listItems', novelId); }
export async function createItem(item: Item, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createItem', item) : callForGeneration(databaseGeneration, 'createItem', item);
}
export async function updateItem(id: string, data: Partial<Item>): Promise<boolean> { return call('updateItem', id, data); }
export async function deleteItem(id: string): Promise<boolean> { return call('deleteItem', id); }

export async function listFactions(novelId: string): Promise<Faction[]> { return call('listFactions', novelId); }
export async function createFaction(f: Faction): Promise<void> { return call('createFaction', f); }
export async function updateFaction(id: string, data: Partial<Faction>): Promise<boolean> { return call('updateFaction', id, data); }
export async function deleteFaction(id: string): Promise<boolean> { return call('deleteFaction', id); }

export async function listPowerLevels(novelId: string): Promise<PowerLevel[]> { return call('listPowerLevels', novelId); }
export async function createPowerLevel(p: PowerLevel): Promise<void> { return call('createPowerLevel', p); }
export async function updatePowerLevel(id: string, data: Partial<PowerLevel>): Promise<boolean> { return call('updatePowerLevel', id, data); }
export async function deletePowerLevel(id: string): Promise<boolean> { return call('deletePowerLevel', id); }

export async function listTimelineEvents(novelId: string): Promise<TimelineEvent[]> { return call('listTimelineEvents', novelId); }
export async function createTimelineEvent(t: TimelineEvent): Promise<void> { return call('createTimelineEvent', t); }
export async function updateTimelineEvent(id: string, data: Partial<TimelineEvent>): Promise<boolean> { return call('updateTimelineEvent', id, data); }
export async function deleteTimelineEvent(id: string): Promise<boolean> { return call('deleteTimelineEvent', id); }

// Entity relationships (knowledge graph)
export async function listEntityRelationshipsClient(novelId: string): Promise<EntityRelationship[]> {
  return call('listEntityRelationships', novelId);
}
export async function createEntityRelationshipClient(rel: EntityRelationship): Promise<void> {
  return call('createEntityRelationship', rel);
}
export async function updateEntityRelationshipClient(id: string, data: Partial<EntityRelationship>): Promise<boolean> {
  return call('updateEntityRelationship', id, data);
}
export async function deleteEntityRelationshipClient(id: string): Promise<boolean> {
  return call('deleteEntityRelationship', id);
}
