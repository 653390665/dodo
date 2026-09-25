/**
 * 批次 C 知识失效语义（图谱维护闭环）：知识行记录摄入来源版本，失效只打标、不删除。
 *
 * - `source_version`：知识行的摄入来源指纹。资料包派生 = `pack:<packId>@<updatedAt>`；
 *   章节作用域派生 = `chapter:<chapterId>`（章节删除补偿按该值匹配）。
 * - `stale` / `stale_reason`：失效标记与原因（当前唯一原因族 `chapter-deleted:Ch012`）。
 *
 * 语义边界：
 * ① 章节删除只把「引用该章」的台账行与「来源版本等于该章」的边标为失效——可查询、可解释，不删除任何行；
 * ② 重跑 enrich 不删除既有边，也不重置既有失效标记（幂等只增不减）。
 */
import { getDb } from '../db-instance.js';
import { chapterOrderOfId } from '../../../shared/lib/knowledge-capabilities.js';

export const KG_PACK_VERSION_PREFIX = 'pack:';
export const KG_CHAPTER_VERSION_PREFIX = 'chapter:';
export const KG_STALE_REASON_CHAPTER_DELETED = 'chapter-deleted';

export interface KnowledgeStaleCounts {
  staleLedger: number;
  staleEdges: number;
}

export interface StaleKnowledgeRow {
  table: 'foreshadowings' | 'entity_relationships';
  id: string;
  label: string;
  staleReason: string | null;
  sourceVersion: string | null;
}

/** `Ch012`（与 `chapterOrderOfId` 的可解析口径一致，零填充三位）。 */
export function chapterTokenForOrder(order: number): string {
  return `Ch${String(order).padStart(3, '0')}`;
}

/** 资料包来源版本指纹：`pack:<packId>@<updatedAt>`；无资料包返回 null。 */
export function packSourceVersion(novelId: string): string | null {
  const row = getDb()
    .prepare('SELECT id, updated_at FROM continuation_packs WHERE novel_id = ? ORDER BY updated_at DESC LIMIT 1')
    .get(novelId) as { id: string; updated_at: number } | undefined;
  if (!row) return null;
  return `${KG_PACK_VERSION_PREFIX}${row.id}@${row.updated_at}`;
}

/** 章节作用域来源版本指纹：`chapter:<chapterId>`。 */
export function chapterSourceVersion(chapterId: string): string {
  return `${KG_CHAPTER_VERSION_PREFIX}${chapterId}`;
}

/**
 * 章节删除补偿：把引用该章的台账行与来源版本等于该章的边标为失效。
 * 只打标（`stale=1` + 原因），不删除；已在失效态的行不重复打标（保留首次原因）。
 */
export function markKnowledgeStaleForDeletedChapter(
  novelId: string,
  chapter: { id: string; order: number }
): { ledgerMarked: number; edgesMarked: number } {
  const db = getDb();
  const now = Date.now();
  const reason = `${KG_STALE_REASON_CHAPTER_DELETED}:${chapterTokenForOrder(chapter.order)}`;

  const ledgerRows = db
    .prepare(
      'SELECT id, planted_chapter_id, payoff_chapter_id FROM foreshadowings WHERE novel_id = ? AND stale = 0'
    )
    .all(novelId) as Array<{ id: string; planted_chapter_id: string | null; payoff_chapter_id: string | null }>;
  const markLedger = db.prepare(
    'UPDATE foreshadowings SET stale = 1, stale_reason = ?, updated_at = ? WHERE id = ?'
  );
  let ledgerMarked = 0;
  for (const row of ledgerRows) {
    const hit =
      chapterOrderOfId(row.planted_chapter_id) === chapter.order ||
      chapterOrderOfId(row.payoff_chapter_id) === chapter.order;
    if (!hit) continue;
    markLedger.run(reason, now, row.id);
    ledgerMarked += 1;
  }

  const edgesMarked = db
    .prepare(
      'UPDATE entity_relationships SET stale = 1, stale_reason = ? WHERE novelId = ? AND stale = 0 AND source_version = ?'
    )
    .run(reason, novelId, chapterSourceVersion(chapter.id)).changes;

  return { ledgerMarked, edgesMarked: Number(edgesMarked) };
}

export function countStaleKnowledgeRows(novelId: string): KnowledgeStaleCounts {
  const db = getDb();
  const count = (sql: string) =>
    (db.prepare(sql).get(novelId) as { n: number } | undefined)?.n ?? 0;
  return {
    staleLedger: count('SELECT count(*) AS n FROM foreshadowings WHERE novel_id = ? AND stale = 1'),
    staleEdges: count('SELECT count(*) AS n FROM entity_relationships WHERE novelId = ? AND stale = 1'),
  };
}

/** 失效行可查询面（测试与后续 UI 入口共用；按表分组、稳定排序）。 */
export function listStaleKnowledgeRows(novelId: string): StaleKnowledgeRow[] {
  const db = getDb();
  const ledger = db
    .prepare(
      'SELECT id, title, stale_reason, source_version FROM foreshadowings WHERE novel_id = ? AND stale = 1 ORDER BY planted_chapter_id, id'
    )
    .all(novelId) as Array<{ id: string; title: string; stale_reason: string | null; source_version: string | null }>;
  const edges = db
    .prepare(
      'SELECT id, description, stale_reason, source_version FROM entity_relationships WHERE novelId = ? AND stale = 1 ORDER BY relationshipType, id'
    )
    .all(novelId) as Array<{
    id: string;
    description: string;
    stale_reason: string | null;
    source_version: string | null;
  }>;
  return [
    ...ledger.map((row) => ({
      table: 'foreshadowings' as const,
      id: row.id,
      label: row.title,
      staleReason: row.stale_reason ?? null,
      sourceVersion: row.source_version ?? null,
    })),
    ...edges.map((row) => ({
      table: 'entity_relationships' as const,
      id: row.id,
      label: row.description,
      staleReason: row.stale_reason ?? null,
      sourceVersion: row.source_version ?? null,
    })),
  ];
}
