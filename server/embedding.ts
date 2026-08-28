/**
 * Embedding service — local WASM inference via @xenova/transformers.
 * Uses bge-small-zh-v1.5 (384-dim, ~130 MB cached).  Falls back to
 * the configured LLM's embedding endpoint if WASM is unavailable.
 */
import { env, pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { generateEmbedding, getEmbeddingModelInfo } from './lib/server-llm';
import { getConfig } from './lib/config';
import { logger } from './logger';
import { createLlmExecution } from './helpers/llm-execution-gate';

let embedPipeline: FeatureExtractionPipeline | null = null;
let initPromise: Promise<void> | null = null;

// Provider mocks must never be allowed to populate the real Transformers cache.
// Tests exercise the LLM fallback path, so remote and local model reads are both
// disabled before the first pipeline call in test processes.
if (process.env.NODE_ENV === 'test') {
  env.allowRemoteModels = false;
  env.allowLocalModels = false;
}

export type EmbeddingStatus = 'ready' | 'initializing' | 'fallback' | 'unavailable';

export interface EmbeddingStatusSnapshot {
  status: EmbeddingStatus;
  provider: 'local' | 'llm' | null;
  modelId: string | null;
  reason?: string;
  lastFallbackAt: string | null;
  metrics: { localInitializationFailures: number; fallbackSuccesses: number; fallbackFailures: number };
}

let embeddingStatus: EmbeddingStatus = 'unavailable';
let embeddingReason: string | undefined = 'not_initialized';
let lastFallbackAt: string | null = null;
let retryPromise: Promise<EmbeddingStatusSnapshot> | null = null;
const embeddingMetrics = { localInitializationFailures: 0, fallbackSuccesses: 0, fallbackFailures: 0 };

/** Read-only capability state; this never initializes the model or calls a provider. */
export function getEmbeddingStatus(): EmbeddingStatusSnapshot {
  if (embedPipeline) {
    return {
      status: 'ready',
      provider: 'local',
      modelId: 'local:Xenova/bge-small-zh-v1.5',
      lastFallbackAt,
      metrics: { ...embeddingMetrics },
    };
  }

  if (embeddingStatus === 'initializing') {
    return { status: 'initializing', provider: 'local', modelId: 'local:Xenova/bge-small-zh-v1.5', lastFallbackAt, metrics: { ...embeddingMetrics } };
  }

  if (embeddingStatus === 'fallback') {
    const config = getConfig();
    const modelInfo = getEmbeddingModelInfo(config);
    return { status: 'fallback', provider: 'llm', modelId: modelInfo.modelId, reason: embeddingReason, lastFallbackAt, metrics: { ...embeddingMetrics } };
  }

  return { status: embeddingStatus, provider: null, modelId: null, reason: embeddingReason, lastFallbackAt, metrics: { ...embeddingMetrics } };
}

export class EmbeddingUnavailableError extends Error {
  readonly code = 'EMBEDDING_UNAVAILABLE';

  constructor(message = '语义检索暂不可用，已保留本地写作流程') {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

async function ensurePipeline(): Promise<void> {
  if (embedPipeline) return;
  if (initPromise) return initPromise;

  embeddingStatus = 'initializing';
  initPromise = (async () => {
    try {
      embedPipeline = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
      embeddingStatus = 'ready';
      embeddingReason = undefined;
      logger.info('Embedding pipeline ready (local WASM)');
    } catch (e) {
      logger.warn('Local embedding pipeline failed, will use LLM fallback', e);
      embedPipeline = null as unknown as FeatureExtractionPipeline | null;
      embeddingStatus = 'unavailable';
      embeddingReason = getConfig().apiKey.trim() ? 'local_pipeline_unavailable' : 'api_key_missing';
      embeddingMetrics.localInitializationFailures += 1;
    }
  })();

  return initPromise;
}

export async function retryLocalEmbeddingInitialization(): Promise<EmbeddingStatusSnapshot> {
  if (retryPromise) return retryPromise;
  retryPromise = (async () => {
    if (embedPipeline) return getEmbeddingStatus();
    if (embeddingStatus === 'initializing' && initPromise) {
      await initPromise;
      return getEmbeddingStatus();
    }
    initPromise = null;
    embeddingStatus = 'initializing';
    embeddingReason = undefined;
    await ensurePipeline();
    return getEmbeddingStatus();
  })().finally(() => {
    retryPromise = null;
  });
  return retryPromise;
}

export async function embedWithMetadata(
  text: string,
  novelId?: string,
  signal?: AbortSignal,
): Promise<{ values: number[]; modelId: string }> {
  await ensurePipeline();

  if (embedPipeline) {
    if (signal?.aborted) throw signal.reason || new Error('Embedding aborted');
    const result = await embedPipeline(text, { pooling: 'mean', normalize: true });
    if (signal?.aborted) throw signal.reason || new Error('Embedding aborted');
    return { values: Array.from(result.data as Float32Array), modelId: 'local:Xenova/bge-small-zh-v1.5' };
  }

  // LLM fallback — request embedding via API
  const config = getConfig();
  if (!config.apiKey.trim()) {
    // Do not manufacture a provider request when the user is offline or has
    // not configured a key. Callers can surface this as an honest degradation.
    embeddingStatus = 'unavailable';
    embeddingReason = 'api_key_missing';
    throw new EmbeddingUnavailableError();
  }
  try {
    const execution = await createLlmExecution({
      operation: 'embedding',
      novelId,
      timeoutMs: 30_000,
      concurrency: 2,
      signal,
    });
    const values = await execution.run(({ signal: executionSignal }) =>
      generateEmbedding(config, text, executionSignal, 30_000));
    const modelInfo = getEmbeddingModelInfo(config);
    embeddingStatus = 'fallback';
    embeddingReason = 'local_pipeline_unavailable';
    lastFallbackAt = new Date().toISOString();
    embeddingMetrics.fallbackSuccesses += 1;
    return { values, modelId: modelInfo.modelId };
  } catch (e) {
    if (signal?.aborted) throw signal.reason || e;
    logger.warn('LLM embedding fallback unavailable; semantic retrieval is degraded', e);
    embeddingStatus = 'unavailable';
    embeddingReason = 'llm_fallback_failed';
    lastFallbackAt = new Date().toISOString();
    embeddingMetrics.fallbackFailures += 1;
    throw new EmbeddingUnavailableError();
  }
}

export async function embed(text: string, novelId?: string, signal?: AbortSignal): Promise<number[]> {
  return (await embedWithMetadata(text, novelId, signal)).values;
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}
