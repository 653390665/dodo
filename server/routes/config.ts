import { logger } from '../logger';
import type { Express } from 'express';
import { getConfig, getLastConfigError, reloadConfig, saveConfig, updateCachedApiKey } from '../lib/config';
import { mergePromptTemplates } from '../../shared/config/prompt-templates';
import { validate, configSchema } from '../validation';
import { generateText } from '../lib/server-llm';
import { withTimeout } from '../helpers/async-utils';

export function registerConfigRoutes(app: Express) {
  app.get('/api/config', (_req, res) => {
    try {
      const config = getConfig();
      const configError = getLastConfigError();
      res.json({
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        promptTemplates: config.promptTemplates,
        ...(configError ? { configError } : {}),
      });
    } catch (e) {
      logger.error('GET /api/config error:', e);
      res.status(500).json({ error: 'Failed to load config' });
    }
  });

  app.post('/api/config', validate(configSchema), (req, res) => {
    try {
      const { apiKey, baseUrl, model, promptTemplates } = req.body;
      const existing = getConfig();
      saveConfig({
        apiKey: apiKey || existing.apiKey,
        baseUrl: baseUrl || existing.baseUrl,
        model: model || existing.model,
        promptTemplates: mergePromptTemplates(promptTemplates),
      });
      reloadConfig();
      res.json({ ok: true });
    } catch (e) {
      logger.error('POST /api/config error:', e);
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  app.post('/api/config/sync', (req, res) => {
    try {
      const { apiKey } = req.body;
      if (apiKey !== undefined) {
        updateCachedApiKey(apiKey);
      }
      reloadConfig();
      res.json({ ok: true });
    } catch (e) {
      logger.error('POST /api/config/sync error:', e);
      res.status(500).json({ error: 'Failed to sync config' });
    }
  });

  app.post('/api/config/test-connection', async (req, res) => {
    try {
      const { apiKey, baseUrl, model } = req.body;
      const existing = getConfig();

      const effectiveConfig = {
        apiKey: apiKey || existing.apiKey,
        baseUrl: baseUrl || existing.baseUrl,
        model: model || existing.model,
        promptTemplates: existing.promptTemplates,
      };

      if (!effectiveConfig.apiKey) {
        return res.status(400).json({ error: 'API Key 未配置' });
      }

      const text = await withTimeout(
        generateText(effectiveConfig, {
          prompt: 'Please reply with the word "OK" only.',
          maxTokens: 5,
        }),
        10000,
        '链接测试超时：网络超时或大模型接口响应过慢。'
      );

      res.json({ ok: true, message: text });
    } catch (e) {
      logger.error('POST /api/config/test-connection error:', e);
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });
}
