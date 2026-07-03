/**
 * Embedding service — local WASM inference via @xenova/transformers.
 * Uses bge-small-zh-v1.5 (384-dim, ~130 MB cached).  Falls back to
 * the configured LLM's embedding endpoint if WASM is unavailable.
 */
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { generateEmbedding } from './lib/server-llm';
import { getConfig } from './lib/config';
import { logger } from './logger';

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

export async function embed(text: string): Promise<number[]> {
  await ensurePipeline();

  if (embedPipeline) {
    const result = await embedPipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data as Float32Array);
  }

  // LLM fallback — request embedding via API
  const config = getConfig();
  try {
    return await generateEmbedding(config, text);
  } catch (e) {
    logger.error('LLM embedding fallback failed', e);
    throw new Error('Failed to generate embedding from LLM fallback');
  }
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}
