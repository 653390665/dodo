/**
 * 批次 C（知识图谱可编排与维护闭环）· 图谱能力卡执行入口（2026-09-26）。
 *
 * 两张工具卡各对应一个确定性动作（不调 LLM、不注入提示词）：
 * - `knowledge-extract`：`runLineageEnrichment`（幂等）→ 返回 coverage 数值；
 * - `foreshadow-settle`：读伏笔台账 → 未回收伏笔核对清单（纯函数，见 shared/lib/knowledge-capabilities.ts）。
 *
 * 与唯一写库者约定一致：写入只经既有 db 层；本模块不直接执行 SQL。
 */
import {
  FORESHADOW_SETTLE_CAPABILITY_ID,
  KNOWLEDGE_EXTRACT_CAPABILITY_ID,
  KNOWLEDGE_SOURCE_PACK_MISSING,
  buildForeshadowSettlementChecklist,
  isKnowledgeCapabilityId,
  type KnowledgeCapabilityRunResult,
} from '../../shared/lib/knowledge-capabilities.js';
import { packSourceDocuments, runLineageEnrichment } from './knowledge-lineage-enrich.js';
import * as db from '../lib/db.js';
import { getDb } from '../lib/db-instance.js';

export class KnowledgeCapabilityError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'KnowledgeCapabilityError';
  }
}

/** 作品当前最新章序（无章节时 undefined）；参考章用于判定「欠账」伏笔。 */
function latestChapterOrder(novelId: string): number | undefined {
  const chapters = db.listChapters(novelId);
  if (chapters.length === 0) return undefined;
  return chapters.reduce((max, chapter) => Math.max(max, chapter.order), 0);
}

export function runKnowledgeCapability(
  novelId: string,
  assetId: string
): KnowledgeCapabilityRunResult {
  if (!db.getNovel(novelId)) {
    throw new KnowledgeCapabilityError(404, 'KNOWLEDGE_NOVEL_NOT_FOUND', '作品不存在');
  }
  if (!isKnowledgeCapabilityId(assetId)) {
    throw new KnowledgeCapabilityError(
      400,
      'KNOWLEDGE_CAPABILITY_UNSUPPORTED',
      `不支持的知识能力卡：${assetId}`
    );
  }
  if (assetId === KNOWLEDGE_EXTRACT_CAPABILITY_ID) {
    const handle = getDb();
    // 前置校验：没有资料包就没有可摄入的素材 —— 明确报错且零写入，避免"成功但什么都没发生"。
    if (packSourceDocuments(handle, novelId).length === 0) {
      throw new KnowledgeCapabilityError(
        400,
        KNOWLEDGE_SOURCE_PACK_MISSING,
        '未找到续写资料包，无法重跑知识谱系；请先导入资料包（含逐章细纲）。'
      );
    }
    // 单连接事务：中途失败整体回滚，既有台账/边零变化（重跑仍是幂等追加）。
    const report = handle.transaction(() => runLineageEnrichment(novelId))();
    return {
      capabilityId: KNOWLEDGE_EXTRACT_CAPABILITY_ID,
      kind: 'coverage',
      coverage: report,
    };
  }
  const rows = db.listForeshadowings(novelId).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    description: row.description,
    notes: row.notes,
    plantedChapterId: row.plantedChapterId,
    payoffChapterId: row.payoffChapterId,
  }));
  return {
    capabilityId: FORESHADOW_SETTLE_CAPABILITY_ID,
    kind: 'checklist',
    checklist: buildForeshadowSettlementChecklist({
      foreshadowings: rows,
      currentChapterOrder: latestChapterOrder(novelId),
    }),
  };
}
