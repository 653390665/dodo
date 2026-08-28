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
export async function deleteCharacter(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('deleteCharacter', id) : callForGeneration(databaseGeneration, 'deleteCharacter', id);
}

export async function listLocations(novelId: string): Promise<Location[]> { return call('listLocations', novelId); }
export async function createLocation(loc: Location, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createLocation', loc) : callForGeneration(databaseGeneration, 'createLocation', loc);
}
export async function updateLocation(id: string, data: Partial<Location>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('updateLocation', id, data) : callForGeneration(databaseGeneration, 'updateLocation', id, data);
}
export async function deleteLocation(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('deleteLocation', id) : callForGeneration(databaseGeneration, 'deleteLocation', id);
}

export async function listItems(novelId: string): Promise<Item[]> { return call('listItems', novelId); }
export async function createItem(item: Item, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createItem', item) : callForGeneration(databaseGeneration, 'createItem', item);
}
export async function updateItem(id: string, data: Partial<Item>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('updateItem', id, data) : callForGeneration(databaseGeneration, 'updateItem', id, data);
}
export async function deleteItem(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('deleteItem', id) : callForGeneration(databaseGeneration, 'deleteItem', id);
}

export async function listFactions(novelId: string): Promise<Faction[]> { return call('listFactions', novelId); }
export async function createFaction(f: Faction, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createFaction', f) : callForGeneration(databaseGeneration, 'createFaction', f);
}
export async function updateFaction(id: string, data: Partial<Faction>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('updateFaction', id, data) : callForGeneration(databaseGeneration, 'updateFaction', id, data);
}
export async function deleteFaction(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('deleteFaction', id) : callForGeneration(databaseGeneration, 'deleteFaction', id);
}

export async function listPowerLevels(novelId: string): Promise<PowerLevel[]> { return call('listPowerLevels', novelId); }
export async function createPowerLevel(p: PowerLevel, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createPowerLevel', p) : callForGeneration(databaseGeneration, 'createPowerLevel', p);
}
export async function updatePowerLevel(id: string, data: Partial<PowerLevel>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('updatePowerLevel', id, data) : callForGeneration(databaseGeneration, 'updatePowerLevel', id, data);
}
export async function deletePowerLevel(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('deletePowerLevel', id) : callForGeneration(databaseGeneration, 'deletePowerLevel', id);
}

export async function listTimelineEvents(novelId: string): Promise<TimelineEvent[]> { return call('listTimelineEvents', novelId); }
export async function createTimelineEvent(t: TimelineEvent, databaseGeneration?: number): Promise<void> {
  return databaseGeneration === undefined ? call('createTimelineEvent', t) : callForGeneration(databaseGeneration, 'createTimelineEvent', t);
}
export async function updateTimelineEvent(id: string, data: Partial<TimelineEvent>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('updateTimelineEvent', id, data) : callForGeneration(databaseGeneration, 'updateTimelineEvent', id, data);
}
export async function deleteTimelineEvent(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined ? call('deleteTimelineEvent', id) : callForGeneration(databaseGeneration, 'deleteTimelineEvent', id);
}

// Entity relationships (knowledge graph)
export async function listEntityRelationshipsClient(novelId: string): Promise<EntityRelationship[]> {
  return call('listEntityRelationships', novelId);
}
export async function createEntityRelationshipClient(rel: EntityRelationship, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('createEntityRelationship', rel)
    : callForGeneration(databaseGeneration, 'createEntityRelationship', rel);
}
export async function updateEntityRelationshipClient(id: string, data: Partial<EntityRelationship>, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('updateEntityRelationship', id, data)
    : callForGeneration(databaseGeneration, 'updateEntityRelationship', id, data);
}
export async function deleteEntityRelationshipClient(id: string, databaseGeneration?: number): Promise<boolean> {
  return databaseGeneration === undefined
    ? call('deleteEntityRelationship', id)
    : callForGeneration(databaseGeneration, 'deleteEntityRelationship', id);
}
