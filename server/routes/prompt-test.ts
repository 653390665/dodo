import { logger } from '../logger';
import type { Express } from 'express';
import { generateText } from '../lib/server-llm';
import { getConfig } from '../lib/config';
import { withTimeout } from '../helpers/async-utils';
import { getPromptTemplate, buildPromptTemplateTest } from '../helpers/prompt-helpers';
import type { PromptTemplateKey } from '../../shared/config/prompt-templates';

export function registerPromptTestRoutes(app: Express) {
  app.post('/api/prompt-template-test', async (req, res) => {
    let promptPreview: string | undefined;
    try {
      const { key, template } = req.body as { key?: PromptTemplateKey; template?: string };
      if (!key || typeof key !== 'string') {
        return res.status(400).json({ error: 'Template key is required' });
      }
      const baseTemplate = getPromptTemplate(key);
      const effectiveTemplate = typeof template === 'string' && template.trim() ? template : baseTemplate;
      const payload = buildPromptTemplateTest(key, effectiveTemplate);
      if (!payload.prompt?.trim()) {
        return res.status(400).json({ error: 'Template rendered to empty prompt' });
      }
      promptPreview = payload.prompt.slice(0, 4000);
      const text = await withTimeout(
        generateText(getConfig(), payload as { prompt: string; systemInstruction?: string }),
        25000,
        '模板试跑超时：上游模型响应过慢，请稍后重试或先用渲染预览检查模板结构。',
      );
      res.json({
        text,
        promptPreview,
      });
    } catch (e) {
      logger.error(String(e));
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}
