/**
 * Embedding service — local WASM inference via @xenova/transformers.
 * Uses bge-small-zh-v1.5 (384-dim, ~130 MB cached).  Falls back to
 * the configured LLM's embedding endpoint if WASM is unavailable.
 */
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { generateEmbedding } from './lib/server-llm';
import { getConfig } from './lib/config';
import { logger } from './logger';
import { createLlmExecution } from './helpers/llm-execution-gate';

let embedPipeline: FeatureExtractionPipeline | null = null;
let initPromise: Promise<void> | null = null;

async function ensurePipeline(): Promise<void> {
  if (embedPipeline) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      embedPipeline = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
      logger.info('Embedding pipeline ready (local WASM)');
    } catch (e) {
      logger.warn('Local embedding pipeline failed, will use LLM fallback', e);
      embedPipeline = null as unknown as FeatureExtractionPipeline | null;
    }
  })();

  return initPromise;
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
    const provider = !config.baseUrl || config.baseUrl.includes('generativelanguage.googleapis.com') ? 'google' : 'openai-compatible';
    const model = config.model?.includes('embedding') ? config.model : provider === 'google' ? 'text-embedding-004' : 'text-embedding-3-small';
    return { values, modelId: `${provider}:${model}` };
  } catch (e) {
    if (signal?.aborted) throw signal.reason || e;
    logger.error('LLM embedding fallback failed', e);
    throw new Error('Failed to generate embedding from LLM fallback');
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
