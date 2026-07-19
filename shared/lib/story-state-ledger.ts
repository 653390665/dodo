import type {
  Chapter,
  Character,
  Faction,
  Foreshadowing,
  Item,
  Location,
  Novel,
  PowerLevel,
  StoryEntitySnapshot,
  StoryStateLedger,
  TimelineEvent,
} from '../types';

interface BuildStoryStateLedgerInput {
  novel: Novel;
  chapters: Chapter[];
  characters?: Character[];
  locations?: Location[];
  items?: Item[];
  factions?: Faction[];
  powerLevels?: PowerLevel[];
  timelineEvents?: TimelineEvent[];
  foreshadowings?: Foreshadowing[];
  recentChapterLimit?: number;
}

function compact(text: string | undefined, max = 360): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function chapterSummary(chapter: Chapter): string {
  const source = chapter.sceneBeats || chapter.content || '';
  return compact(source, 420);
}

function characterSnapshot(character: Character): StoryEntitySnapshot {
  return {
    id: character.id,
    name: character.name,
    kind: 'character',
    summary: compact(character.summary || character.bio, 260),
    statusNote: [
      character.role ? `role=${character.role}` : '',
      character.traits?.length ? `traits=${character.traits.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('; '),
    updatedAt: character.updatedAt,
  };
}

function locationSnapshot(location: Location): StoryEntitySnapshot {
  return {
    id: location.id,
    name: location.name,
    kind: 'location',
    summary: compact(location.description, 260),
    statusNote: location.region ? `region=${location.region}` : '',
    updatedAt: location.updatedAt,
  };
}

function itemSnapshot(item: Item): StoryEntitySnapshot {
  return {
    id: item.id,
    name: item.name,
    kind: 'item',
    summary: compact(item.description, 260),
    statusNote: item.type ? `type=${item.type}` : '',
    updatedAt: item.updatedAt,
  };
}

function factionSnapshot(faction: Faction): StoryEntitySnapshot {
  return {
    id: faction.id,
    name: faction.name,
    kind: 'faction',
    summary: compact(faction.description, 260),
    statusNote: [
      faction.leader ? `leader=${faction.leader}` : '',
      faction.territory ? `territory=${faction.territory}` : '',
    ]
      .filter(Boolean)
      .join('; '),
    updatedAt: faction.updatedAt,
  };
}

function powerLevelSnapshot(powerLevel: PowerLevel): StoryEntitySnapshot {
  return {
    id: powerLevel.id,
    name: powerLevel.name,
    kind: 'powerLevel',
    summary: compact(powerLevel.description, 260),
    statusNote: [
      `tier=${powerLevel.tier}`,
      powerLevel.characteristics ? `characteristics=${powerLevel.characteristics}` : '',
    ]
      .filter(Boolean)
      .join('; '),
    updatedAt: powerLevel.updatedAt,
  };
}

export function buildStoryStateLedger(input: BuildStoryStateLedgerInput): StoryStateLedger {
  const recentChapterLimit = input.recentChapterLimit ?? 5;
  const orderedChapters = input.chapters.slice().sort((a, b) => a.order - b.order);
  const recentChapters = orderedChapters.slice(-recentChapterLimit).map((chapter) => ({
    id: chapter.id,
    title: chapter.title || `第 ${chapter.order} 章`,
    order: chapter.order,
    sceneBeats: compact(chapter.sceneBeats, 500),
    summary: chapterSummary(chapter),
  }));

  return {
    novelId: input.novel.id,
    title: input.novel.title,
    summary: compact(input.novel.summary, 600),
    worldRules: compact(input.novel.worldRules, 900),
    globalOutline: compact(input.novel.globalOutline, 900),
    recentChapters,
    entityStates: {
      characters: (input.characters || []).map(characterSnapshot),
      locations: (input.locations || []).map(locationSnapshot),
      items: (input.items || []).map(itemSnapshot),
      factions: (input.factions || []).map(factionSnapshot),
      powerLevels: (input.powerLevels || []).map(powerLevelSnapshot),
    },
    timeline: (input.timelineEvents || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((event) => ({
        id: event.id,
        title: event.title,
        timestamp: event.timestamp,
        description: compact(event.description, 280),
        statusTag: event.statusTag,
        order: event.order,
      })),
    openForeshadowings: (input.foreshadowings || [])
      .filter((entry) => entry.status !== 'payoff')
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        description: compact(entry.description, 280),
        status: entry.status,
        plantedChapterId: entry.plantedChapterId,
        payoffChapterId: entry.payoffChapterId,
        notes: compact(entry.notes, 220),
      })),
  };
}

function formatEntityList(title: string, entries: StoryEntitySnapshot[]): string {
  if (!entries.length) return `${title}\n- 无`;
  return `${title}\n${entries
    .map(
      (entry) =>
        `- ${entry.name}: ${entry.summary || '无摘要'}${
          entry.statusNote ? ` (${entry.statusNote})` : ''
        }`,
    )
    .join('\n')}`;
}

export function buildLedgerPromptFacts(ledger: StoryStateLedger): Record<string, string> {
  return {
    story: [
      `作品：${ledger.title}`,
      `摘要：${ledger.summary || '无'}`,
      `世界规则：${ledger.worldRules || '无'}`,
      `全局大纲：${ledger.globalOutline || '无'}`,
    ].join('\n'),
    recentChapters: ledger.recentChapters.length
      ? ledger.recentChapters
          .map(
            (chapter) =>
              `- ${chapter.title}: ${chapter.summary || chapter.sceneBeats || '无摘要'}`,
          )
          .join('\n')
      : '- 无',
    characters: formatEntityList('人物状态', ledger.entityStates.characters),
    locations: formatEntityList('地点状态', ledger.entityStates.locations),
    items: formatEntityList('道具状态', ledger.entityStates.items),
    factions: formatEntityList('势力状态', ledger.entityStates.factions),
    powerLevels: formatEntityList('力量体系', ledger.entityStates.powerLevels),
    timeline: ledger.timeline.length
      ? ledger.timeline
          .map(
            (event) =>
              `- [${event.timestamp || '未标时间'}] ${event.title}: ${event.description}`,
          )
          .join('\n')
      : '- 无',
    foreshadowings: ledger.openForeshadowings.length
      ? ledger.openForeshadowings
          .map((entry) => `- ${entry.title} (${entry.status}): ${entry.description}`)
          .join('\n')
      : '- 无',
  };
}

export function summarizeStoryStateLedger(ledger: StoryStateLedger): string {
  const facts = buildLedgerPromptFacts(ledger);
  return [
    '【故事状态账本】',
    facts.story,
    '【近期章节】',
    facts.recentChapters,
    '【人物】',
    facts.characters,
    '【道具】',
    facts.items,
    '【时间线】',
    facts.timeline,
    '【未回收伏笔】',
    facts.foreshadowings,
  ].join('\n\n');
}

// ── Layered Ledger (Morpheus L1/L2/L3 inspired) ─────────────────────

export interface LayeredLedger {
  world: string;
  currentArc: string;
  recentChapters: string;
}

export function buildLayeredLedgerSummary(
  ledger: StoryStateLedger,
  currentChapterOrder: number,
): LayeredLedger {
  const world = [
    ledger.worldRules || '',
    ledger.globalOutline || '',
  ].filter(Boolean).join('\n');

  const arcChapters = ledger.recentChapters
    ?.filter(ch => Math.abs(ch.order - currentChapterOrder) < 20)
    .sort((a, b) => a.order - b.order) || [];
  const currentArc = arcChapters
    .map(ch => `第${ch.order}章: ${ch.title}`)
    .join('\n');

  const recent = ledger.recentChapters
    .filter(ch => ch.order <= currentChapterOrder && ch.order > currentChapterOrder - 5)
    .sort((a, b) => a.order - b.order);
  const recentChapters = recent
    .map(ch => {
      const chars = ledger.entityStates.characters
        .filter(c => ch.summary?.includes(c.name))
        .map(c => c.name)
        .slice(0, 5);
      return `第${ch.order}章「${ch.title}」${chars.length ? '出场: ' + chars.join('、') : ''}`;
    }).join('\n');

  return { world, currentArc, recentChapters };
}
