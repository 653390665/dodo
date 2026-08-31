import * as db from '../lib/db.js';
import { buildLedgerPromptFacts, buildStoryStateLedger } from '../../shared/lib/story-state-ledger.js';
import { embedWithMetadata, getEmbeddingStatus } from '../embedding';
import { getChunkCount, searchSimilar } from '../vector-store';

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


/**
 * Story context with semantic retrieval (DIR-01): embeds the current chapter
 * and appends the top similar archived-chapter fragments, so long-form
 * continuity depends on semantically related scenes rather than keyword
 * overlap alone. Strictly additive — any failure falls back to the base
 * keyword-ledger context, and the base context is never truncated further.
 */
export async function buildServerStoryContextWithSemantic(input: {
  novelId: string;
  chapterId: string;
  clientContext?: string;
}): Promise<string> {
  const base = buildServerStoryContext(input);
  try {
    const novel = db.getNovel(input.novelId);
    const chapter = db.getChapter(input.chapterId);
    if (!novel || !chapter) return base;
    if (getChunkCount(novel.id) <= 0) return base;
    const embeddingStatus = getEmbeddingStatus();
    if (embeddingStatus.status !== 'ready' && embeddingStatus.status !== 'fallback') return base;
    const { values, modelId } = await embedWithMetadata(
      `${chapter.title}\n${chapter.content || ''}`,
      novel.id,
    );
    const hits = searchSimilar(values, novel.id, modelId, 2);
    if (hits.length === 0) return base;
    const semanticSection = hits
      .map((hit) => hit.text.trim())
      .filter(Boolean)
      .join('\n---\n')
      .slice(0, 1200);
    if (!semanticSection) return base;
    return `${base}\n\n【语义相关的过往章节片段】\n${semanticSection}`;
  } catch {
    // Embedding/search is best-effort; the keyword ledger stays the fallback.
    return base;
  }
}
