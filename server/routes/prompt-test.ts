import { logger } from '../logger';
import type { Express } from 'express';
import { z } from 'zod';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { getConfig } from '../lib/config';
import { getPromptTemplate, buildPromptTemplateTest } from '../helpers/prompt-helpers';
import type { PromptTemplateKey } from '../../shared/config/prompt-templates';
import { rateLimit } from '../middleware/rate-limit';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';

const promptTemplateTestSchema = z.object({
  novelId: z.string().trim().min(1).max(200),
  key: z.string().trim().min(1).max(100),
  template: z.string().max(100_000).optional(),
}).strict();

export function registerPromptTestRoutes(app: Express) {
  app.post('/api/prompt-template-test', async (req, res) => {
    if (!rateLimit('prompt-template-test')) {
      return res.status(429).json({ error: 'Rate limited', retryAfter: 5 });
    }
    let promptPreview: string | undefined;
    try {
      const parsed = promptTemplateTestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid prompt template test request' });
      }
      const { novelId, key, template } = parsed.data;
      if (!Object.prototype.hasOwnProperty.call(getConfig().promptTemplates, key)) {
        return res.status(400).json({ error: 'Unknown template key' });
      }
      const promptKey = key as PromptTemplateKey;
      const baseTemplate = getPromptTemplate(promptKey);
      const effectiveTemplate = typeof template === 'string' && template.trim() ? template : baseTemplate;
      const payload = buildPromptTemplateTest(promptKey, effectiveTemplate);
      if (!payload.prompt?.trim()) {
        return res.status(400).json({ error: 'Template rendered to empty prompt' });
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
        return res.status(e.status).json({ error: e.message, code: e.quota.code });
      }
      logger.error(String(e));
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
