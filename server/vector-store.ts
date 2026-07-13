/**
 * Lightweight vector store backed by SQLite.
 */
import {
  getDatabaseGeneration,
  getDb,
  runInSerializedWriteForGeneration,
} from './lib/db-instance';
import { embed, cosineSimilarity } from './embedding';

// 常驻内存向量解析 Cache，避免高频相似度计算下的重复 JSON.parse 消耗
const embeddingCache = new Map<string, number[]>();

/** Add a text chunk to the vector store (async, auto-embeds) */
export async function addChunk(
  novelId: string,
  chapterId: string,
  index: number,
  text: string
): Promise<void> {
  const generation = getDatabaseGeneration();
  const embedding = await embed(text);
  const id = `${novelId}_${chapterId}_${index}`;

  await runInSerializedWriteForGeneration(generation, () => {
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
}

/** Clear data derived from a previously mounted database. */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/** Search top-k most similar chunks for a given novel */
export function searchSimilar(
  queryEmbedding: number[],
  novelId: string,
  topK: number = 5
): Array<{ text: string; score: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, text, embedding FROM vector_chunks WHERE novel_id = ?
  `).all(novelId) as Array<{ id: string; text: string; embedding: string }>;

  const scored = rows.map((row) => {
    let emb = embeddingCache.get(row.id);
    if (!emb) {
      emb = JSON.parse(row.embedding) as number[];
      embeddingCache.set(row.id, emb);
    }
    return {
      text: row.text,
      score: cosineSimilarity(queryEmbedding, emb),
    };
  });
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
