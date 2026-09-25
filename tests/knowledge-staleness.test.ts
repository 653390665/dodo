/**
 * 批次 C · 图谱失效语义（sourceVersion / stale / 章节删除补偿 / 重跑不删除）验收测试。
 *
 * 覆盖本小类三条验收：
 * ① 章节删除后相关边/台账被标 stale 且可查询（用例：deleteChapter 真实路径 + listStaleKnowledgeRows）；
 * ② 重跑 enrich 不删除任何既有边、不重置既有失效标记（不变量测试 + 源码不变量）；
 * ③ stale 计数可从接口读取（coverage.staleLedger / coverage.staleEdges）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { closeDb, getDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { runLineageEnrichment } from '../server/helpers/knowledge-lineage-enrich.js';
import { runKnowledgeCapability } from '../server/helpers/knowledge-capabilities.js';
import {
  chapterSourceVersion,
  countStaleKnowledgeRows,
  listStaleKnowledgeRows,
  markKnowledgeStaleForDeletedChapter,
  packSourceVersion,
} from '../server/lib/db/knowledge-staleness.js';
import type { Chapter } from '../shared/types.js';

test.after(() => {
  closeDb();
});

function now(): number {
  return Date.now();
}

function seedNovel(id: string): void {
  getDb()
    .prepare('INSERT INTO novels (id, title, created_at, updated_at) VALUES (?,?,?,?)')
    .run(id, '图谱失效测试作品', now(), now());
}

function seedPack(novelId: string, filename: string, text: string): void {
  getDb()
    .prepare(
      `INSERT INTO continuation_packs
        (id, novel_id, title, status, source_documents, canon_facts, character_states, plot_state, style_profile, contradictions, continuation_task, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      `pack-${novelId}`,
      novelId,
      '测试资料包',
      'approved',
      JSON.stringify([{ filename, kind: 'outline', text }]),
      '[]',
      '[]',
      '{}',
      '{}',
      '[]',
      '{}',
      1,
      1
    );
}

function seedChapter(novelId: string, id: string, order: number): void {
  const chapter: Chapter = {
    id,
    novelId,
    title: `第${order}章`,
    content: '',
    order,
    wordCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
  db.createChapter(chapter);
}

function seedEdge(novelId: string, id: string, sourceVersion: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO entity_relationships
        (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt, source_version)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, novelId, 'character', 'c-1', 'item', 'i-1', '关联', `测试边 ${id}`, now(), sourceVersion);
}

function edgeRows(novelId: string): Array<{ id: string; stale: number; staleReason: string | null }> {
  return getDb()
    .prepare('SELECT id, stale, stale_reason AS staleReason FROM entity_relationships WHERE novelId = ? ORDER BY id')
    .all(novelId) as Array<{ id: string; stale: number; staleReason: string | null }>;
}

const XIGANG_FIXTURE = `
# 《测试》逐章细纲数据库

### Ch002 · 雾港的交接
**核心事件**：左妄在雾港接手舱单。
**伏笔埋点**：舱单上的第二个签名无人认领
**回收章**：Ch006
`;

test('① 章节删除后引用该章的台账与来源版本指向该章的边被标 stale 且可查询', () => {
  initDb(':memory:');
  seedNovel('fs-delete');
  seedPack('fs-delete', '逐章细纲.md', XIGANG_FIXTURE);
  seedChapter('fs-delete', 'ch-2', 2);

  const beforeRun = runLineageEnrichment('fs-delete');
  assert.equal(beforeRun.coverage.foreshadowings, 1);
  assert.equal(beforeRun.coverage.staleLedger, 0);
  assert.equal(beforeRun.coverage.staleEdges, 0);

  // 既有边：一条来自章节作用域摄入（source_version=chapter:<id>），一条来自资料包摄入。
  seedEdge('fs-delete', 'edge-chapter', chapterSourceVersion('ch-2'));
  seedEdge('fs-delete', 'edge-pack', packSourceVersion('fs-delete'));

  // 真实删除路径（server/lib/db/chapters.ts deleteChapter 钩子）。
  assert.equal(db.deleteChapter('ch-2'), true);

  assert.deepEqual(countStaleKnowledgeRows('fs-delete'), { staleLedger: 1, staleEdges: 1 });
  const rows = listStaleKnowledgeRows('fs-delete');
  assert.equal(rows.length, 2, '失效查询面应返回台账 + 边各一行');
  const ledgerRow = rows.find((row) => row.table === 'foreshadowings');
  assert.ok(ledgerRow, '台账行应可查询');
  assert.equal(ledgerRow.staleReason, 'chapter-deleted:Ch002');
  const edgeRow = rows.find((row) => row.table === 'entity_relationships');
  assert.equal(edgeRow?.id, 'edge-chapter');
  assert.equal(edgeRow?.sourceVersion, chapterSourceVersion('ch-2'));
  assert.equal(edgeRow?.staleReason, 'chapter-deleted:Ch002');

  // 非章节来源（资料包）的边不受章节删除影响。
  assert.equal(edgeRows('fs-delete').find((row) => row.id === 'edge-pack')?.stale, 0);

  // 重复补偿不重复打标（保留首次原因，只增不减）。
  assert.deepEqual(markKnowledgeStaleForDeletedChapter('fs-delete', { id: 'ch-2', order: 2 }), {
    ledgerMarked: 0,
    edgesMarked: 0,
  });
  assert.deepEqual(countStaleKnowledgeRows('fs-delete'), { staleLedger: 1, staleEdges: 1 });
});

test('② 重跑 enrich 不删除任何既有边，也不重置既有失效标记', () => {
  initDb(':memory:');
  seedNovel('fs-invariant');
  seedPack('fs-invariant', '逐章细纲.md', XIGANG_FIXTURE);
  seedEdge('fs-invariant', 'edge-keep', packSourceVersion('fs-invariant'));
  seedEdge('fs-invariant', 'edge-stale', chapterSourceVersion('ch-x'));
  markKnowledgeStaleForDeletedChapter('fs-invariant', { id: 'ch-x', order: 9 });

  const before = edgeRows('fs-invariant');
  assert.deepEqual(
    before.map((row) => [row.id, row.stale]),
    [
      ['edge-keep', 0],
      ['edge-stale', 1],
    ]
  );

  const first = runLineageEnrichment('fs-invariant');
  const second = runLineageEnrichment('fs-invariant');
  const after = edgeRows('fs-invariant');

  assert.deepEqual(after, before, '重跑前后边的集合与失效标记必须逐项一致');
  assert.equal(second.ledgerInserted, 0, '第二次重跑不新增台账');
  assert.equal(second.ledgerSkipped, 1, '第二次重跑按既有键跳过');
  assert.equal(first.coverage.staleEdges, 1);
  assert.equal(second.coverage.staleEdges, 1);

  // 源码不变量：enrich 从不删除知识行（只增不减的兑现方式）。
  const source = fs.readFileSync(
    fileURLToPath(new URL('../server/helpers/knowledge-lineage-enrich.ts', import.meta.url)),
    'utf8'
  );
  assert.ok(!source.includes('DELETE FROM entity_relationships'), 'enrich 不得删除边');
  assert.ok(!source.includes('DELETE FROM foreshadowings'), 'enrich 不得删除台账');
});

test('③ stale 计数经 knowledge-extract 接口可读', () => {
  initDb(':memory:');
  seedNovel('fs-api');
  seedPack('fs-api', '逐章细纲.md', XIGANG_FIXTURE);
  seedChapter('fs-api', 'ch-2', 2);
  runLineageEnrichment('fs-api');
  seedEdge('fs-api', 'edge-api-chapter', chapterSourceVersion('ch-2'));
  assert.equal(db.deleteChapter('ch-2'), true);

  const result = runKnowledgeCapability('fs-api', 'knowledge-extract');
  assert.equal(result.kind, 'coverage');
  if (result.kind !== 'coverage') return;
  assert.equal(result.coverage.coverage.staleLedger, 1);
  assert.equal(result.coverage.coverage.staleEdges, 1);
  // 正常计数不受影响（失效是标记，不是删除）。
  assert.equal(result.coverage.coverage.foreshadowings, 1);
  assert.equal(result.coverage.coverage.edges, 1);
});
