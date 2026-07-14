import { logger } from '../logger';
import type { Express } from 'express';
import { getConfig, getLastConfigError, reloadConfig, saveConfig, updateCachedApiKey, getLivenessStatus, setLivenessStatus } from '../lib/config';
import { mergePromptTemplates } from '../../shared/config/prompt-templates';
import { validate, configConnectionSchema, configSchema } from '../validation';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';
import { bindClientDisconnect } from '../helpers/stream-disconnect';
import { discoverModels } from '../helpers/model-discovery';

export function registerConfigRoutes(app: Express) {
  app.get('/api/config', (_req, res) => {
    try {
      const config = getConfig();
      const configError = getLastConfigError();
      res.json({
        hasApiKey: !!config.apiKey,
        livenessStatus: getLivenessStatus(),
        baseUrl: config.baseUrl,
        model: config.model,
        promptGuardLevel: config.promptGuardLevel || 'strict',
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
      const { apiKey, baseUrl, model, promptTemplates, promptGuardLevel } = req.body;
      const existing = getConfig();
      saveConfig({
        apiKey: apiKey || existing.apiKey,
        baseUrl: baseUrl || existing.baseUrl,
        model: model || existing.model,
        promptGuardLevel: promptGuardLevel || existing.promptGuardLevel || 'strict',
        promptTemplates: mergePromptTemplates(promptTemplates),
      });
      reloadConfig();
      res.json({ ok: true });
    } catch (e) {
      logger.error('POST /api/config error:', e);
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  app.post('/api/config/sync', validate(configSchema), (req, res) => {
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

  app.post('/api/config/test-connection', validate(configConnectionSchema), async (req, res) => {
    const controller = new AbortController();
    const disposeDisconnect = bindClientDisconnect(req, res, () => controller.abort());
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

      // ── Phase 1: Model discovery (shares the execution gate's signal + timeout) ──
      // A connection test happens before a project is selected, so it is an
      // explicit non-quota operation inside the shared execution gate.
      const execution = await createLlmExecution({
        operation: 'config-test-connection',
        novelId: undefined,
        timeoutMs: 15_000,
        concurrency: 1,
        signal: controller.signal,
      });

      let models: string[] = [];
      let modelDiscovery: 'available' | 'unsupported' = 'unsupported';
      let discoveryWarning: string | undefined;

      try {
        const result = await execution.run(({ signal }) => discoverModels(effectiveConfig, signal));
        models = result.models;
        modelDiscovery = result.discovery;
      } catch (e) {
        // 401/403 from discovery — surface as a credential warning but keep going.
        const status = (e as Error & { status?: number }).status;
        if (status === 401 || status === 403) {
          return res.status(401).json({ error: 'API Key 验证失败' });
        }
        // Other discovery errors — degrade gracefully, continue to connection test.
        discoveryWarning = '模型列表获取失败，请手动填写模型名称';
      }

      const selectedModelValid = !!effectiveConfig.model && models.includes(effectiveConfig.model);

      // ── Phase 2: Connection test (only when model is known to be valid) ──
      // If the model is empty or not in the discovered list, skip the generation
      // probe; return the model list so the user can pick one.
      if (!effectiveConfig.model || !selectedModelValid) {
        const message = effectiveConfig.model
          ? `模型 "${effectiveConfig.model}" 不在可用列表中，请选择后再次测试`
          : '请从已发现的模型中选择一个';
        return res.json({
          ok: false,
          connectionOk: false,
          models,
          modelDiscovery,
          selectedModelValid: false,
          modelTested: false,
          message,
          ...(discoveryWarning ? { warning: discoveryWarning } : {}),
        });
      }

      let connectionOk = false;
      let message = '';
      const text = await execution.run(({ signal }) =>
        generateText(effectiveConfig, {
          prompt: 'Please reply with the word "OK" only.',
          maxTokens: 5,
          signal,
        }));
      connectionOk = true;
      message = text;

      res.json({
        ok: true,
        connectionOk,
        models,
        modelDiscovery,
        selectedModelValid: true,
        modelTested: true,
        message,
        ...(discoveryWarning ? { warning: discoveryWarning } : {}),
      });
    } catch (e) {
      logger.error('POST /api/config/test-connection error:', e);
      if (!res.writableEnded) {
        if (e instanceof LlmExecutionRejectedError) {
          return res.status(e.status).json({
            error: e.message,
            code: e.quota.code,
            ...(e.status === 429 ? { retryAfter: 5 } : {}),
          });
        }
        res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      }
    } finally {
      disposeDisconnect();
    }
  });

  // Trigger startup liveness check asynchronously on boot
  triggerStartupLivenessCheck();
}

async function triggerStartupLivenessCheck() {
  try {
    const config = getConfig();
    if (!config.apiKey) {
      setLivenessStatus('disconnected');
      return;
    }

    setLivenessStatus('unknown');

    // Startup liveness is the same explicit non-quota exception.
    const execution = await createLlmExecution({
      operation: 'startup-connection-check',
      novelId: undefined,
      timeoutMs: 5_000,
      concurrency: 1,
    });
    await execution.run(({ signal }) =>
      generateText(config, {
        prompt: 'Please reply with "OK".',
        maxTokens: 5,
        maxAttempts: 1, // Only 1 attempt during startup check
        signal,
      }));
    setLivenessStatus('connected');
    logger.info('LLM startup liveness check: Connected successfully.');
  } catch (_e) {
    setLivenessStatus('unknown');
    logger.warn('LLM startup liveness check: Failed or timed out. Status set to unknown.');
  }
}
