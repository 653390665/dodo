import type { ChapterMetadata, ContinuationPack } from '../../../shared/types';
import { getDb } from '../db-instance.js';
import { mapContinuationPackRow } from '../db-mappers.js';

export interface LibraryMetadataBatch {
  chapters: Record<string, ChapterMetadata[]>;
  packs: Record<string, ContinuationPack[]>;
}

export function listLibraryMetadata(novelIds: string[]): LibraryMetadataBatch {
  const ids = [...new Set(novelIds.filter((id) => typeof id === 'string' && id.trim()))];
  if (ids.length === 0) return { chapters: {}, packs: {} };
  const placeholders = ids.map(() => '?').join(',');
  const db = getDb();
  const chapterRows = db.prepare(`SELECT id, novel_id, volume_name, title, "order", word_count, workflow_meta, created_at, updated_at FROM chapters WHERE novel_id IN (${placeholders}) ORDER BY novel_id, "order" ASC`).all(...ids) as Array<Record<string, unknown>>;
  const packRows = db.prepare(`SELECT * FROM continuation_packs WHERE novel_id IN (${placeholders}) ORDER BY novel_id, updated_at DESC`).all(...ids) as Array<Record<string, unknown>>;
  const chapters: Record<string, ChapterMetadata[]> = Object.fromEntries(ids.map((id) => [id, []]));
  const packs: Record<string, ContinuationPack[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const row of chapterRows) {
    const novelId = String(row.novel_id);
    chapters[novelId]?.push({ id: String(row.id), novelId, volumeName: row.volume_name ? String(row.volume_name) : undefined, title: String(row.title), order: Number(row.order), wordCount: Number(row.word_count), workflowMeta: (() => { try { return row.workflow_meta ? JSON.parse(String(row.workflow_meta)) : undefined; } catch { return undefined; } })(), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
  }
  for (const row of packRows) {
    const pack = mapContinuationPackRow(row);
    packs[pack.novelId]?.push(pack);
  }
  return { chapters, packs };
}
