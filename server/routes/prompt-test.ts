import { logger } from '../logger';
import type { Express } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { getPromptTemplate, buildPromptTemplateTest } from '../helpers/prompt-helpers';
import type { PromptTemplateKey } from '../../shared/config/prompt-templates';
import { rateLimit } from '../middleware/rate-limit';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';

const PROMPT_TEST_CODES = {
  invalidInput: 'PROMPT_TEST_INVALID_INPUT',
  timeout: 'PROMPT_TEST_TIMEOUT',
  rateLimited: 'PROMPT_TEST_RATE_LIMITED',
  providerError: 'PROMPT_TEST_PROVIDER_ERROR',
} as const;

function isPromptTestTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|timeout|超时/i.test(message);
}

const promptTemplateTestSchema = z.object({
  novelId: z.string().trim().min(1).max(200),
  key: z.string().trim().min(1).max(100),
  template: z.string().max(100_000).optional(),
}).strict();

export function registerPromptTestRoutes(app: Express) {
  app.post('/api/prompt-template-test', async (req, res) => {
    if (!rateLimit('prompt-template-test')) {
      return res.status(429).json({
        error: '提示词试跑请求过于频繁，请稍后再试。',
        code: PROMPT_TEST_CODES.rateLimited,
        retryAfter: 5,
      });
    }
    let promptPreview: string | undefined;
    try {
      const parsed = promptTemplateTestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: '提示词试跑参数无效，请先选择作品和模板。', code: PROMPT_TEST_CODES.invalidInput });
      }
      const { novelId, key, template } = parsed.data;
      if (!Object.prototype.hasOwnProperty.call(getConfig().promptTemplates, key)) {
        return res.status(400).json({ error: '未找到这张提示词模板，请重新选择。', code: PROMPT_TEST_CODES.invalidInput });
      }
      const promptKey = key as PromptTemplateKey;
      const baseTemplate = getPromptTemplate(promptKey);
      const effectiveTemplate = typeof template === 'string' && template.trim() ? template : baseTemplate;
      const payload = buildPromptTemplateTest(promptKey, effectiveTemplate);
      if (!payload.prompt?.trim()) {
        return res.status(400).json({ error: '这张提示词模板渲染后为空，请先补全模板内容。', code: PROMPT_TEST_CODES.invalidInput });
      }
      promptPreview = payload.prompt.slice(0, 4000);
      const execution = await createLlmExecution({
        operation: 'prompt-template-test',
        novelId,
        quotaType: 'advancedAudit',
        timeoutMs: 25_000,
        concurrency: 1,
      });
      const text = await execution.run(({ signal }) => generateText(getConfig(), {
        ...(payload as { prompt: string; systemInstruction?: string }),
        signal,
        timeoutMs: 25_000,
        maxAttempts: 1,
      }));
      res.json({
        text,
        promptPreview,
        traceId: execution.traceId,
      });
    } catch (e) {
      if (e instanceof LlmExecutionRejectedError) {
        const isRateLimited = e.quota.code === 'RATE_LIMITED';
        const message = isRateLimited
          ? '提示词试跑请求过于频繁，请稍后再试。'
          : e.message;
        return res.status(e.status).json({
          error: message,
          code: isRateLimited ? PROMPT_TEST_CODES.rateLimited : e.quota.code,
          ...(isRateLimited ? { retryAfter: 5 } : {}),
          ...(promptPreview ? { promptPreview } : {}),
        });
      }
      logger.error(String(e));
      if (isPromptTestTimeout(e)) {
        return res.status(504).json({
          error: '提示词试跑超时，请稍后重试。',
          code: PROMPT_TEST_CODES.timeout,
          ...(promptPreview ? { promptPreview } : {}),
        });
      }
      return res.status(502).json({
        error: '提示词试跑调用模型失败，请检查模型配置后重试。',
        code: PROMPT_TEST_CODES.providerError,
        ...(promptPreview ? { promptPreview } : {}),
      });
    }
  });
}
