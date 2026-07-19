import type { Character, Location, Item, Faction, PowerLevel, TimelineEvent, EntityRelationship } from '../../../shared/types';
import { getDb, notify } from '../db-instance.js';
import { rowToCharacter, characterToRow, rowToLocation, locationToRow, rowToItem, itemToRow, rowToFaction, factionToRow, rowToPowerLevel, powerLevelToRow, rowToTimelineEvent, timelineEventToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';

// --- Character CRUD ---
const characterCrud = createCrudHelpers<Character, ReturnType<typeof characterToRow>>({
  tableName: 'characters',
  rowToEntity: rowToCharacter,
  entityToRow: characterToRow,
  insertColumns: ['id', 'novel_id', 'name', 'role', 'summary', 'traits', 'bio', 'current_state', 'created_at', 'updated_at'],
  updateColumns: ['name', 'role', 'summary', 'traits', 'bio', 'current_state', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listCharacters(novelId: string): Character[] {
  return characterCrud.list(novelId);
}

export function getCharacter(id: string): Character | undefined {
  return characterCrud.get(id);
}

export function createCharacter(c: Character): void {
  characterCrud.create(c);
}

export function updateCharacter(id: string, data: Partial<Character>): boolean {
  return characterCrud.update(id, data);
}

export function deleteCharacter(id: string): boolean {
  return characterCrud.delete(id);
}

// --- Location CRUD ---
const locationCrud = createCrudHelpers<Location, ReturnType<typeof locationToRow>>({
  tableName: 'locations',
  rowToEntity: rowToLocation,
  entityToRow: locationToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'region', 'created_at', 'updated_at'],
  updateColumns: ['name', 'description', 'region', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listLocations(novelId: string): Location[] {
  return locationCrud.list(novelId);
}

export function createLocation(loc: Location): void {
  locationCrud.create(loc);
}

export function updateLocation(id: string, data: Partial<Location>): boolean {
  return locationCrud.update(id, data);
}

export function deleteLocation(id: string): boolean {
  return locationCrud.delete(id);
}

// --- Item CRUD ---
const itemCrud = createCrudHelpers<Item, ReturnType<typeof itemToRow>>({
  tableName: 'items',
  rowToEntity: rowToItem,
  entityToRow: itemToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'type', 'created_at', 'updated_at'],
  updateColumns: ['name', 'description', 'type', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listItems(novelId: string): Item[] {
  return itemCrud.list(novelId);
}

export function getItem(id: string): Item | undefined {
  return itemCrud.get(id);
}

export function createItem(item: Item): void {
  itemCrud.create(item);
}

export function updateItem(id: string, data: Partial<Item>): boolean {
  return itemCrud.update(id, data);
}

export function deleteItem(id: string): boolean {
  return itemCrud.delete(id);
}

// --- Faction CRUD ---
const factionCrud = createCrudHelpers<Faction, ReturnType<typeof factionToRow>>({
  tableName: 'factions',
  rowToEntity: rowToFaction,
  entityToRow: factionToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'leader', 'territory', 'created_at', 'updated_at'],
  updateColumns: ['name', 'description', 'leader', 'territory', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listFactions(novelId: string): Faction[] {
  return factionCrud.list(novelId);
}

export function createFaction(f: Faction): void {
  factionCrud.create(f);
}

export function updateFaction(id: string, data: Partial<Faction>): boolean {
  return factionCrud.update(id, data);
}

export function deleteFaction(id: string): boolean {
  return factionCrud.delete(id);
}

// --- PowerLevel CRUD ---
const powerLevelCrud = createCrudHelpers<PowerLevel, ReturnType<typeof powerLevelToRow>>({
  tableName: 'power_levels',
  rowToEntity: rowToPowerLevel,
  entityToRow: powerLevelToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'tier', 'characteristics', 'created_at', 'updated_at'],
  updateColumns: ['name', 'description', 'tier', 'characteristics', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'tier ASC'
});

export function listPowerLevels(novelId: string): PowerLevel[] {
  return powerLevelCrud.list(novelId);
}

export function createPowerLevel(p: PowerLevel): void {
  powerLevelCrud.create(p);
}

export function updatePowerLevel(id: string, data: Partial<PowerLevel>): boolean {
  return powerLevelCrud.update(id, data);
}

export function deletePowerLevel(id: string): boolean {
  return powerLevelCrud.delete(id);
}

// --- TimelineEvent CRUD ---
const timelineEventCrud = createCrudHelpers<TimelineEvent, ReturnType<typeof timelineEventToRow>>({
  tableName: 'timeline_events',
  rowToEntity: rowToTimelineEvent,
  entityToRow: timelineEventToRow,
  insertColumns: ['id', 'novel_id', 'title', 'description', 'timestamp', 'status_tag', '"order"', 'created_at', 'updated_at'],
  updateColumns: ['title', 'description', 'timestamp', 'status_tag', '"order"', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: '"order" ASC'
});

export function listTimelineEvents(novelId: string): TimelineEvent[] {
  return timelineEventCrud.list(novelId);
}

export function createTimelineEvent(t: TimelineEvent): void {
  timelineEventCrud.create(t);
}

export function updateTimelineEvent(id: string, data: Partial<TimelineEvent>): boolean {
  return timelineEventCrud.update(id, data);
}

export function deleteTimelineEvent(id: string): boolean {
  return timelineEventCrud.delete(id);
}

// --- Entity Relationships ---
const ENTITY_TYPES = ['character', 'location', 'item', 'faction'] as const;
type EntityType = typeof ENTITY_TYPES[number];
const ENTITY_TABLE_MAP: Record<EntityType, string> = {
  character: 'characters',
  location: 'locations',
  item: 'items',
  faction: 'factions',
};

function validateRelationship(rel: { novelId: string; sourceType: string; sourceId: string; targetType: string; targetId: string }): void {
  if (!ENTITY_TYPES.includes(rel.sourceType as EntityType) || !ENTITY_TYPES.includes(rel.targetType as EntityType)) {
    throw new Error(`Invalid entity type: sourceType="${rel.sourceType}", targetType="${rel.targetType}". Must be one of: ${ENTITY_TYPES.join(', ')}`);
  }
  if (rel.sourceType === rel.targetType && rel.sourceId === rel.targetId) {
    throw new Error('Self-relationship is not allowed');
  }
  const db = getDb();
  const srcTable = ENTITY_TABLE_MAP[rel.sourceType as EntityType];
  const tgtTable = ENTITY_TABLE_MAP[rel.targetType as EntityType];
  const srcExists = db.prepare(`SELECT 1 FROM ${srcTable} WHERE id = ? AND novel_id = ?`).get(rel.sourceId, rel.novelId);
  if (!srcExists) throw new Error(`Source entity not found: ${rel.sourceType} id="${rel.sourceId}" in novel "${rel.novelId}"`);
  const tgtExists = db.prepare(`SELECT 1 FROM ${tgtTable} WHERE id = ? AND novel_id = ?`).get(rel.targetId, rel.novelId);
  if (!tgtExists) throw new Error(`Target entity not found: ${rel.targetType} id="${rel.targetId}" in novel "${rel.novelId}"`);
}

function isDuplicateRelationship(novelId: string, sourceType: string, sourceId: string, targetType: string, targetId: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM entity_relationships WHERE novelId = ? AND sourceType = ? AND sourceId = ? AND targetType = ? AND targetId = ?').get(novelId, sourceType, sourceId, targetType, targetId);
  return !!row;
}

export function listEntityRelationships(novelId: string): EntityRelationship[] {
  return getDb().prepare('SELECT * FROM entity_relationships WHERE novelId = ?').all(novelId) as EntityRelationship[];
}

export function createEntityRelationship(rel: EntityRelationship): boolean {
  validateRelationship(rel);
  if (isDuplicateRelationship(rel.novelId, rel.sourceType, rel.sourceId, rel.targetType, rel.targetId)) {
    return false;
  }
  getDb().prepare('INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(rel.id, rel.novelId, rel.sourceType, rel.sourceId, rel.targetType, rel.targetId, rel.relationshipType, rel.description || '', Date.now());
  notify();
  return true;
}

const ENTITY_RELATIONSHIP_COLUMNS = new Set([
  'sourceType', 'sourceId', 'targetType', 'targetId', 'relationshipType', 'description'
]);

export function updateEntityRelationship(id: string, data: Partial<EntityRelationship>): boolean {
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (!ENTITY_RELATIONSHIP_COLUMNS.has(k)) {
      throw new Error(`Invalid column name: ${k}`);
    }
    sets.push(k + ' = ?');
    vals.push(v);
  }
  if (sets.length === 0) return false;

  const needsRevalidation = 'sourceType' in data || 'sourceId' in data || 'targetType' in data || 'targetId' in data;
  if (needsRevalidation) {
    const existing = getDb().prepare('SELECT * FROM entity_relationships WHERE id = ?').get(id) as EntityRelationship | undefined;
    if (!existing) throw new Error(`Relationship not found: id="${id}"`);
    const merged = {
      novelId: existing.novelId,
      sourceType: (data.sourceType as string) ?? existing.sourceType,
      sourceId: (data.sourceId as string) ?? existing.sourceId,
      targetType: (data.targetType as string) ?? existing.targetType,
      targetId: (data.targetId as string) ?? existing.targetId,
    };
    validateRelationship(merged);
    if (isDuplicateRelationship(merged.novelId, merged.sourceType, merged.sourceId, merged.targetType, merged.targetId)) {
      const dup = getDb().prepare('SELECT id FROM entity_relationships WHERE novelId = ? AND sourceType = ? AND sourceId = ? AND targetType = ? AND targetId = ? AND id != ?').get(merged.novelId, merged.sourceType, merged.sourceId, merged.targetType, merged.targetId, id);
      if (dup) return false;
    }
  }

  vals.push(id);
  const result = getDb().prepare('UPDATE entity_relationships SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  if (result.changes > 0) notify();
  return result.changes > 0;
}

export function deleteEntityRelationship(id: string): boolean {
  const result = getDb().prepare('DELETE FROM entity_relationships WHERE id = ?').run(id);
  if (result.changes > 0) notify();
  return result.changes > 0;
}
