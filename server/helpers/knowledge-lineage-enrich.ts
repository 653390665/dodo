import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db-instance.js';
import { countStaleKnowledgeRows, packSourceVersion } from '../lib/db/knowledge-staleness.js';
import {
  extractCharacterItemAffinityEdges,
  extractWorldviewHints,
  extractCharacterLocationEdges,
  extractForeshadowingLedger,
  extractPowerHolderEdges,
  extractRelicHolderEdges,
  extractOutlineUnit,
  extractXigangEntries,
  RELATIONSHIP_TYPE_SYNONYMS,
} from './knowledge-lineage.js';
import { resolveCuratedTechniquePrompt } from './curated-skill-runtime.js';
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
  ledgerBackfilled: number;
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
    staleLedger: number;
    staleEdges: number;
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
    // ㉒ 黄金三章维度：Ch1-3 审计显式核查金手指/钩子/反派智商
    chapterOrder <= 3
      ? `- 【黄金三章自查】${resolveCuratedTechniquePrompt('opening-novelty-hook') || '金手指是否在前三章显露、反派智商是否在线、剧情钩子是否合理'}`
      : '',
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

/**
 * 伏笔状态机闭环（Phase2）：本章接受入库时，把细纲指定在本章回收的
 * 伏笔标记为 payoff（已回收）。确定性 UPDATE，幂等。
 */
export function settleForeshadowingsOnApply(
  novelId: string,
  chapterOrder: number
): { paidOff: number; chapterNo: string } {
  const database = getDb();
  const chapterNo = `Ch${String(chapterOrder).padStart(3, '0')}`;
  const result = database
    .prepare(
      "UPDATE foreshadowings SET status = 'payoff', updated_at = ? WHERE novel_id = ? AND payoff_chapter_id = ? AND status != 'payoff'"
    )
    .run(Date.now(), novelId, chapterNo);
  return { paidOff: result.changes, chapterNo };
}

export interface ForeshadowingContext {
  /** 本章应埋设（planted_chapter_id 指向本章且尚未回收）。 */
  toPlant: Foreshadowing[];
  /** 本章应回收（payoff_chapter_id 指向本章）。 */
  toPayOff: Foreshadowing[];
  /** 前文已埋、仍未回收且不属于本章回收计划的活跃伏笔（跨章连续性）。 */
  arrears: Foreshadowing[];
  /** 上述三类伏笔关联到的角色名（由 related_character_ids 解析），供图谱过滤扩展。 */
  relatedCharacterNames: string[];
  /** 注入 planner / writer 的提示块；无台账内容时为空串。 */
  promptBlock: string;
  /** 注入 critic 的核对清单块；无台账内容时为空串。 */
  checklistBlock: string;
}

/** 提示块内最多牵引多少条旧伏笔，避免长线作品把上下文灌爆。 */
const MAX_ARREARS_IN_PROMPT = 12;

/** 解析 `Ch012` / `Ch012_1` 形式的章节序号；无法解析返回 null。 */
function chapterIndexOf(chapterId: string | null | undefined): number | null {
  if (!chapterId) return null;
  const match = /^Ch(\d+)/i.exec(chapterId.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

function truncateForPrompt(text: string, max = 90): string {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

type ForeshadowingRow = {
  id: string;
  novel_id: string;
  title: string;
  description: string | null;
  status: string;
  planted_chapter_id: string | null;
  payoff_chapter_id: string | null;
  related_character_ids: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

function toForeshadowing(row: ForeshadowingRow): Foreshadowing {
  let relatedCharacterIds: string[] = [];
  try {
    const parsed = JSON.parse(row.related_character_ids || '[]');
    if (Array.isArray(parsed)) {
      relatedCharacterIds = parsed.filter((id): id is string => typeof id === 'string');
    }
  } catch {
    relatedCharacterIds = [];
  }
  const status = row.status === 'payoff' || row.status === 'hinted' ? row.status : 'planted';
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    description: row.description || '',
    status,
    plantedChapterId: row.planted_chapter_id || undefined,
    payoffChapterId: row.payoff_chapter_id || undefined,
    relatedCharacterIds,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Phase4（知识图谱参与生成链路）：把已入库的伏笔台账读成生成期上下文。
 *
 * 注意与既有读点的分工（2026-09-23 更正）：`story-state-ledger` 已通过
 * `db.listForeshadowings` 把「开放伏笔」扁平清单渲染进 planner/writer 上下文；
 * 本函数不是唯一读点，而是提供它缺的两件事：
 * - 本章应埋 / 本章应回收 的行动分组（扁平清单不区分二者）；
 * - critic 的逐条核对清单，以及供图谱过滤使用的关联角色名。
 */
export function loadForeshadowingContext(
  novelId: string,
  chapterOrder: number
): ForeshadowingContext {
  const empty: ForeshadowingContext = {
    toPlant: [],
    toPayOff: [],
    arrears: [],
    relatedCharacterNames: [],
    promptBlock: '',
    checklistBlock: '',
  };
  try {
    const rows = getDb()
      .prepare(
        `SELECT id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id,
                related_character_ids, notes, created_at, updated_at
         FROM foreshadowings WHERE novel_id = ? ORDER BY created_at ASC`
      )
      .all(novelId) as ForeshadowingRow[];
    const ledger = rows.map(toForeshadowing);
    const toPlant = ledger.filter(
      (row) => chapterIndexOf(row.plantedChapterId) === chapterOrder && row.status !== 'payoff'
    );
    const toPayOff = ledger.filter((row) => chapterIndexOf(row.payoffChapterId) === chapterOrder);
    const arrears = ledger
      .filter((row) => {
        if (row.status === 'payoff') return false;
        const planted = chapterIndexOf(row.plantedChapterId);
        if (planted === null || planted >= chapterOrder) return false;
        return chapterIndexOf(row.payoffChapterId) !== chapterOrder;
      })
      .sort(
        (a, b) =>
          (chapterIndexOf(b.plantedChapterId) ?? 0) - (chapterIndexOf(a.plantedChapterId) ?? 0)
      )
      .slice(0, MAX_ARREARS_IN_PROMPT);
    if (!toPlant.length && !toPayOff.length && !arrears.length) return empty;

    const relatedCharacterIds = new Set<string>();
    for (const row of [...toPlant, ...toPayOff, ...arrears]) {
      for (const id of row.relatedCharacterIds) relatedCharacterIds.add(id);
    }
    let relatedCharacterNames: string[] = [];
    if (relatedCharacterIds.size > 0) {
      const ids = [...relatedCharacterIds];
      const placeholders = ids.map(() => '?').join(',');
      relatedCharacterNames = (
        getDb()
          .prepare(
            `SELECT name FROM characters WHERE novel_id = ? AND id IN (${placeholders})`
          )
          .all(novelId, ...ids) as Array<{ name: string }>
      ).map((row) => row.name);
    }

    const chapterNo = `Ch${String(chapterOrder).padStart(3, '0')}`;
    const describe = (row: Foreshadowing): string => {
      const payoff = row.notes ? `（回收说明：${truncateForPrompt(row.notes)}）` : '';
      const detail = row.description ? `：${truncateForPrompt(row.description)}` : '';
      return `${row.title}${detail}${payoff}`;
    };
    const promptLines = [`【伏笔台账 · ${chapterNo}（来自已入库知识谱系）】`];
    if (toPayOff.length) {
      promptLines.push(`- 本章应回收：${toPayOff.map(describe).join('；')}`);
    }
    if (toPlant.length) {
      promptLines.push(`- 本章应埋设：${toPlant.map(describe).join('；')}`);
    }
    if (arrears.length) {
      promptLines.push(
        `- 仍未回收的旧伏笔（跨章连续性，勿遗忘；不必强行本章回收）：${arrears
          .map(
            (row) =>
              `${row.title}（埋于 ${row.plantedChapterId || '未知'}，计划 ${row.payoffChapterId || '待定'}）`
          )
          .join('；')}`
      );
    }

    const checklistLines = [
      `【伏笔核对清单 · ${chapterNo}（来自已入库知识谱系）】逐条核查，未兑现须在 fatalIssues 中指出：`,
    ];
    if (toPayOff.length) {
      checklistLines.push(`- 应回收：${toPayOff.map((row) => row.title).join('；')}`);
    }
    if (toPlant.length) {
      checklistLines.push(`- 应埋设：${toPlant.map((row) => row.title).join('；')}`);
    }
    if (arrears.length) {
      checklistLines.push(
        `- 不应遗忘（可牵引但不必本章回收）：${arrears.map((row) => row.title).join('；')}`
      );
    }

    return {
      toPlant,
      toPayOff,
      arrears,
      relatedCharacterNames,
      promptBlock: promptLines.join('\n'),
      checklistBlock: checklistLines.join('\n'),
    };
  } catch {
    return empty;
  }
}

export function loadWorldviewHints(novelId: string, castNames: string[]) {
  try {
    const docs = packSourceDocuments(getDb(), novelId);
    const metaDoc = docs.find((d) => d.filename.includes('元设定'))?.text || '';
    return extractWorldviewHints(metaDoc, castNames);
  } catch {
    return extractWorldviewHints('', []);
  }
}

export function loadOutlineUnit(novelId: string, chapterOrder: number) {
  try {
    const docs = packSourceDocuments(getDb(), novelId);
    const outlineDoc = docs.find((d) => d.filename.includes('剧情大纲'))?.text || '';
    return extractOutlineUnit(outlineDoc, chapterOrder);
  } catch {
    return null;
  }
}

export function runLineageEnrichment(novelId: string): LineageReport {
  const db = getDb();
  const report: LineageReport = {
    xigangEntries: 0,
    ledgerInserted: 0,
    ledgerSkipped: 0,
    ledgerBackfilled: 0,
    powerEdgesAdded: 0,
    relicEdgesAdded: 0,
    affinityEdgesAdded: 0,
    residenceEdgesAdded: 0,
    relicUnmatched: [],
    relationshipTypesNormalized: 0,
    coverage: { characters: 0, items: 0, locations: 0, factions: 0, powerLevels: 0, timelineEvents: 0, foreshadowings: 0, edges: 0, staleLedger: 0, staleEdges: 0 },
  };

  const docs = packSourceDocuments(db, novelId);
  // 批次 C：本次摄入写入的行统一记录资料包来源版本（`pack:<id>@<updatedAt>`）。
  const packStamp = packSourceVersion(novelId);
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
    .prepare(
      'SELECT id, title, planted_chapter_id AS plantedChapterId, related_character_ids AS relatedCharacterIds FROM foreshadowings WHERE novel_id = ?'
    )
    .all(novelId) as Array<{
    id: string;
    title: string;
    plantedChapterId: string | null;
    relatedCharacterIds: string | null;
  }>;
  const existingLedgerByKey = new Map(
    existingLedger.map((r) => [`${r.title}\u0000${r.plantedChapterId}`, r])
  );
  const backfillCastStmt = db.prepare(
    'UPDATE foreshadowings SET related_character_ids = ?, updated_at = ? WHERE id = ?'
  );

  const insertForeshadowing = db.prepare(
    `INSERT INTO foreshadowings (id, novel_id, title, description, status, planted_chapter_id, payoff_chapter_id, related_character_ids, notes, created_at, updated_at, source_version)
     VALUES (?, ?, ?, ?, 'planted', ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of extractForeshadowingLedger(entries)) {
    const key = `${row.title}\u0000${row.plantedChapter}`;
    const cast = [...nameToId.keys()].filter((name) => row.description.includes(name));
    const existing = existingLedgerByKey.get(key);
    if (existing) {
      report.ledgerSkipped += 1;
      // 台账按 title+plantedChapter 去重，但 related_character_ids 可能是角色库建好之前
      // 写入的空数组。确认入世界 / apply 后角色已存在时回填一次，让图谱消费
      // （writer 上下文的实体过滤）能用到这些关联角色。
      let current: unknown;
      try {
        current = JSON.parse(existing.relatedCharacterIds || '[]');
      } catch {
        current = [];
      }
      if ((!Array.isArray(current) || current.length === 0) && cast.length > 0) {
        backfillCastStmt.run(
          JSON.stringify(cast.map((name) => nameToId.get(name))),
          Date.now(),
          existing.id
        );
        report.ledgerBackfilled += 1;
      }
      continue;
    }
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
      now,
      packStamp
    );
    report.ledgerInserted += 1;
  }

  // ③ 公理持有边（character→power_level 持有）
  const powerRows = db
    .prepare('SELECT name, description FROM power_levels WHERE novel_id = ?')
    .all(novelId) as Array<{ name: string; description: string }>;
  const characterNames = new Set(characterRows.map((c) => c.name));
  const insertEdge = db.prepare(
    `INSERT INTO entity_relationships (id, novelId, sourceType, sourceId, targetType, targetId, relationshipType, description, createdAt, source_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    insertEdge.run(randomUUID(), novelId, 'character', holderId, 'power', powerId, '持有', `${edge.holderName}持有${edge.powerName}`, Date.now(), packStamp);
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
        Date.now(),
        packStamp
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
    insertEdge.run(randomUUID(), novelId, 'character', charId, 'item', itemId, '关联', `${edge.characterName}与${edge.itemName}存在关联（道具描述点名）`, Date.now(), packStamp);
    affinityAdded += 1;
  }
  for (const edge of locationEdges) {
    const locationId = locationRowsAll.find((r) => r.name === edge.locationName)?.id;
    if (!locationId) continue;
    if (edgeExists(db, novelId, edge.characterId, locationId, '居住')) continue;
    insertEdge.run(randomUUID(), novelId, 'character', edge.characterId, 'location', locationId, '居住', `${edge.locationName}为相关地点（角色小传点名）`, Date.now(), packStamp);
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
  const staleCounts = countStaleKnowledgeRows(novelId);
  report.coverage = {
    characters: count('SELECT count(*) AS n FROM characters WHERE novel_id = ?'),
    items: count('SELECT count(*) AS n FROM items WHERE novel_id = ?'),
    locations: count('SELECT count(*) AS n FROM locations WHERE novel_id = ?'),
    factions: count('SELECT count(*) AS n FROM factions WHERE novel_id = ?'),
    powerLevels: count('SELECT count(*) AS n FROM power_levels WHERE novel_id = ?'),
    timelineEvents: count('SELECT count(*) AS n FROM timeline_events WHERE novel_id = ?'),
    foreshadowings: count('SELECT count(*) AS n FROM foreshadowings WHERE novel_id = ?'),
    edges: count('SELECT count(*) AS n FROM entity_relationships WHERE novelId = ?'),
    staleLedger: staleCounts.staleLedger,
    staleEdges: staleCounts.staleEdges,
  };
  return report;
}

export type { Foreshadowing };
