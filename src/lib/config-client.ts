import { request, HttpApiError } from './http';
import { deriveLlmAvailability, type LlmAvailabilityState } from './llm-availability';

export type EmbeddingStatusValue = 'ready' | 'initializing' | 'fallback' | 'unavailable' | 'unknown';

/** Shape of the server `GET /api/config` payload. */
export interface LlmConfig {
  hasApiKey?: boolean;
  livenessStatus?: 'connected' | 'unknown' | 'disconnected' | string;
  embeddingStatus?: { status?: EmbeddingStatusValue; reason?: string | null; provider?: string | null; modelId?: string | null } | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  baseUrl?: string;
  model?: string;
  promptGuardLevel?: 'strict' | 'balanced' | 'disabled';
  promptTemplates?: Record<string, unknown>;
  configError?: unknown;
}

/** Payload accepted by the server `POST /api/config` (see `configSchema`). */
export interface LlmConfigSaveInput {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  promptGuardLevel?: 'strict' | 'balanced' | 'disabled';
  promptTemplates?: Record<string, unknown>;
}

export interface LlmConfigSnapshot {
  config: LlmConfig;
  availability: LlmAvailabilityState;
}

export async function fetchLlmConfig(init?: RequestInit): Promise<LlmConfigSnapshot> {
  const config = await request<LlmConfig>('/api/config', init);
  return { config, availability: deriveLlmAvailability(config) };
}

export async function saveLlmConfig(config: LlmConfigSaveInput): Promise<void> {
  await request<{ ok: boolean }>('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
}

export { HttpApiError };
