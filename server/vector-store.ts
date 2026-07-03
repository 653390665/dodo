/**
 * Lightweight vector store backed by SQLite.
 */
import { getDb } from './lib/db-instance';
import { embed, cosineSimilarity } from './embedding';

/** Add a text chunk to the vector store (async, auto-embeds) */
export async function addChunk(
  novelId: string,
  chapterId: string,
  index: number,
  text: string
): Promise<void> {
  const embedding = await embed(text);
  const id = `${novelId}_${chapterId}_${index}`;
  const db = getDb();
  db.prepare(`
    INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      text = excluded.text,
      embedding = excluded.embedding
  `).run(id, novelId, chapterId, index, text, JSON.stringify(embedding));
}

/** Search top-k most similar chunks for a given novel */
export function searchSimilar(
  queryEmbedding: number[],
  novelId: string,
  topK: number = 5
): Array<{ text: string; score: number }> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT text, embedding FROM vector_chunks WHERE novel_id = ?
  `).all(novelId) as Array<{ text: string; embedding: string }>;

  const scored = rows.map((row) => {
    const emb = JSON.parse(row.embedding) as number[];
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
