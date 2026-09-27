/**
 * 批次 D · 记忆健康度看板（2026-09-27）：五项指标的取数与可用性判定。
 *
 * 职责边界：
 * - 本文件只做「取数 + 可用性策略」，指标口径（含孤立节点定义、未知文案）全部来自
 *   `shared/lib/memory-health.ts`——与前端渲染同一份实现（同源）。
 * - 每项指标只在数据源真的可用时才给数值；否则给 `null` 并附可读原因，由界面显示「未知」。
 *   典型陷阱：作品从未摄入资料包时台账为空，此时「未回收伏笔 = 0」是假的，必须报未知。
 *
 * 数据源（均为既有单一事实源）：
 * - 未回收伏笔：`buildForeshadowSettlementChecklist`（与 foreshadow-settle 能力卡同源）
 * - 失效知识：`countStaleKnowledgeRows`（与知识失效语义同源）
 * - 孤立节点：`shared/lib/memory-health.ts` 的 `computeOrphanEntityIds`
 * - RAG 命中：`buildSemanticRecallSection`（与生产管线注入同源）
 */
import * as db from '../lib/db.js';
import { getDb } from '../lib/db-instance.js';
import { getChunkCount } from '../vector-store.js';
import { getEmbeddingStatus } from '../embedding.js';
import { packSourceDocuments } from './knowledge-lineage-enrich.js';
import { buildSemanticRecallSection } from './story-context.js';
import { buildForeshadowSettlementChecklist } from '../../shared/lib/knowledge-capabilities.js';
import {
  buildMemoryHealthMetrics,
  computeOrphanEntityIds,
  type MemoryHealthEntityRef,
  type MemoryHealthMetric,
} from '../../shared/lib/memory-health.js';

export const MEMORY_HEALTH_NOVEL_NOT_FOUND = 'MEMORY_HEALTH_NOVEL_NOT_FOUND';

export class MemoryHealthError extends Error {
  constructor(
    readonly status: 404,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'MemoryHealthError';
  }
}

export interface MemoryHealthEvidence {
  packDocuments: number;
  foreshadowingRows: number;
  relationshipRows: number;
  entityRows: number;
  orphanRows: number;
  indexedChunks: number;
  embeddingStatus: string;
  ragQueryChapterId: string | null;
}

export interface MemoryHealthSnapshot {
  novelId: string;
  computedAt: string;
  metrics: MemoryHealthMetric[];
  evidence: MemoryHealthEvidence;
}

const GRAPH_UNKNOWN_REASON = '尚未摄入资料包：先导入含逐章细纲的续写资料包';

function collectEntityRefs(novelId: string): MemoryHealthEntityRef[] {
  const refs: MemoryHealthEntityRef[] = [];
  for (const character of db.listCharacters(novelId)) refs.push({ type: 'character', id: character.id });
  for (const location of db.listLocations(novelId)) refs.push({ type: 'location', id: location.id });
  for (const item of db.listItems(novelId)) refs.push({ type: 'item', id: item.id });
  for (const faction of db.listFactions(novelId)) refs.push({ type: 'faction', id: faction.id });
  return refs;
}

export async function collectMemoryHealth(novelId: string): Promise<MemoryHealthSnapshot> {
  const novel = db.getNovel(novelId);
  if (!novel)
    throw new MemoryHealthError(404, MEMORY_HEALTH_NOVEL_NOT_FOUND, '作品不存在或已被删除。');

  const packDocuments = packSourceDocuments(getDb(), novelId).length;
  const foreshadowings = db.listForeshadowings(novelId);
  const relationships = db.listEntityRelationships(novelId);
  const entities = collectEntityRefs(novelId);
  const orphanRefs = computeOrphanEntityIds({ entities, relationships });

  const hasLedger = foreshadowings.length > 0;
  const hasEdges = relationships.length > 0;
  const graphIngested = packDocuments > 0 || hasLedger || hasEdges;

  // 未回收伏笔：台账为空但资料包已摄入 ⇒ 真实 0；从未摄入 ⇒ 未知。
  const checklist = hasLedger
    ? buildForeshadowSettlementChecklist({
        foreshadowings,
        currentChapterOrder: latestChapterOrder(novelId),
      })
    : null;
  const openForeshadowings = hasLedger ? (checklist?.openCount ?? 0) : graphIngested ? 0 : null;
  // 欠账与 foreshadow-settle 清单同源；无台账但已摄入图谱 ⇒ 真实 0。
  const foreshadowArrears = hasLedger ? (checklist?.arrears ?? 0) : graphIngested ? 0 : null;

  // 孤立节点：有实体或有边即可判定（全无关系 ⇒ 全部实体都是孤立节点，0 也可为真值）。
  const orphanNodes = entities.length > 0 || hasEdges || graphIngested ? orphanRefs.length : null;

  // 失效知识：随图谱摄入一起判定。
  const staleCounts = graphIngested ? db.countStaleKnowledgeRows(novelId) : null;

  // RAG 命中：先看索引与嵌入能力，再复用生产注入的同一函数做一次按章检索。
  const indexedChunks = getChunkCount(novelId);
  const embeddingStatus = getEmbeddingStatus().status;
  let ragHits: number | null = null;
  let ragUnknownReason: string | undefined;
  let ragDetail: string | undefined;
  let ragQueryChapterId: string | null = null;
  if (indexedChunks === 0) {
    ragUnknownReason = '尚未建立向量索引：保存章节后会增量回填';
  } else if (embeddingStatus !== 'ready' && embeddingStatus !== 'fallback') {
    ragUnknownReason =
      embeddingStatus === 'initializing' ? '嵌入模型正在初始化：稍后刷新重试' : '嵌入模型不可用：无法执行检索';
  } else {
    const latestChapter = latestChapterOf(novelId);
    ragQueryChapterId = latestChapter?.id ?? null;
    const queryText = [latestChapter?.title, latestChapter?.sceneBeats].filter(Boolean).join('\n');
    const section = await buildSemanticRecallSection({
      novelId,
      queryText: queryText || novel.title,
    });
    ragHits = section?.hitCount ?? 0;
    ragDetail = latestChapter ? `查询：最新章节《${latestChapter.title}》` : '查询：作品标题';
  }

  return {
    novelId,
    computedAt: new Date().toISOString(),
    metrics: buildMemoryHealthMetrics({
      openForeshadowings,
      ...(openForeshadowings === null ? { openForeshadowingsUnknownReason: GRAPH_UNKNOWN_REASON } : {}),
      foreshadowArrears,
      ...(foreshadowArrears === null ? { foreshadowArrearsUnknownReason: GRAPH_UNKNOWN_REASON } : {}),
      orphanNodes,
      ...(orphanNodes === null ? { orphanNodesUnknownReason: GRAPH_UNKNOWN_REASON } : {}),
      staleLedger: staleCounts?.staleLedger ?? null,
      staleEdges: staleCounts?.staleEdges ?? null,
      ...(staleCounts === null ? { staleUnknownReason: GRAPH_UNKNOWN_REASON } : {}),
      ragHits,
      ...(ragUnknownReason ? { ragUnknownReason } : {}),
      ...(ragDetail ? { ragDetail } : {}),
    }),
    evidence: {
      packDocuments,
      foreshadowingRows: foreshadowings.length,
      relationshipRows: relationships.length,
      entityRows: entities.length,
      orphanRows: orphanRefs.length,
      indexedChunks,
      embeddingStatus,
      ragQueryChapterId,
    },
  };
}

function latestChapterOf(novelId: string) {
  const chapters = db.listChapters(novelId);
  return chapters.length > 0 ? chapters[chapters.length - 1] : null;
}

function latestChapterOrder(novelId: string): number | null {
  const latest = latestChapterOf(novelId);
  return latest ? latest.order : null;
}
