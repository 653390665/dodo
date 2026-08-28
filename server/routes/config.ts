import { logger } from '../logger';
import type { Express } from 'express';
import { getConfig, getLastConfigError, reloadConfig, saveConfig, updateCachedApiKey, getLivenessStatus, setLivenessStatus } from '../lib/config';
import { mergePromptTemplates } from '../../shared/config/prompt-templates';
import { validate, configConnectionSchema, configSchema } from '../validation';
import { governedGenerateText as generateText } from '../helpers/governed-llm';
import { createLlmExecution, LlmExecutionRejectedError } from '../helpers/llm-execution-gate';
import { bindClientDisconnect } from '../helpers/stream-disconnect';
import { discoverModels } from '../helpers/model-discovery';
import { getEmbeddingStatus, retryLocalEmbeddingInitialization } from '../embedding';

// Reasoning models may spend their first tokens on hidden reasoning before
// emitting the visible response used by the connection probe.
const CONNECTION_PROBE_MAX_TOKENS = 128;

export function registerConfigRoutes(app: Express) {
  app.get('/api/config', (_req, res) => {
    try {
      const config = getConfig();
      const configError = getLastConfigError();
      const embedding = getEmbeddingStatus();
      res.json({
        hasApiKey: !!config.apiKey,
        livenessStatus: getLivenessStatus(),
        embeddingStatus: embedding,
        embeddingProvider: embedding.provider,
        embeddingModel: embedding.modelId,
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

  app.post('/api/config/embedding/retry', async (_req, res) => {
    try {
      const embeddingStatus = await retryLocalEmbeddingInitialization();
      return res.status(embeddingStatus.status === 'ready' ? 200 : 503).json({ embeddingStatus });
    } catch (error) {
      logger.warn('POST /api/config/embedding/retry failed', error);
      return res.status(503).json({ embeddingStatus: getEmbeddingStatus() });
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

      // ── Single execution gate: shared timeout / concurrency / rate-limit ──
      const execution = await createLlmExecution({
        operation: 'config-test-connection',
        novelId: undefined,
        timeoutMs: 15_000,
        concurrency: 1,
        signal: controller.signal,
      });

      const result = await execution.run(async ({ signal }) => {
        // Phase 1: Model discovery
        let models: string[] = [];
        let modelDiscovery: 'available' | 'unsupported' = 'unsupported';
        let discoveryWarning: string | undefined;

        try {
          const discResult = await discoverModels(effectiveConfig, signal);
          models = discResult.models;
          modelDiscovery = discResult.discovery;
        } catch (e) {
          // AbortError must NOT degrade to unsupported — propagate so caller
          // can return a generic error instead of a misleading "discovery OK".
          if (e instanceof Error && (e.name === 'AbortError' || signal.aborted)) {
            throw e;
          }
          // 401/403 from discovery — surface as credential failure.
          const status = (e as Error & { status?: number }).status;
          if (status === 401 || status === 403) {
            throw e;
          }
          // Other discovery errors — degrade gracefully.
          discoveryWarning = '模型列表获取失败，请手动填写模型名称';
        }

        const responseBase = {
          models,
          modelDiscovery,
          ...(discoveryWarning ? { warning: discoveryWarning } : {}),
        };

        // If model is empty, return the list for selection.
        if (!effectiveConfig.model) {
          return {
            ...responseBase,
            ok: false,
            connectionOk: false,
            selectedModelValid: false,
            modelTested: false,
            message: models.length > 0
              ? '请从已发现的模型中选择一个'
              : '请输入模型名称',
          };
        }

        // If discovery succeeded but the model is not in the list, don't probe.
        if (modelDiscovery === 'available' && models.length > 0 && !models.includes(effectiveConfig.model)) {
          return {
            ...responseBase,
            ok: false,
            connectionOk: false,
            selectedModelValid: false,
            modelTested: false,
            message: `模型 "${effectiveConfig.model}" 不在可用列表中，请选择后再次测试`,
          };
        }

        // Phase 2: Probe the model via a short generation.
        const text = await generateText(effectiveConfig, {
          prompt: 'Please reply with the word "OK" only.',
          maxTokens: CONNECTION_PROBE_MAX_TOKENS,
          signal,
        });

        return {
          ...responseBase,
          ok: true,
          connectionOk: true,
          selectedModelValid: true,
          modelTested: true,
          message: text,
        };
      });

      return res.json(result);
    } catch (e) {
      logger.error('POST /api/config/test-connection error:', e);
      if (!res.writableEnded) {
        // 401/403 from discovery
        const status = (e as Error & { status?: number }).status;
        if (status === 401 || status === 403) {
          return res.status(401).json({ error: 'API Key 验证失败' });
        }
        if (e instanceof LlmExecutionRejectedError) {
          return res.status(e.status).json({
            error: e.message,
            code: e.quota.code,
            ...(e.status === 429 ? { retryAfter: 5 } : {}),
          });
        }
        // Generic error — log detailed info, return opaque message.
        res.status(500).json({ error: '连接测试失败，请检查网络或配置后重试' });
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
        maxTokens: CONNECTION_PROBE_MAX_TOKENS,
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
