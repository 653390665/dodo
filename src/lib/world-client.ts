import type { Character, Location, Item, Faction, PowerLevel, TimelineEvent } from '../types';
import { call } from './db-transport';

export async function listCharacters(novelId: string): Promise<Character[]> { return call('listCharacters', novelId); }
export async function createCharacter(c: Character): Promise<void> { return call('createCharacter', c); }
export async function updateCharacter(id: string, data: Partial<Character>): Promise<void> { return call('updateCharacter', id, data); }
export async function deleteCharacter(id: string): Promise<void> { return call('deleteCharacter', id); }

export async function listLocations(novelId: string): Promise<Location[]> { return call('listLocations', novelId); }
export async function createLocation(loc: Location): Promise<void> { return call('createLocation', loc); }
export async function updateLocation(id: string, data: Partial<Location>): Promise<void> { return call('updateLocation', id, data); }
export async function deleteLocation(id: string): Promise<void> { return call('deleteLocation', id); }

export async function listItems(novelId: string): Promise<Item[]> { return call('listItems', novelId); }
export async function createItem(item: Item): Promise<void> { return call('createItem', item); }
export async function updateItem(id: string, data: Partial<Item>): Promise<void> { return call('updateItem', id, data); }
export async function deleteItem(id: string): Promise<void> { return call('deleteItem', id); }

export async function listFactions(novelId: string): Promise<Faction[]> { return call('listFactions', novelId); }
export async function createFaction(f: Faction): Promise<void> { return call('createFaction', f); }
export async function updateFaction(id: string, data: Partial<Faction>): Promise<void> { return call('updateFaction', id, data); }
export async function deleteFaction(id: string): Promise<void> { return call('deleteFaction', id); }

export async function listPowerLevels(novelId: string): Promise<PowerLevel[]> { return call('listPowerLevels', novelId); }
export async function createPowerLevel(p: PowerLevel): Promise<void> { return call('createPowerLevel', p); }
export async function updatePowerLevel(id: string, data: Partial<PowerLevel>): Promise<void> { return call('updatePowerLevel', id, data); }
export async function deletePowerLevel(id: string): Promise<void> { return call('deletePowerLevel', id); }

export async function listTimelineEvents(novelId: string): Promise<TimelineEvent[]> { return call('listTimelineEvents', novelId); }
export async function createTimelineEvent(t: TimelineEvent): Promise<void> { return call('createTimelineEvent', t); }
export async function updateTimelineEvent(id: string, data: Partial<TimelineEvent>): Promise<void> { return call('updateTimelineEvent', id, data); }
export async function deleteTimelineEvent(id: string): Promise<void> { return call('deleteTimelineEvent', id); }
