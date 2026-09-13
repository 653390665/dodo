/**
 * Lightweight vector store backed by SQLite.
 */
import { getDatabaseGeneration, getDb, runInSerializedWriteForGeneration } from './lib/db-instance';
import { createHash } from 'node:crypto';
import { embedWithMetadata, cosineSimilarity } from './embedding';
import { logger } from './logger';

interface StoredEmbedding {
  values: number[];
  modelId: string;
  dimensions: number;
  contentHash: string;
}

// 常驻内存向量解析 Cache，避免高频相似度计算下的重复 JSON.parse 消耗。
// 以 Map 插入序近似 FIFO 淘汰（get 不提升位次），防止无界增长；未来需要真实 LRU 再替换。
const EMBEDDING_CACHE_MAX_ENTRIES = 5_000;
const embeddingCache = new Map<string, StoredEmbedding>();

function setCachedEmbedding(id: string, stored: StoredEmbedding): void {
  embeddingCache.set(id, stored);
  while (embeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldest = embeddingCache.keys().next().value;
    if (oldest === undefined) break;
    embeddingCache.delete(oldest);
  }
}

export class VectorIndexGenerationMismatchError extends Error {
  readonly code = 'VECTOR_INDEX_GENERATION_MISMATCH';

  constructor() {
    super('数据库已切换，已丢弃旧章节的语义索引任务');
    this.name = 'VectorIndexGenerationMismatchError';
  }
}

async function buildStoredEmbedding(text: string, novelId: string): Promise<StoredEmbedding> {
  const embedded = await embedWithMetadata(text, novelId);
  return {
    values: embedded.values,
    modelId: embedded.modelId,
    dimensions: embedded.values.length,
    contentHash: createHash('sha256').update(text).digest('hex'),
  };
}

/** Add a text chunk to the vector store (async, auto-embeds) */
export async function addChunk(
  novelId: string,
  chapterId: string,
  index: number,
  text: string
): Promise<void> {
  const generation = getDatabaseGeneration();
  const embedding = await buildStoredEmbedding(text, novelId);
  const id = `${novelId}_${chapterId}_${index}`;

  const guarded = await runInSerializedWriteForGeneration(generation, () => {
    setCachedEmbedding(id, embedding);
    const db = getDb();
    db.prepare(
      `
      INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        embedding = excluded.embedding
    `
    ).run(id, novelId, chapterId, index, text, JSON.stringify(embedding));
  });
  if (!guarded.executed) throw new VectorIndexGenerationMismatchError();
}

/** Clear data derived from a previously mounted database. */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/** Search top-k most similar chunks for a given novel */
export function searchSimilar(
  queryEmbedding: number[],
  novelId: string,
  queryModelId: string,
  topK: number = 5
): Array<{ text: string; score: number; chapterId: string }> {
  return searchSimilarWithStats(queryEmbedding, novelId, queryModelId, topK).hits;
}

export interface SearchSimilarStats {
  hits: Array<{ text: string; score: number; chapterId: string }>;
  /** 本次扫描的本书 chunk 总数 */
  scanned: number;
  /** 因模型/维度不兼容被静默排除、未参与检索的 chunk 数（Plan 201 代际过期提示依据） */
  excludedIncompatible: number;
}

/** Search top-k similar chunks and expose compatibility-exclusion stats. */
export function searchSimilarWithStats(
  queryEmbedding: number[],
  novelId: string,
  queryModelId: string,
  topK: number = 5
): SearchSimilarStats {
  const db = getDb();
  const rows = db
    .prepare(
      `
    SELECT id, chapter_id, text, embedding FROM vector_chunks WHERE novel_id = ?
  `
    )
    .all(novelId) as Array<{ id: string; chapter_id: string; text: string; embedding: string }>;
  // 调查项（Plan 184）：检索当前为全表扫描线性余弦。chunk 超过阈值时记录一次，
  // 积累数据后另立计划决定是否引入 sqlite-vec/分块；不做算法替换。
  if (rows.length >= 1_000) {
    logger.info('searchSimilar 全表扫描规模达到调查阈值', { novelId, chunks: rows.length, topK });
  }

  let excludedIncompatible = 0;
  const scored = rows
    .map((row) => {
      let stored = embeddingCache.get(row.id);
      if (!stored) {
        const parsed = JSON.parse(row.embedding) as number[] | StoredEmbedding;
        const values = Array.isArray(parsed) ? parsed : parsed.values;
        stored = Array.isArray(parsed)
          ? { values, modelId: 'legacy:unknown', dimensions: values.length, contentHash: '' }
          : parsed;
        setCachedEmbedding(row.id, stored);
      }
      const compatible =
        stored.modelId !== 'legacy:unknown' &&
        stored.modelId === queryModelId &&
        stored.dimensions === queryEmbedding.length;
      if (!compatible) excludedIncompatible += 1;
      return {
        text: row.text,
        score: compatible
          ? cosineSimilarity(queryEmbedding, stored.values)
          : Number.NEGATIVE_INFINITY,
        chapterId: row.chapter_id,
      };
    })
    .filter((row) => Number.isFinite(row.score));
  scored.sort((a, b) => b.score - a.score);
  return { hits: scored.slice(0, topK), scanned: rows.length, excludedIncompatible };
}

/** Remove all chunks for a novel (e.g., on deletion) */
export function deleteNovel(novelId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM vector_chunks WHERE novel_id = ?').run(novelId);

  // 同步清理内存缓存，确保无任何内存泄漏隐患
  const prefix = `${novelId}_`;
  for (const key of embeddingCache.keys()) {
    if (key.startsWith(prefix)) {
      embeddingCache.delete(key);
    }
  }
}

function pruneChapterCache(novelId: string, chapterId: string): void {
  const prefix = `${novelId}_${chapterId}_`;
  for (const key of embeddingCache.keys()) {
    if (key.startsWith(prefix)) {
      embeddingCache.delete(key);
    }
  }
}

/** Remove all chunks of a single chapter (Plan 201：删章/重写清理，此前仅 deleteNovel 级联清理） */
export function deleteChapterChunks(novelId: string, chapterId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM vector_chunks WHERE novel_id = ? AND chapter_id = ?').run(
    novelId,
    chapterId
  );
  pruneChapterCache(novelId, chapterId);
}

/** 已索引的某章 index-0 文本（无则 undefined），供回填按内容去重、避免重复 embed。 */
export function getChapterChunkText(
  novelId: string,
  chapterId: string,
  index: number = 0
): string | undefined {
  const db = getDb();
  const row = db
    .prepare(
      'SELECT text FROM vector_chunks WHERE novel_id = ? AND chapter_id = ? AND chunk_index = ?'
    )
    .get(novelId, chapterId, index) as { text: string } | undefined;
  return row?.text;
}

/**
 * Plan 201 — 章级 upsert：先清该章全部旧 chunk，再按 index 0 重写。
 * delete 与 embed 均在写事务外执行（调用方保证异步回填语境）；embedding 失败时
 * 旧 chunk 已清除（诚实语义：该章暂不可检索，下次保存自动重试），错误向上抛出，
 * 由回填编排（server/lib/chapter-index.ts）捕获记日志，绝不影响正文保存。
 * 数据库代际不匹配时 addChunk 抛出 VectorIndexGenerationMismatchError（静默丢弃）。
 */
export async function upsertChapterChunk(
  novelId: string,
  chapterId: string,
  text: string
): Promise<void> {
  deleteChapterChunks(novelId, chapterId);
  await addChunk(novelId, chapterId, 0, text);
}

/** Export raw chunks for debugging */
export function getChunkCount(novelId?: string): number {
  const db = getDb();
  if (novelId) {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM vector_chunks WHERE novel_id = ?')
      .get(novelId) as { count: number } | undefined;
    return row ? row.count : 0;
  } else {
    const row = db.prepare('SELECT COUNT(*) as count FROM vector_chunks').get() as
      { count: number } | undefined;
    return row ? row.count : 0;
  }
}
