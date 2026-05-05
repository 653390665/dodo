import type { Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Chapter, ChapterVersion, Skill } from '../types';

async function call(method: string, ...args: any[]): Promise<any> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'API error');
  }
  const data = await res.json();
  return data.result;
}

// Subscribe to DB changes via SSE
export function subscribeToChanges(onChange: () => void): () => void {
  const es = new EventSource('/api/db/events');
  es.onmessage = () => onChange();
  return () => es.close();
}

// Novel
export async function listNovels(): Promise<Novel[]> { return call('listNovels'); }
export async function getNovel(id: string): Promise<Novel | undefined> { return call('getNovel', id); }
export async function createNovel(novel: Novel): Promise<void> { return call('createNovel', novel); }
export async function updateNovel(id: string, data: Partial<Novel>): Promise<void> { return call('updateNovel', id, data); }
export async function deleteNovel(id: string): Promise<void> { return call('deleteNovel', id); }

// Chapter
export async function listChapters(novelId: string): Promise<Chapter[]> { return call('listChapters', novelId); }
export async function getChapter(id: string): Promise<Chapter | undefined> { return call('getChapter', id); }
export async function createChapter(chapter: Chapter): Promise<void> { return call('createChapter', chapter); }
export async function updateChapter(id: string, data: Partial<Chapter>): Promise<void> { return call('updateChapter', id, data); }
export async function deleteChapter(id: string): Promise<void> { return call('deleteChapter', id); }

// ChapterVersion
export async function listChapterVersions(chapterId: string): Promise<ChapterVersion[]> { return call('listChapterVersions', chapterId); }
export async function createChapterVersion(cv: ChapterVersion): Promise<void> { return call('createChapterVersion', cv); }

// Character
export async function listCharacters(novelId: string): Promise<Character[]> { return call('listCharacters', novelId); }
export async function createCharacter(c: Character): Promise<void> { return call('createCharacter', c); }
export async function updateCharacter(id: string, data: Partial<Character>): Promise<void> { return call('updateCharacter', id, data); }
export async function deleteCharacter(id: string): Promise<void> { return call('deleteCharacter', id); }

// Location
export async function listLocations(novelId: string): Promise<Location[]> { return call('listLocations', novelId); }
export async function createLocation(loc: Location): Promise<void> { return call('createLocation', loc); }
export async function updateLocation(id: string, data: Partial<Location>): Promise<void> { return call('updateLocation', id, data); }
export async function deleteLocation(id: string): Promise<void> { return call('deleteLocation', id); }

// Item
export async function listItems(novelId: string): Promise<Item[]> { return call('listItems', novelId); }
export async function createItem(item: Item): Promise<void> { return call('createItem', item); }
export async function updateItem(id: string, data: Partial<Item>): Promise<void> { return call('updateItem', id, data); }
export async function deleteItem(id: string): Promise<void> { return call('deleteItem', id); }

// Faction
export async function listFactions(novelId: string): Promise<Faction[]> { return call('listFactions', novelId); }
export async function createFaction(f: Faction): Promise<void> { return call('createFaction', f); }
export async function updateFaction(id: string, data: Partial<Faction>): Promise<void> { return call('updateFaction', id, data); }
export async function deleteFaction(id: string): Promise<void> { return call('deleteFaction', id); }

// PowerLevel
export async function listPowerLevels(novelId: string): Promise<PowerLevel[]> { return call('listPowerLevels', novelId); }
export async function createPowerLevel(p: PowerLevel): Promise<void> { return call('createPowerLevel', p); }
export async function updatePowerLevel(id: string, data: Partial<PowerLevel>): Promise<void> { return call('updatePowerLevel', id, data); }
export async function deletePowerLevel(id: string): Promise<void> { return call('deletePowerLevel', id); }

// TimelineEvent
export async function listTimelineEvents(novelId: string): Promise<TimelineEvent[]> { return call('listTimelineEvents', novelId); }
export async function createTimelineEvent(t: TimelineEvent): Promise<void> { return call('createTimelineEvent', t); }
export async function updateTimelineEvent(id: string, data: Partial<TimelineEvent>): Promise<void> { return call('updateTimelineEvent', id, data); }
export async function deleteTimelineEvent(id: string): Promise<void> { return call('deleteTimelineEvent', id); }

// Skill
export async function listSkills(): Promise<Skill[]> { return call('listSkills'); }
export async function getSkill(id: string): Promise<Skill | undefined> { return call('getSkill', id); }
export async function createSkill(s: Skill): Promise<void> { return call('createSkill', s); }
export async function deleteSkill(id: string): Promise<void> { return call('deleteSkill', id); }
