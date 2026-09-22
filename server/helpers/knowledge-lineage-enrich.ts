import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db-instance.js';
import {
  extractCharacterItemAffinityEdges,
  extractCharacterLocationEdges,
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
  affinityEdgesAdded: number;
  residenceEdgesAdded: number;
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


export interface ChapterContract {
  chapterNo: string;
  title: string;
  contractText: string;
  checklistText: string;
  foreshadowingTasks: string[];
  payoffNote: string;
}

/**
 * Phase2：按章节序号加载逐章细纲条目，生成 planner 任务书（contractText）
 * 与 critic 核对清单（checklistText）。资料包无细纲或无本章条目时返回 null。
 */
export function loadChapterContract(novelId: string, chapterOrder: number): ChapterContract | null {
  const db = getDb();
  const chapterNo = `Ch${String(chapterOrder).padStart(3, '0')}`;
  const docs = packSourceDocuments(db, novelId);
  const xigangDoc = docs.find((d) => d.filename.includes('逐章细纲'));
  if (!xigangDoc) return null;
  const entry = extractXigangEntries(xigangDoc.text).find((e) => e.chapterNo === chapterNo);
  if (!entry) return null;
  const ledgerRows = extractForeshadowingLedger([entry]);
  const contractText = [
    `【权威细纲合同 · ${chapterNo}】本章分镜必须从以下合同展开：核心事件、场景锚点、关键道具、伏笔埋点、章末钩子逐项落实；禁止另行编造核心事件或替换伏笔。`,
    `- 章节标题：${entry.title}`,
    ...Object.entries(entry.fields).map(([k, v]) => `- ${k}：${v}`),
  ].join('\n');
  const checklistText = [
    `【审计核对清单 · ${chapterNo}】以下各项逐条核查，未兑现须在 fatalIssues 中指出：`,
    entry.fields['红线自查'] ? `- 红线自查：${entry.fields['红线自查']}` : '',
    entry.fields['伏笔埋点'] ? `- 伏笔埋点应包含：${entry.fields['伏笔埋点']}` : '',
    ledgerRows.length ? `- 伏笔台账：本章应埋设 ${ledgerRows.length} 条（${ledgerRows.map((r) => r.title).join('；')}）` : '',
    entry.fields['章末钩子'] ? `- 章末钩子应兑现：${entry.fields['章末钩子']}` : '',
  ].filter(Boolean).join('\n');
  return {
    chapterNo,
    title: entry.title,
    contractText,
    checklistText,
    foreshadowingTasks: ledgerRows.map((r) => r.description),
    payoffNote: ledgerRows[0]?.payoffNote || '',
  };
}

export function runLineageEnrichment(novelId: string): LineageReport {
  const db = getDb();
  const report: LineageReport = {
    xigangEntries: 0,
    ledgerInserted: 0,
    ledgerSkipped: 0,
    powerEdgesAdded: 0,
    relicEdgesAdded: 0,
    affinityEdgesAdded: 0,
    residenceEdgesAdded: 0,
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

  // ㉑b 亲和边补齐：孤立道具/地点与角色的关联（description/小传点名即命中）
  const itemRowsAll = db
    .prepare('SELECT id, name, description FROM items WHERE novel_id = ?')
    .all(novelId) as Array<{ id: string; name: string; description: string }>;
  const itemIdByExactAll = new Map(itemRowsAll.map((r) => [r.name, r.id]));
  const locationRowsAll = db
    .prepare('SELECT id, name FROM locations WHERE novel_id = ?')
    .all(novelId) as Array<{ id: string; name: string }>;
  const characterRowsForAffinity = db
    .prepare('SELECT id, name, bio, current_state FROM characters WHERE novel_id = ?')
    .all(novelId) as Array<{ id: string; name: string; bio: string; current_state: string }>;
  const affinityEdges = extractCharacterItemAffinityEdges(
    itemRowsAll,
    new Set(characterNames)
  );
  const locationEdges = extractCharacterLocationEdges(
    characterRowsForAffinity,
    new Set(locationRowsAll.map((r) => r.name))
  );
  let affinityAdded = 0;
  let residenceAdded = 0;
  for (const edge of affinityEdges) {
    const itemId = itemIdByExactAll.get(edge.itemName) || itemIdByExactAll.get(edge.itemName.slice(0, 6));
    const charId = nameToId.get(edge.characterName);
    if (!itemId || !charId) continue;
    if (edgeExists(db, novelId, charId, itemId, '关联')) continue;
    insertEdge.run(randomUUID(), novelId, 'character', charId, 'item', itemId, '关联', `${edge.characterName}与${edge.itemName}存在关联（道具描述点名）`, Date.now());
    affinityAdded += 1;
  }
  for (const edge of locationEdges) {
    const locationId = locationRowsAll.find((r) => r.name === edge.locationName)?.id;
    if (!locationId) continue;
    if (edgeExists(db, novelId, edge.characterId, locationId, '居住')) continue;
    insertEdge.run(randomUUID(), novelId, 'character', edge.characterId, 'location', locationId, '居住', `${edge.locationName}为相关地点（角色小传点名）`, Date.now());
    residenceAdded += 1;
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
  report.affinityEdgesAdded = affinityAdded;
  report.residenceEdgesAdded = residenceAdded;

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
