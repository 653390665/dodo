import type { Novel } from '../../../shared/types';
import { rowToNovel, novelToRow } from '../db-mappers.js';
import { createCrudHelpers } from '../db-crud.js';
import { getDb } from '../db-instance.js';
import { deleteNovel as deleteVectorChunks } from '../../vector-store.js';

const novelCrud = createCrudHelpers<Novel, ReturnType<typeof novelToRow>>({
  tableName: 'novels',
  rowToEntity: rowToNovel,
  entityToRow: novelToRow,
  insertColumns: [
    'id', 'title', 'author_id', 'summary', 'cover_image', 'status', 'world_rules',
    'global_outline', 'mounted_skill_ids', 'mounted_skill_loadout',
    'project_preference_profile', 'created_at', 'updated_at'
  ],
  updateColumns: [
    'title', 'author_id', 'summary', 'cover_image', 'status', 'world_rules',
    'global_outline', 'mounted_skill_ids', 'mounted_skill_loadout',
    'project_preference_profile', 'updated_at'
  ],
  listOrderBy: 'updated_at DESC'
});

export function listNovels(): Novel[] {
  return novelCrud.list();
}

export function getNovel(id: string): Novel | undefined {
  return novelCrud.get(id);
}

export function createNovel(novel: Novel): void {
  novelCrud.create(novel);
}

export function updateNovel(id: string, data: Partial<Novel>): void {
  novelCrud.update(id, data);
}

export function deleteNovel(id: string): void {
  const db = getDb();
  // 使用事务封装，保证删除逻辑的原子性与数据一致性
  const deleteTransaction = db.transaction(() => {
    // 1. 手动清理不带外键 CASCADE 约束的 continuation_packs 表记录
    db.prepare('DELETE FROM continuation_packs WHERE novel_id = ?').run(id);

    // 2. 调用 vector-store 的 deleteNovel 级联清理 vector_chunks 与向量常驻内存缓存
    deleteVectorChunks(id);

    // 3. 手动提前清理可能引发级联 SET NULL 与 CASCADE 执行冲突的关联子表
    db.prepare('DELETE FROM skill_usage_records WHERE novel_id = ?').run(id);
    db.prepare('DELETE FROM chapter_production_runs WHERE novel_id = ?').run(id);

    // 4. 手动清理 entity_relationships 记录（虽然有 CASCADE，但在 novels 删掉前彻底清除更安全）
    db.prepare('DELETE FROM entity_relationships WHERE novelId = ?').run(id);

    // 5. 最后安全删除 novels 表记录，这将由 SQLite 级联触发 characters, chapters, locations 等子表的删除
    novelCrud.delete(id);
  });

  deleteTransaction();
}

