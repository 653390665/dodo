import * as db from '../lib/db.js';
import {
  buildLedgerPromptFacts,
  buildStoryStateLedger,
} from '../../shared/lib/story-state-ledger.js';
import { embedWithMetadata, getEmbeddingStatus } from '../embedding';
import { getChunkCount, searchSimilar } from '../vector-store';

const MAX_SERVER_CONTEXT_CHARS = 7_000;
const MAX_CLIENT_CONTEXT_CHARS = 1_200;
const MAX_ENTITIES_PER_KIND = 12;
const MAX_TIMELINE_EVENTS = 12;
const MAX_FORESHADOWINGS = 12;

export const SEMANTIC_RECALL_MARKER = '【语义相关的过往章节片段】';
export const MAX_SEMANTIC_RECALL_CHARS = 1_200;
const DEFAULT_SEMANTIC_RECALL_TOP_K = 2;

export interface SemanticRecallSection {
  marker: string;
  text: string;
  hitCount: number;
  injectedChars: number;
  truncated: boolean;
}

/**
 * Injectable seams. Production always uses the real implementations below;
 * tests supply stubs because `NODE_ENV=test` disables both local and remote
 * embedding models, so the hit path is otherwise unreachable.
 */
export interface SemanticRecallDeps {
  getChunkCount: (novelId: string) => number;
  getEmbeddingStatus: () => { status: string };
  embedWithMetadata: (text: string, novelId: string) => Promise<{ values: number[]; modelId: string }>;
  searchSimilar: (
    values: number[],
    novelId: string,
    modelId: string,
    topK: number
  ) => Array<{ text: string; score: number; chapterId: string }>;
}

const SEMANTIC_RECALL_DEPS: SemanticRecallDeps = {
  getChunkCount,
  getEmbeddingStatus,
  embedWithMetadata,
  searchSimilar,
};

/**
 * Best-effort semantic recall for one chapter: embeds the query text and returns
 * the top similar archived fragments, capped by `maxChars`. Returns null — and
 * never throws — when the vector index is empty, the embedding provider is not
 * ready, the query is blank, or no hit survives; callers then degrade to their
 * keyword-ledger context unchanged.
 */
export async function buildSemanticRecallSection(
  input: { novelId: string; queryText: string; topK?: number; maxChars?: number },
  deps: SemanticRecallDeps = SEMANTIC_RECALL_DEPS
): Promise<SemanticRecallSection | null> {
  try {
    if (!input.queryText.trim()) return null;
    if (deps.getChunkCount(input.novelId) <= 0) return null;
    const embeddingStatus = deps.getEmbeddingStatus();
    if (embeddingStatus.status !== 'ready' && embeddingStatus.status !== 'fallback') return null;
    const { values, modelId } = await deps.embedWithMetadata(input.queryText, input.novelId);
    const hits = deps.searchSimilar(
      values,
      input.novelId,
      modelId,
      input.topK ?? DEFAULT_SEMANTIC_RECALL_TOP_K
    );
    const raw = hits
      .map((hit) => hit.text.trim())
      .filter(Boolean)
      .join('\n---\n');
    if (!raw) return null;
    const maxChars = input.maxChars ?? MAX_SEMANTIC_RECALL_CHARS;
    const text = raw.slice(0, maxChars);
    return {
      marker: SEMANTIC_RECALL_MARKER,
      text,
      hitCount: hits.length,
      injectedChars: text.length,
      truncated: text.length < raw.length,
    };
  } catch {
    return null;
  }
}

function truncate(text: string, maxChars: number): string {
  const normalized = text.trim();
  return normalized.length > maxChars
    ? `${normalized.slice(0, maxChars)}\n……（已截断）`
    : normalized;
}

function prioritizeNamed<T extends { name: string; updatedAt?: number }>(
  entries: T[],
  chapterText: string,
  isPrimary?: (entry: T) => boolean
): T[] {
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
  const foreshadowings = db
    .listForeshadowings(novel.id)
    .filter((entry) => entry.status !== 'payoff')
    .sort((left, right) => {
      const leftScore =
        (left.plantedChapterId === chapter.id ? 2 : 0) + (chapterText.includes(left.title) ? 1 : 0);
      const rightScore =
        (right.plantedChapterId === chapter.id ? 2 : 0) +
        (chapterText.includes(right.title) ? 1 : 0);
      return rightScore - leftScore || left.createdAt - right.createdAt;
    })
    .slice(0, MAX_FORESHADOWINGS);

  const ledger = buildStoryStateLedger({
    novel,
    // The ledger only reads the last `recentChapterLimit` chapters — loading
    // just those rows avoids a full-book content scan per request.
    chapters: db.listRecentChapterContents(novel.id, 5),
    characters: prioritizeNamed(
      db.listCharacters(novel.id),
      chapterText,
      (entry) => entry.role === 'protagonist'
    ),
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
  const serverContext = truncate(
    [
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
      `【开放伏笔与叙事承诺】\n${
        ledger.openForeshadowings.length
          ? ledger.openForeshadowings
              .map(
                (entry) =>
                  `- [${entry.id}] ${entry.title} (${entry.status}): ${entry.description}${entry.revealConstraint ? `；揭示约束：${entry.revealConstraint}` : ''}`
              )
              .join('\n')
          : '- 无'
      }`,
    ].join('\n\n'),
    MAX_SERVER_CONTEXT_CHARS
  );
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
  const novel = db.getNovel(input.novelId);
  const chapter = db.getChapter(input.chapterId);
  if (!novel || !chapter) return base;
  // Shared single source with the production pipeline injection; embedding/search
  // is best-effort and the keyword ledger stays the fallback.
  const section = await buildSemanticRecallSection({
    novelId: novel.id,
    queryText: `${chapter.title}\n${chapter.content || ''}`,
  });
  if (!section) return base;
  return `${base}\n\n${section.marker}\n${section.text}`;
}
