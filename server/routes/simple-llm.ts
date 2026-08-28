import type { Express } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { logger } from '../logger';
import { bindClientDisconnect, isStreamDisconnected } from '../helpers/stream-disconnect';
import { rateLimit } from '../middleware/rate-limit';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';
import { getDatabaseGeneration } from '../lib/db-instance';

const EXPAND_FRAGMENT_MAX_INPUT_CHARS = 30_000;
const EXPAND_FRAGMENT_MAX_OUTPUT_TOKENS = 1_200;

export const expandFragmentSchema = z.object({
  content: z.string().trim().max(20_000).optional(),
  text: z.string().trim().max(20_000).optional(),
  type: z.string().trim().max(200).default(''),
  context: z.string().max(20_000).default(''),
  novelId: z.string().trim().min(1).max(200),
}).strict().superRefine((value, ctx) => {
  const content = value.content || value.text || '';
  if (!content) {
    ctx.addIssue({ code: 'custom', path: ['content'], message: '请先输入要扩写的片段。' });
  }
  if (content.length + value.context.length > EXPAND_FRAGMENT_MAX_INPUT_CHARS) {
    ctx.addIssue({ code: 'too_big', origin: 'string', maximum: EXPAND_FRAGMENT_MAX_INPUT_CHARS, inclusive: true, path: ['context'], message: '片段和上下文过长，请缩短后再试。' });
  }
});

/**
 * Simple LLM proxy routes — no shared local helpers needed.
 */
export function registerSimpleLlmRoutes(app: Express) {
  // 扩展创意片段 (SSE 流式输出)
  app.post('/api/expand-fragment', async (req, res) => {
    if (!rateLimit('expand-fragment')) {
      return res.status(429).json({ error: '片段扩写请求过于频繁，请稍后再试。', retryAfter: 5 });
    }
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => {
      controller.abort();
    });

    try {
      // 同时兼容旧的 { text, context } 与前端实际调用的 { content, type } 参数
      const parsed = expandFragmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: '扩写请求参数无效', code: 'INVALID_EXPAND_FRAGMENT_REQUEST' });
      }
      const { type, context, novelId } = parsed.data;
      const content = parsed.data.content || parsed.data.text || '';

      let execution;
      const databaseGeneration = getDatabaseGeneration();
      try {
        execution = await createLlmExecution({
          operation: 'expand-fragment',
          novelId,
          quotaType: 'generateProse',
          accessContext: 'basic-byok',
          timeoutMs: 90_000,
          signal: controller.signal,
          concurrency: 2,
          databaseGeneration,
        });
      } catch (error) {
        if (error instanceof LlmExecutionRejectedError) {
          const message = error.quota.code === 'RATE_LIMITED'
            ? '片段扩写请求过于频繁，请稍后再试。'
            : error.message;
          res.status(error.status).json({ error: message, code: error.quota.code });
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
          maxTokens: EXPAND_FRAGMENT_MAX_OUTPUT_TOKENS,
          onToken: (token) => {
            if (databaseGeneration !== getDatabaseGeneration()) {
              controller.abort(new Error('数据库已在片段扩写期间切换。'));
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
          throw new Error('片段扩写连接已中断。');
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
        res.status(500).json({ error: '片段扩写失败，请稍后重试。' });
      } else {
        res.write(`data: ${JSON.stringify({ error: '片段扩写失败，请稍后重试。' })}\n\n`);
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
