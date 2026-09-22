import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db-instance.js';
import {
  extractForeshadowingLedger,
  extractPowerHolderEdges,
  extractRelicHolderEdges,
  extractXigangEntries,
  RELATIONSHIP_TYPE_SYNONYMS,
} from './knowledge-lineage.js';
import type { Foreshadowing } from '../../shared/types';

/**
 * 知识谱系入库编排（Plan 261 Phase 1）：把资料包权威素材解析进
 * 伏笔台账与图谱边。全部幂等：台账按 title+plantedChapterId 去重，
 * 边按 source+target+type 去重；只新增，不删除既有行。
 */

export interface LineageReport {
  xigangEntries: number;
  ledgerInserted: number;
  ledgerSkipped: number;
  powerEdgesAdded: number;
  relicEdgesAdded: number;
  relicUnmatched: string[];
  relationshipTypesNormalized: number;
  coverage: {
    characters: number;
    items: number;
    locations: number;
    factions: number;
    powerLevels: number;
    timelineEvents: number;
    foreshadowings: number;
    edges: number;
  };
}

export function packSourceDocuments(db: ReturnType<typeof getDb>, novelId: string): Array<{
  filename: string;
  kind: string;
  text: string;
}> {
  const row = db
    .prepare(
      'SELECT source_documents AS docs FROM continuation_packs WHERE novel_id = ? ORDER BY updated_at DESC LIMIT 1'
    )
    .get(novelId) as { docs: string } | undefined;
  if (!row?.docs) return [];
  try {
    const parsed = JSON.parse(row.docs) as Array<{ filename: string; kind: string; text: string }>;
    return parsed.filter((d) => d.text);
  } catch {
    return [];
  }
}

function edgeExists(
  db: ReturnType<typeof getDb>,
  novelId: string,
  sourceId: string,
  targetId: string,
  relationshipType: string
): boolean {
  return Boolean(
    db
      .prepare(
        'SELECT id FROM entity_relationships WHERE novelId = ? AND sourceId = ? AND targetId = ? AND relationshipType = ?'
      )
      .get(novelId, sourceId, targetId, relationshipType)
  );
}

export function runLineageEnrichment(novelId: string): LineageReport {
  const db = getDb();
  const report: LineageReport = {
    xigangEntries: 0,
    ledgerInserted: 0,
    ledgerSkipped: 0,
    powerEdgesAdded: 0,
    relicEdgesAdded: 0,
    relicUnmatched: [],
    relationshipTypesNormalized: 0,
    coverage: { characters: 0, items: 0, locations: 0, factions: 0, powerLevels: 0, timelineEvents: 0, foreshadowings: 0, edges: 0 },
  };

  const docs = packSourceDocuments(db, novelId);
  const xigangDoc = docs.find((d) => d.filename.includes('逐章细纲'));
  const relicDoc = docs.find((d) => d.filename.includes('遗物体系'));

  // ①② 细纲条目 + 伏笔台账
  const entries = xigangDoc ? extractXigangEntries(xigangDoc.text) : [];
  report.xigangEntries = entries.length;
  const characterRows = db
    .prepare('SELECT id, name FROM characters WHERE novel_id = ?')
    .all(novelId) as Array<{ id: string; name: string }>;
  const nameToId = new Map(characterRows.map((c) => [c.name, c.id]));
  const existingLedger = db
    .prepare('SELECT title, planted_chapter_id AS plantedChapterId FROM foreshadowings WHERE novel_id = ?')
    .all(novelId) as Array<{ title: string; plantedChapterId: string | null }>;
  const ledgerKey = new Set(existingLedger.map((r) => `${r.title}\u0000${r.plantedChapterId}`));

  const insertForeshadowing = db.prepare(
    `INSERT INTO foreshadowings (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'planted', ?, ?, ?, ?, ?, ?)`
  );
  for (const row of extractForeshadowingLedger(entries)) {
    const key = `${row.title}\u0000${row.plantedChapter}`;
    if (ledgerKey.has(key)) {
      report.ledgerSkipped += 1;
      continue;
    }
    const cast = [...nameToId.keys()].filter((name) => row.description.includes(name));
    const now = Date.now();
    insertForeshadowing.run(
      randomUUID(),
      novelId,
      row.title,
      row.description,
      row.plantedChapter,
      row.payoffChapter,
      JSON.stringify(cast.map((name) => nameToId.get(name))),
      row.payoffNote ? `回收：${row.payoffNote}` : null,
      now,
      now
    );
    ledgerKey.add(key);
    report.ledgerInserted += 1;
  }

  // ③ 公理持有边（character→power_level 持有）
  const powerRows = db
    .prepare('SELECT name, description FROM power_levels WHERE novel_id = ?')
    .all(novelId) as Array<{ name: string; description: string }>;
  const characterNames = new Set(characterRows.map((c) => c.name));
  const insertEdge = db.prepare(
    `INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const powerIds = new Map(
    (db.prepare('SELECT id, name FROM power_levels WHERE novel_id = ?').all(novelId) as Array<{ id: string; name: string }>).map(
      (r) => [r.name, r.id]
    )
  );
  for (const edge of extractPowerHolderEdges(powerRows, characterNames)) {
    const powerId = powerIds.get(edge.powerName);
    const holderId = nameToId.get(edge.holderName);
    if (!powerId || !holderId) continue;
    if (edgeExists(db, novelId, holderId, powerId, '持有')) continue;
    insertEdge.run(randomUUID(), novelId, 'character', holderId, 'power', powerId, '持有', `${edge.holderName}持有${edge.powerName}`, Date.now());
    report.powerEdgesAdded += 1;
  }

  // ③b 遗物持有边（character→item 持有，来自遗物体系索引表）
  if (relicDoc) {
    const itemRows = db
      .prepare('SELECT id, name FROM items WHERE novel_id = ?')
      .all(novelId) as Array<{ id: string; name: string }>;
    const itemIdByExact = new Map(itemRows.map((r) => [r.name, r.id]));
    const itemIdByFuzzy = new Map<string, string>();
    for (const row of itemRows) {
      itemIdByFuzzy.set(row.name.slice(0, 6), row.id);
    }
    for (const edge of extractRelicHolderEdges(relicDoc.text)) {
      const holderId = nameToId.get(edge.holderName);
      if (!holderId) {
        report.relicUnmatched.push(`${edge.itemName}（持有人 ${edge.holderName} 未在角色库）`);
        continue;
      }
      const itemId = itemIdByExact.get(edge.itemName) || itemIdByFuzzy.get(edge.itemName.slice(0, 6));
      if (!itemId) {
        report.relicUnmatched.push(`${edge.itemName}（未在道具库）`);
        continue;
      }
      if (edgeExists(db, novelId, holderId, itemId, '持有')) continue;
      insertEdge.run(
        randomUUID(),
        novelId,
        'character',
        holderId,
        'item',
        itemId,
        '持有',
        `${edge.holderName}持有遗物 NO.${edge.no} ${edge.itemName}（${edge.level}）`,
        Date.now()
      );
      report.relicEdgesAdded += 1;
    }
  }

  // ⑤ 关系类型归一化
  const normalizeStmt = db.prepare(
    'UPDATE entity_relationships SET relationshipType = ? WHERE novelId = ? AND relationshipType = ?'
  );
  for (const [synonym, canonical] of Object.entries(RELATIONSHIP_TYPE_SYNONYMS)) {
    if (synonym === canonical) continue;
    const result = normalizeStmt.run(canonical, novelId, synonym);
    report.relationshipTypesNormalized += result.changes;
  }

  // 覆盖度报告
  const count = (sql: string) =>
    (db.prepare(sql).get(novelId) as { n: number } | undefined)?.n ?? 0;
  report.coverage = {
    characters: count('SELECT count(*) AS n FROM characters WHERE novel_id = ?'),
    items: count('SELECT count(*) AS n FROM items WHERE novel_id = ?'),
    locations: count('SELECT count(*) AS n FROM locations WHERE novel_id = ?'),
    factions: count('SELECT count(*) AS n FROM factions WHERE novel_id = ?'),
    powerLevels: count('SELECT count(*) AS n FROM power_levels WHERE novel_id = ?'),
    timelineEvents: count('SELECT count(*) AS n FROM timeline_events WHERE novel_id = ?'),
    foreshadowings: count('SELECT count(*) AS n FROM foreshadowings WHERE novel_id = ?'),
    edges: count('SELECT count(*) AS n FROM entity_relationships WHERE novelId = ?'),
  };
  return report;
}

export type { Foreshadowing };
