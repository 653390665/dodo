import * as db from '../lib/db.js';
import { buildLedgerPromptFacts, buildStoryStateLedger } from '../../shared/lib/story-state-ledger.js';

const MAX_SERVER_CONTEXT_CHARS = 7_000;
const MAX_CLIENT_CONTEXT_CHARS = 1_200;
const MAX_ENTITIES_PER_KIND = 12;
const MAX_TIMELINE_EVENTS = 12;
const MAX_FORESHADOWINGS = 12;

function truncate(text: string, maxChars: number): string {
  const normalized = text.trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars)}\n……（已截断）` : normalized;
}

function prioritizeNamed<T extends { name: string; updatedAt?: number }>(entries: T[], chapterText: string, isPrimary?: (entry: T) => boolean): T[] {
  return entries
    .slice()
    .sort((left, right) => {
      const leftScore = (isPrimary?.(left) ? 2 : 0) + (chapterText.includes(left.name) ? 1 : 0);
      const rightScore = (isPrimary?.(right) ? 2 : 0) + (chapterText.includes(right.name) ? 1 : 0);
      return rightScore - leftScore || (right.updatedAt || 0) - (left.updatedAt || 0);
    })
    .slice(0, MAX_ENTITIES_PER_KIND);
}

export function buildServerStoryContext(input: {
  novelId: string;
  chapterId: string;
  clientContext?: string;
}): string {
  const novel = db.getNovel(input.novelId);
  if (!novel) throw new Error('NOVEL_NOT_FOUND');
  const chapter = db.getChapter(input.chapterId);
  if (!chapter) throw new Error('CHAPTER_NOT_FOUND');
  if (chapter.novelId !== novel.id) throw new Error('CHAPTER_SCOPE_MISMATCH');

  const chapterText = `${chapter.title}\n${chapter.sceneBeats || ''}\n${chapter.content || ''}`;
  const foreshadowings = db.listForeshadowings(novel.id)
    .filter((entry) => entry.status !== 'payoff')
    .sort((left, right) => {
      const leftScore = (left.plantedChapterId === chapter.id ? 2 : 0) + (chapterText.includes(left.title) ? 1 : 0);
      const rightScore = (right.plantedChapterId === chapter.id ? 2 : 0) + (chapterText.includes(right.title) ? 1 : 0);
      return rightScore - leftScore || left.createdAt - right.createdAt;
    })
    .slice(0, MAX_FORESHADOWINGS);

  const ledger = buildStoryStateLedger({
    novel,
    chapters: db.listChapters(novel.id),
    characters: prioritizeNamed(db.listCharacters(novel.id), chapterText, (entry) => entry.role === 'protagonist'),
    locations: prioritizeNamed(db.listLocations(novel.id), chapterText),
    items: prioritizeNamed(db.listItems(novel.id), chapterText),
    factions: prioritizeNamed(db.listFactions(novel.id), chapterText),
    powerLevels: prioritizeNamed(db.listPowerLevels(novel.id), chapterText),
    timelineEvents: db.listTimelineEvents(novel.id).slice(-MAX_TIMELINE_EVENTS),
    foreshadowings,
    recentChapterLimit: 5,
    currentChapterOrder: chapter.order,
  });
  const facts = buildLedgerPromptFacts(ledger);
  const serverContext = truncate([
    '【服务端故事状态账本】',
    facts.story,
    `【当前章节】\n- [${chapter.id}] ${chapter.title}：${chapter.sceneBeats || '无分镜'}`,
    `【近期章节】\n${facts.recentChapters}`,
    facts.characters,
    facts.locations,
    facts.items,
    facts.factions,
    facts.powerLevels,
    `【时间线】\n${facts.timeline}`,
    `【开放伏笔与叙事承诺】\n${ledger.openForeshadowings.length
      ? ledger.openForeshadowings.map((entry) => `- [${entry.id}] ${entry.title} (${entry.status}): ${entry.description}${entry.revealConstraint ? `；揭示约束：${entry.revealConstraint}` : ''}`).join('\n')
      : '- 无'}`,
  ].join('\n\n'), MAX_SERVER_CONTEXT_CHARS);
  const clientContext = truncate(input.clientContext || '', MAX_CLIENT_CONTEXT_CHARS);
  return clientContext
    ? `${serverContext}\n\n【客户端补充上下文（仅作临时补充）】\n${clientContext}`
    : serverContext;
}
