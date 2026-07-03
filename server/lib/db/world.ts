import type { Character, Location, Item, Faction, PowerLevel, TimelineEvent, EntityRelationship } from '../../../shared/types';
import { getDb, notify } from '../db-instance.js';
import { rowToCharacter, characterToRow, rowToLocation, locationToRow, rowToItem, itemToRow, rowToFaction, factionToRow, rowToPowerLevel, powerLevelToRow, rowToTimelineEvent, timelineEventToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';

// --- Character CRUD ---
const characterCrud = createCrudHelpers<Character, ReturnType<typeof characterToRow>>({
  tableName: 'characters',
  rowToEntity: rowToCharacter,
  entityToRow: characterToRow,
  insertColumns: ['id', 'novel_id', 'name', 'role', 'summary', 'traits', 'bio', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'role', 'summary', 'traits', 'bio', 'updated_at'],
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

export function updateCharacter(id: string, data: Partial<Character>): void {
  characterCrud.update(id, data);
}

export function deleteCharacter(id: string): void {
  characterCrud.delete(id);
}

// --- Location CRUD ---
const locationCrud = createCrudHelpers<Location, ReturnType<typeof locationToRow>>({
  tableName: 'locations',
  rowToEntity: rowToLocation,
  entityToRow: locationToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'region', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'region', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listLocations(novelId: string): Location[] {
  return locationCrud.list(novelId);
}

export function createLocation(loc: Location): void {
  locationCrud.create(loc);
}

export function updateLocation(id: string, data: Partial<Location>): void {
  locationCrud.update(id, data);
}

export function deleteLocation(id: string): void {
  locationCrud.delete(id);
}

// --- Item CRUD ---
const itemCrud = createCrudHelpers<Item, ReturnType<typeof itemToRow>>({
  tableName: 'items',
  rowToEntity: rowToItem,
  entityToRow: itemToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'type', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'type', 'updated_at'],
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

export function updateItem(id: string, data: Partial<Item>): void {
  itemCrud.update(id, data);
}

export function deleteItem(id: string): void {
  itemCrud.delete(id);
}

// --- Faction CRUD ---
const factionCrud = createCrudHelpers<Faction, ReturnType<typeof factionToRow>>({
  tableName: 'factions',
  rowToEntity: rowToFaction,
  entityToRow: factionToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'leader', 'territory', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'leader', 'territory', 'updated_at'],
  listFilterKey: 'novel_id'
});

export function listFactions(novelId: string): Faction[] {
  return factionCrud.list(novelId);
}

export function createFaction(f: Faction): void {
  factionCrud.create(f);
}

export function updateFaction(id: string, data: Partial<Faction>): void {
  factionCrud.update(id, data);
}

export function deleteFaction(id: string): void {
  factionCrud.delete(id);
}

// --- PowerLevel CRUD ---
const powerLevelCrud = createCrudHelpers<PowerLevel, ReturnType<typeof powerLevelToRow>>({
  tableName: 'power_levels',
  rowToEntity: rowToPowerLevel,
  entityToRow: powerLevelToRow,
  insertColumns: ['id', 'novel_id', 'name', 'description', 'tier', 'characteristics', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'name', 'description', 'tier', 'characteristics', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: 'tier ASC'
});

export function listPowerLevels(novelId: string): PowerLevel[] {
  return powerLevelCrud.list(novelId);
}

export function createPowerLevel(p: PowerLevel): void {
  powerLevelCrud.create(p);
}

export function updatePowerLevel(id: string, data: Partial<PowerLevel>): void {
  powerLevelCrud.update(id, data);
}

export function deletePowerLevel(id: string): void {
  powerLevelCrud.delete(id);
}

// --- TimelineEvent CRUD ---
const timelineEventCrud = createCrudHelpers<TimelineEvent, ReturnType<typeof timelineEventToRow>>({
  tableName: 'timeline_events',
  rowToEntity: rowToTimelineEvent,
  entityToRow: timelineEventToRow,
  insertColumns: ['id', 'novel_id', 'title', 'description', 'timestamp', 'status_tag', '"order"', 'created_at', 'updated_at'],
  updateColumns: ['novel_id', 'title', 'description', 'timestamp', 'status_tag', '"order"', 'updated_at'],
  listFilterKey: 'novel_id',
  listOrderBy: '"order" ASC'
});

export function listTimelineEvents(novelId: string): TimelineEvent[] {
  return timelineEventCrud.list(novelId);
}

export function createTimelineEvent(t: TimelineEvent): void {
  timelineEventCrud.create(t);
}

export function updateTimelineEvent(id: string, data: Partial<TimelineEvent>): void {
  timelineEventCrud.update(id, data);
}

export function deleteTimelineEvent(id: string): void {
  timelineEventCrud.delete(id);
}

// --- Entity Relationships ---
export function listEntityRelationships(novelId: string): EntityRelationship[] {
  return getDb().prepare('SELECT * FROM entity_relationships WHERE novelId = ?').all(novelId) as EntityRelationship[];
}

export function createEntityRelationship(rel: EntityRelationship): void {
  getDb().prepare('INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(rel.id, rel.novelId, rel.sourceType, rel.sourceId, rel.targetType, rel.targetId, rel.relationshipType, rel.description || '', Date.now());
  notify();
}

const ENTITY_RELATIONSHIP_COLUMNS = new Set([
  'sourceType', 'sourceId', 'targetType', 'targetId', 'relationshipType', 'description'
]);

export function updateEntityRelationship(id: string, data: Partial<EntityRelationship>): void {
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (!ENTITY_RELATIONSHIP_COLUMNS.has(k)) {
      throw new Error(`Invalid column name: ${k}`);
    }
    sets.push(k + ' = ?');
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  getDb().prepare('UPDATE entity_relationships SET ' + sets.join(', ') + ' WHERE id = ?').run(...vals);
  notify();
}

export function deleteEntityRelationship(id: string): void {
  getDb().prepare('DELETE FROM entity_relationships WHERE id = ?').run(id);
  notify();
}
