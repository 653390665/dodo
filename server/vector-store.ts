/**
 * Lightweight vector store backed by SQLite.
 */
import {
  getDatabaseGeneration,
  getDb,
  runInSerializedWriteForGeneration,
} from './lib/db-instance';
import { createHash } from 'node:crypto';
import { embedWithMetadata, cosineSimilarity } from './embedding';

interface StoredEmbedding {
  values: number[];
  modelId: string;
  dimensions: number;
  contentHash: string;
}

// 常驻内存向量解析 Cache，避免高频相似度计算下的重复 JSON.parse 消耗
const embeddingCache = new Map<string, StoredEmbedding>();

export class VectorIndexGenerationMismatchError extends Error {
  readonly code = 'VECTOR_INDEX_GENERATION_MISMATCH';

  constructor() {
    super('数据库已切换，已丢弃旧章节的语义索引任务');
    this.name = 'VectorIndexGenerationMismatchError';
  }
}

/** Add a text chunk to the vector store (async, auto-embeds) */
export async function addChunk(
  novelId: string,
  chapterId: string,
  index: number,
  text: string
): Promise<void> {
  const generation = getDatabaseGeneration();
  const embedded = await embedWithMetadata(text, novelId);
  const embedding: StoredEmbedding = {
    values: embedded.values,
    modelId: embedded.modelId,
    dimensions: embedded.values.length,
    contentHash: createHash('sha256').update(text).digest('hex'),
  };
  const id = `${novelId}_${chapterId}_${index}`;

  const guarded = await runInSerializedWriteForGeneration(generation, () => {
    embeddingCache.set(id, embedding);
    const db = getDb();
    db.prepare(`
      INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        embedding = excluded.embedding
    `).run(id, novelId, chapterId, index, text, JSON.stringify(embedding));
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
  topK: number = 5,
): Array<{ text: string; score: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, text, embedding FROM vector_chunks WHERE novel_id = ?
  `).all(novelId) as Array<{ id: string; text: string; embedding: string }>;

  const scored = rows.map((row) => {
    let stored = embeddingCache.get(row.id);
    if (!stored) {
      const parsed = JSON.parse(row.embedding) as number[] | StoredEmbedding;
      const values = Array.isArray(parsed) ? parsed : parsed.values;
      stored = Array.isArray(parsed)
        ? { values, modelId: 'legacy:unknown', dimensions: values.length, contentHash: '' }
        : parsed;
      embeddingCache.set(row.id, stored);
    }
    const compatible = stored.modelId !== 'legacy:unknown'
      && stored.modelId === queryModelId
      && stored.dimensions === queryEmbedding.length;
    return {
      text: row.text,
      score: compatible ? cosineSimilarity(queryEmbedding, stored.values) : Number.NEGATIVE_INFINITY,
    };
  }).filter((row) => Number.isFinite(row.score));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
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

/** Export raw chunks for debugging */
export function getChunkCount(novelId?: string): number {
  const db = getDb();
  if (novelId) {
    const row = db.prepare('SELECT COUNT(*) as count FROM vector_chunks WHERE novel_id = ?').get(novelId) as { count: number } | undefined;
    return row ? row.count : 0;
  } else {
    const row = db.prepare('SELECT COUNT(*) as count FROM vector_chunks').get() as { count: number } | undefined;
    return row ? row.count : 0;
  }
}
