/**
 * 向量索引初始化 CLI：为作品存量章节回填语义索引（本地 bge 模型嵌入，
 * 不调用任何 LLM 写作）。已有索引的章节自动跳过，幂等可重跑。
 *
 * 用法：npx tsx server/cli/vector-init.ts <novelId>
 */
import { initDb } from '../lib/db.ts';
import { getDb } from '../lib/db-instance.ts';
import { addChunk } from '../vector-store.ts';

initDb();
const db = getDb();
const novelId = process.argv[2];
if (!novelId) {
  console.error('用法: npx tsx server/cli/vector-init.ts <novelId>');
  process.exit(1);
}

const chapters = db
  .prepare('SELECT id, title, content FROM chapters WHERE novel_id = ? AND length(content) > 100 ORDER BY created_at')
  .all(novelId) as Array<{ id: string; title: string; content: string }>;
console.log(`待索引章节: ${chapters.length}`);

const chunked = new Set(
  (db.prepare('SELECT DISTINCT chapter_id AS id FROM vector_chunks WHERE novel_id = ?').all(novelId) as Array<{ id: string }>).map(
    (r) => r.id
  )
);

let indexed = 0;
let skipped = 0;
for (const chapter of chapters) {
  if (chunked.has(chapter.id)) {
    skipped += 1;
    continue;
  }
  process.stdout.write(`索引中: ${chapter.title || chapter.id} (${chapter.content.length}字) … `);
  try {
    // 整章单 chunk：与生产接受流程的索引粒度一致
    await addChunk(novelId, chapter.id, 0, chapter.content);
    indexed += 1;
    console.log('完成');
  } catch (err) {
    console.log('失败:', err instanceof Error ? err.message.slice(0, 100) : err);
  }
}
console.log(`=== 完成：新索引 ${indexed} 章，跳过已索引 ${skipped} 章 ===`);
