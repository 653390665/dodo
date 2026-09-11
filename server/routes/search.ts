import type { Express } from 'express';
import { z } from 'zod';
import { logger } from '../logger';
import { getEmbeddingStatus, embedWithMetadata } from '../embedding';
import { searchSimilar, getChunkCount } from '../vector-store';
import * as db from '../lib/db';

/**
 * Plan 194 spike — 相似段落检索端点（Cmd+K 竖切片的服务端半边）。
 *
 * 诚实降级契约（同 llm-status-honesty 语义）：embedding 管线未就绪时返回
 * available:false + 当前状态，不假装空结果；索引为空时返回 indexed:false，
 * 让客户端渲染「还没有可检索的索引」而不是「没有匹配」。
 */
const searchSchema = z
  .object({
    novelId: z.string().min(1),
    query: z.string().min(1).max(500),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

export function registerSearchRoutes(app: Express): void {
  app.post('/api/search-similar', async (req, res) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: 'SEARCH_INVALID_INPUT', error: '检索请求参数无效。' });
    }
    const { novelId, query, limit } = parsed.data;
    if (!db.getNovel(novelId)) {
      return res.status(404).json({ code: 'NOVEL_NOT_FOUND', error: '作品不存在，请刷新后重试。' });
    }

    const embeddingStatus = getEmbeddingStatus();
    if (embeddingStatus.status !== 'ready' && embeddingStatus.status !== 'fallback') {
      return res.json({
        available: false,
        embeddingStatus: embeddingStatus.status,
        indexed: getChunkCount(novelId) > 0,
        hits: [],
      });
    }
    if (getChunkCount(novelId) <= 0) {
      return res.json({
        available: true,
        embeddingStatus: embeddingStatus.status,
        indexed: false,
        hits: [],
      });
    }

    try {
      const { values, modelId } = await embedWithMetadata(query, novelId);
      const hits = searchSimilar(values, novelId, modelId, limit ?? 8);
      return res.json({
        available: true,
        embeddingStatus: embeddingStatus.status,
        indexed: true,
        hits,
      });
    } catch (error) {
      logger.error('search-similar failed', {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return res.status(500).json({ code: 'SEARCH_FAILED', error: '检索失败，请稍后重试。' });
    }
  });
}
