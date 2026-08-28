import type { Express } from 'express';
import { completeChapter, acceptChapterRisk } from '../helpers/chapter-completion.js';

export function registerChapterCompletionRoutes(app: Express): void {
  app.post('/api/chapters/:chapterId/complete', async (req, res) => {
    try {
      const body = req.body || {};
      if (typeof body.novelId !== 'string' || !Number.isInteger(body.databaseGeneration)) return res.status(400).json({ code: 'CHAPTER_COMPLETION_INVALID_INPUT', error: '章节完成参数无效' });
      const result = await completeChapter({
        novelId: body.novelId,
        chapterId: req.params.chapterId,
        databaseGeneration: body.databaseGeneration,
        content: '',
        retryUnavailable: body.retryUnavailable === true,
      });
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : '章节完成失败';
      const stale = message === 'CHAPTER_COMPLETION_STALE';
      res.status(message.includes('NOT_FOUND') ? 404 : 409).json({
        code: stale ? message : undefined,
        error: stale ? '章节内容已变化，原审查结果已失效，请重新审查。' : message,
      });
    }
  });
  app.post('/api/chapters/:chapterId/complete/risk', async (req, res) => {
    try {
      const body = req.body || {};
      if (typeof body.novelId !== 'string' || !Number.isInteger(body.databaseGeneration)
        || !Array.isArray(body.unresolvedIssueIds) || body.unresolvedIssueIds.some((id: unknown) => typeof id !== 'string')
        || !Array.isArray(body.unknownChecks) || body.unknownChecks.some((check: unknown) => typeof check !== 'string')
        || typeof body.contentHash !== 'string' || typeof body.planHash !== 'string') {
        return res.status(400).json({ code: 'CHAPTER_COMPLETION_INVALID_RISK', error: '风险确认参数无效' });
      }
      res.json(await acceptChapterRisk({
        novelId: body.novelId, chapterId: req.params.chapterId, databaseGeneration: body.databaseGeneration,
        unresolvedIssueIds: body.unresolvedIssueIds, unknownChecks: body.unknownChecks,
        contentHash: body.contentHash, planHash: body.planHash, authorDecisionAt: body.authorDecisionAt,
      }));
    } catch (error) { const message = error instanceof Error ? error.message : '风险确认失败'; res.status(message.includes('NOT_FOUND') ? 404 : 409).json({ error: message }); }
  });
}
