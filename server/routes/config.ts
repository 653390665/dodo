import type { Express } from 'express';
import { getConfig, getLastConfigError, reloadConfig, saveConfig } from '../../src/lib/config';
import { mergePromptTemplates } from '../../src/config/prompt-templates';

export function registerConfigRoutes(app: Express) {
  app.get('/api/config', (_req, res) => {
    const config = getConfig();
    const configError = getLastConfigError();
    res.json({
      hasApiKey: !!config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      promptTemplates: config.promptTemplates,
      ...(configError ? { configError } : {}),
    });
  });

  app.post('/api/config', (req, res) => {
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
  });
}
