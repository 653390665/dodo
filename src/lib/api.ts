import type { Novel, Character, Location, Item, Faction, PowerLevel, TimelineEvent, Chapter, ChapterVersion, Skill, IdeaFragment, Foreshadowing, SkillUsageRecord, StoryIdeaCard, StoryPlanningInput, ChapterProductionRun, AggregatedSkillDeck, BookEvidenceSegment } from '../types';
import type { PromptSurface } from './prompt-stage-routing';

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

// Shared SSE connection — single EventSource for all subscribers
let globalEventSource: EventSource | null = null;
let globalListeners = new Set<() => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 3000;

function connectEventSource() {
  if (globalEventSource && globalEventSource.readyState === EventSource.OPEN) return;
  if (globalEventSource) {
    globalEventSource.close();
    globalEventSource = null;
  }

  const es = new EventSource('/api/db/events');

  es.onmessage = () => {
    reconnectDelay = 3000;
    globalListeners.forEach((fn) => {
      try { fn(); } catch (e) { console.error('SSE listener error:', e); }
    });
  };

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      globalEventSource = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectEventSource();
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      }, reconnectDelay);
    }
  };

  es.onopen = () => { reconnectDelay = 3000; };
  globalEventSource = es;
}

// Subscribe to DB changes via SSE (shared connection with auto-reconnect)
export function subscribeToChanges(onChange: () => void): () => void {
  globalListeners.add(onChange);
  connectEventSource();
  return () => {
    globalListeners.delete(onChange);
    if (globalListeners.size === 0 && globalEventSource) {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      globalEventSource.close();
      globalEventSource = null;
    }
  };
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
export async function updateSkill(id: string, data: Partial<Skill>): Promise<void> { return call('updateSkill', id, data); }
export async function listSkillVersions(skillId: string): Promise<Skill[]> { return call('listSkillVersions', skillId); }
export async function deleteSkill(id: string): Promise<void> { return call('deleteSkill', id); }
export async function listSkillUsageRecords(skillId?: string): Promise<SkillUsageRecord[]> { return call('listSkillUsageRecords', skillId); }
export async function syncSkillFeedbackScores(): Promise<Skill[]> { return call('syncSkillFeedbackScores'); }
export async function createSkillUsageRecord(record: SkillUsageRecord): Promise<void> { return call('createSkillUsageRecord', record); }

export async function extractSkill(text: string): Promise<{
  skills: Skill[];
  deck: AggregatedSkillDeck;
  segments: BookEvidenceSegment[];
}> {
  const res = await fetch('/api/extract-skill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to extract skill');
  return { skills: data.skills, deck: data.deck, segments: data.segments };
}

// IdeaFragment
export async function listIdeaFragments(novelId?: string): Promise<IdeaFragment[]> { return call('listIdeaFragments', novelId); }
export async function createIdeaFragment(f: IdeaFragment): Promise<void> { return call('createIdeaFragment', f); }
export async function updateIdeaFragment(id: string, data: Partial<IdeaFragment>): Promise<void> { return call('updateIdeaFragment', id, data); }
export async function deleteIdeaFragment(id: string): Promise<void> { return call('deleteIdeaFragment', id); }

export async function generateStoryCards(payload: {
  ideaSeed: string;
  chatContext: string;
  planning: StoryPlanningInput;
  surface?: PromptSurface;
}): Promise<StoryIdeaCard[]> {
  const res = await fetch('/api/story-cards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to generate story cards');
  return data.cards;
}

export async function refineSetupTask(payload: {
  taskTitle: string;
  currentDraft: string;
  userRequest: string;
  storyContext: string;
  surface?: PromptSurface;
}): Promise<string> {
  const res = await fetch('/api/setup-task-refine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to refine setup task');
  return data.text;
}

// Foreshadowing
export async function listForeshadowings(novelId: string): Promise<Foreshadowing[]> { return call('listForeshadowings', novelId); }
export async function createForeshadowing(f: Foreshadowing): Promise<void> { return call('createForeshadowing', f); }
export async function updateForeshadowing(id: string, data: Partial<Foreshadowing>): Promise<void> { return call('updateForeshadowing', id, data); }
export async function deleteForeshadowing(id: string): Promise<void> { return call('deleteForeshadowing', id); }

// ChapterProductionRun
export async function listChapterProductionRuns(novelId: string): Promise<ChapterProductionRun[]> { return call('listChapterProductionRuns', novelId); }
export async function getChapterProductionRun(id: string): Promise<ChapterProductionRun | undefined> { return call('getChapterProductionRun', id); }
export async function createChapterProductionRun(run: ChapterProductionRun): Promise<void> { return call('createChapterProductionRun', run); }
export async function updateChapterProductionRun(id: string, data: Partial<ChapterProductionRun>): Promise<void> { return call('updateChapterProductionRun', id, data); }
export async function startChapterProductionRun(payload: {
  novelId: string;
  targetChapterId?: string;
  userIntent: string;
  surface?: PromptSurface;
}): Promise<ChapterProductionRun> {
  const res = await fetch('/api/chapter-production-runs/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to start chapter production run');
  return data.run;
}

export async function applyChapterProductionRun(runId: string): Promise<{ chapterId: string }> {
  const res = await fetch(`/api/chapter-production-runs/${runId}/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to apply chapter production run');
  return { chapterId: data.chapterId };
}

export async function generateInspiration(prompt: string, surface: PromptSurface = 'workspace-draft'): Promise<string> {
  const res = await fetch('/api/inspiration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, surface }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Failed to generate inspiration');
  return data.text;
}
