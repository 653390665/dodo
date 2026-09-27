/**
 * Embedding service — local inference via @huggingface/transformers.
 * Uses bge-small-zh-v1.5 (512-dim, ~23 MB quantized ONNX).  Falls back to
 * the configured LLM's embedding endpoint if local inference is unavailable.
 *
 * Note: this model outputs 512-dim vectors (the 384 figure belongs to
 * bge-small-en-v1.5); vector_chunks compatibility relies on the model id and
 * dimension staying identical across runtime upgrades.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { generateEmbedding, getEmbeddingModelInfo } from './lib/server-llm';
import { getConfig } from './lib/config';
import { logger } from './logger';
import { createLlmExecution } from './helpers/llm-execution-gate';

let embedPipeline: FeatureExtractionPipeline | null = null;
let initPromise: Promise<void> | null = null;

// TS2590: the exported `pipeline` overload union is too large for tsc to resolve
// (huggingface/transformers.js#1249), so narrow it to the single task we use.
type FeatureExtractionPipelineFactory = (
  task: 'feature-extraction',
  modelId: string,
  options?: { dtype?: 'q8' | 'fp16' | 'fp32' | 'auto' }
) => Promise<FeatureExtractionPipeline>;

/**
 * 离线语义检索所需的权重清单（dtype q8 → onnx/model_quantized.onnx）。
 * 必须与 scripts/lib/embedding-weights.mjs 的 EMBEDDING_MODEL_FILES 一致
 * （tests/embedding-model-assets.test.ts 断言一致）。
 */
export const LOCAL_EMBEDDING_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
] as const;

/** 权重模型 id：与 vector_chunks 的 modelId 匹配，不得改。 */
const MODEL_ID = 'Xenova/bge-small-zh-v1.5';

export interface EmbeddingAssetPaths {
  /** 随包权重目录（electron-builder extraResources → Resources/embedding-model）。 */
  localModelPath?: string;
  /** 可写的权重缓存目录（userData/models-cache；app 包体在签名/更新/Gatekeeper 下不可写）。 */
  cacheDir?: string;
  /** 随包权重齐备 → 关闭远程拉取（离线优先，避免首启静默出网）。 */
  disableRemoteModels: boolean;
}

/**
 * 解析打包态权重/缓存落点（Plan 263 E2，对应 R6·M6）。
 *
 * - 权重齐备：`env.localModelPath` 指向随包目录且关闭远程（离线可用）。
 * - 权重不全：只设缓存目录、保留远程 —— 宁可联网补齐，也不把本地能力静默打死。
 * - 两个变量由 electron.cjs 在打包态注入；dev 下不注入，沿用 transformers 默认缓存。
 */
export function resolveEmbeddingAssetPaths(
  input: { bundledModelDir?: string | null; modelCacheDir?: string | null } = {},
  deps: { exists?: (target: string) => boolean; join?: (...parts: string[]) => string } = {}
): EmbeddingAssetPaths {
  const exists = deps.exists ?? existsSync;
  const join = deps.join ?? path.join;
  const bundled = input.bundledModelDir?.trim();
  const cacheDir = input.modelCacheDir?.trim();
  const modelDir = bundled ? join(bundled, ...MODEL_ID.split('/')) : '';
  const complete =
    modelDir !== '' && LOCAL_EMBEDDING_MODEL_FILES.every((file) => exists(join(modelDir, file)));

  return {
    ...(complete ? { localModelPath: bundled as string } : {}),
    ...(cacheDir ? { cacheDir } : {}),
    disableRemoteModels: complete,
  };
}

// 打包态落点（Plan 263 E2）：由 electron.cjs 注入；dev 下不注入，走 transformers 默认缓存。
const embeddingAssetPaths = resolveEmbeddingAssetPaths({
  bundledModelDir: process.env.INKFLOW_EMBEDDING_MODEL_DIR,
  modelCacheDir: process.env.INKFLOW_MODEL_CACHE_DIR,
});
if (embeddingAssetPaths.localModelPath) env.localModelPath = embeddingAssetPaths.localModelPath;
if (embeddingAssetPaths.cacheDir) env.cacheDir = embeddingAssetPaths.cacheDir;
if (embeddingAssetPaths.disableRemoteModels) env.allowRemoteModels = false;

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
  metrics: {
    localInitializationFailures: number;
    fallbackSuccesses: number;
    fallbackFailures: number;
  };
}

let embeddingStatus: EmbeddingStatus = 'unavailable';
let embeddingReason: string | undefined = 'not_initialized';
let lastFallbackAt: string | null = null;
let retryPromise: Promise<EmbeddingStatusSnapshot> | null = null;
const embeddingMetrics = {
  localInitializationFailures: 0,
  fallbackSuccesses: 0,
  fallbackFailures: 0,
};

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
    return {
      status: 'initializing',
      provider: 'local',
      modelId: 'local:Xenova/bge-small-zh-v1.5',
      lastFallbackAt,
      metrics: { ...embeddingMetrics },
    };
  }

  if (embeddingStatus === 'fallback') {
    const config = getConfig();
    const modelInfo = getEmbeddingModelInfo(config);
    return {
      status: 'fallback',
      provider: 'llm',
      modelId: modelInfo.modelId,
      reason: embeddingReason,
      lastFallbackAt,
      metrics: { ...embeddingMetrics },
    };
  }

  return {
    status: embeddingStatus,
    provider: null,
    modelId: null,
    reason: embeddingReason,
    lastFallbackAt,
    metrics: { ...embeddingMetrics },
  };
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
      // dtype 'q8' keeps the quantized model that @xenova/transformers v2 loaded
      // by default, so cached files and embedding outputs stay compatible.
      // Model id must not change: vector_chunks rows are matched on modelId equality.
      embedPipeline = await (pipeline as unknown as FeatureExtractionPipelineFactory)(
        'feature-extraction',
        'Xenova/bge-small-zh-v1.5',
        { dtype: 'q8' }
      );
      embeddingStatus = 'ready';
      embeddingReason = undefined;
      logger.info('Embedding pipeline ready (local WASM)', {
        localModelPath: env.localModelPath,
        cacheDir: env.cacheDir,
        allowRemoteModels: env.allowRemoteModels,
      });
    } catch (e) {
      logger.warn('Local embedding pipeline failed, will use LLM fallback', e);
      embedPipeline = null as unknown as FeatureExtractionPipeline | null;
      embeddingStatus = 'unavailable';
      embeddingReason = getConfig().apiKey.trim()
        ? 'local_pipeline_unavailable'
        : 'api_key_missing';
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
  signal?: AbortSignal
): Promise<{ values: number[]; modelId: string }> {
  await ensurePipeline();

  if (embedPipeline) {
    if (signal?.aborted) throw signal.reason || new Error('Embedding aborted');
    const result = await embedPipeline(text, { pooling: 'mean', normalize: true });
    if (signal?.aborted) throw signal.reason || new Error('Embedding aborted');
    return {
      values: Array.from(result.data as Float32Array),
      modelId: 'local:Xenova/bge-small-zh-v1.5',
    };
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
      generateEmbedding(config, text, executionSignal, 30_000)
    );
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

export async function embed(
  text: string,
  novelId?: string,
  signal?: AbortSignal
): Promise<number[]> {
  return (await embedWithMetadata(text, novelId, signal)).values;
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (
    a.length === 0 ||
    a.length !== b.length ||
    !a.every(Number.isFinite) ||
    !b.every(Number.isFinite)
  )
    return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}
