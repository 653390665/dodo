import { generateText as generateTextRaw } from '../lib/server-llm';
import { createLlmExecution, hasActiveLlmExecution } from './llm-execution-gate';
import type { QuotaLimitType } from './quota-guard';

type GenerateConfig = Parameters<typeof generateTextRaw>[0];
type GenerateOptions = Parameters<typeof generateTextRaw>[1];

export interface LlmCallGovernance {
  operation: string;
  novelId?: string;
  quotaType?: QuotaLimitType;
  timeoutMs: number;
  concurrency?: number;
  signal?: AbortSignal;
}

/**
 * The sole route/helper entry point for text generation. Calls made inside an
 * existing execution session inherit its trace, cancellation and semaphore;
 * standalone/manual-settlement flows must declare their own governance.
 */
export async function governedGenerateText(
  config: GenerateConfig,
  options: GenerateOptions,
  governance?: LlmCallGovernance,
): Promise<string> {
  if (hasActiveLlmExecution()) return generateTextRaw(config, options);
  if (!governance) throw new Error('Ungoverned LLM call rejected');

  const execution = await createLlmExecution({
    operation: governance.operation,
    novelId: governance.novelId,
    quotaType: governance.quotaType,
    timeoutMs: governance.timeoutMs,
    concurrency: governance.concurrency,
    signal: governance.signal ?? options.signal,
    // Standalone governed provider calls live inside routes/jobs that already
    // apply one request-level limiter. Counting every writer/critic iteration
    // here would reject one legitimate multi-step workflow as its own burst.
    enforceRateLimit: false,
  });
  return execution.run(({ signal }) => generateTextRaw(config, { ...options, signal }));
}
