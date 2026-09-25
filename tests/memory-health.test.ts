/**
 * 批次 D · 记忆健康度看板（/api/novels/:novelId/memory-health）验收测试。
 *
 * 覆盖小类三条验收：
 * ① 四项指标可见（本文件覆盖接口面与数值；界面见 src/tests/memory-health-panel.test.tsx）；
 * ② 数据缺失显示未知——对应项返回 null + unknownReason，绝不折算 0；
 * ③ 口径与后端计算同源——响应逐项等于既有单源函数（checklist / stale 计数 / 孤立节点纯函数）结果。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { closeDb, getDb } from '../server/lib/db-instance.js';
import { initDb } from '../server/lib/db-init.js';
import * as db from '../server/lib/db.js';
import { registerUtilityRoutes } from '../server/routes/utilities.js';
import { MemoryHealthError, collectMemoryHealth } from '../server/helpers/memory-health.js';
import { buildForeshadowSettlementChecklist } from '../shared/lib/knowledge-capabilities.js';
import {
  computeOrphanEntityIds,
  memoryHealthMetricByKey,
  memoryHealthValueLabel,
  MEMORY_HEALTH_METRIC_KEYS,
  type MemoryHealthEntityRef,
} from '../shared/lib/memory-health.js';
import type { Chapter, Character, EntityRelationship, Foreshadowing, Novel } from '../shared/types.js';

const app = express();
app.use(express.json());
registerUtilityRoutes(app);
const server = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
  const instance = app.listen(0, () => resolve(instance));
  instance.once('error', reject);
});
const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

function freshDb(): void {
  closeDb();
  initDb(':memory:');
}

test.after(() => {
  closeDb();
  server.close();
});

function novel(id: string): Novel {
  return {
    id,
    title: '记忆健康度测试作品',
    authorId: 'local',
    summary: '',
    status: 'ongoing',
    mountedSkillIds: [],
    mountedSkillLoadout: [],
    createdAt: 1,
    updatedAt: 1,
  } as Novel;
}

function seedChapter(novelId: string, id: string, order: number, title: string): void {
  db.createChapter({
    id,
    novelId,
    title,
    content: '',
    order,
    wordCount: 0,
    createdAt: 1,
    updatedAt: 1,
  } as Chapter);
}

function seedCharacter(novelId: string, id: string, name: string): void {
  db.createCharacter({
    id,
    novelId,
    name,
    role: 'supporting',
    summary: '',
    traits: [],
    bio: '',
    createdAt: 1,
    updatedAt: 1,
  } as Character);
}

function seedLocation(novelId: string, id: string, name: string): void {
  db.createLocation({
    id,
    novelId,
    name,
    description: '',
    region: '',
    createdAt: 1,
    updatedAt: 1,
  } as Parameters<typeof db.createLocation>[0]);
}

function seedItem(novelId: string, id: string, name: string): void {
  db.createItem({
    id,
    novelId,
    name,
    description: '',
    type: 'relic',
    createdAt: 1,
    updatedAt: 1,
  } as Parameters<typeof db.createItem>[0]);
}

function seedEdge(
  novelId: string,
  id: string,
  source: { type: string; id: string },
  target: { type: string; id: string }
): void {
  db.createEntityRelationship({
    id,
    novelId,
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relationshipType: 'mentions',
    description: '',
    createdAt: 1,
  } as EntityRelationship);
}

function seedForeshadowing(
  novelId: string,
  id: string,
  title: string,
  status: Foreshadowing['status'],
  plantedChapterId?: string
): void {
  db.createForeshadowing({
    id,
    novelId,
    title,
    description: '',
    status,
    ...(plantedChapterId ? { plantedChapterId } : {}),
    relatedCharacterIds: [],
    createdAt: 1,
    updatedAt: 1,
  } as Foreshadowing);
}

function seedPack(novelId: string): void {
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
      JSON.stringify([{ filename: '逐章细纲.md', kind: 'outline', text: '### Ch001 · 开篇' }]),
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

function entityRefs(novelId: string): MemoryHealthEntityRef[] {
  const refs: MemoryHealthEntityRef[] = [];
  for (const character of db.listCharacters(novelId)) refs.push({ type: 'character', id: character.id });
  for (const location of db.listLocations(novelId)) refs.push({ type: 'location', id: location.id });
  for (const item of db.listItems(novelId)) refs.push({ type: 'item', id: item.id });
  for (const faction of db.listFactions(novelId)) refs.push({ type: 'faction', id: faction.id });
  return refs;
}

async function getMemoryHealth(novelId: string) {
  const response = await fetch(`${baseUrl}/api/novels/${encodeURIComponent(novelId)}/memory-health`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

test('四项指标逐项等于既有单源计算（同源）且顺序固定', async () => {
  freshDb();
  const novelId = 'mh-sync';
  db.createNovel(novel(novelId));
  seedPack(novelId);
  seedChapter(novelId, 'ch-1', 1, '开篇');
  seedChapter(novelId, 'ch-2', 2, '发展');
  seedChapter(novelId, 'ch-3', 3, '转折');
  seedCharacter(novelId, 'c-linked', '林舟');
  seedCharacter(novelId, 'c-orphan', '苏晚');
  seedLocation(novelId, 'l-linked', '雾港');
  seedItem(novelId, 'i-orphan', '旧灯');
  seedEdge(
    novelId,
    'edge-1',
    { type: 'character', id: 'c-linked' },
    { type: 'location', id: 'l-linked' }
  );
  seedForeshadowing(novelId, 'f-open', '舱单', 'planted', 'Ch001');
  seedForeshadowing(novelId, 'f-hinted', '灯塔', 'hinted', 'Ch002');
  seedForeshadowing(novelId, 'f-done', '钥匙', 'payoff', 'Ch002');
  // 失效标记：台账 1 行 + 关系边 1 条（沿用知识失效语义的列，只打标不删除）。
  getDb()
    .prepare("UPDATE foreshadowings SET stale = 1, stale_reason = 'chapter-deleted:Ch003' WHERE id = ?")
    .run('f-open');
  getDb()
    .prepare(
      "UPDATE entity_relationships SET stale = 1, stale_reason = 'chapter-deleted:Ch003' WHERE id = ?"
    )
    .run('edge-1');

  const snapshot = await collectMemoryHealth(novelId);

  const expected = buildForeshadowSettlementChecklist({
    foreshadowings: db.listForeshadowings(novelId),
    currentChapterOrder: 3,
  });
  const expectedStale = db.countStaleKnowledgeRows(novelId);
  const expectedOrphans = computeOrphanEntityIds({
    entities: entityRefs(novelId),
    relationships: db.listEntityRelationships(novelId),
  });

  assert.equal(expected.openCount, 2, '未回收口径：status !== payoff');
  assert.deepEqual(
    expectedOrphans.map((ref) => ref.id),
    ['c-orphan', 'i-orphan'],
    '孤立节点：既非 source 也非 target'
  );
  assert.equal(expectedStale.staleLedger, 1);
  assert.equal(expectedStale.staleEdges, 1);

  assert.deepEqual(
    snapshot.metrics.map((metric) => metric.key),
    [...MEMORY_HEALTH_METRIC_KEYS],
    '指标顺序固定'
  );
  const open = memoryHealthMetricByKey(snapshot.metrics, 'openForeshadowings');
  const orphans = memoryHealthMetricByKey(snapshot.metrics, 'orphanNodes');
  const stale = memoryHealthMetricByKey(snapshot.metrics, 'staleKnowledge');
  assert.equal(open?.value, expected.openCount);
  assert.equal(orphans?.value, expectedOrphans.length);
  assert.equal(stale?.value, expectedStale.staleLedger + expectedStale.staleEdges);
  assert.equal(stale?.detail, `台账 ${expectedStale.staleLedger} · 关系边 ${expectedStale.staleEdges}`);
  assert.equal(open?.label, '未回收伏笔');
  assert.equal(orphans?.label, '孤立节点');
  assert.equal(stale?.label, '失效知识');
  assert.equal(memoryHealthMetricByKey(snapshot.metrics, 'ragHits')?.label, 'RAG 命中');

  // 无向量索引 ⇒ RAG 命中为未知（不是 0）。
  const rag = memoryHealthMetricByKey(snapshot.metrics, 'ragHits');
  assert.equal(rag?.value, null);
  assert.match(String(rag?.unknownReason), /向量索引/);
  assert.equal(memoryHealthValueLabel(rag!), '未知');
  assert.equal(snapshot.evidence.indexedChunks, 0);

  const { status, body } = await getMemoryHealth(novelId);
  assert.equal(status, 200);
  assert.deepEqual(
    (body.metrics as { key: string; value: number | null }[]).map((metric) => [
      metric.key,
      metric.value,
    ]),
    snapshot.metrics.map((metric) => [metric.key, metric.value]),
    '路由响应与 helper 同源'
  );
});

test('从未摄入资料包：图谱三项返回未知而非 0，RAG 亦未知', async () => {
  freshDb();
  const novelId = 'mh-empty';
  db.createNovel(novel(novelId));

  const snapshot = await collectMemoryHealth(novelId);
  for (const key of ['openForeshadowings', 'orphanNodes', 'staleKnowledge'] as const) {
    const metric = memoryHealthMetricByKey(snapshot.metrics, key);
    assert.equal(metric?.value, null, `${key} 不得以 0 顶替`);
    assert.ok(metric?.unknownReason, `${key} 必须给出未知原因`);
    assert.equal(memoryHealthValueLabel(metric!), '未知');
  }
  assert.equal(memoryHealthMetricByKey(snapshot.metrics, 'ragHits')?.value, null);
  assert.equal(snapshot.evidence.packDocuments, 0);
  assert.equal(snapshot.evidence.foreshadowingRows, 0);

  const { status, body } = await getMemoryHealth(novelId);
  assert.equal(status, 200);
  assert.equal(
    (body.metrics as { key: string; value: number | null }[]).filter(
      (metric) => metric.value === 0
    ).length,
    0,
    '未知不得渲染成 0'
  );
});

test('已摄入但确为 0：真实 0 与未知可区分', async () => {
  freshDb();
  const novelId = 'mh-ingested-empty';
  db.createNovel(novel(novelId));
  seedPack(novelId);

  const snapshot = await collectMemoryHealth(novelId);
  assert.equal(memoryHealthMetricByKey(snapshot.metrics, 'openForeshadowings')?.value, 0);
  assert.equal(memoryHealthMetricByKey(snapshot.metrics, 'orphanNodes')?.value, 0);
  assert.equal(memoryHealthMetricByKey(snapshot.metrics, 'staleKnowledge')?.value, 0);
  assert.equal(
    memoryHealthValueLabel(memoryHealthMetricByKey(snapshot.metrics, 'openForeshadowings')!),
    '0'
  );
});

test('索引存在但嵌入不可用：RAG 命中报未知（附嵌入状态）', async () => {
  freshDb();
  const novelId = 'mh-rag';
  db.createNovel(novel(novelId));
  seedChapter(novelId, 'ch-1', 1, '开篇');
  getDb()
    .prepare(
      'INSERT INTO vector_chunks (id, novel_id, chapter_id, chunk_index, text, embedding) VALUES (?,?,?,?,?,?)'
    )
    .run('chunk-1', novelId, 'ch-1', 0, '雾港的灯', '[]');

  const snapshot = await collectMemoryHealth(novelId);
  const rag = memoryHealthMetricByKey(snapshot.metrics, 'ragHits');
  assert.equal(rag?.value, null);
  assert.match(String(rag?.unknownReason), /嵌入模型/);
  assert.equal(snapshot.evidence.indexedChunks, 1);
  assert.notEqual(snapshot.evidence.embeddingStatus, 'ready');
});

test('作品不存在：helper 抛 404，路由返回同码', async () => {
  freshDb();
  await assert.rejects(
    () => collectMemoryHealth('mh-missing'),
    (error: unknown) => error instanceof MemoryHealthError && error.status === 404
  );
  const { status, body } = await getMemoryHealth('mh-missing');
  assert.equal(status, 404);
  assert.equal(body.code, 'MEMORY_HEALTH_NOVEL_NOT_FOUND');
});
