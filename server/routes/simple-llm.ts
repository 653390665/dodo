import type { Express } from 'express';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { logger } from '../logger';
import { bindClientDisconnect, isStreamDisconnected } from '../helpers/stream-disconnect';
import { rateLimit } from '../middleware/rate-limit';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';
import { getDatabaseGeneration } from '../lib/db-instance';

/**
 * Simple LLM proxy routes — no shared local helpers needed.
 */
export function registerSimpleLlmRoutes(app: Express) {
  // 扩展创意片段 (SSE 流式输出)
  app.post('/api/expand-fragment', async (req, res) => {
    if (!rateLimit('expand-fragment')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => {
      controller.abort();
    });

    try {
      // 同时兼容旧的 { text, context } 与前端实际调用的 { content, type } 参数
      const content = req.body.content || req.body.text || '';
      const type = req.body.type || '';
      const context = req.body.context || '';
      const novelId = req.body.novelId;

      if (!content) {
        res.write(`data: ${JSON.stringify({ error: "Content is required" })}\n\n`);
        res.end();
        return;
      }
      if (typeof novelId !== 'string' || !novelId.trim()) {
        res.status(400).json({ error: 'novelId is required' });
        return;
      }

      let execution;
      const databaseGeneration = getDatabaseGeneration();
      try {
        execution = await createLlmExecution({
          operation: 'expand-fragment',
          novelId,
          quotaType: 'generateProse',
          timeoutMs: 90_000,
          signal: controller.signal,
          concurrency: 2,
          databaseGeneration,
        });
      } catch (error) {
        if (error instanceof LlmExecutionRejectedError) {
          res.status(error.status).json({ error: error.message, code: error.quota.code });
          return;
        }
        throw error;
      }

      // 设置 SSE 响应头，确保数据实时下发且无缓存
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-InkFlow-Database-Generation', String(databaseGeneration));
      req.socket.setTimeout(0);

      let prompt = '';
      if (type) {
        prompt = `请将以下创意片段（类型: ${type}）扩展为更详细的描述:\n\n${content}`;
      } else {
        prompt = `请将以下创意片段扩展为更详细的描述:\n\n${content}\n\n上下文: ${context || '无'}`;
      }

      // 调用大模型进行流式生成，通过 onToken 写入客户端
      await execution.run(async ({ signal }) => {
        await generateText(getConfig(), {
          prompt,
          novelId,
          signal,
          onToken: (token) => {
            if (databaseGeneration !== getDatabaseGeneration()) {
              controller.abort(new Error('Database changed during fragment expansion'));
              return;
            }
            if (!isStreamDisconnected(req, res) && !res.writableEnded) {
              res.write(`data: ${JSON.stringify({ token })}\n\n`);
            }
          }
        });
        if (
          databaseGeneration !== getDatabaseGeneration()
          || isStreamDisconnected(req, res)
          || res.writableEnded
        ) {
          throw new Error('Client disconnected before fragment completion');
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } catch (e: unknown) {
      logger.error("Simple LLM route error:", e);
      if (isStreamDisconnected(req, res) || res.writableEnded) {
        return;
      }
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Internal server error" })}\n\n`);
        res.end();
      }
    } finally {
      disposeDisconnect();
    }
  });


  // Remaining routes (generate-bio, extract-entities, detect-foreshadowing,
  // analyze-pacing, generate-entity-details) are handled by world.ts with
  // enhanced prompt engineering and continuation-pack context support.
}
